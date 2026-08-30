from __future__ import annotations

"""Autopilot verifier: reviews the real diff, then proves it in a browser.

Two independent checks run after the executor says it is finished:

1. **Self review** — the model is shown the actual `git diff` of what it wrote
   (never its own recollection of what it wrote) and must answer with a strict
   JSON list of findings. Reviewing the diff is the whole point: the failure
   mode this guards against is an agent that reports success for an edit that
   never landed, or that landed in the wrong file.

2. **End-to-end self test** — Playwright drives a real browser against the
   working copy: log in with a *local* test account, walk the user flow, and
   fail on console errors. This is what turns "the code compiles" into "the
   feature actually works".

Credential handling is the security-critical part and is enforced here, not by
prompt:
  * Test credentials arrive from settings (i.e. the operator's un-committed
    `.env.e2e.local`) and are passed to the subprocess only through its
    environment — never argv, never a written file.
  * The subprocess gets a hand-built minimal environment, NOT a copy of
    `os.environ`, so the GitHub token and every AI provider key are structurally
    absent from the browser test's process.
  * All captured output is scrubbed of the known secret values before it is
    stored in a report, an artifact, or a log line.
"""

import asyncio
import json
import logging
import os
import re
import shutil
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable

from backend.config import settings
from backend.services.autopilot_plan import AutopilotPlan, _extract_json_object

logger = logging.getLogger(__name__)

# Nominal per-step ceilings. The real ceiling is whatever budget the caller has
# left: `run_browser_self_test` hands each step `min(nominal, remaining)`, so a
# run that spent most of its time on the tool loop degrades to a clean "skipped"
# instead of overrunning the job timeout and being killed mid-verification.
INSTALL_TIMEOUT_SECONDS = 900
BROWSER_INSTALL_TIMEOUT_SECONDS = 600
E2E_TIMEOUT_SECONDS = 900
NOMINAL_BUDGET_SECONDS = INSTALL_TIMEOUT_SECONDS + BROWSER_INSTALL_TIMEOUT_SECONDS + E2E_TIMEOUT_SECONDS
# Below this there is no point starting: a warm install plus the shortest useful
# Playwright run does not fit, and a half-run that gets cut off reads as a
# verification failure when it is really a scheduling failure.
MIN_BUDGET_SECONDS = 300
OUTPUT_TAIL = 3000

SEVERITIES = ("blocker", "major", "minor")
BLOCKING_SEVERITIES = ("blocker", "major")

REVIEWER_SYSTEM_PROMPT = (
    "Ты — придирчивый ревьюер Orbit CRM (FastAPI + React/Vite + Supabase). "
    "Тебе дан РЕАЛЬНЫЙ git diff изменений. Найди дефекты, которые сломают работу: "
    "несуществующие импорты, необработанные ошибки, потерянный await, изменения не в том файле, "
    "нарушение архитектуры проекта, попавшие в код секреты. "
    "Отвечай ТОЛЬКО JSON: "
    '{"findings": [{"severity": "blocker|major|minor", "file": "путь", "summary": "суть дефекта", '
    '"suggestion": "как починить"}]}. '
    "Если дефектов нет — верни {\"findings\": []}. Не придирайся к стилю и форматированию."
)


# ── secret scrubbing ─────────────────────────────────────────────────

def _secret_values() -> list[str]:
    """Every secret this process knows that could plausibly reach a log line."""
    candidates = [
        settings.GITHUB_TOKEN,
        settings.INTERNAL_API_TOKEN,
        settings.SELFDEV_PROVIDER_TOKEN,
        settings.AUTOPILOT_E2E_PASSWORD,
        getattr(settings, "SUPABASE_SERVICE_ROLE_KEY", ""),
        getattr(settings, "OPENCLAW_GATEWAY_TOKEN", ""),
        getattr(settings, "NVIDIA_API_KEY", ""),
        getattr(settings, "OPENAI_API_KEY", ""),
        getattr(settings, "GROQ_API_KEY", ""),
    ]
    # Short values would scrub half the output away; secrets are never that short.
    return [str(value) for value in candidates if value and len(str(value)) >= 8]


# Shapes of credentials this process may never have seen — a Supabase JWT echoed
# by a Playwright network log, a token pasted into a fixture. Value-based
# scrubbing alone can only redact what is already in `settings`.
SECRET_PATTERNS = (
    re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"),  # JWT
    re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}"),  # GitHub token (classic/fine-grained prefixes)
    re.compile(r"github_pat_[A-Za-z0-9_]{20,}"),
    re.compile(r"sk-[A-Za-z0-9_-]{20,}"),  # OpenAI-style key
    re.compile(r"nvapi-[A-Za-z0-9_-]{20,}"),  # NVIDIA key
    re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}"),  # Slack token
)


def scrub(text: str) -> str:
    """Redact secrets from anything about to be persisted or logged.

    Two passes, because either alone leaks: known values catch a credential that
    has no recognisable shape, and shape matching catches one this process never
    held — such as a JWT the browser test printed out of a network log.
    """
    cleaned = text or ""
    for secret in _secret_values():
        cleaned = cleaned.replace(secret, "***")
    for pattern in SECRET_PATTERNS:
        cleaned = pattern.sub("***", cleaned)
    return cleaned


# ── data model ───────────────────────────────────────────────────────

@dataclass
class ReviewFinding:
    severity: str
    summary: str
    file: str = ""
    suggestion: str = ""

    @property
    def blocking(self) -> bool:
        return self.severity in BLOCKING_SEVERITIES

    def to_dict(self) -> dict[str, Any]:
        return {
            "severity": self.severity,
            "file": self.file,
            "summary": self.summary,
            "suggestion": self.suggestion,
        }

    def as_line(self) -> str:
        location = f" (`{self.file}`)" if self.file else ""
        fix = f" — как починить: {self.suggestion}" if self.suggestion else ""
        return f"[{self.severity}]{location} {self.summary}{fix}"


@dataclass
class VerificationResult:
    """Outcome of the browser self-test. `skipped` is a first-class result:
    an un-configured E2E environment must not be reported as a passing test."""

    status: str = "skipped"
    reason: str = ""
    steps: list[dict[str, Any]] = field(default_factory=list)
    defects: list[str] = field(default_factory=list)
    # Which user flow was actually exercised. A report that omits this implies
    # more coverage than the run bought.
    spec: str = "" 

    @property
    def passed(self) -> bool:
        return self.status == "passed"

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "reason": self.reason,
            "steps": self.steps,
            "defects": self.defects,
            "spec": self.spec,
        }


# ── phase 3: self review over the real diff ──────────────────────────

MAX_DIFF_CHARS = 60_000
# A diff bigger than one review call is split by file rather than cut off. Two
# ceilings keep that bounded: a very large single file is still truncated (with
# the fact recorded), and a run touching hundreds of files does not turn into
# hundreds of model calls.
MAX_REVIEW_CHUNKS = 4
MAX_FILE_DIFF_CHARS = 20_000


def parse_findings(payload: dict[str, Any] | None) -> list[ReviewFinding]:
    raw = (payload or {}).get("findings")
    if not isinstance(raw, list):
        return []
    findings: list[ReviewFinding] = []
    for item in raw[:20]:
        if not isinstance(item, dict):
            continue
        summary = str(item.get("summary") or item.get("issue") or "").strip()
        if not summary:
            continue
        severity = str(item.get("severity") or "minor").strip().lower()
        if severity not in SEVERITIES:
            severity = "minor"
        findings.append(
            ReviewFinding(
                severity=severity,
                summary=summary[:500],
                file=str(item.get("file") or "").strip()[:200],
                suggestion=str(item.get("suggestion") or "").strip()[:500],
            )
        )
    return findings


def split_diff_by_file(diff: str) -> list[tuple[str, str]]:
    """Split a unified diff into `(path, hunk)` pairs, in order."""
    pieces: list[tuple[str, str]] = []
    current_path = ""
    current: list[str] = []
    for line in (diff or "").splitlines(keepends=True):
        if line.startswith("diff --git "):
            if current:
                pieces.append((current_path, "".join(current)))
            parts = line.split()
            current_path = parts[-1][2:] if len(parts) >= 4 and parts[-1].startswith("b/") else "?"
            current = [line]
        elif current:
            current.append(line)
    if current:
        pieces.append((current_path, "".join(current)))
    return pieces


def chunk_diff(diff: str) -> tuple[list[str], list[str]]:
    """Group a diff into review-sized chunks.

    Returns `(chunks, skipped_paths)`. Truncation used to be silent: everything
    past 60k characters simply vanished and the report said only "(обрезан)",
    never which files went unread.
    """
    if len(diff) <= MAX_DIFF_CHARS:
        return ([diff] if diff.strip() else []), []

    chunks: list[str] = []
    skipped: list[str] = []
    current: list[str] = []
    current_size = 0

    for path, piece in split_diff_by_file(diff):
        if len(piece) > MAX_FILE_DIFF_CHARS:
            piece = piece[:MAX_FILE_DIFF_CHARS] + f"\n… (файл {path} обрезан)\n"
        if current and current_size + len(piece) > MAX_DIFF_CHARS:
            chunks.append("".join(current))
            current, current_size = [], 0
            if len(chunks) >= MAX_REVIEW_CHUNKS:
                skipped.append(path)
                continue
        if len(chunks) >= MAX_REVIEW_CHUNKS:
            skipped.append(path)
            continue
        current.append(piece)
        current_size += len(piece)

    if current and len(chunks) < MAX_REVIEW_CHUNKS:
        chunks.append("".join(current))
    return chunks, skipped


def _dedupe_findings(findings: list[ReviewFinding]) -> list[ReviewFinding]:
    """Same defect reported from two chunks is one defect."""
    seen: set[tuple[str, str]] = set()
    unique: list[ReviewFinding] = []
    for finding in findings:
        key = (finding.file, finding.summary.strip().lower())
        if key in seen:
            continue
        seen.add(key)
        unique.append(finding)
    return unique


async def review_diff(
    complete: Callable[[list[dict[str, Any]]], Awaitable[Any]],
    task: dict[str, Any],
    diff: str,
    plan: AutopilotPlan | None = None,
) -> list[ReviewFinding]:
    """Review the actual diff. Never raises — a failed review is not a failed run."""
    if not (diff or "").strip():
        return []

    chunks, skipped = chunk_diff(diff)
    plan_block = ""
    if plan is not None:
        plan_block = "\nПлан работ и статусы:\n" + "\n".join(
            f"- [{step.status}] {step.id}. {step.title}" for step in plan.steps
        )

    findings: list[ReviewFinding] = []
    for index, chunk in enumerate(chunks, start=1):
        part = f" (часть {index} из {len(chunks)})" if len(chunks) > 1 else ""
        user_prompt = (
            f"Задача: {task.get('title') or ''}\n"
            f"Критерии приёмки: {json.dumps(task.get('acceptance_criteria') or [], ensure_ascii=False)}"
            f"{plan_block}\n\n"
            f"git diff{part}:\n```diff\n{chunk}\n```"
        )
        try:
            result = await complete(
                [
                    {"role": "system", "content": REVIEWER_SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ]
            )
        except Exception:  # pragma: no cover - defensive
            logger.exception("autopilot self-review call failed on chunk %s", index)
            continue
        if result is None:
            logger.info("autopilot self-review: provider returned nothing for chunk %s", index)
            continue
        findings.extend(parse_findings(_extract_json_object(getattr(result, "content", "") or "")))

    if skipped:
        # Never let unreviewed files pass as reviewed.
        logger.info("autopilot self-review: %s file(s) exceeded the review budget", len(skipped))
        findings.append(
            ReviewFinding(
                severity="minor",
                summary=(
                    f"Не проверено ревизией — изменения не поместились в бюджет: "
                    f"{', '.join(skipped[:10])}"
                    + (f" и ещё {len(skipped) - 10}" if len(skipped) > 10 else "")
                ),
                file=skipped[0],
            )
        )
    return _dedupe_findings(findings)


# ── phase 4: end-to-end browser self test ────────────────────────────

def _cache_root() -> Path | None:
    """Directory for the shared npm/Playwright caches, created on demand.

    Returns None if it cannot be created — a missing cache must degrade to a
    slow run, never to a failed one.
    """
    configured = (settings.AUTOPILOT_CACHE_DIR or "").strip()
    if not configured:
        return None
    root = Path(configured)
    try:
        (root / "npm").mkdir(parents=True, exist_ok=True)
        (root / "playwright").mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        logger.warning("autopilot: cache dir %s unusable (%s), falling back to a cold run", root, exc)
        return None
    return root


def e2e_environment() -> dict[str, str]:
    """Minimal environment for the browser test.

    Built from scratch rather than copied from ``os.environ``: that is what keeps
    GITHUB_TOKEN and the AI provider keys out of the test process entirely.
    """
    env = {
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "HOME": os.environ.get("HOME", "/tmp"),
        "CI": "1",
        "NODE_ENV": "test",
        "E2E_EMAIL": settings.AUTOPILOT_E2E_EMAIL,
        "E2E_PASSWORD": settings.AUTOPILOT_E2E_PASSWORD,
        "E2E_BASE_URL": settings.AUTOPILOT_E2E_BASE_URL,
        "VITE_SUPABASE_URL": settings.SUPABASE_URL,
        "VITE_SUPABASE_PUBLISHABLE_KEY": settings.AUTOPILOT_E2E_SUPABASE_ANON_KEY,
    }
    for key in ("TMPDIR", "LANG"):
        value = os.environ.get(key)
        if value:
            env[key] = value

    # Persistent caches. Each run works in a throwaway clone, so without a cache
    # that outlives it every run re-downloads the whole dependency tree and a
    # browser — by far the largest slice of the verification budget. An
    # explicitly exported value from the host still wins, so an operator can
    # point these somewhere else.
    cache_root = _cache_root()
    if cache_root is not None:
        env.setdefault("npm_config_cache", str(cache_root / "npm"))
        env.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(cache_root / "playwright"))
    for key in ("PLAYWRIGHT_BROWSERS_PATH", "npm_config_cache"):
        value = os.environ.get(key)
        if value:
            env[key] = value
    return {key: value for key, value in env.items() if value}


def _missing_e2e_config() -> str:
    if not settings.AUTOPILOT_E2E_ENABLED:
        return "AUTOPILOT_E2E_ENABLED=false — браузерный самотест выключен в конфигурации"
    if not settings.AUTOPILOT_E2E_EMAIL or not settings.AUTOPILOT_E2E_PASSWORD:
        return "Не заданы AUTOPILOT_E2E_EMAIL / AUTOPILOT_E2E_PASSWORD (локальный .env.e2e.local)"
    if not settings.AUTOPILOT_E2E_SUPABASE_ANON_KEY:
        # Without it the frontend under test renders "Supabase не настроен" and the
        # failure looks like a defect in the change rather than a missing setting.
        return "Не задан AUTOPILOT_E2E_SUPABASE_ANON_KEY — фронтенд под тестом не сможет подключиться к Supabase"
    if not shutil.which("npm"):
        return "npm недоступен в окружении бэкенда"
    return ""


async def _run_step(
    name: str,
    cmd: list[str],
    cwd: Path,
    timeout: float,
    env: dict[str, str],
) -> dict[str, Any]:
    """Run one verification command. Secrets travel in `env`, never in `cmd`."""
    try:
        process = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=str(cwd),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env=env,
        )
    except FileNotFoundError as exc:
        return {"name": name, "command": " ".join(cmd), "exit_code": 127, "ok": False, "output": str(exc)}
    try:
        stdout, _ = await asyncio.wait_for(process.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()
        return {
            "name": name,
            "command": " ".join(cmd),
            "exit_code": 124,
            "ok": False,
            "output": f"Команда не уложилась в {timeout:.0f}с",
        }
    exit_code = process.returncode or 0
    output = scrub(stdout.decode("utf-8", "replace"))[-OUTPUT_TAIL:]
    return {"name": name, "command": " ".join(cmd), "exit_code": exit_code, "ok": exit_code == 0, "output": output}


class _Budget:
    """Hands out per-step timeouts from a shrinking wall-clock allowance."""

    def __init__(self, total_seconds: float) -> None:
        self._deadline = time.monotonic() + total_seconds

    @property
    def remaining(self) -> float:
        return max(0.0, self._deadline - time.monotonic())

    def slice_for(self, nominal: float) -> float:
        return min(nominal, self.remaining)

    def exhausted(self, need: float) -> bool:
        return self.remaining < need


async def run_browser_self_test(
    workdir: Path,
    spec: str = "e2e/autopilot-smoke.spec.ts",
    budget_seconds: float | None = None,
) -> VerificationResult:
    """Install dependencies and drive the app in a real browser.

    `budget_seconds` is the wall-clock the caller has left. Every step is capped
    by what remains, so verification can never be the reason a run blows past the
    job timeout — it degrades to `skipped` instead.

    Returns `skipped` (not `failed`) when the E2E environment is not configured:
    a missing local test account is an operator gap, not a defect in the change.
    """
    blocked = _missing_e2e_config()
    if blocked:
        return VerificationResult(status="skipped", reason=blocked, spec=spec)

    if not (workdir / spec).is_file():
        return VerificationResult(
            status="skipped", reason=f"Сценарий {spec} отсутствует в рабочей копии", spec=spec
        )

    budget = _Budget(NOMINAL_BUDGET_SECONDS if budget_seconds is None else budget_seconds)
    if budget.exhausted(MIN_BUDGET_SECONDS):
        return VerificationResult(
            status="skipped",
            reason=(
                f"Осталось {budget.remaining:.0f}с из бюджета рана — недостаточно для браузерного "
                f"теста (нужно минимум {MIN_BUDGET_SECONDS}с)"
            ),
            spec=spec,
        )

    env = e2e_environment()
    steps: list[dict[str, Any]] = []

    def out_of_time(stage: str) -> VerificationResult:
        return VerificationResult(
            status="skipped",
            reason=f"Бюджет рана исчерпан до этапа «{stage}» — браузерный тест не запускался целиком",
            steps=steps,
            spec=spec,
        )

    # `npm ci` is both faster and deterministic, but it requires a lockfile that
    # agrees with package.json — fall back rather than fail the phase over it.
    install_cmd = (
        ["npm", "ci", "--no-audit", "--no-fund"]
        if (workdir / "package-lock.json").is_file()
        else ["npm", "install", "--no-audit", "--no-fund"]
    )
    install = await _run_step("install", install_cmd, workdir, budget.slice_for(INSTALL_TIMEOUT_SECONDS), env)
    if not install["ok"] and install_cmd[1] == "ci" and not budget.exhausted(MIN_BUDGET_SECONDS):
        logger.info("autopilot: npm ci failed, retrying with npm install")
        install = await _run_step(
            "install",
            ["npm", "install", "--no-audit", "--no-fund"],
            workdir,
            budget.slice_for(INSTALL_TIMEOUT_SECONDS),
            env,
        )
    steps.append(install)
    if not install["ok"]:
        return VerificationResult(
            status="error",
            reason="Не удалось установить зависимости для браузерного теста",
            steps=steps,
            defects=[install["output"][-800:]],
            spec=spec,
        )

    if budget.exhausted(MIN_BUDGET_SECONDS):
        return out_of_time("установка браузера")
    browsers = await _run_step(
        "browser-install",
        ["npx", "--yes", "playwright", "install", "--with-deps", "chromium"],
        workdir,
        budget.slice_for(BROWSER_INSTALL_TIMEOUT_SECONDS),
        env,
    )
    if not browsers["ok"] and not budget.exhausted(MIN_BUDGET_SECONDS):
        # `--with-deps` needs root on Linux; retry without it before giving up.
        browsers = await _run_step(
            "browser-install",
            ["npx", "--yes", "playwright", "install", "chromium"],
            workdir,
            budget.slice_for(BROWSER_INSTALL_TIMEOUT_SECONDS),
            env,
        )
    steps.append(browsers)
    if not browsers["ok"]:
        return VerificationResult(
            status="error",
            reason="Не удалось установить браузер Playwright",
            steps=steps,
            defects=[browsers["output"][-800:]],
            spec=spec,
        )

    if budget.exhausted(MIN_BUDGET_SECONDS):
        return out_of_time("прогон сценария")
    run = await _run_step(
        "e2e",
        ["npx", "--yes", "playwright", "test", spec, "--reporter=line"],
        workdir,
        budget.slice_for(E2E_TIMEOUT_SECONDS),
        env,
    )
    steps.append(run)
    if run["ok"]:
        return VerificationResult(status="passed", reason="Браузерный сценарий пройден", steps=steps, spec=spec)
    return VerificationResult(
        status="failed",
        reason="Браузерный сценарий не прошёл",
        steps=steps,
        defects=[run["output"][-1500:]],
        spec=spec,
    )


# ── choosing what to verify ──────────────────────────────────────────

SMOKE_SPEC = "e2e/autopilot-smoke.spec.ts"
# Routes the smoke spec already walks; a task confined to these adds nothing by
# selecting a spec of its own.
SMOKE_ROUTES = ("/", "/clients", "/tasks", "/projects", "/self-development")


def select_spec(workdir: Path, task: dict[str, Any], changed_files: list[str] | None = None) -> str:
    """Pick the Playwright spec that actually exercises this task's user flow.

    The smoke spec is the floor, not the ceiling. When a task's own changes point
    at a route with a dedicated spec in `e2e/`, run that one instead — verifying
    a checkout change by logging in and looking at the dashboard proves nothing
    about the checkout.
    """
    e2e_dir = workdir / "e2e"
    if not e2e_dir.is_dir():
        return SMOKE_SPEC

    haystack = " ".join(
        [
            str(task.get("title") or ""),
            str(task.get("description") or ""),
            " ".join(str(item) for item in (task.get("acceptance_criteria") or [])),
            " ".join(changed_files or []),
        ]
    ).lower()

    best: tuple[int, str] | None = None
    for spec in sorted(e2e_dir.glob("*.spec.ts")):
        relative = f"e2e/{spec.name}"
        if relative == SMOKE_SPEC:
            continue
        # "approval-workflow.spec.ts" -> {"approval", "workflow"}
        words = {word for word in re.split(r"[^a-z0-9]+", spec.stem.lower()) if len(word) > 3}
        if not words:
            continue
        score = sum(1 for word in words if word in haystack)
        if score and (best is None or score > best[0]):
            best = (score, relative)

    return best[1] if best else SMOKE_SPEC


# ── phase 5: the report ──────────────────────────────────────────────

_STATUS_LABEL = {"done": "Сделано", "blocked": "Заблокировано", "pending": "Не сделано"}
_VERIFICATION_LABEL = {
    "passed": "✅ пройден",
    "failed": "❌ не пройден",
    "error": "⚠️ не удалось выполнить",
    "skipped": "⏭️ пропущен",
}


def render_report(
    task: dict[str, Any],
    plan: AutopilotPlan,
    summary: str,
    findings: list[ReviewFinding],
    verification: VerificationResult,
    pr_url: str = "",
) -> str:
    counts = plan.counts()
    lines = [
        f"## Итоговый отчёт автопилота — {task.get('title') or ''}",
        "",
        summary.strip() or "_Исполнитель не оставил резюме._",
        "",
        f"### 1. План ({counts['done']}/{counts['total']} выполнено)",
        "",
        f"Файл плана: `{plan.relative_path}`",
        "",
        "| Шаг | Статус | Комментарий |",
        "| --- | --- | --- |",
    ]
    for step in plan.steps:
        note = (step.note or "").replace("|", "\\|")
        title = step.title.replace("|", "\\|")
        lines.append(f"| {step.id}. {title} | {_STATUS_LABEL.get(step.status, step.status)} | {note or '—'} |")

    lines += ["", "### 2. Самопроверка кода", ""]
    if findings:
        for finding in findings:
            lines.append(f"- {finding.as_line()}")
    else:
        lines.append("Незакрытых замечаний нет.")

    lines += ["", f"### 3. Браузерный самотест — {_VERIFICATION_LABEL.get(verification.status, verification.status)}", ""]
    lines.append(verification.reason or "—")
    if verification.spec:
        lines.append("")
        lines.append(f"Сценарий: `{verification.spec}`")
    if verification.defects:
        lines += ["", "<details><summary>Вывод теста</summary>", "", "```"]
        lines += [scrub(defect)[-1500:] for defect in verification.defects]
        lines += ["```", "", "</details>"]

    if pr_url:
        lines += ["", f"### 4. Pull Request", "", pr_url]

    lines += ["", "---", "_Сгенерировано Orbit Autopilot. Ветка всегда `autopilot/*`, в `main` автопилот не пишет._"]
    return "\n".join(lines)
