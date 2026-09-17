from __future__ import annotations

"""Coding executor: turns an approved engineering task into a real branch + PR.

Runs a small tool-calling loop against an OpenAI-compatible provider with a
narrow, sandboxed toolset (read/write a file, list a directory, run an
allow-listed command) scoped to a fresh shallow clone of `settings.GITHUB_REPO`.
On completion it commits, pushes a NEW branch, and opens a pull request via the
GitHub REST API.

The run is a five-phase lifecycle, not a single shot:

  1. **Plan** — the task is decomposed into atomic steps and written to
     `docs/autopilot/plans/…` inside the working copy, so the plan ships in the
     same PR as the code (`autopilot_plan`).
  2. **Execute** — the tool loop, with plan tools that force every step to end
     with an explicit status. A blocked step is recorded and the run continues
     on the steps that do not depend on it.
  3. **Self review** — the model is shown the real `git diff` and must report
     defects; blocking findings get one bounded repair round (`autopilot_verifier`).
  4. **Browser self test** — Playwright logs into the app with a *local* test
     account and walks the flow. Credentials never touch argv, a file, or a log.
  5. **Report** — plan statuses, findings and the test outcome become the PR
     body and the structured result handed back to the commander.

Safety invariants enforced in code, not by prompt:
  * Every branch is prefixed `autopilot/` — it can never collide with `main`/
    `master`, and pushing to the repository's default branch is never
    attempted anywhere in this module.
  * Every file operation is confined to the freshly cloned working directory;
    paths that would escape it (`..`, absolute paths) are rejected.
  * `.git/` and any `.env*` file are never writable by the model.
  * Shell commands run via argv (no shell=True), so there is no command
    injection surface, and only an explicit allow-list of command prefixes
    is accepted.
"""

import asyncio
import contextlib
import json
import logging
import os
import re
import shlex
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

from backend.config import settings
from backend.services import autopilot_plan, autopilot_verifier, autopilot_workspace
from backend.services.ai_providers import ai_provider_registry
from backend.services.autopilot_plan import STATUS_BLOCKED, STATUS_DONE, AutopilotPlan
from backend.services.autopilot_verifier import ReviewFinding, VerificationResult

logger = logging.getLogger(__name__)

# Observed: a documentation edit spent ~20 steps on reads and searches before
# it was ready to finish, so a 20-step ceiling cut off otherwise-healthy runs.
# Step tracking (complete_step/block_step) spends turns on bookkeeping that used
# to go to edits, so the ceiling grew alongside the plan phase.
MAX_STEPS = 55
STEP_TIMEOUT_SECONDS = 90
# A --depth 1 clone of this repository checks out ~23k files (~465 MB) and takes
# about two minutes on a warm connection, so the ceiling has to sit well clear of
# that — a marginal limit here fails the whole run before any work starts.
CLONE_TIMEOUT_SECONDS = 420
COMMAND_TIMEOUT_SECONDS = 120

# ── Time budgets ─────────────────────────────────────────────────────
# These are derived, not guessed, and they have to reconcile with the caller:
# the queue worker kills a job at `workflow_jobs.timeout_seconds`, so a run whose
# phases can legitimately outlast that value simply never finishes. Anything that
# changes a phase budget must therefore flow through `total_run_budget_seconds()`
# into the job's timeout — which is why the numbers live in one place.
#
# Planning + the tool loops + self review + one repair round.
EXECUTION_BUDGET_SECONDS = 1200
# Dependency install + browser install + the Playwright run. Generous because a
# cold `npm install` in a fresh clone genuinely takes minutes; the verifier
# subdivides whatever slice of this is actually left.
VERIFICATION_BUDGET_SECONDS = 1500
# Everything after the clone. The run enforces this itself rather than trusting
# the job timeout, so the executor is self-limiting even if it is called from
# somewhere that sizes the job wrong.
RUN_TIMEOUT_SECONDS = EXECUTION_BUDGET_SECONDS + VERIFICATION_BUDGET_SECONDS
# Slack for commit/push/PR round-trips and store writes on either side of a run.
JOB_TIMEOUT_MARGIN_SECONDS = 240
# Extra tool steps granted after the self review finds blocking defects.
REPAIR_STEPS = 12


def total_run_budget_seconds() -> int:
    """Wall-clock ceiling for one autopilot run, clone included.

    The caller must size `workflow_jobs.timeout_seconds` from this. With the
    queue's old 900s default, a run that reached the browser self test was killed
    mid-verification every time — the phase could never complete.
    """
    return CLONE_TIMEOUT_SECONDS + RUN_TIMEOUT_SECONDS + JOB_TIMEOUT_MARGIN_SECONDS
MAX_FILE_BYTES = 200_000
GITHUB_API = "https://api.github.com"

ALLOWED_COMMAND_PREFIXES = (
    "npm run build",
    "npm run lint",
    "npm run test",
    "npx tsc --noEmit",
    "npx eslint",
    "npx playwright test",
    "npm run test:e2e",
    "pytest",
    "python -m pytest",
    "python3 -m pytest",
    "git status",
    "git diff",
)

# Checks `check_changes` can run, and how to read their output. `path_group`
# names the regex group holding the file a diagnostic belongs to.
CHECKS: dict[str, dict[str, Any]] = {
    "typescript": {
        "command": ["npx", "tsc", "--noEmit"],
        # src/routes/tasks.tsx(160,36): error TS2532: ...
        "diagnostic": re.compile(r"^(?P<path>[^\s(]+)\((?P<line>\d+),\d+\):"),
        "needs": "node_modules",
    },
    "lint": {
        "command": ["npx", "eslint", "."],
        # eslint prints the file on its own line, then indented messages.
        "diagnostic": re.compile(r"^(?P<path>[^\s]+\.(?:ts|tsx|js|jsx|mjs|cjs))$"),
        "needs": "node_modules",
    },
    "tests": {
        "command": ["python3", "-m", "pytest", "-q", "backend/tests"],
        "diagnostic": None,
        "needs": None,
    },
}
MAX_CHECK_LINES = 40

TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read a text file from the repository working copy.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path relative to the repository root."},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "edit_file",
            "description": (
                "Replace an exact snippet inside an existing file. This is the correct way to "
                "modify a file you did not write yourself — prefer it over write_file always. "
                "old_string must appear exactly once in the file; include enough surrounding "
                "context to make it unique. Everything outside the snippet is left untouched."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path relative to the repository root."},
                    "old_string": {"type": "string", "description": "Exact text to replace, unique in the file."},
                    "new_string": {"type": "string", "description": "Replacement text."},
                },
                "required": ["path", "old_string", "new_string"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": (
                "Write a file's ENTIRE contents, replacing whatever was there. Use only for files "
                "you are creating from scratch. To change part of an existing file use edit_file — "
                "write_file on an existing file discards every line you do not repeat."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path relative to the repository root."},
                    "content": {"type": "string", "description": "Full new file content."},
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search",
            "description": (
                "Search the repository for a literal string and return matching file paths with "
                "line numbers. Use this to locate where something lives instead of reading files "
                "one by one."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Literal text to search for."},
                    "path": {"type": "string", "description": "Optional subdirectory to limit the search to."},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_dir",
            "description": "List files and directories at a path relative to the repository root.",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string", "description": "Defaults to the repository root."}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_command",
            "description": (
                "Run one allow-listed command inside the repository working copy. "
                f"Allowed command prefixes: {', '.join(ALLOWED_COMMAND_PREFIXES)}."
            ),
            "parameters": {
                "type": "object",
                "properties": {"command": {"type": "string"}},
                "required": ["command"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_changes",
            "description": (
                "Прогнать проверку и показать ТОЛЬКО те замечания, которые относятся к изменённым "
                "тобой файлам. В проекте есть накопленные чужие ошибки — эта команда отделяет твою "
                "дельту от фона. Запускай перед finish, чтобы убедиться, что ты ничего не сломал."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "check": {
                        "type": "string",
                        "enum": ["typescript", "lint", "tests"],
                        "description": "typescript — tsc --noEmit; lint — eslint; tests — pytest.",
                    }
                },
                "required": ["check"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "show_plan",
            "description": "Показать текущий план работ со статусом каждого шага.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "complete_step",
            "description": (
                "Отметить шаг плана выполненным. Вызывай сразу после того, как реально внёс "
                "изменения для этого шага, а не в конце работы пачкой."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "step_id": {"type": "string", "description": "Идентификатор шага из плана, например \"2\"."},
                    "note": {"type": "string", "description": "Коротко: что именно сделано и в каких файлах."},
                },
                "required": ["step_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "block_step",
            "description": (
                "Отметить шаг плана заблокированным с причиной. Это НЕ останавливает работу — "
                "переходи к остальным шагам, которые от него не зависят."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "step_id": {"type": "string", "description": "Идентификатор шага из плана."},
                    "reason": {"type": "string", "description": "Почему шаг нельзя выполнить."},
                },
                "required": ["step_id", "reason"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "finish",
            "description": (
                "Call this once — and only once — when the task is complete and ready to commit, "
                "or when the task cannot be completed. If no files were changed, explain why in summary."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "summary": {"type": "string", "description": "What was done (or why it could not be done)."},
                    "commit_message": {"type": "string", "description": "Git commit message, imperative mood."},
                },
                "required": ["summary", "commit_message"],
            },
        },
    },
]


class CodingExecutorUnavailable(RuntimeError):
    pass


@dataclass
class CodingExecutionResult:
    success: bool
    branch: str = ""
    commit_sha: str = ""
    pr_url: str = ""
    summary: str = ""
    steps: list[dict[str, Any]] = field(default_factory=list)
    error: str | None = None
    # Lifecycle artifacts. Present even on failure, so a run that dies halfway
    # still reports which steps it had completed before it stopped.
    plan: dict[str, Any] = field(default_factory=dict)
    review_findings: list[dict[str, Any]] = field(default_factory=list)
    verification: dict[str, Any] = field(default_factory=dict)
    report: str = ""
    # Per-phase wall clock, in seconds. The budgets can only be calibrated
    # against real numbers, and until now a run reported none.
    timings: dict[str, float] = field(default_factory=dict)
    # "worktree" (persistent, node_modules reused) or "clone" (throwaway).
    workspace: str = "clone"


def _branch_name(task_id: str, title: str, attempt: int = 1) -> str:
    """`autopilot/<task>-<slug>`, with an attempt suffix from the second try on.

    The name used to be a pure function of the task, which broke retries: if a
    run pushed its branch and then failed to open the PR, the next attempt hit a
    non-fast-forward on push and a 422 on the pull request. Distinct attempts get
    distinct branches, so a retry is always able to complete.
    """
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:40] or "task"
    suffix = f"-a{attempt}" if attempt > 1 else ""
    return f"autopilot/{task_id}-{slug}{suffix}"


def _is_protected(path: Path) -> bool:
    """Paths the model must never write to, whatever the task says.

    The plan directory is in here for the same reason `.git` is: the plan file is
    the run's own progress record, written by `_dispatch_plan_tool` after every
    status change. A model that edits it directly could report steps as done
    without doing them, which is exactly what the plan exists to prevent — so it
    is blocked in code, not merely discouraged in the system prompt.
    """
    parts = path.parts
    if ".git" in parts or path.name.startswith(".env"):
        return True
    return tuple(autopilot_plan.PLAN_DIR.split("/")) in tuple(
        parts[index : index + 3] for index in range(len(parts))
    )


def _safe_path(workdir: Path, relative: str) -> Path:
    candidate = (workdir / (relative or ".")).resolve()
    root = workdir.resolve()
    if candidate != root and root not in candidate.parents:
        raise ValueError(f"Путь выходит за пределы рабочей копии репозитория: {relative!r}")
    return candidate


# Git primitives live in `autopilot_workspace` so that module can manage mirrors
# and worktrees without importing this one. They are re-exported here because
# this module's own helpers (and their tests) address them by these names.
_run = autopilot_workspace.run_git
_git_credential_env = autopilot_workspace.git_credential_env
CREDENTIAL_HELPER = autopilot_workspace.CREDENTIAL_HELPER


async def _clone_repo(repo: str, workdir: Path, token: str) -> str:
    remote_url = f"https://github.com/{repo}.git"
    env = _git_credential_env(token)
    code, _out, err = await _run(
        ["git", "-c", f"credential.helper={CREDENTIAL_HELPER}", "clone", "--depth", "1", remote_url, str(workdir)],
        cwd=workdir.parent,
        timeout=CLONE_TIMEOUT_SECONDS,
        env=env,
    )
    if code != 0:
        raise RuntimeError(f"git clone failed: {err[-2000:]}")
    # Persist the helper in the clone's own config so `git push` later picks it up too.
    await _run(["git", "config", "credential.helper", CREDENTIAL_HELPER], cwd=workdir, timeout=15, env=env)
    code, out, err = await _run(["git", "symbolic-ref", "--short", "HEAD"], cwd=workdir, timeout=15, env=env)
    return out.strip() or "main"


async def _dispatch_tool(workdir: Path, name: str, arguments: dict[str, Any]) -> str:
    try:
        if name == "read_file":
            path = _safe_path(workdir, str(arguments.get("path") or ""))
            if not path.is_file():
                return f"Ошибка: файл не найден: {arguments.get('path')}"
            return path.read_bytes()[:MAX_FILE_BYTES].decode("utf-8", "replace")

        if name == "edit_file":
            path = _safe_path(workdir, str(arguments.get("path") or ""))
            if _is_protected(path):
                return "Ошибка: запись в этот путь запрещена"
            if not path.is_file():
                return f"Ошибка: файл не найден: {arguments.get('path')}"
            old = str(arguments.get("old_string") or "")
            new = str(arguments.get("new_string") or "")
            if not old:
                return "Ошибка: old_string обязателен и не может быть пустым"
            current = path.read_text(encoding="utf-8", errors="replace")
            occurrences = current.count(old)
            if occurrences == 0:
                return "Ошибка: old_string не найден в файле. Прочитай файл и скопируй фрагмент точно."
            if occurrences > 1:
                return (
                    f"Ошибка: old_string встречается {occurrences} раз — нужен уникальный фрагмент. "
                    "Добавь окружающий контекст, чтобы совпадение было единственным."
                )
            path.write_text(current.replace(old, new, 1), encoding="utf-8")
            return f"Заменён фрагмент в {arguments.get('path')}"

        if name == "write_file":
            path = _safe_path(workdir, str(arguments.get("path") or ""))
            if _is_protected(path):
                return "Ошибка: запись в этот путь запрещена"
            content = str(arguments.get("content") or "")
            # Guard against the classic whole-file-overwrite failure: the model
            # cannot hold a large file in context, writes back only its new
            # section, and silently deletes everything else. An edit that drops
            # most of an existing file is virtually never intended.
            if path.is_file():
                existing = path.read_text(encoding="utf-8", errors="replace")
                if len(existing) > 2000 and len(content) < len(existing) * 0.5:
                    return (
                        f"Ошибка: отказано — это перезаписало бы {len(existing)} байт на {len(content)} "
                        "и удалило бы большую часть файла. Используй edit_file для точечной правки."
                    )
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
            return f"Записано {len(content)} байт в {arguments.get('path')}"

        if name == "search":
            query = str(arguments.get("query") or "")
            if not query:
                return "Ошибка: query обязателен"
            root = _safe_path(workdir, str(arguments.get("path") or "."))
            # -F: literal, not regex — the model supplies plain text, and a stray
            # metacharacter should not silently change what gets matched.
            code, out, _err = await _run(
                ["grep", "-rnI", "-F", "--exclude-dir=.git", "--exclude-dir=node_modules", query, str(root)],
                cwd=workdir,
                timeout=30,
            )
            if code != 0 or not out.strip():
                return "Совпадений не найдено"
            lines = out.splitlines()[:40]
            rel = [line.replace(f"{workdir}/", "", 1) for line in lines]
            return "\n".join(rel)[:4000]

        if name == "list_dir":
            path = _safe_path(workdir, str(arguments.get("path") or "."))
            if not path.is_dir():
                return f"Ошибка: не директория: {arguments.get('path')}"
            entries = sorted(
                p.name + ("/" if p.is_dir() else "") for p in path.iterdir() if p.name != ".git"
            )
            return "\n".join(entries) or "(пусто)"

        if name == "run_command":
            command = str(arguments.get("command") or "").strip()
            if not any(command == p or command.startswith(p + " ") for p in ALLOWED_COMMAND_PREFIXES):
                return f"Ошибка: команда не разрешена. Разрешены только: {', '.join(ALLOWED_COMMAND_PREFIXES)}"
            code, out, err = await _run(shlex.split(command), cwd=workdir, timeout=COMMAND_TIMEOUT_SECONDS)
            return f"exit={code}\nstdout:\n{out[-3000:]}\nstderr:\n{err[-3000:]}"

        return f"Ошибка: неизвестный инструмент {name}"
    except (ValueError, TimeoutError) as exc:
        return f"Ошибка: {exc}"
    except Exception as exc:  # pragma: no cover - defensive, tool failures must not crash the loop
        logger.exception("coding_executor tool %s failed", name)
        return f"Ошибка: {exc}"


async def _free_branch_name(workdir: Path, branch: str) -> str:
    """A branch name that does not already exist locally.

    With a throwaway clone this was moot. A persistent worktree keeps refs
    between runs, so `git checkout -b` on a name a previous attempt left behind
    would fail — and force-creating it would destroy a commit the resume path
    may still need to deliver.
    """
    candidate = branch
    for suffix in range(1, 20):
        code, _out, _err = await _run(
            ["git", "show-ref", "--verify", "--quiet", f"refs/heads/{candidate}"], cwd=workdir, timeout=15
        )
        if code != 0:
            return candidate
        candidate = f"{branch}-{suffix}"
    return f"{branch}-{int(time.monotonic())}"


async def _create_branch_and_commit(workdir: Path, branch: str, commit_message: str) -> str:
    assert branch not in ("main", "master"), "coding_executor must never target the default branch"
    await _run(["git", "checkout", "-b", branch], cwd=workdir, timeout=15)
    await _run(
        ["git", "-c", "user.name=Orbit Autopilot", "-c", "user.email=autopilot@orbit-crm.local", "add", "-A"],
        cwd=workdir,
        timeout=30,
    )
    code, _out, _err = await _run(["git", "diff", "--cached", "--quiet"], cwd=workdir, timeout=15)
    if code == 0:
        raise RuntimeError("Модель вызвала finish, не изменив ни одного файла")
    code, _out, err = await _run(
        [
            "git",
            "-c",
            "user.name=Orbit Autopilot",
            "-c",
            "user.email=autopilot@orbit-crm.local",
            "commit",
            "-m",
            commit_message,
        ],
        cwd=workdir,
        timeout=30,
    )
    if code != 0:
        raise RuntimeError(f"git commit failed: {err[-2000:]}")
    _code, out, _err = await _run(["git", "rev-parse", "HEAD"], cwd=workdir, timeout=15)
    return out.strip()


async def _push_branch(workdir: Path, branch: str, token: str) -> None:
    assert branch not in ("main", "master"), "coding_executor must never target the default branch"
    code, _out, err = await _run(
        ["git", "push", "-u", "origin", branch], cwd=workdir, timeout=60, env=_git_credential_env(token)
    )
    if code != 0:
        raise RuntimeError(f"git push failed: {err[-2000:]}")


async def _find_open_pull_request(client: httpx.AsyncClient, repo: str, branch: str) -> str:
    """URL of an already-open PR for `branch`, or "" if there is none.

    Makes PR creation idempotent: a run that pushed successfully and then failed
    while opening the PR (or while reporting it) must be able to finish on a
    retry instead of dying on GitHub's "a pull request already exists" 422.
    """
    owner = repo.split("/", 1)[0]
    try:
        response = await client.get(f"/repos/{repo}/pulls", params={"head": f"{owner}:{branch}", "state": "open"})
        response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.info("coding_executor: could not look up an existing PR for %s: %s", branch, exc)
        return ""
    payload = response.json()
    if isinstance(payload, list) and payload:
        return str(payload[0].get("html_url") or "")
    return ""


async def _open_pull_request(
    repo: str, token: str, branch: str, base_branch: str, title: str, body: str, draft: bool = False
) -> str:
    async with httpx.AsyncClient(
        base_url=GITHUB_API,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        timeout=30.0,
    ) as client:
        existing = await _find_open_pull_request(client, repo, branch)
        if existing:
            logger.info("coding_executor: reusing the pull request already open for %s", branch)
            return existing
        response = await client.post(
            f"/repos/{repo}/pulls",
            json={
                "title": title[:250],
                "head": branch,
                "base": base_branch,
                "body": body[:60000],
                "draft": draft,
            },
        )
        if response.status_code == 422:
            # Lost a race, or the branch already had a PR the listing missed.
            recovered = await _find_open_pull_request(client, repo, branch)
            if recovered:
                return recovered
        response.raise_for_status()
        return str(response.json().get("html_url") or "")


# Models verified to answer a tools= request on each provider. These are
# deliberately NOT the project-wide defaults: `openai/gpt-oss-120b`, which the
# rest of the app uses, never returns at all once `tools` is present on the
# NVIDIA endpoint (it hangs past a 180s read timeout), so a chat-only default
# is not safe to reuse here.
TOOL_CAPABLE_MODELS = {
    "nvidia": "openai/gpt-oss-20b",
    "openai": "gpt-4o-mini",
    "groq": "llama-3.3-70b-versatile",
}


PROVIDER_ATTEMPTS = 4


async def _complete_with_retry(
    provider: Any,
    model: str,
    messages: list[dict[str, Any]],
    *,
    tools: list[dict[str, Any]] | None = None,
) -> Any | None:
    """One agent step, retried past transient provider hiccups.

    The NVIDIA endpoint intermittently answers with no choices at all (and
    occasionally just stalls) for a model that served a request seconds earlier,
    so a single bad response must not end an otherwise healthy run.

    `tools` is explicit because the planning and review phases must call the
    model *without* a toolset — handing them TOOLS would invite the model to
    start editing files during a phase that is only supposed to think.
    """
    for attempt in range(1, PROVIDER_ATTEMPTS + 1):
        try:
            return await asyncio.wait_for(
                provider.complete(model, messages, temperature=0.1, max_tokens=4096, tools=tools),
                timeout=STEP_TIMEOUT_SECONDS,
            )
        except Exception as exc:
            if attempt == PROVIDER_ATTEMPTS:
                logger.warning("coding_executor: provider gave up after %s attempts: %s", attempt, exc)
                return None
            logger.info("coding_executor: provider attempt %s failed (%s), retrying", attempt, exc)
            await asyncio.sleep(2 * attempt)
    return None


def _resolve_provider() -> tuple[str, str]:
    override = settings.CODING_EXECUTOR_MODEL.strip()
    for name in ("nvidia", "openai", "groq"):
        if ai_provider_registry.is_configured(name):
            return name, override or TOOL_CAPABLE_MODELS[name]
    raise CodingExecutorUnavailable("Ни один AI-провайдер с поддержкой function calling не настроен")


def _plan_status_block(plan: AutopilotPlan) -> str:
    lines = [f"- [{step.status}] {step.id}. {step.title}" + (f" — {step.detail}" if step.detail else "")
             for step in plan.steps]
    return "\n".join(lines)


def _dispatch_plan_tool(
    plan: AutopilotPlan, workdir: Path, name: str, arguments: dict[str, Any]
) -> str | None:
    """Handle the plan-tracking tools. Returns None when `name` is not one of them.

    Every mutation is flushed to the plan file immediately: a run that is killed
    mid-flight must still leave an accurate record of how far it got, and the
    file is what a human reads in the PR.
    """
    if name == "show_plan":
        return _plan_status_block(plan)

    if name in ("complete_step", "block_step"):
        step_id = str(arguments.get("step_id") or "").strip()
        step = plan.find(step_id)
        if step is None:
            known = ", ".join(item.id for item in plan.steps)
            return f"Ошибка: шага {step_id!r} нет в плане. Существующие шаги: {known}"
        if name == "complete_step":
            plan.mark(step_id, STATUS_DONE, str(arguments.get("note") or ""))
            outcome = f"Шаг {step_id} отмечен выполненным"
        else:
            reason = str(arguments.get("reason") or "").strip()
            if not reason:
                return "Ошибка: reason обязателен — нужно зафиксировать, почему шаг заблокирован"
            plan.mark(step_id, STATUS_BLOCKED, reason)
            outcome = f"Шаг {step_id} отмечен заблокированным. Продолжай остальные шаги."
        plan.write(workdir)
        counts = plan.counts()
        return f"{outcome}. Прогресс: {counts['done']}/{counts['total']}, осталось {counts['pending']}."

    return None


async def _changed_files(workdir: Path) -> set[str]:
    """Repository-relative paths the run has touched so far."""
    await _run(["git", "add", "-A", "-N"], cwd=workdir, timeout=30)
    _code, out, _err = await _run(["git", "diff", "--name-only"], cwd=workdir, timeout=30)
    return {line.strip() for line in out.splitlines() if line.strip()}


def _belongs_to_changed(raw_path: str, workdir: Path, changed: set[str]) -> bool:
    candidate = raw_path.strip()
    if not candidate:
        return False
    try:
        relative = str(Path(candidate).resolve().relative_to(workdir.resolve()))
    except (ValueError, OSError):
        relative = candidate.lstrip("./")
    return relative in changed


async def _run_check(workdir: Path, check_name: str) -> str:
    """Run a project check and report the delta, not the absolute.

    The repository carries pre-existing failures (at the time of writing, 141
    `tsc` diagnostics and 3 failing tests). Handing the model that wall of noise
    makes any "did I break something?" question unanswerable, so the output is
    filtered down to files this run actually touched.
    """
    spec = CHECKS.get(check_name)
    if spec is None:
        return f"Ошибка: неизвестная проверка {check_name!r}. Доступны: {', '.join(CHECKS)}"

    if spec["needs"] == "node_modules" and not (workdir / "node_modules").is_dir():
        return (
            "Проверка недоступна: в рабочей копии нет node_modules — зависимости ставятся "
            "только на этапе браузерной верификации, после коммита. Опирайся на чтение кода; "
            "эта проверка всё равно будет прогнана позже."
        )

    changed = await _changed_files(workdir)
    if not changed:
        return "Ты пока не изменил ни одного файла — проверять нечего."

    try:
        code, out, err = await _run(spec["command"], cwd=workdir, timeout=COMMAND_TIMEOUT_SECONDS)
    except TimeoutError as exc:
        return f"Ошибка: {exc}"
    output = f"{out}\n{err}"

    pattern = spec["diagnostic"]
    if pattern is None:
        tail = output.strip()[-3000:]
        return f"exit={code}\n{tail}"

    all_lines = [line for line in output.splitlines() if pattern.match(line.strip())]
    mine = [
        line
        for line in all_lines
        if _belongs_to_changed(pattern.match(line.strip()).group("path"), workdir, changed)
    ]
    header = (
        f"Проверка «{check_name}»: {len(mine)} замечани(й) в изменённых тобой файлах "
        f"(всего в проекте — {len(all_lines)}, остальное существовало до тебя)."
    )
    if not mine:
        return f"{header}\nВ твоих файлах чисто."
    return header + "\n" + "\n".join(mine[:MAX_CHECK_LINES])


async def _working_diff(workdir: Path) -> str:
    """The real diff of the working copy, including files created this run.

    `-N` (intent-to-add) is what makes new files show up in `git diff` without
    actually staging anything, so the review sees exactly what the commit will.
    """
    await _run(["git", "add", "-A", "-N"], cwd=workdir, timeout=30)
    _code, out, _err = await _run(["git", "diff"], cwd=workdir, timeout=60)
    return out


def _findings_message(findings: list[ReviewFinding]) -> str:
    lines = [finding.as_line() for finding in findings]
    return (
        "Ревизия твоего собственного диффа нашла дефекты. Почини блокирующие из них "
        "инструментами edit_file/write_file, затем снова вызови finish. "
        "Если дефект — ложное срабатывание, всё равно вызови finish и объясни это в summary.\n\n"
        + "\n".join(f"- {line}" for line in lines)
    )


async def _tool_loop(
    provider: Any,
    model_name: str,
    messages: list[dict[str, Any]],
    workdir: Path,
    plan: AutopilotPlan,
    steps: list[dict[str, Any]],
    max_steps: int,
    deadline: float,
) -> tuple[dict[str, Any] | None, str | None]:
    """Drive the tool-calling loop until `finish`.

    Returns `(finish_payload, error)`; exactly one of the two is set.
    """
    nudged_about_pending = False

    for _ in range(max_steps):
        if time.monotonic() > deadline:
            return None, "Превышен общий лимит времени выполнения"

        result = await _complete_with_retry(provider, model_name, messages, tools=TOOLS)
        if result is None:
            return None, f"Провайдер {provider.name} не ответил после {PROVIDER_ATTEMPTS} попыток"

        if not result.tool_calls:
            messages.append({"role": "assistant", "content": result.content})
            messages.append(
                {
                    "role": "user",
                    "content": (
                        "Используй один из инструментов read_file/edit_file/write_file/search/list_dir/"
                        "run_command/check_changes/show_plan/complete_step/block_step, либо finish."
                    ),
                }
            )
            continue

        messages.append(
            {
                "role": "assistant",
                "content": result.content or None,
                "tool_calls": [
                    {
                        "id": call["id"],
                        "type": "function",
                        "function": {"name": call["name"], "arguments": call["arguments"]},
                    }
                    for call in result.tool_calls
                ],
            }
        )

        finish_payload: dict[str, Any] | None = None
        for call in result.tool_calls:
            try:
                arguments = json.loads(call["arguments"] or "{}")
            except json.JSONDecodeError:
                arguments = {}
            tool_name = call["name"]

            if tool_name == "finish":
                pending = plan.pending
                if pending and not nudged_about_pending:
                    # Every step must end with an explicit status — silently
                    # leaving steps unaddressed is how a run reports success for
                    # work it never did.
                    nudged_about_pending = True
                    tool_output = (
                        "Ещё не у всех шагов плана есть статус: "
                        + ", ".join(f"{step.id}. {step.title}" for step in pending)
                        + ". Для каждого вызови complete_step (если сделан) или block_step "
                        "(если сделать нельзя), затем finish снова."
                    )
                else:
                    finish_payload = arguments
                    tool_output = "ok"
            elif tool_name == "check_changes":
                tool_output = await _run_check(workdir, str(arguments.get("check") or ""))
            else:
                plan_output = _dispatch_plan_tool(plan, workdir, tool_name, arguments)
                tool_output = (
                    plan_output
                    if plan_output is not None
                    else await _dispatch_tool(workdir, tool_name, arguments)
                )

            steps.append({"tool": tool_name, "arguments": arguments})
            messages.append({"role": "tool", "tool_call_id": call["id"], "content": tool_output[:4000]})

        if finish_payload is not None:
            return finish_payload, None

    return None, f"Достигнут лимит шагов ({max_steps}) без вызова finish"


async def _resume_delivery(
    mirror: Path,
    repo: str,
    token: str,
    task: dict[str, Any],
    default_branch: str,
    timings: dict[str, float],
) -> CodingExecutionResult | None:
    """Re-deliver a commit a previous attempt made but could not push.

    Returns None when there is nothing to resume. Any failure here is swallowed:
    falling through to a normal run is always correct, just slower.
    """
    try:
        branch, commit_sha = await autopilot_workspace.pending_delivery(mirror, str(task["id"]))
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("autopilot: could not check for a pending delivery: %s", exc)
        return None
    if not branch:
        return None

    logger.info("autopilot: resuming delivery of %s from a previous attempt", branch)
    started = time.monotonic()
    try:
        code, _out, err = await _run(
            ["git", "--git-dir", str(mirror), "push", "-u", "origin", branch],
            cwd=mirror.parent,
            timeout=120,
            env=_git_credential_env(token),
        )
        if code != 0:
            raise RuntimeError(f"git push failed: {err[-2000:]}")
        pr_url = await _open_pull_request(
            repo,
            token,
            branch,
            default_branch,
            title=f"[Autopilot] {task['title']}",
            body=(
                f"Изменения были готовы в предыдущей попытке, но не доставлены в GitHub "
                f"(сетевой сбой). Эта попытка только досылает уже сделанный коммит "
                f"`{commit_sha[:8]}` — работа заново не выполнялась.\n\n---\n"
                f"Создано автопилотом Orbit CRM по задаче `{task['id']}`."
            ),
        )
    except (RuntimeError, httpx.HTTPError) as exc:
        logger.warning("autopilot: resuming delivery of %s failed again: %s", branch, exc)
        return None

    timings["resume_delivery"] = round(time.monotonic() - started, 1)
    return CodingExecutionResult(
        success=True,
        branch=branch,
        commit_sha=commit_sha,
        pr_url=pr_url,
        summary="Досланы изменения предыдущей попытки — работа не выполнялась заново.",
        plan={},
        report=f"Доставлен коммит `{commit_sha[:8]}` из предыдущей попытки: {pr_url}",
        timings=dict(timings),
        workspace="worktree",
    )


async def run(task: dict[str, Any], agent: dict[str, Any]) -> CodingExecutionResult:
    repo = str(settings.GITHUB_REPO or "").strip()
    token = str(settings.GITHUB_TOKEN or "").strip()
    if not repo or not token:
        raise CodingExecutorUnavailable("GITHUB_REPO/GITHUB_TOKEN не настроены")

    provider_name, model_name = _resolve_provider()
    provider = ai_provider_registry.get(provider_name)

    async def complete_without_tools(messages: list[dict[str, Any]]) -> Any | None:
        return await _complete_with_retry(provider, model_name, messages, tools=None)

    async with contextlib.AsyncExitStack() as stack:
        timings: dict[str, float] = {}
        clone_started = time.monotonic()
        space = await stack.enter_async_context(
            autopilot_workspace.acquire(
                repo, token, settings.AUTOPILOT_CACHE_DIR, settings.AUTOPILOT_WORKSPACE_SLOTS
            )
        )
        if space.persistent:
            workdir = space.path
            default_branch = space.default_branch
        else:
            base = stack.enter_context(tempfile.TemporaryDirectory(prefix="orbit-autopilot-"))
            workdir = Path(base) / "repo"
            default_branch = await _clone_repo(repo, workdir, token)
        timings["clone"] = round(time.monotonic() - clone_started, 1)

        # A previous attempt may have committed and then failed to deliver. With
        # a persistent workspace that commit still exists, so re-push it instead
        # of spending a whole run reproducing work that is already done.
        if space.persistent and space.git_dir is not None:
            resumed = await _resume_delivery(space.git_dir, repo, token, task, default_branch, timings)
            if resumed is not None:
                return resumed

        branch = _branch_name(str(task["id"]), task["title"], int(task.get("attempt_count") or 1))
        if space.persistent:
            branch = await _free_branch_name(workdir, branch)
        # Two deadlines, not one: the execution loops must leave the verification
        # phase its share of the run, and the run as a whole must stay inside the
        # budget the job timeout was sized from.
        run_started = time.monotonic()
        run_deadline = run_started + RUN_TIMEOUT_SECONDS
        deadline = run_started + EXECUTION_BUDGET_SECONDS
        steps: list[dict[str, Any]] = []

        # ── Phase 1: plan ────────────────────────────────────────────
        phase_started = time.monotonic()
        plan = await autopilot_plan.generate(complete_without_tools, task)
        plan.write(workdir)
        timings["plan"] = round(time.monotonic() - phase_started, 1)
        logger.info("autopilot: plan for task %s has %s steps", task["id"], len(plan.steps))

        def failure(error: str, summary: str = "") -> CodingExecutionResult:
            """A failed run still reports the plan it got through."""
            return CodingExecutionResult(
                success=False,
                steps=steps,
                summary=summary,
                error=error,
                plan=plan.to_dict(),
                timings=dict(timings),
                workspace=space.kind,
            )

        # ── Phase 2: execute, tracking every step ────────────────────
        system_prompt = (
            "Ты — автономный инженер Orbit Autopilot с доступом к рабочей копии репозитория "
            f"{repo} через инструменты read_file/edit_file/write_file/search/list_dir/run_command. "
            "Работай строго по плану ниже. Как только шаг реально сделан — вызывай complete_step; "
            "если шаг выполнить нельзя — block_step с причиной и продолжай остальные шаги. "
            "Перед finish прогони check_changes — в проекте есть накопленные чужие ошибки, и эта "
            "команда покажет только те замечания, которые относятся к изменённым тобой файлам. "
            f"Файл плана `{plan.relative_path}` веду я сам, не редактируй его инструментами файлов. "
            "Вноси только изменения, необходимые для задачи. Никогда не читай и не пиши в .git "
            "или файлы .env*. Когда все шаги закрыты — вызови finish с summary и commit_message. "
            "Если задачу нельзя выполнить — вызови finish, объяснив почему, и не меняй файлы."
        )
        user_prompt = (
            f"Задача: {task['title']}\n"
            f"Описание: {task.get('description') or ''}\n"
            f"Критерии приёмки: {json.dumps(task.get('acceptance_criteria') or [], ensure_ascii=False)}\n\n"
            f"План работ:\n{_plan_status_block(plan)}"
        )
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        phase_started = time.monotonic()
        finish_payload, error = await _tool_loop(
            provider, model_name, messages, workdir, plan, steps, MAX_STEPS, deadline
        )
        timings["execute"] = round(time.monotonic() - phase_started, 1)
        if finish_payload is None:
            return failure(error or "Модель не вызвала finish")

        summary = str(finish_payload.get("summary") or "")[:2000]
        commit_message = str(finish_payload.get("commit_message") or task["title"])[:200]

        # ── Phase 3: self review over the real diff, one repair round ─
        phase_started = time.monotonic()
        findings: list[ReviewFinding] = []
        if settings.AUTOPILOT_SELF_REVIEW_ENABLED:
            diff = await _working_diff(workdir)
            findings = await autopilot_verifier.review_diff(complete_without_tools, task, diff, plan)
            blocking = [finding for finding in findings if finding.blocking]
            if blocking and time.monotonic() < deadline:
                logger.info("autopilot: self review found %s blocking findings, repairing", len(blocking))
                messages.append({"role": "user", "content": _findings_message(blocking)})
                repair_payload, repair_error = await _tool_loop(
                    provider, model_name, messages, workdir, plan, steps, REPAIR_STEPS, deadline
                )
                if repair_payload is not None:
                    summary = str(repair_payload.get("summary") or summary)[:2000]
                    commit_message = str(repair_payload.get("commit_message") or commit_message)[:200]
                else:
                    logger.info("autopilot: repair round did not finish cleanly (%s)", repair_error)
                # Re-review once so the report reflects the repaired diff, not
                # the findings the model was asked to fix.
                findings = await autopilot_verifier.review_diff(
                    complete_without_tools, task, await _working_diff(workdir), plan
                )
        timings["review"] = round(time.monotonic() - phase_started, 1)

        # ── Commit (before verification, so npm artefacts stay out) ───
        try:
            commit_sha = await _create_branch_and_commit(workdir, branch, commit_message)
        except RuntimeError as exc:
            return failure(str(exc), summary=summary)

        # ── Phase 4: browser self test ───────────────────────────────
        phase_started = time.monotonic()
        verification = VerificationResult(status="skipped", reason="Верификация не запускалась")
        try:
            spec = autopilot_verifier.select_spec(workdir, task, sorted(await _changed_files(workdir)))
            if spec != autopilot_verifier.SMOKE_SPEC:
                logger.info("autopilot: verifying task %s with %s", task["id"], spec)
            verification = await autopilot_verifier.run_browser_self_test(
                workdir, spec=spec, budget_seconds=run_deadline - time.monotonic()
            )
        except Exception as exc:  # pragma: no cover - a broken test rig must not lose the PR
            logger.exception("autopilot: browser self test crashed")
            verification = VerificationResult(
                status="error", reason=f"Браузерный самотест упал: {autopilot_verifier.scrub(str(exc))}"
            )
        timings["verify"] = round(time.monotonic() - phase_started, 1)

        # ── Phase 5: report, push, PR ────────────────────────────────
        report = autopilot_verifier.render_report(task, plan, summary, findings, verification)
        phase_started = time.monotonic()
        try:
            await _push_branch(workdir, branch, token)
            # An unrepaired blocker (or a failed browser test) should not produce
            # a PR that looks ready to merge — the finding used to live only in
            # the body, where it is easy to scroll past.
            unresolved = [finding for finding in findings if finding.blocking]
            as_draft = settings.AUTOPILOT_BLOCKER_POLICY == "draft" and (
                bool(unresolved) or verification.status == "failed"
            )
            title_prefix = "[Autopilot][требует внимания] " if as_draft else "[Autopilot] "
            pr_url = await _open_pull_request(
                repo,
                token,
                branch,
                default_branch,
                title=f"{title_prefix}{task['title']}",
                body=f"{report}\n\n---\nСоздано автопилотом Orbit CRM по задаче `{task['id']}`.",
                draft=as_draft,
            )
        except (RuntimeError, httpx.HTTPError) as exc:
            # Delivery failed, the work did not. Returning a result instead of
            # raising keeps this out of the worker's generic retry path, which
            # would re-clone and re-run the whole model loop from scratch while
            # the finished commit died with the temporary directory.
            timings["deliver"] = round(time.monotonic() - phase_started, 1)
            logger.warning("coding_executor: could not deliver branch %s: %s", branch, exc)
            return CodingExecutionResult(
                success=False,
                branch=branch,
                commit_sha=commit_sha,
                summary=summary,
                steps=steps,
                error=f"Изменения закоммичены, но не доставлены в GitHub: {autopilot_verifier.scrub(str(exc))}",
                plan=plan.to_dict(),
                review_findings=[finding.to_dict() for finding in findings],
                verification=verification.to_dict(),
                report=report,
                timings=dict(timings),
                workspace=space.kind,
            )
        timings["deliver"] = round(time.monotonic() - phase_started, 1)
        timings["total"] = round(time.monotonic() - clone_started, 1)
        logger.info("autopilot: task %s finished, phase timings %s", task["id"], timings)

        return CodingExecutionResult(
            success=True,
            branch=branch,
            commit_sha=commit_sha,
            pr_url=pr_url,
            summary=summary,
            steps=steps,
            plan=plan.to_dict(),
            review_findings=[finding.to_dict() for finding in findings],
            verification=verification.to_dict(),
            report=autopilot_verifier.render_report(task, plan, summary, findings, verification, pr_url),
            timings=dict(timings),
            workspace=space.kind,
        )
