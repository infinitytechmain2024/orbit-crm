from __future__ import annotations

"""Autopilot planner: an approved task becomes an explicit, trackable plan.

The plan is a first-class artifact, not a scratchpad the model keeps in its
head. It is written into the repository working copy at a fixed, predictable
path (`docs/autopilot/plans/<slug>.md`), it ships inside the same pull request
as the code, and its per-step status is rewritten to disk the moment a step
completes or gets blocked — so a run that dies halfway still leaves a truthful
record of how far it got.

Design notes:
  * Statuses are deliberately three-valued. `blocked` exists so one dead step
    does not have to abort the run: the executor records why and keeps going
    on the steps that do not depend on it.
  * Rendering and parsing are inverses. The file on disk is the source of
    truth a human reads in the PR; the in-memory object is what the executor
    mutates. Round-tripping keeps the two from drifting.
  * Nothing here talks to git or the network. Persisting is the caller's job,
    which keeps this module trivially unit-testable.
"""

import json
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

PLAN_DIR = "docs/autopilot/plans"
MAX_STEPS = 12
MIN_STEPS = 2

STATUS_PENDING = "pending"
STATUS_DONE = "done"
STATUS_BLOCKED = "blocked"

_STATUS_MARK = {STATUS_PENDING: " ", STATUS_DONE: "x", STATUS_BLOCKED: "!"}
_MARK_STATUS = {mark: status for status, mark in _STATUS_MARK.items()}

_STEP_LINE = re.compile(r"^- \[(?P<mark>[ x!])\] (?P<id>[\w.]+)\. (?P<rest>.*)$")


def slugify(value: str, *, limit: int = 40) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (value or "").lower()).strip("-")
    return slug[:limit] or "task"


@dataclass
class PlanStep:
    id: str
    title: str
    detail: str = ""
    status: str = STATUS_PENDING
    note: str = ""

    @property
    def done(self) -> bool:
        return self.status == STATUS_DONE

    @property
    def blocked(self) -> bool:
        return self.status == STATUS_BLOCKED

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "detail": self.detail,
            "status": self.status,
            "note": self.note,
        }


@dataclass
class AutopilotPlan:
    task_id: str
    task_title: str
    goal: str = ""
    steps: list[PlanStep] = field(default_factory=list)

    # ── lookup / mutation ────────────────────────────────────────────
    def find(self, step_id: str) -> PlanStep | None:
        wanted = str(step_id or "").strip().rstrip(".")
        for step in self.steps:
            if step.id == wanted:
                return step
        return None

    def mark(self, step_id: str, status: str, note: str = "") -> PlanStep | None:
        step = self.find(step_id)
        if step is None:
            return None
        step.status = status
        step.note = (note or "").strip()[:400]
        return step

    # ── reporting ────────────────────────────────────────────────────
    @property
    def pending(self) -> list[PlanStep]:
        return [step for step in self.steps if step.status == STATUS_PENDING]

    def counts(self) -> dict[str, int]:
        return {
            "total": len(self.steps),
            "done": sum(1 for step in self.steps if step.done),
            "blocked": sum(1 for step in self.steps if step.blocked),
            "pending": len(self.pending),
        }

    def to_dict(self) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "task_title": self.task_title,
            "goal": self.goal,
            "path": self.relative_path,
            "counts": self.counts(),
            "steps": [step.to_dict() for step in self.steps],
        }

    # ── persistence ──────────────────────────────────────────────────
    @property
    def relative_path(self) -> str:
        return f"{PLAN_DIR}/{slugify(self.task_id, limit=36)}-{slugify(self.task_title)}.md"

    def render(self) -> str:
        counts = self.counts()
        lines = [
            f"# Autopilot plan — {self.task_title}",
            "",
            f"- Задача: `{self.task_id}`",
            f"- Цель: {self.goal or '—'}",
            f"- Прогресс: {counts['done']}/{counts['total']} выполнено"
            + (f", {counts['blocked']} заблокировано" if counts["blocked"] else ""),
            "",
            "Статусы: `[ ]` не сделано · `[x]` сделано · `[!]` заблокировано.",
            "",
            "## Шаги",
            "",
        ]
        for step in self.steps:
            mark = _STATUS_MARK.get(step.status, " ")
            lines.append(f"- [{mark}] {step.id}. {step.title}")
            if step.detail:
                lines.append(f"      - Что сделать: {step.detail}")
            if step.note:
                label = "Заблокировано" if step.blocked else "Заметка"
                lines.append(f"      - {label}: {step.note}")
        lines.append("")
        lines.append("_Файл ведёт Orbit Autopilot автоматически: он переписывается после каждого шага._")
        lines.append("")
        return "\n".join(lines)

    def write(self, workdir: Path) -> Path:
        """Persist the plan inside the repository working copy."""
        target = workdir / self.relative_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(self.render(), encoding="utf-8")
        return target


def parse(markdown: str, *, task_id: str = "", task_title: str = "") -> AutopilotPlan:
    """Read a rendered plan back into an object. Inverse of :meth:`AutopilotPlan.render`."""
    steps: list[PlanStep] = []
    goal = ""
    for raw in (markdown or "").splitlines():
        line = raw.rstrip()
        if line.startswith("- Цель: "):
            goal = line[len("- Цель: ") :].strip()
            if goal == "—":
                goal = ""
            continue
        match = _STEP_LINE.match(line.strip())
        if match:
            steps.append(
                PlanStep(
                    id=match.group("id"),
                    title=match.group("rest").strip(),
                    status=_MARK_STATUS.get(match.group("mark"), STATUS_PENDING),
                )
            )
            continue
        stripped = line.strip()
        if steps and stripped.startswith("- Что сделать: "):
            steps[-1].detail = stripped[len("- Что сделать: ") :].strip()
        elif steps and (stripped.startswith("- Заблокировано: ") or stripped.startswith("- Заметка: ")):
            steps[-1].note = stripped.split(": ", 1)[1].strip()
    return AutopilotPlan(task_id=task_id, task_title=task_title, goal=goal, steps=steps)


# ── plan generation ──────────────────────────────────────────────────

PLANNER_SYSTEM_PROMPT = (
    "Ты — планировщик Orbit Autopilot. Ты получаешь инженерную задачу и разбиваешь её "
    "на атомарные шаги, каждый из которых можно выполнить и проверить отдельно. "
    "Отвечай ТОЛЬКО валидным JSON вида "
    '{"goal": "...", "steps": [{"title": "...", "detail": "..."}]}. '
    f"Шагов должно быть от {MIN_STEPS} до {MAX_STEPS}. "
    "title — короткая формулировка результата шага; detail — какие файлы/места тронуть. "
    "Не выдумывай шаги про деплой, релиз или доступы, которых задача не требует."
)


def _extract_json_object(text: str) -> dict[str, Any] | None:
    """Pull the first balanced JSON object out of a model answer.

    Deliberately local rather than imported from ``orbit_commander``: that module
    imports the coding executor, which imports this one, so sharing the helper
    would create an import cycle.
    """
    if not text:
        return None
    candidate = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", candidate, re.DOTALL)
    if fence:
        candidate = fence.group(1).strip()
    start = candidate.find("{")
    while start != -1:
        depth = 0
        in_string = False
        escaped = False
        for index in range(start, len(candidate)):
            char = candidate[index]
            if in_string:
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == '"':
                    in_string = False
                continue
            if char == '"':
                in_string = True
            elif char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    try:
                        parsed = json.loads(candidate[start : index + 1])
                    except json.JSONDecodeError:
                        break
                    return parsed if isinstance(parsed, dict) else None
        start = candidate.find("{", start + 1)
    return None


def fallback_plan(task: dict[str, Any]) -> AutopilotPlan:
    """Deterministic plan used when the planner model is unavailable or unusable.

    A run must never die because planning failed — acceptance criteria are
    already a serviceable step list, and an explicit two-step skeleton beats
    no plan at all.
    """
    criteria = [str(item).strip() for item in (task.get("acceptance_criteria") or []) if str(item).strip()]
    titles = criteria[:MAX_STEPS] or [
        f"Реализовать: {task.get('title') or 'задача'}",
        "Проверить изменения и убедиться, что ничего не сломано",
    ]
    return AutopilotPlan(
        task_id=str(task.get("id") or "task"),
        task_title=str(task.get("title") or "Задача"),
        goal=str(task.get("goal") or task.get("description") or "")[:500],
        steps=[PlanStep(id=str(index), title=title[:300]) for index, title in enumerate(titles, start=1)],
    )


def build_plan(task: dict[str, Any], payload: dict[str, Any] | None) -> AutopilotPlan:
    """Turn a planner response into a plan, falling back when it is unusable."""
    raw_steps = (payload or {}).get("steps")
    if not isinstance(raw_steps, list):
        return fallback_plan(task)
    steps: list[PlanStep] = []
    for item in raw_steps[:MAX_STEPS]:
        if isinstance(item, str):
            title, detail = item, ""
        elif isinstance(item, dict):
            title = str(item.get("title") or item.get("step") or "").strip()
            detail = str(item.get("detail") or item.get("description") or "").strip()
        else:
            continue
        if not title:
            continue
        steps.append(PlanStep(id=str(len(steps) + 1), title=title[:300], detail=detail[:500]))
    if len(steps) < MIN_STEPS:
        return fallback_plan(task)
    return AutopilotPlan(
        task_id=str(task.get("id") or "task"),
        task_title=str(task.get("title") or "Задача"),
        goal=str((payload or {}).get("goal") or task.get("goal") or task.get("description") or "")[:500],
        steps=steps,
    )


async def generate(complete: Any, task: dict[str, Any]) -> AutopilotPlan:
    """Ask the model for a plan. `complete` is an awaitable (messages) -> result-or-None."""
    user_prompt = (
        f"Задача: {task.get('title') or ''}\n"
        f"Описание: {task.get('description') or ''}\n"
        f"Критерии приёмки: {json.dumps(task.get('acceptance_criteria') or [], ensure_ascii=False)}"
    )
    try:
        result = await complete(
            [
                {"role": "system", "content": PLANNER_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ]
        )
    except Exception:  # pragma: no cover - planning must never abort a run
        logger.exception("autopilot planner call failed; using fallback plan")
        return fallback_plan(task)
    if result is None:
        logger.info("autopilot planner returned nothing; using fallback plan")
        return fallback_plan(task)
    return build_plan(task, _extract_json_object(getattr(result, "content", "") or ""))
