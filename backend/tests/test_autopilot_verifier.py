from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from backend.services import autopilot_verifier
from backend.services.autopilot_plan import STATUS_BLOCKED, STATUS_DONE, AutopilotPlan, PlanStep
from backend.services.autopilot_verifier import ReviewFinding, VerificationResult

SECRET = "github_pat_TOTALLY_SECRET_VALUE_1234"
TEST_PASSWORD = "sup3r-secret-test-password"


class SecretHandlingTests(unittest.TestCase):
    """The browser test is the one phase that runs untrusted-ish tooling with
    credentials in scope, so both directions are covered: secrets must not get
    *into* the subprocess unnecessarily, and must not get *out* into a report."""

    @patch.object(autopilot_verifier.settings, "GITHUB_TOKEN", SECRET)
    @patch.object(autopilot_verifier.settings, "AUTOPILOT_E2E_PASSWORD", TEST_PASSWORD)
    def test_scrub_redacts_known_secrets(self):
        text = f"clone failed with token {SECRET} and password {TEST_PASSWORD}"
        cleaned = autopilot_verifier.scrub(text)
        self.assertNotIn(SECRET, cleaned)
        self.assertNotIn(TEST_PASSWORD, cleaned)
        self.assertIn("***", cleaned)

    def test_scrub_ignores_empty_and_short_values(self):
        with patch.object(autopilot_verifier.settings, "GITHUB_TOKEN", ""):
            self.assertEqual(autopilot_verifier.scrub("ничего не трогаем"), "ничего не трогаем")

    @patch.object(autopilot_verifier.settings, "GITHUB_TOKEN", SECRET)
    @patch.object(autopilot_verifier.settings, "AUTOPILOT_E2E_EMAIL", "qa@example.local")
    @patch.object(autopilot_verifier.settings, "AUTOPILOT_E2E_PASSWORD", TEST_PASSWORD)
    def test_e2e_environment_excludes_repo_and_provider_secrets(self):
        env = autopilot_verifier.e2e_environment()
        self.assertNotIn("GITHUB_TOKEN", env)
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", env)
        self.assertNotIn("NVIDIA_API_KEY", env)
        self.assertNotIn(SECRET, "".join(env.values()))
        # ...while the test account itself is present, out of band from argv.
        self.assertEqual(env["E2E_EMAIL"], "qa@example.local")
        self.assertEqual(env["E2E_PASSWORD"], TEST_PASSWORD)

    @patch.object(autopilot_verifier.settings, "AUTOPILOT_E2E_PASSWORD", TEST_PASSWORD)
    def test_run_step_keeps_secrets_out_of_argv_and_output(self):
        async def scenario():
            with tempfile.TemporaryDirectory() as tmp:
                return await autopilot_verifier._run_step(
                    "echo",
                    ["python3", "-c", "import os; print(os.environ['E2E_PASSWORD'])"],
                    Path(tmp),
                    30,
                    {"PATH": "/usr/bin:/bin:/usr/local/bin", "E2E_PASSWORD": TEST_PASSWORD},
                )

        import asyncio

        step = asyncio.run(scenario())
        self.assertTrue(step["ok"], step["output"])
        self.assertNotIn(TEST_PASSWORD, step["command"])
        # The subprocess printed the password; the captured output must be scrubbed.
        self.assertNotIn(TEST_PASSWORD, step["output"])
        self.assertIn("***", step["output"])


class E2EGatingTests(unittest.IsolatedAsyncioTestCase):
    @patch.object(autopilot_verifier.settings, "AUTOPILOT_E2E_ENABLED", False)
    async def test_disabled_reports_skipped_not_passed(self):
        result = await autopilot_verifier.run_browser_self_test(Path("/tmp"))
        self.assertEqual(result.status, "skipped")
        self.assertFalse(result.passed)

    @patch.object(autopilot_verifier.settings, "AUTOPILOT_E2E_ENABLED", True)
    @patch.object(autopilot_verifier.settings, "AUTOPILOT_E2E_EMAIL", "")
    @patch.object(autopilot_verifier.settings, "AUTOPILOT_E2E_PASSWORD", "")
    async def test_missing_credentials_reports_skipped(self):
        result = await autopilot_verifier.run_browser_self_test(Path("/tmp"))
        self.assertEqual(result.status, "skipped")
        self.assertIn("AUTOPILOT_E2E_EMAIL", result.reason)

    @patch.object(autopilot_verifier.settings, "AUTOPILOT_E2E_ENABLED", True)
    @patch.object(autopilot_verifier.settings, "AUTOPILOT_E2E_EMAIL", "qa@example.local")
    @patch.object(autopilot_verifier.settings, "AUTOPILOT_E2E_PASSWORD", TEST_PASSWORD)
    @patch.object(autopilot_verifier.settings, "AUTOPILOT_E2E_SUPABASE_ANON_KEY", "")
    async def test_missing_anon_key_reports_skipped(self):
        """Without it the app under test renders "Supabase не настроен" and the
        failure reads as a defect in the change rather than a missing setting."""
        result = await autopilot_verifier.run_browser_self_test(Path("/tmp"))
        self.assertEqual(result.status, "skipped")
        self.assertIn("ANON_KEY", result.reason)

    @patch.object(autopilot_verifier.settings, "AUTOPILOT_E2E_ENABLED", True)
    @patch.object(autopilot_verifier.settings, "AUTOPILOT_E2E_EMAIL", "qa@example.local")
    @patch.object(autopilot_verifier.settings, "AUTOPILOT_E2E_PASSWORD", TEST_PASSWORD)
    @patch.object(autopilot_verifier.settings, "AUTOPILOT_E2E_SUPABASE_ANON_KEY", "anon-key-value")
    async def test_missing_spec_reports_skipped_rather_than_running_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = await autopilot_verifier.run_browser_self_test(Path(tmp))
        self.assertEqual(result.status, "skipped")
        self.assertIn("autopilot-smoke.spec.ts", result.reason)


class ReviewParsingTests(unittest.IsolatedAsyncioTestCase):
    def test_findings_are_normalised(self):
        findings = autopilot_verifier.parse_findings(
            {
                "findings": [
                    {"severity": "BLOCKER", "summary": "await потерян", "file": "a.py", "suggestion": "добавь await"},
                    {"severity": "космический", "summary": "мелочь"},
                    {"summary": ""},
                    "не объект",
                ]
            }
        )
        self.assertEqual(len(findings), 2)
        self.assertEqual(findings[0].severity, "blocker")
        self.assertTrue(findings[0].blocking)
        self.assertEqual(findings[1].severity, "minor")
        self.assertFalse(findings[1].blocking)

    def test_garbage_payload_yields_no_findings(self):
        for payload in (None, {}, {"findings": "нет"}):
            self.assertEqual(autopilot_verifier.parse_findings(payload), [])

    async def test_empty_diff_skips_the_model_call(self):
        called = False

        async def complete(_messages):
            nonlocal called
            called = True
            return None

        self.assertEqual(await autopilot_verifier.review_diff(complete, {"title": "t"}, "   "), [])
        self.assertFalse(called)

    async def test_review_sees_the_real_diff(self):
        captured: list[str] = []

        class Result:
            content = '{"findings": [{"severity": "major", "summary": "битый импорт", "file": "x.py"}]}'

        async def complete(messages):
            captured.append(messages[-1]["content"])
            return Result()

        findings = await autopilot_verifier.review_diff(
            complete, {"title": "t"}, "diff --git a/x.py b/x.py\n+import nope"
        )
        self.assertEqual(len(findings), 1)
        self.assertIn("import nope", captured[0])

    async def test_provider_failure_is_not_a_run_failure(self):
        async def boom(_messages):
            raise RuntimeError("down")

        self.assertEqual(await autopilot_verifier.review_diff(boom, {"title": "t"}, "diff"), [])


class ReportTests(unittest.TestCase):
    def test_report_states_every_plan_step_and_the_verification_outcome(self):
        plan = AutopilotPlan(
            task_id="task-1",
            task_title="Экспорт",
            steps=[PlanStep(id="1", title="Ручка"), PlanStep(id="2", title="Кнопка"), PlanStep(id="3", title="Тест")],
        )
        plan.mark("1", STATUS_DONE)
        plan.mark("2", STATUS_BLOCKED, "нет макета")

        report = autopilot_verifier.render_report(
            {"title": "Экспорт"},
            plan,
            "Сделал ручку.",
            [ReviewFinding(severity="minor", summary="можно проще", file="a.py")],
            VerificationResult(status="failed", reason="Логин не прошёл", defects=["timeout"]),
            pr_url="https://github.com/acme/repo/pull/7",
        )

        self.assertIn("1/3 выполнено", report)
        self.assertIn("Сделано", report)
        self.assertIn("Заблокировано", report)
        self.assertIn("нет макета", report)
        self.assertIn("Не сделано", report)
        self.assertIn("можно проще", report)
        self.assertIn("не пройден", report)
        self.assertIn("https://github.com/acme/repo/pull/7", report)

    def test_report_survives_pipes_in_step_titles(self):
        plan = AutopilotPlan(
            task_id="t", task_title="T", steps=[PlanStep(id="1", title="a | b"), PlanStep(id="2", title="c")]
        )
        report = autopilot_verifier.render_report({"title": "T"}, plan, "", [], VerificationResult())
        self.assertIn("a \\| b", report)

    @patch.object(autopilot_verifier.settings, "GITHUB_TOKEN", SECRET)
    def test_report_never_leaks_a_secret_from_test_output(self):
        plan = AutopilotPlan(task_id="t", task_title="T", steps=[PlanStep(id="1", title="a")])
        report = autopilot_verifier.render_report(
            {"title": "T"},
            plan,
            "",
            [],
            VerificationResult(status="failed", reason="упал", defects=[f"auth header: {SECRET}"]),
        )
        self.assertNotIn(SECRET, report)


if __name__ == "__main__":
    unittest.main()


class VerificationBudgetTests(unittest.IsolatedAsyncioTestCase):
    """Verification must never be the reason a run overruns its job timeout: it
    is handed whatever wall clock is left and degrades to `skipped` when that is
    not enough, instead of being killed halfway through."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.workdir = Path(self._tmp.name)
        spec = self.workdir / "e2e" / "autopilot-smoke.spec.ts"
        spec.parent.mkdir(parents=True)
        spec.write_text("// spec", encoding="utf-8")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    @patch.object(autopilot_verifier.settings, "AUTOPILOT_E2E_ENABLED", True)
    @patch.object(autopilot_verifier.settings, "AUTOPILOT_E2E_EMAIL", "qa@example.local")
    @patch.object(autopilot_verifier.settings, "AUTOPILOT_E2E_PASSWORD", TEST_PASSWORD)
    @patch.object(autopilot_verifier.settings, "AUTOPILOT_E2E_SUPABASE_ANON_KEY", "anon")
    @patch.object(autopilot_verifier, "_run_step", new_callable=AsyncMock)
    async def test_too_little_budget_skips_without_running_anything(self, run_step):
        result = await autopilot_verifier.run_browser_self_test(self.workdir, budget_seconds=10)
        self.assertEqual(result.status, "skipped")
        self.assertIn("недостаточно", result.reason)
        run_step.assert_not_awaited()

    @patch.object(autopilot_verifier.settings, "AUTOPILOT_E2E_ENABLED", True)
    @patch.object(autopilot_verifier.settings, "AUTOPILOT_E2E_EMAIL", "qa@example.local")
    @patch.object(autopilot_verifier.settings, "AUTOPILOT_E2E_PASSWORD", TEST_PASSWORD)
    @patch.object(autopilot_verifier.settings, "AUTOPILOT_E2E_SUPABASE_ANON_KEY", "anon")
    @patch.object(autopilot_verifier, "_run_step", new_callable=AsyncMock)
    async def test_step_timeouts_are_capped_by_the_remaining_budget(self, run_step):
        run_step.return_value = {"name": "x", "command": "x", "exit_code": 0, "ok": True, "output": ""}
        budget = autopilot_verifier.MIN_BUDGET_SECONDS + 60
        await autopilot_verifier.run_browser_self_test(self.workdir, budget_seconds=budget)

        self.assertTrue(run_step.await_args_list, "no step ran")
        for call in run_step.await_args_list:
            timeout = call.args[3]
            self.assertLessEqual(timeout, budget)
        # ...and the nominal ceilings still apply when the budget is generous.
        run_step.reset_mock()
        await autopilot_verifier.run_browser_self_test(self.workdir, budget_seconds=100_000)
        self.assertEqual(run_step.await_args_list[0].args[3], autopilot_verifier.INSTALL_TIMEOUT_SECONDS)

    def test_nominal_budget_is_the_sum_of_its_steps(self):
        self.assertEqual(
            autopilot_verifier.NOMINAL_BUDGET_SECONDS,
            autopilot_verifier.INSTALL_TIMEOUT_SECONDS
            + autopilot_verifier.BROWSER_INSTALL_TIMEOUT_SECONDS
            + autopilot_verifier.E2E_TIMEOUT_SECONDS,
        )
