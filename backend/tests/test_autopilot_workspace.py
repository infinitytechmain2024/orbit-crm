from __future__ import annotations

import asyncio
import shutil
import tempfile
import unittest
from pathlib import Path

from backend.services import autopilot_workspace as workspace


class SlugTests(unittest.TestCase):
    def test_repo_slug_is_filesystem_safe(self):
        self.assertEqual(workspace.repo_slug("Acme/My_Repo.git"), "acme-my-repo-git")
        self.assertEqual(workspace.repo_slug(""), "repo")

    def test_base_ref_is_always_remote_tracking(self):
        # Checking out a local head would let one run's branch state leak into
        # the next; the remote-tracking ref is always exactly what is on GitHub.
        self.assertEqual(workspace._base_ref("main"), "refs/remotes/origin/main")


class FallbackTests(unittest.IsolatedAsyncioTestCase):
    """Workspace management must never be the reason a run fails: every failure
    path degrades to the caller's throwaway clone."""

    async def test_no_cache_dir_yields_a_throwaway_clone(self):
        async with workspace.acquire("acme/repo", "tok", "", 2) as space:
            self.assertFalse(space.persistent)
            self.assertEqual(space.kind, "clone")

    async def test_zero_slots_yields_a_throwaway_clone(self):
        with tempfile.TemporaryDirectory() as tmp:
            async with workspace.acquire("acme/repo", "tok", tmp, 0) as space:
                self.assertFalse(space.persistent)

    async def test_unreachable_remote_degrades_instead_of_raising(self):
        with tempfile.TemporaryDirectory() as tmp:
            async with workspace.acquire("acme/definitely-not-a-repo", "tok", tmp, 1) as space:
                self.assertFalse(space.persistent)

    async def test_caller_exceptions_propagate(self):
        with self.assertRaises(ValueError):
            async with workspace.acquire("acme/repo", "tok", "", 1):
                raise ValueError("boom")


class SlotLockTests(unittest.TestCase):
    def test_a_held_slot_cannot_be_taken_twice(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "0.lock"
            first, second = workspace._SlotLock(path), workspace._SlotLock(path)
            self.assertTrue(first.try_acquire())
            try:
                self.assertFalse(second.try_acquire())
            finally:
                first.release()
            self.assertTrue(second.try_acquire())
            second.release()

    def test_release_is_safe_without_acquire(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace._SlotLock(Path(tmp) / "0.lock").release()


class WorktreeLifecycleTests(unittest.IsolatedAsyncioTestCase):
    """End-to-end against a real local repository — the reuse semantics are the
    whole point and cannot be asserted from mocks."""

    async def asyncSetUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)
        self.origin = root / "origin"
        self.cache = root / "cache"
        self.origin.mkdir(parents=True)

        await workspace.run_git(["git", "init", "-q", "-b", "main", "."], cwd=self.origin, timeout=30)
        (self.origin / ".gitignore").write_text("node_modules\n")
        (self.origin / "a.txt").write_text("hello")
        await workspace.run_git(["git", "add", "-A"], cwd=self.origin, timeout=30)
        await workspace.run_git(
            ["git", "-c", "user.email=t@t", "-c", "user.name=T", "commit", "-m", "init"],
            cwd=self.origin,
            timeout=30,
        )

        # Point a bare repository at the local origin, the way acquire() would.
        self.mirror = self.cache / "repos" / workspace.repo_slug("acme/repo") / "mirror.git"
        self.mirror.parent.mkdir(parents=True)
        await workspace.run_git(["git", "init", "--bare", str(self.mirror)], cwd=self.mirror.parent, timeout=30)
        for args in (
            ["remote", "add", "origin", str(self.origin)],
            ["config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"],
        ):
            await workspace.run_git(
                ["git", "--git-dir", str(self.mirror), *args], cwd=self.mirror.parent, timeout=30
            )

    async def asyncTearDown(self) -> None:
        self._tmp.cleanup()

    async def _commit_on_a_branch(self, path: Path, branch: str) -> None:
        await workspace.run_git(["git", "checkout", "-b", branch], cwd=path, timeout=30)
        (path / "feature.txt").write_text("work product")
        await workspace.run_git(["git", "add", "-A"], cwd=path, timeout=30)
        await workspace.run_git(
            ["git", "-c", "user.email=a@a", "-c", "user.name=A", "commit", "-m", "work"],
            cwd=path,
            timeout=30,
        )

    async def test_node_modules_survives_but_everything_else_is_reset(self):
        async with workspace.acquire("acme/repo", "tok", str(self.cache), 2) as space:
            self.assertTrue(space.persistent)
            self.assertEqual(space.default_branch, "main")
            first_path = space.path
            (space.path / "node_modules").mkdir(exist_ok=True)
            (space.path / "node_modules" / "marker").write_text("expensive to rebuild")
            (space.path / "scratch.txt").write_text("garbage")
            await self._commit_on_a_branch(space.path, "autopilot/task-9-demo")

        async with workspace.acquire("acme/repo", "tok", str(self.cache), 2) as space:
            self.assertEqual(space.path, first_path, "the slot should be reused")
            # Reinstalling node_modules is the most expensive step of verification.
            self.assertTrue((space.path / "node_modules" / "marker").is_file())
            self.assertFalse((space.path / "scratch.txt").exists())
            self.assertFalse((space.path / "feature.txt").exists())

    async def test_an_unpushed_commit_survives_the_next_fetch(self):
        async with workspace.acquire("acme/repo", "tok", str(self.cache), 2) as space:
            await self._commit_on_a_branch(space.path, "autopilot/task-9-demo")

        # The next run refetches with --prune. A `--mirror` refspec would delete
        # the unpushed branch here, destroying the commit the resume path needs.
        async with workspace.acquire("acme/repo", "tok", str(self.cache), 2) as space:
            branch, sha = await workspace.pending_delivery(self.mirror, "task-9")
            self.assertEqual(branch, "autopilot/task-9-demo")
            self.assertTrue(sha)

    async def test_pending_delivery_ignores_a_branch_already_on_the_remote(self):
        async with workspace.acquire("acme/repo", "tok", str(self.cache), 2) as space:
            await self._commit_on_a_branch(space.path, "autopilot/task-9-demo")
            await workspace.run_git(
                ["git", "push", "origin", "autopilot/task-9-demo"], cwd=space.path, timeout=30
            )

        async with workspace.acquire("acme/repo", "tok", str(self.cache), 2):
            branch, _sha = await workspace.pending_delivery(self.mirror, "task-9")
            self.assertEqual(branch, "", "a delivered branch has nothing to resume")

    async def test_concurrent_runs_get_different_checkouts(self):
        async with workspace.acquire("acme/repo", "tok", str(self.cache), 2) as first:
            async with workspace.acquire("acme/repo", "tok", str(self.cache), 2) as second:
                self.assertTrue(first.persistent and second.persistent)
                self.assertNotEqual(first.path, second.path)

    async def test_an_exhausted_pool_falls_back_rather_than_queueing(self):
        # Waiting would burn the second run's own time budget.
        async with workspace.acquire("acme/repo", "tok", str(self.cache), 1) as first:
            self.assertTrue(first.persistent)
            async with workspace.acquire("acme/repo", "tok", str(self.cache), 1) as second:
                self.assertFalse(second.persistent)

    async def test_a_deleted_slot_directory_is_rebuilt(self):
        async with workspace.acquire("acme/repo", "tok", str(self.cache), 1) as space:
            path = space.path
        shutil.rmtree(path)
        async with workspace.acquire("acme/repo", "tok", str(self.cache), 1) as space:
            self.assertTrue(space.persistent)
            self.assertTrue((space.path / "a.txt").is_file())


if __name__ == "__main__":
    unittest.main()
