from __future__ import annotations

"""Lifecycle metrics for the autopilot.

Without these there is no way to tell whether the autopilot is improving or
degrading: every judgement about it has so far come from reading individual
runs. One row per finished run, derived from what the executor already returns,
so nothing new has to be measured at the call sites.

Deliberately a pure function plus a tiny aggregator: what to do with the numbers
(store them, chart them, alert on them) is the caller's decision, and keeping
this module free of I/O keeps it testable.
"""

import logging
from typing import Any, Iterable

logger = logging.getLogger(__name__)


def run_metrics(result: Any) -> dict[str, Any]:
    """Flatten one `CodingExecutionResult` into a metrics row."""
    plan = getattr(result, "plan", None) or {}
    counts = plan.get("counts") or {}
    findings = getattr(result, "review_findings", None) or []
    verification = getattr(result, "verification", None) or {}
    timings = getattr(result, "timings", None) or {}

    total_steps = int(counts.get("total") or 0)
    done_steps = int(counts.get("done") or 0)
    return {
        "success": bool(getattr(result, "success", False)),
        "delivered": bool(getattr(result, "pr_url", "")),
        "workspace": getattr(result, "workspace", "clone"),
        "plan_steps": total_steps,
        "plan_done": done_steps,
        "plan_blocked": int(counts.get("blocked") or 0),
        # None rather than 0 for a run with no plan: a zero completion rate and
        # "there was no plan" are different facts and must not average together.
        "plan_completion": round(done_steps / total_steps, 3) if total_steps else None,
        "tool_steps": len(getattr(result, "steps", None) or []),
        "findings_total": len(findings),
        "findings_blocking": sum(1 for item in findings if item.get("severity") in ("blocker", "major")),
        "verification_status": str(verification.get("status") or "skipped"),
        "verification_spec": str(verification.get("spec") or ""),
        "duration_seconds": float(timings.get("total") or 0.0),
        "phase_seconds": {key: value for key, value in timings.items() if key != "total"},
    }


def aggregate(rows: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Summarise many runs. Empty input gives an empty summary, not a crash."""
    rows = list(rows)
    if not rows:
        return {"runs": 0}

    completions = [row["plan_completion"] for row in rows if row.get("plan_completion") is not None]
    statuses: dict[str, int] = {}
    for row in rows:
        status = row.get("verification_status") or "skipped"
        statuses[status] = statuses.get(status, 0) + 1

    durations = [row.get("duration_seconds") or 0.0 for row in rows]
    return {
        "runs": len(rows),
        "delivered": sum(1 for row in rows if row.get("delivered")),
        "delivery_rate": round(sum(1 for row in rows if row.get("delivered")) / len(rows), 3),
        "persistent_workspace_rate": round(
            sum(1 for row in rows if row.get("workspace") == "worktree") / len(rows), 3
        ),
        "avg_plan_completion": round(sum(completions) / len(completions), 3) if completions else None,
        "blocked_steps": sum(row.get("plan_blocked") or 0 for row in rows),
        "findings_total": sum(row.get("findings_total") or 0 for row in rows),
        "findings_blocking": sum(row.get("findings_blocking") or 0 for row in rows),
        "verification": statuses,
        # Verification only means something when it actually ran; counting
        # `skipped` as a pass would make an unconfigured environment look green.
        "verification_pass_rate": (
            round(statuses.get("passed", 0) / (statuses.get("passed", 0) + statuses.get("failed", 0)), 3)
            if (statuses.get("passed", 0) + statuses.get("failed", 0))
            else None
        ),
        "avg_duration_seconds": round(sum(durations) / len(durations), 1),
    }
