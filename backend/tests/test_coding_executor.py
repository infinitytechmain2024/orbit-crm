from __future__ import annotations

import tempfile
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


class FileEditingSafetyTests(unittest.IsolatedAsyncioTestCase):
    """The first live run destroyed a 613-line document: the model called
    write_file with only its new section, silently dropping everything else.
    write_file must refuse a large truncation, and edit_file must exist as the
    safe way to change part of a file."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.workdir = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    async def test_write_file_refuses_to_truncate_a_large_existing_file(self):
        target = self.workdir / "runbook.md"
        target.write_text("original line\n" * 500, encoding="utf-8")
        before = target.read_text(encoding="utf-8")

        out = await coding_executor._dispatch_tool(
            self.workdir, "write_file", {"path": "runbook.md", "content": "## Only a new section\n"}
        )

        self.assertIn("Ошибка", out)
        self.assertEqual(target.read_text(encoding="utf-8"), before, "file must be left untouched")

    async def test_write_file_still_allows_creating_new_files(self):
        out = await coding_executor._dispatch_tool(
            self.workdir, "write_file", {"path": "docs/new.md", "content": "hello"}
        )
        self.assertNotIn("Ошибка", out)
        self.assertEqual((self.workdir / "docs/new.md").read_text(encoding="utf-8"), "hello")

    async def test_edit_file_replaces_only_the_named_snippet(self):
        target = self.workdir / "doc.md"
        target.write_text("# Title\n\nkeep me\n\nOLD BLOCK\n\nkeep me too\n", encoding="utf-8")

        out = await coding_executor._dispatch_tool(
            self.workdir,
            "edit_file",
            {"path": "doc.md", "old_string": "OLD BLOCK", "new_string": "NEW BLOCK"},
        )

        self.assertNotIn("Ошибка", out)
        result = target.read_text(encoding="utf-8")
        self.assertIn("NEW BLOCK", result)
        self.assertIn("keep me", result)
        self.assertIn("keep me too", result)
        self.assertIn("# Title", result)

    async def test_edit_file_rejects_ambiguous_snippet(self):
        target = self.workdir / "doc.md"
        target.write_text("same\nsame\n", encoding="utf-8")
        out = await coding_executor._dispatch_tool(
            self.workdir, "edit_file", {"path": "doc.md", "old_string": "same", "new_string": "x"}
        )
        self.assertIn("встречается 2 раз", out)
        self.assertEqual(target.read_text(encoding="utf-8"), "same\nsame\n")

    async def test_edit_file_reports_missing_snippet_without_writing(self):
        target = self.workdir / "doc.md"
        target.write_text("content\n", encoding="utf-8")
        out = await coding_executor._dispatch_tool(
            self.workdir, "edit_file", {"path": "doc.md", "old_string": "absent", "new_string": "x"}
        )
        self.assertIn("не найден", out)
        self.assertEqual(target.read_text(encoding="utf-8"), "content\n")

    async def test_protected_paths_are_never_writable(self):
        for path in [".env", ".env.local", ".git/config"]:
            out = await coding_executor._dispatch_tool(
                self.workdir, "write_file", {"path": path, "content": "x"}
            )
            self.assertIn("запрещена", out, f"{path} must be refused")


if __name__ == "__main__":
    unittest.main()


class PlanTrackingTests(unittest.TestCase):
    """Step tracking is the contract the report depends on: a status change must
    hit the plan file on disk immediately, so a run killed mid-flight still tells
    the truth about how far it got."""

    def setUp(self) -> None:
        from backend.services.autopilot_plan import AutopilotPlan, PlanStep

        self._tmp = tempfile.TemporaryDirectory()
        self.workdir = Path(self._tmp.name)
        self.plan = AutopilotPlan(
            task_id="task-1",
            task_title="Экспорт клиентов",
            steps=[PlanStep(id="1", title="Ручка"), PlanStep(id="2", title="Кнопка")],
        )
        self.plan.write(self.workdir)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _plan_file(self) -> str:
        return (self.workdir / self.plan.relative_path).read_text(encoding="utf-8")

    def test_complete_step_is_flushed_to_disk_immediately(self):
        out = coding_executor._dispatch_plan_tool(
            self.plan, self.workdir, "complete_step", {"step_id": "1", "note": "добавил /export"}
        )
        self.assertIn("выполненным", out)
        self.assertIn("- [x] 1. Ручка", self._plan_file())
        self.assertIn("добавил /export", self._plan_file())

    def test_block_step_records_reason_and_keeps_the_run_going(self):
        out = coding_executor._dispatch_plan_tool(
            self.plan, self.workdir, "block_step", {"step_id": "2", "reason": "нет макета"}
        )
        self.assertIn("Продолжай остальные шаги", out)
        self.assertIn("- [!] 2. Кнопка", self._plan_file())
        self.assertIn("нет макета", self._plan_file())

    def test_block_step_requires_a_reason(self):
        out = coding_executor._dispatch_plan_tool(self.plan, self.workdir, "block_step", {"step_id": "2"})
        self.assertIn("reason обязателен", out)
        self.assertIn("- [ ] 2. Кнопка", self._plan_file())

    def test_unknown_step_id_lists_the_real_ones(self):
        out = coding_executor._dispatch_plan_tool(self.plan, self.workdir, "complete_step", {"step_id": "9"})
        self.assertIn("Ошибка", out)
        self.assertIn("1, 2", out)

    def test_non_plan_tools_fall_through(self):
        self.assertIsNone(coding_executor._dispatch_plan_tool(self.plan, self.workdir, "read_file", {"path": "x"}))

    def test_show_plan_reports_current_statuses(self):
        coding_executor._dispatch_plan_tool(self.plan, self.workdir, "complete_step", {"step_id": "1"})
        out = coding_executor._dispatch_plan_tool(self.plan, self.workdir, "show_plan", {})
        self.assertIn("[done] 1. Ручка", out)
        self.assertIn("[pending] 2. Кнопка", out)


class PlanToolExposureTests(unittest.TestCase):
    def test_plan_tools_are_offered_to_the_model(self):
        names = {tool["function"]["name"] for tool in coding_executor.TOOLS}
        self.assertTrue({"show_plan", "complete_step", "block_step"}.issubset(names))

    def test_result_carries_the_lifecycle_artifacts(self):
        result = coding_executor.CodingExecutionResult(success=False, error="x")
        self.assertEqual(result.plan, {})
        self.assertEqual(result.review_findings, [])
        self.assertEqual(result.verification, {})


class ProtectedPathTests(unittest.TestCase):
    """The plan file is the run's own progress record. If the model could edit it
    directly it could mark steps done without doing them — the exact failure the
    plan exists to catch — so the block is in code, not in the prompt."""

    def test_plan_directory_is_not_writable_by_the_model(self):
        for relative in ("docs/autopilot/plans/task-1.md", "repo/docs/autopilot/plans/x.md"):
            with self.subTest(relative=relative):
                self.assertTrue(coding_executor._is_protected(Path("/tmp/wd") / relative))

    def test_git_and_env_stay_protected(self):
        for relative in (".git/config", ".env", ".env.local", "backend/.env"):
            with self.subTest(relative=relative):
                self.assertTrue(coding_executor._is_protected(Path("/tmp/wd") / relative))

    def test_ordinary_paths_and_nearby_docs_remain_writable(self):
        for relative in ("src/app.tsx", "docs/autopilot/README.md", "docs/plans/x.md", "backend/main.py"):
            with self.subTest(relative=relative):
                self.assertFalse(coding_executor._is_protected(Path("/tmp/wd") / relative))

    def test_write_file_refuses_the_plan_path(self):
        async def scenario():
            with tempfile.TemporaryDirectory() as tmp:
                return await coding_executor._dispatch_tool(
                    Path(tmp),
                    "write_file",
                    {"path": "docs/autopilot/plans/task-1.md", "content": "- [x] 1. Всё сделано"},
                )

        import asyncio

        self.assertIn("запрещена", asyncio.run(scenario()))


class TimeBudgetTests(unittest.TestCase):
    """The feature shipped with budgets that did not reconcile with the caller:
    the queue killed a job at 900s while a run with verification needs far more,
    so the browser self test could never finish."""

    def test_run_budget_covers_every_phase_it_is_made_of(self):
        self.assertEqual(
            coding_executor.RUN_TIMEOUT_SECONDS,
            coding_executor.EXECUTION_BUDGET_SECONDS + coding_executor.VERIFICATION_BUDGET_SECONDS,
        )
        total = coding_executor.total_run_budget_seconds()
        self.assertGreaterEqual(
            total,
            coding_executor.CLONE_TIMEOUT_SECONDS + coding_executor.RUN_TIMEOUT_SECONDS,
        )

    def test_verification_budget_fits_the_verifier_it_calls(self):
        from backend.services import autopilot_verifier

        # The executor hands the verifier whatever is left; that slice has to be
        # able to cover a real install + browser + run, or phase 4 is decorative.
        self.assertGreaterEqual(
            coding_executor.VERIFICATION_BUDGET_SECONDS,
            autopilot_verifier.MIN_BUDGET_SECONDS,
        )

    def test_total_budget_exceeds_the_queue_default_that_used_to_kill_runs(self):
        self.assertGreater(coding_executor.total_run_budget_seconds(), 900)


class BranchRetryTests(unittest.TestCase):
    """A retry after a partially delivered run must not collide with itself."""

    def test_first_attempt_keeps_the_plain_name(self):
        self.assertEqual(
            coding_executor._branch_name("task-1", "Экспорт", 1),
            coding_executor._branch_name("task-1", "Экспорт"),
        )

    def test_later_attempts_get_distinct_branches(self):
        names = {coding_executor._branch_name("task-1", "Экспорт", attempt) for attempt in (1, 2, 3)}
        self.assertEqual(len(names), 3)
        for name in names:
            self.assertTrue(name.startswith("autopilot/task-1-"))
            self.assertNotIn(name, ("main", "master"))


class DeliveryFailureTests(unittest.IsolatedAsyncioTestCase):
    """A push/PR failure used to escape as an unhandled exception: the worker
    retried the whole job from a fresh clone while the finished commit died with
    the temporary directory."""

    @patch("backend.services.coding_executor._find_open_pull_request", new_callable=AsyncMock)
    async def test_existing_pull_request_is_reused_instead_of_recreated(self, find_mock):
        find_mock.return_value = "https://github.com/acme/repo/pull/9"
        url = await coding_executor._open_pull_request(
            "acme/repo", "token", "autopilot/task-1-x", "main", "title", "body"
        )
        self.assertEqual(url, "https://github.com/acme/repo/pull/9")
        find_mock.assert_awaited()

    async def test_pull_request_lookup_survives_a_broken_listing(self):
        import httpx

        class BrokenClient:
            async def get(self, *_args, **_kwargs):
                raise httpx.ConnectError("no route to host")

        # A failed lookup must degrade to "no existing PR", not blow up the run.
        self.assertEqual(
            await coding_executor._find_open_pull_request(BrokenClient(), "acme/repo", "autopilot/x"),
            "",
        )


class ChangedFileCheckTests(unittest.IsolatedAsyncioTestCase):
    """The repository carries pre-existing failures (141 tsc diagnostics and 3
    failing tests at the time of writing). Handing the model that wall of noise
    makes "did I break something?" unanswerable, so a check reports the delta."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.workdir = Path(self._tmp.name)
        (self.workdir / "node_modules").mkdir()

    def tearDown(self) -> None:
        self._tmp.cleanup()

    async def test_unknown_check_is_rejected_with_the_valid_names(self):
        out = await coding_executor._run_check(self.workdir, "vibes")
        self.assertIn("неизвестная проверка", out)
        self.assertIn("typescript", out)

    async def test_missing_node_modules_explains_itself(self):
        import shutil

        shutil.rmtree(self.workdir / "node_modules")
        out = await coding_executor._run_check(self.workdir, "typescript")
        self.assertIn("node_modules", out)

    @patch("backend.services.coding_executor._changed_files", new_callable=AsyncMock)
    async def test_nothing_changed_means_nothing_to_check(self, changed):
        changed.return_value = set()
        self.assertIn("не изменил", await coding_executor._run_check(self.workdir, "typescript"))

    @patch("backend.services.coding_executor._run", new_callable=AsyncMock)
    @patch("backend.services.coding_executor._changed_files", new_callable=AsyncMock)
    async def test_only_diagnostics_in_changed_files_are_reported(self, changed, run_mock):
        changed.return_value = {"src/mine.tsx"}
        run_mock.return_value = (
            1,
            "src/mine.tsx(10,5): error TS2532: Object is possibly 'undefined'.\n"
            "src/theirs.tsx(1,1): error TS4111: pre-existing\n"
            "src/also-theirs.tsx(2,2): error TS2322: pre-existing\n",
            "",
        )
        out = await coding_executor._run_check(self.workdir, "typescript")

        self.assertIn("src/mine.tsx(10,5)", out)
        self.assertNotIn("src/theirs.tsx", out)
        self.assertNotIn("src/also-theirs.tsx", out)
        # The ambient total is still stated, so the number is not mysterious.
        self.assertIn("1 замечани", out)
        self.assertIn("3", out)

    @patch("backend.services.coding_executor._run", new_callable=AsyncMock)
    @patch("backend.services.coding_executor._changed_files", new_callable=AsyncMock)
    async def test_clean_delta_says_so_even_when_the_project_is_dirty(self, changed, run_mock):
        changed.return_value = {"src/mine.tsx"}
        run_mock.return_value = (1, "src/theirs.tsx(1,1): error TS4111: pre-existing\n", "")
        out = await coding_executor._run_check(self.workdir, "typescript")
        self.assertIn("чисто", out)

    @patch("backend.services.coding_executor._run", new_callable=AsyncMock)
    @patch("backend.services.coding_executor._changed_files", new_callable=AsyncMock)
    async def test_absolute_paths_in_output_still_match_changed_files(self, changed, run_mock):
        changed.return_value = {"src/mine.tsx"}
        run_mock.return_value = (1, f"{self.workdir}/src/mine.tsx(4,1): error TS2532: mine\n", "")
        self.assertIn("mine", await coding_executor._run_check(self.workdir, "typescript"))
        self.assertIn("1 замечани", await coding_executor._run_check(self.workdir, "typescript"))


class CheckToolExposureTests(unittest.TestCase):
    def test_e2e_and_lint_commands_are_runnable_by_the_executor(self):
        for prefix in ("npx playwright test", "npx eslint", "npm run test:e2e"):
            self.assertIn(prefix, coding_executor.ALLOWED_COMMAND_PREFIXES)

    def test_check_changes_is_offered_to_the_model(self):
        names = {tool["function"]["name"] for tool in coding_executor.TOOLS}
        self.assertIn("check_changes", names)
