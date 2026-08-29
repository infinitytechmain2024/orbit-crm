from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from backend.services import coding_executor


class CodingExecutorSafetyTests(unittest.TestCase):
    def test_branch_name_is_always_prefixed_and_never_default(self):
        branch = coding_executor._branch_name("task-123", "Опубликуй релиз в production!")
        self.assertTrue(branch.startswith("autopilot/task-123-"))
        self.assertNotIn(branch, ("main", "master"))

    def test_safe_path_rejects_traversal_outside_workdir(self):
        workdir = Path("/tmp/orbit-test-workdir")
        with self.assertRaises(ValueError):
            coding_executor._safe_path(workdir, "../../etc/passwd")

    def test_safe_path_rejects_absolute_escape(self):
        workdir = Path("/tmp/orbit-test-workdir")
        with self.assertRaises(ValueError):
            coding_executor._safe_path(workdir, "/etc/passwd")

    def test_safe_path_allows_paths_inside_workdir(self):
        workdir = Path("/tmp/orbit-test-workdir")
        resolved = coding_executor._safe_path(workdir, "src/app.py")
        self.assertTrue(str(resolved).startswith(str(workdir.resolve())))


class CodingExecutorTokenRedactionTests(unittest.IsolatedAsyncioTestCase):
    """Regression test for the credential-leak bug: a token must never be
    placed in a subprocess's argv, only in its environment — argv is what
    ends up in exception messages, process listings, and job/event logs."""

    @patch("backend.services.coding_executor._run", new_callable=AsyncMock)
    async def test_clone_repo_never_puts_token_in_argv(self, run_mock):
        run_mock.side_effect = [
            (0, "", ""),  # git clone
            (0, "", ""),  # git config credential.helper
            (0, "main", ""),  # git symbolic-ref
        ]
        secret = "github_pat_TOTALLY_SECRET_VALUE"
        await coding_executor._clone_repo("owner/repo", Path("/tmp/orbit-test-workdir/repo"), secret)

        for call in run_mock.call_args_list:
            cmd = call.args[0]
            for part in cmd:
                self.assertNotIn(secret, part, f"token leaked into argv: {cmd}")

    @patch("backend.services.coding_executor._run", new_callable=AsyncMock)
    async def test_push_branch_never_puts_token_in_argv(self, run_mock):
        run_mock.return_value = (0, "", "")
        secret = "github_pat_TOTALLY_SECRET_VALUE"
        await coding_executor._push_branch(Path("/tmp/orbit-test-workdir/repo"), "autopilot/task-1-x", secret)

        cmd = run_mock.call_args.args[0]
        for part in cmd:
            self.assertNotIn(secret, part, f"token leaked into argv: {cmd}")

    def test_credential_env_carries_token_out_of_band(self):
        env = coding_executor._git_credential_env("github_pat_TOTALLY_SECRET_VALUE")
        self.assertEqual(env["ORBIT_GIT_TOKEN"], "github_pat_TOTALLY_SECRET_VALUE")

    def test_credential_helper_script_has_no_hardcoded_secret(self):
        self.assertNotIn("github_pat", coding_executor.CREDENTIAL_HELPER)
        self.assertIn("$ORBIT_GIT_TOKEN", coding_executor.CREDENTIAL_HELPER)


if __name__ == "__main__":
    unittest.main()
