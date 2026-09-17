from __future__ import annotations

import unittest

from backend.services import autopilot_metrics
from backend.services.coding_executor import CodingExecutionResult


def _result(**overrides) -> CodingExecutionResult:
    base = dict(
        success=True,
        pr_url="https://github.com/acme/repo/pull/1",
        workspace="worktree",
        steps=[{"tool": "read_file"}, {"tool": "edit_file"}],
        plan={"counts": {"total": 4, "done": 3, "blocked": 1, "pending": 0}},
        review_findings=[
            {"severity": "blocker", "summary": "a"},
            {"severity": "minor", "summary": "b"},
        ],
        verification={"status": "passed", "spec": "e2e/autopilot-smoke.spec.ts"},
        timings={"clone": 12.0, "execute": 100.0, "total": 150.0},
    )
    base.update(overrides)
    return CodingExecutionResult(**base)


class RunMetricsTests(unittest.TestCase):
    def test_a_finished_run_flattens_into_one_row(self):
        row = autopilot_metrics.run_metrics(_result())
        self.assertTrue(row["success"])
        self.assertTrue(row["delivered"])
        self.assertEqual(row["workspace"], "worktree")
        self.assertEqual(row["plan_steps"], 4)
        self.assertEqual(row["plan_done"], 3)
        self.assertEqual(row["plan_blocked"], 1)
        self.assertEqual(row["plan_completion"], 0.75)
        self.assertEqual(row["tool_steps"], 2)
        self.assertEqual(row["findings_total"], 2)
        self.assertEqual(row["findings_blocking"], 1)
        self.assertEqual(row["verification_status"], "passed")
        self.assertEqual(row["duration_seconds"], 150.0)
        self.assertNotIn("total", row["phase_seconds"])

    def test_a_run_without_a_plan_reports_no_completion_rather_than_zero(self):
        # Zero completion and "there was no plan" are different facts and must
        # not average together.
        row = autopilot_metrics.run_metrics(_result(plan={}))
        self.assertIsNone(row["plan_completion"])
        self.assertEqual(row["plan_steps"], 0)

    def test_a_failed_run_is_not_counted_as_delivered(self):
        row = autopilot_metrics.run_metrics(_result(success=False, pr_url=""))
        self.assertFalse(row["success"])
        self.assertFalse(row["delivered"])

    def test_an_empty_result_does_not_crash(self):
        row = autopilot_metrics.run_metrics(CodingExecutionResult(success=False))
        self.assertEqual(row["plan_steps"], 0)
        self.assertEqual(row["verification_status"], "skipped")


class AggregateTests(unittest.TestCase):
    def test_no_runs_gives_an_empty_summary(self):
        self.assertEqual(autopilot_metrics.aggregate([]), {"runs": 0})

    def test_rates_are_computed_over_the_whole_set(self):
        rows = [
            autopilot_metrics.run_metrics(_result()),
            autopilot_metrics.run_metrics(_result(success=False, pr_url="", workspace="clone")),
        ]
        summary = autopilot_metrics.aggregate(rows)
        self.assertEqual(summary["runs"], 2)
        self.assertEqual(summary["delivered"], 1)
        self.assertEqual(summary["delivery_rate"], 0.5)
        self.assertEqual(summary["persistent_workspace_rate"], 0.5)
        self.assertEqual(summary["findings_blocking"], 2)

    def test_skipped_verifications_do_not_count_as_passes(self):
        # An unconfigured environment must not make the pass rate look green.
        rows = [
            autopilot_metrics.run_metrics(_result(verification={"status": "skipped"})),
            autopilot_metrics.run_metrics(_result(verification={"status": "skipped"})),
        ]
        summary = autopilot_metrics.aggregate(rows)
        self.assertIsNone(summary["verification_pass_rate"])
        self.assertEqual(summary["verification"]["skipped"], 2)

    def test_pass_rate_uses_only_runs_that_actually_ran(self):
        rows = [
            autopilot_metrics.run_metrics(_result(verification={"status": "passed"})),
            autopilot_metrics.run_metrics(_result(verification={"status": "failed"})),
            autopilot_metrics.run_metrics(_result(verification={"status": "skipped"})),
        ]
        self.assertEqual(autopilot_metrics.aggregate(rows)["verification_pass_rate"], 0.5)

    def test_runs_without_a_plan_are_excluded_from_the_completion_average(self):
        rows = [
            autopilot_metrics.run_metrics(_result()),
            autopilot_metrics.run_metrics(_result(plan={})),
        ]
        self.assertEqual(autopilot_metrics.aggregate(rows)["avg_plan_completion"], 0.75)


if __name__ == "__main__":
    unittest.main()
