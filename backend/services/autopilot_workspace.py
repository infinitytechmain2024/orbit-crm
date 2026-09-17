from __future__ import annotations

"""Persistent working copies for the autopilot.

Each run used to `git clone --depth 1` into a `TemporaryDirectory`. That cost a
~465 MB checkout every time, threw away `node_modules` so the verification phase
reinstalled from scratch, and — worst of all — destroyed the finished commit when
delivery to GitHub failed, so the retry had to redo the entire model loop.

This module replaces that with a **mirror plus a pool of reused worktrees**:

  * One bare repository per GitHub repo, refreshed with a fetch instead of
    re-cloned. The first fetch is a full one (bigger than a shallow clone),
    every later run pays only for new objects.

    It is deliberately NOT a `--mirror` clone. A mirror maps `refs/*:refs/*`, so
    `fetch --prune` would delete an autopilot branch that exists locally but was
    never pushed — destroying exactly the commit the resume path is for. With a
    plain `+refs/heads/*:refs/remotes/origin/*` refspec, pruning only touches
    remote-tracking refs and our own `refs/heads/autopilot/*` survive.
  * A small pool of long-lived worktrees. Between runs a slot is reset hard and
    cleaned — except `node_modules`, which is exactly what makes the browser
    self test affordable.
  * Because refs live in the mirror rather than in a temporary directory, a
    commit survives a failed push. `pending_delivery` finds it on the next
    attempt so the run can just re-push instead of redoing the work.

Slots are guarded by an advisory file lock, so two workers (or two processes)
never share a checkout. If anything about the persistent path fails — no cache
directory, every slot busy, a corrupted mirror — the caller falls back to the
old throwaway clone. A slow run is always preferable to a failed one.
"""

import asyncio
import fcntl
import logging
import os
import re
import shutil
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, AsyncIterator

logger = logging.getLogger(__name__)

MIRROR_FETCH_TIMEOUT_SECONDS = 600
MIRROR_CLONE_TIMEOUT_SECONDS = 900
WORKTREE_TIMEOUT_SECONDS = 300
# Never wiped when a slot is recycled: reinstalling it is the single most
# expensive step of the verification phase.
PRESERVED_BETWEEN_RUNS = ("node_modules",)


async def run_git(
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


def git_credential_env(token: str) -> dict[str, str]:
    """Environment for a git subprocess that authenticates as x-access-token
    without ever placing the token in argv (command line / process list /
    any exception message that echoes `cmd`)."""
    return {**os.environ, "GIT_TERMINAL_PROMPT": "0", "ORBIT_GIT_TOKEN": token}


CREDENTIAL_HELPER = "!f() { echo username=x-access-token; echo password=$ORBIT_GIT_TOKEN; }; f"


def repo_slug(repo: str) -> str:
    return re.sub(r"[^a-zA-Z0-9]+", "-", repo).strip("-").lower() or "repo"


@dataclass
class Workspace:
    """A checkout the executor can work in."""

    path: Path
    default_branch: str
    persistent: bool
    git_dir: Path | None = None

    @property
    def kind(self) -> str:
        return "worktree" if self.persistent else "clone"


class _SlotLock:
    """Advisory file lock so two runs never share one worktree.

    Non-blocking on purpose: a busy pool falls back to a throwaway clone rather
    than queueing behind another run and burning its own time budget waiting.
    """

    def __init__(self, path: Path) -> None:
        self._path = path
        self._handle: Any = None

    def try_acquire(self) -> bool:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        handle = open(self._path, "w")
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            handle.close()
            return False
        self._handle = handle
        return True

    def release(self) -> None:
        if self._handle is None:
            return
        try:
            fcntl.flock(self._handle.fileno(), fcntl.LOCK_UN)
        finally:
            self._handle.close()
            self._handle = None


async def _ensure_mirror(mirror: Path, repo: str, token: str) -> None:
    """Create the bare repository, or bring an existing one up to date.

    Uses an explicit `+refs/heads/*:refs/remotes/origin/*` refspec rather than a
    mirror, so `--prune` can never delete a locally committed autopilot branch
    that has not been pushed yet.
    """
    env = git_credential_env(token)
    remote_url = f"https://github.com/{repo}.git"
    fetch_refspec = "+refs/heads/*:refs/remotes/origin/*"

    if not (mirror / "HEAD").is_file():
        mirror.parent.mkdir(parents=True, exist_ok=True)
        shutil.rmtree(mirror, ignore_errors=True)
        code, _out, err = await run_git(
            ["git", "init", "--bare", str(mirror)], cwd=mirror.parent, timeout=60
        )
        if code != 0:
            raise RuntimeError(f"git init --bare failed: {err[-2000:]}")
        for args in (
            ["remote", "add", "origin", remote_url],
            ["config", "credential.helper", CREDENTIAL_HELPER],
            ["config", "remote.origin.fetch", fetch_refspec],
        ):
            await run_git(["git", "--git-dir", str(mirror), *args], cwd=mirror.parent, timeout=30, env=env)

    code, _out, err = await run_git(
        ["git", "--git-dir", str(mirror), "fetch", "--prune", "origin", fetch_refspec],
        cwd=mirror.parent,
        timeout=MIRROR_FETCH_TIMEOUT_SECONDS,
        env=env,
    )
    if code != 0:
        # A repository that cannot be refreshed is worse than none: it would hand
        # the run a stale base branch.
        raise RuntimeError(f"git fetch failed: {err[-2000:]}")


async def _mirror_default_branch(mirror: Path, token: str) -> str:
    """The remote's default branch, asked of the remote rather than guessed."""
    code, out, _err = await run_git(
        ["git", "--git-dir", str(mirror), "ls-remote", "--symref", "origin", "HEAD"],
        cwd=mirror.parent,
        timeout=60,
        env=git_credential_env(token),
    )
    if code == 0:
        for line in out.splitlines():
            if line.startswith("ref:"):
                ref = line.split()[1]
                return ref.rsplit("/", 1)[-1] or "main"
    return "main"


def _base_ref(default_branch: str) -> str:
    """What a worktree checks out: the remote-tracking ref, never a local head.

    Checking out a local head would let one run's branch state leak into the
    next; the remote-tracking ref is always exactly what is on GitHub.
    """
    return f"refs/remotes/origin/{default_branch}"


async def _reset_worktree(worktree: Path, mirror: Path, default_branch: str) -> None:
    """Return a reused slot to a pristine copy of the base branch.

    `node_modules` is deliberately preserved — recreating it is the most
    expensive thing the verification phase does.
    """
    excludes: list[str] = []
    for name in PRESERVED_BETWEEN_RUNS:
        excludes += ["-e", name]
    base = _base_ref(default_branch)
    await run_git(["git", "checkout", "--detach", "--force", base], cwd=worktree, timeout=WORKTREE_TIMEOUT_SECONDS)
    await run_git(["git", "reset", "--hard", base], cwd=worktree, timeout=WORKTREE_TIMEOUT_SECONDS)
    await run_git(["git", "clean", "-xdf", *excludes], cwd=worktree, timeout=WORKTREE_TIMEOUT_SECONDS)


async def _ensure_worktree(worktree: Path, mirror: Path, default_branch: str) -> None:
    if (worktree / ".git").exists():
        await _reset_worktree(worktree, mirror, default_branch)
        return
    # A stale registration from a slot whose directory was deleted by hand would
    # make `worktree add` refuse the path.
    await run_git(["git", "--git-dir", str(mirror), "worktree", "prune"], cwd=mirror.parent, timeout=60)
    shutil.rmtree(worktree, ignore_errors=True)
    worktree.parent.mkdir(parents=True, exist_ok=True)
    code, _out, err = await run_git(
        ["git", "--git-dir", str(mirror), "worktree", "add", "--detach", str(worktree), _base_ref(default_branch)],
        cwd=mirror.parent,
        timeout=WORKTREE_TIMEOUT_SECONDS,
    )
    if code != 0:
        raise RuntimeError(f"git worktree add failed: {err[-2000:]}")


async def pending_delivery(mirror: Path, task_id: str) -> tuple[str, str]:
    """A previous attempt's branch that was committed but never pushed.

    Returns `(branch, commit_sha)` or `("", "")`. Only meaningful with a
    persistent mirror: with a throwaway clone the commit is already gone.
    """
    code, out, _err = await run_git(
        [
            "git",
            "--git-dir",
            str(mirror),
            "for-each-ref",
            "--format=%(refname:short) %(objectname)",
            f"refs/heads/autopilot/{task_id}-*",
        ],
        cwd=mirror.parent,
        timeout=60,
    )
    if code != 0:
        return "", ""
    for line in out.splitlines():
        parts = line.split()
        if len(parts) != 2:
            continue
        branch, sha = parts
        # Already on the remote? Then delivery succeeded and there is nothing to resume.
        remote_code, remote_out, _ = await run_git(
            ["git", "--git-dir", str(mirror), "rev-parse", "--verify", "--quiet", f"refs/remotes/origin/{branch}"],
            cwd=mirror.parent,
            timeout=30,
        )
        if remote_code == 0 and remote_out.strip() == sha:
            continue
        return branch, sha
    return "", ""


@asynccontextmanager
async def acquire(repo: str, token: str, cache_dir: str, slots: int) -> AsyncIterator[Workspace]:
    """Yield a working copy, persistent when possible.

    Never raises for a workspace-management reason: every failure path degrades
    to the caller's throwaway clone by yielding `persistent=False`. There is
    exactly one `yield`, so an exception raised by the *caller's* body
    propagates normally instead of being swallowed by a second one.
    """
    fallback = Workspace(path=Path(), default_branch="", persistent=False)
    lock: _SlotLock | None = None
    workspace = fallback

    try:
        if cache_dir and slots >= 1:
            try:
                root = Path(cache_dir) / "repos" / repo_slug(repo)
                slot_index: int | None = None
                for index in range(slots):
                    candidate = _SlotLock(root / "slots" / f"{index}.lock")
                    if candidate.try_acquire():
                        lock, slot_index = candidate, index
                        break
                if slot_index is None:
                    logger.info(
                        "autopilot: all %s workspace slots busy, falling back to a throwaway clone", slots
                    )
                else:
                    mirror = root / "mirror.git"
                    await _ensure_mirror(mirror, repo, token)
                    default_branch = await _mirror_default_branch(mirror, token)
                    worktree = root / "worktrees" / str(slot_index)
                    await _ensure_worktree(worktree, mirror, default_branch)
                    logger.info(
                        "autopilot: using persistent worktree slot %s for %s", slot_index, repo
                    )
                    workspace = Workspace(
                        path=worktree,
                        default_branch=default_branch,
                        persistent=True,
                        git_dir=mirror,
                    )
            except Exception as exc:
                logger.warning(
                    "autopilot: persistent workspace unavailable (%s), using a throwaway clone", exc
                )
                if lock is not None:
                    lock.release()
                    lock = None
                workspace = fallback
        yield workspace
    finally:
        if lock is not None:
            lock.release()
