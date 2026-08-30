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

MAX_STEPS = 20
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
            "name": "write_file",
            "description": "Create or overwrite a text file in the repository working copy.",
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

        if name == "write_file":
            path = _safe_path(workdir, str(arguments.get("path") or ""))
            if ".git" in path.parts or path.name.startswith(".env"):
                return "Ошибка: запись в этот путь запрещена"
            path.parent.mkdir(parents=True, exist_ok=True)
            content = str(arguments.get("content") or "")
            path.write_text(content, encoding="utf-8")
            return f"Записано {len(content)} байт в {arguments.get('path')}"

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


def _resolve_provider() -> tuple[str, str]:
    chain = [
        ("nvidia", settings.NVIDIA_MODEL or "openai/gpt-oss-120b"),
        ("openai", settings.OPENAI_MODEL or "gpt-4o-mini"),
        ("groq", settings.GROQ_MODEL or "openai/gpt-oss-120b"),
    ]
    for name, model in chain:
        if ai_provider_registry.is_configured(name):
            return name, model
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
            f"{repo} через инструменты read_file/write_file/list_dir/run_command. "
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

            result = await asyncio.wait_for(
                provider.complete(model_name, messages, temperature=0.1, max_tokens=4096, tools=TOOLS),
                timeout=STEP_TIMEOUT_SECONDS,
            )

            if not result.tool_calls:
                messages.append({"role": "assistant", "content": result.content})
                messages.append(
                    {
                        "role": "user",
                        "content": "Используй один из инструментов read_file/write_file/list_dir/run_command, либо finish.",
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
