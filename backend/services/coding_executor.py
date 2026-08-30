from __future__ import annotations

"""Coding executor: turns an approved engineering task into a real branch + PR.

Runs a small tool-calling loop against an OpenAI-compatible provider with a
narrow, sandboxed toolset (read/write a file, list a directory, run an
allow-listed command) scoped to a fresh shallow clone of `settings.GITHUB_REPO`.
On completion it commits, pushes a NEW branch, and opens a pull request via the
GitHub REST API.

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
from backend.services.ai_providers import ai_provider_registry

logger = logging.getLogger(__name__)

# Observed: a documentation edit spent ~20 steps on reads and searches before
# it was ready to finish, so a 20-step ceiling cut off otherwise-healthy runs.
MAX_STEPS = 45
STEP_TIMEOUT_SECONDS = 90
# A --depth 1 clone of this repository checks out ~23k files (~465 MB) and takes
# about two minutes on a warm connection, so the ceiling has to sit well clear of
# that — a marginal limit here fails the whole run before any work starts.
CLONE_TIMEOUT_SECONDS = 420
COMMAND_TIMEOUT_SECONDS = 120
RUN_TIMEOUT_SECONDS = 900
MAX_FILE_BYTES = 200_000
GITHUB_API = "https://api.github.com"

ALLOWED_COMMAND_PREFIXES = (
    "npm run build",
    "npm run lint",
    "npm run test",
    "npx tsc --noEmit",
    "pytest",
    "python -m pytest",
    "python3 -m pytest",
    "git status",
    "git diff",
)

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


def _branch_name(task_id: str, title: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:40] or "task"
    return f"autopilot/{task_id}-{slug}"


def _is_protected(path: Path) -> bool:
    """Paths the model must never write to, whatever the task says."""
    return ".git" in path.parts or path.name.startswith(".env")


def _safe_path(workdir: Path, relative: str) -> Path:
    candidate = (workdir / (relative or ".")).resolve()
    root = workdir.resolve()
    if candidate != root and root not in candidate.parents:
        raise ValueError(f"Путь выходит за пределы рабочей копии репозитория: {relative!r}")
    return candidate


async def _run(
    cmd: list[str], cwd: Path, timeout: float, env: dict[str, str] | None = None
) -> tuple[int, str, str]:
    """Run a subprocess. `cmd` must never itself contain a secret value — pass
    secrets via `env` instead, so they can never leak into a logged/raised
    command line, a process listing, or a subprocess exception message."""
    process = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=str(cwd),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
    )
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()
        raise TimeoutError(f"Команда не уложилась в {timeout}с: {' '.join(cmd)}")
    return process.returncode or 0, stdout.decode("utf-8", "replace"), stderr.decode("utf-8", "replace")


def _git_credential_env(token: str) -> dict[str, str]:
    """Environment for a git subprocess that authenticates as x-access-token
    without ever placing the token in argv (command line / process list /
    any exception message that echoes `cmd`)."""
    return {**os.environ, "GIT_TERMINAL_PROMPT": "0", "ORBIT_GIT_TOKEN": token}


CREDENTIAL_HELPER = "!f() { echo username=x-access-token; echo password=$ORBIT_GIT_TOKEN; }; f"


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


async def _open_pull_request(
    repo: str, token: str, branch: str, base_branch: str, title: str, body: str
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
        response = await client.post(
            f"/repos/{repo}/pulls",
            json={"title": title[:250], "head": branch, "base": base_branch, "body": body[:60000]},
        )
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


async def _complete_with_retry(provider: Any, model: str, messages: list[dict[str, Any]]) -> Any | None:
    """One agent step, retried past transient provider hiccups.

    The NVIDIA endpoint intermittently answers with no choices at all (and
    occasionally just stalls) for a model that served a request seconds earlier,
    so a single bad response must not end an otherwise healthy run.
    """
    for attempt in range(1, PROVIDER_ATTEMPTS + 1):
        try:
            return await asyncio.wait_for(
                provider.complete(model, messages, temperature=0.1, max_tokens=4096, tools=TOOLS),
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


async def run(task: dict[str, Any], agent: dict[str, Any]) -> CodingExecutionResult:
    repo = str(settings.GITHUB_REPO or "").strip()
    token = str(settings.GITHUB_TOKEN or "").strip()
    if not repo or not token:
        raise CodingExecutorUnavailable("GITHUB_REPO/GITHUB_TOKEN не настроены")

    provider_name, model_name = _resolve_provider()
    provider = ai_provider_registry.get(provider_name)

    with tempfile.TemporaryDirectory(prefix="orbit-autopilot-") as base:
        workdir = Path(base) / "repo"
        default_branch = await _clone_repo(repo, workdir, token)
        branch = _branch_name(str(task["id"]), task["title"])

        system_prompt = (
            "Ты — автономный инженер Orbit Autopilot с доступом к рабочей копии репозитория "
            f"{repo} через инструменты read_file/edit_file/write_file/search/list_dir/run_command. "
            "Вноси только изменения, необходимые для задачи. Никогда не читай и не пиши в .git "
            "или файлы .env*. Когда закончишь — вызови finish с summary и commit_message. "
            "Если задачу нельзя выполнить — вызови finish, объяснив почему, и не меняй файлы."
        )
        user_prompt = (
            f"Задача: {task['title']}\n"
            f"Описание: {task.get('description') or ''}\n"
            f"Критерии приёмки: {json.dumps(task.get('acceptance_criteria') or [], ensure_ascii=False)}"
        )
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        steps: list[dict[str, Any]] = []
        finish_payload: dict[str, Any] | None = None
        deadline = time.monotonic() + RUN_TIMEOUT_SECONDS

        for _ in range(MAX_STEPS):
            if time.monotonic() > deadline:
                return CodingExecutionResult(success=False, steps=steps, error="Превышен общий лимит времени выполнения")

            result = await _complete_with_retry(provider, model_name, messages)
            if result is None:
                return CodingExecutionResult(
                    success=False,
                    steps=steps,
                    error=f"Провайдер {provider.name} не ответил после {PROVIDER_ATTEMPTS} попыток",
                )

            if not result.tool_calls:
                messages.append({"role": "assistant", "content": result.content})
                messages.append(
                    {
                        "role": "user",
                        "content": "Используй один из инструментов read_file/edit_file/write_file/search/list_dir/run_command, либо finish.",
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

            stop = False
            for call in result.tool_calls:
                try:
                    arguments = json.loads(call["arguments"] or "{}")
                except json.JSONDecodeError:
                    arguments = {}
                tool_name = call["name"]
                if tool_name == "finish":
                    finish_payload = arguments
                    stop = True
                    tool_output = "ok"
                else:
                    tool_output = await _dispatch_tool(workdir, tool_name, arguments)
                steps.append({"tool": tool_name, "arguments": arguments})
                messages.append({"role": "tool", "tool_call_id": call["id"], "content": tool_output[:4000]})
            if stop:
                break
        else:
            return CodingExecutionResult(
                success=False, steps=steps, error=f"Достигнут лимит шагов ({MAX_STEPS}) без вызова finish"
            )

        if finish_payload is None:
            return CodingExecutionResult(success=False, steps=steps, error="Модель не вызвала finish")

        summary = str(finish_payload.get("summary") or "")[:2000]
        commit_message = str(finish_payload.get("commit_message") or task["title"])[:200]

        try:
            commit_sha = await _create_branch_and_commit(workdir, branch, commit_message)
        except RuntimeError as exc:
            return CodingExecutionResult(success=False, steps=steps, summary=summary, error=str(exc))

        await _push_branch(workdir, branch, token)
        pr_url = await _open_pull_request(
            repo,
            token,
            branch,
            default_branch,
            title=f"[Autopilot] {task['title']}",
            body=f"{summary}\n\n---\nСоздано автопилотом Orbit CRM по задаче `{task['id']}`.",
        )

        return CodingExecutionResult(
            success=True,
            branch=branch,
            commit_sha=commit_sha,
            pr_url=pr_url,
            summary=summary,
            steps=steps,
        )
