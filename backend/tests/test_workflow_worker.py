from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from backend.config import settings
from backend.services.workflow_worker import WorkflowWorker

ORG = "org-1"


def make_job(**overrides):
    job = {
        "id": "job-1",
        "organization_id": ORG,
        "workflow_run_id": "run-1",
        "task_id": "task-1",
        "job_type": "execute",
        "status": "leased",
        "attempts": 1,
        "max_attempts": 3,
        "timeout_seconds": 900,
        "last_error": None,
    }
    job.update(overrides)
    return job


class FakeStore:
    def __init__(self, exhausted=None, rpc_error=None, update_rows=True):
        self.exhausted = exhausted or []
        self.rpc_error = rpc_error
        self.update_rows = update_rows
        self.rpc_calls = []
        self.updates = []
        self.rows = {
            "ai_tasks": {"task-1": {"id": "task-1", "organization_id": ORG}},
            "workflow_runs": {
                "run-1": {"id": "run-1", "organization_id": ORG, "root_task_id": "task-1"}
            },
        }

    async def rpc(self, name, payload):
        self.rpc_calls.append(name)
        if self.rpc_error:
            raise self.rpc_error
        if name == "fail_exhausted_workflow_jobs":
            return list(self.exhausted)
        return []

    async def one(self, table, *, organization_id, row_id, **kwargs):
        return self.rows[table][row_id]

    async def update(self, table, *, organization_id, filters, payload):
        self.updates.append((table, filters, payload))
        return [payload] if self.update_rows else []

    def updates_for(self, table):
        return [(filters, payload) for name, filters, payload in self.updates if name == table]


def make_worker(store):
    commander = AsyncMock()
    return WorkflowWorker(store=store, commander=commander), commander


class SweepTests(unittest.IsolatedAsyncioTestCase):
    async def test_sweep_records_blocked_event_for_exhausted_job(self):
        store = FakeStore(exhausted=[make_job(status="failed", attempts=3, max_attempts=3)])
        worker, commander = make_worker(store)

        await worker._maybe_sweep(0)

        self.assertEqual(store.rpc_calls, ["fail_exhausted_workflow_jobs"])
        # Task, run and root are blocked atomically by the SQL function.
        self.assertEqual(store.updates, [])
        commander._block_workflow.assert_not_awaited()
        commander.create_event.assert_awaited_once()
        self.assertEqual(commander.create_event.await_args.args[1], "blocked")

    async def test_sweep_continues_after_event_failure_on_one_job(self):
        store = FakeStore(
            exhausted=[
                make_job(id="job-missing", task_id="task-missing", status="failed", attempts=3),
                make_job(status="failed", attempts=3, max_attempts=3),
            ]
        )
        worker, commander = make_worker(store)

        await worker._maybe_sweep(0)

        commander.create_event.assert_awaited_once()
        self.assertEqual(commander.create_event.await_args.args[0]["id"], "task-1")

    async def test_sweep_runs_only_on_worker_zero_and_is_throttled(self):
        store = FakeStore()
        worker, _ = make_worker(store)
        now = [1000.0]
        worker._clock = lambda: now[0]

        with patch.object(settings, "AI_WORKFLOW_SWEEP_INTERVAL_SECONDS", 60.0):
            await worker._maybe_sweep(1)
            self.assertEqual(store.rpc_calls, [])

            await worker._maybe_sweep(0)
            await worker._maybe_sweep(0)
            self.assertEqual(len(store.rpc_calls), 1)

            now[0] += 61
            await worker._maybe_sweep(0)
            self.assertEqual(len(store.rpc_calls), 2)

    async def test_sweep_errors_are_swallowed(self):
        store = FakeStore(rpc_error=RuntimeError("db down"))
        worker, commander = make_worker(store)

        await worker._maybe_sweep(0)

        commander._block_workflow.assert_not_awaited()
        self.assertNotEqual(worker._last_sweep, float("-inf"))


class ProcessTests(unittest.IsolatedAsyncioTestCase):
    async def test_recovered_job_emits_event_before_processing(self):
        store = FakeStore()
        worker, commander = make_worker(store)
        job = make_job(
            attempts=2,
            last_error={"type": "LeaseExpired", "previous_worker": "dead-worker", "attempt": 2},
        )

        await worker._process(job)

        names = [call[0] for call in commander.mock_calls]
        self.assertIn("create_event", names)
        self.assertLess(names.index("create_event"), names.index("process_job"))
        self.assertEqual(commander.create_event.await_args.args[1], "recovered")
        self.assertEqual(store.updates_for("workflow_jobs")[0][1]["status"], "succeeded")

    async def test_regular_job_emits_no_recovery_event(self):
        store = FakeStore()
        worker, commander = make_worker(store)

        await worker._process(make_job())

        commander.create_event.assert_not_awaited()
        commander.process_job.assert_awaited_once()

    async def test_failure_with_attempts_left_requeues(self):
        store = FakeStore()
        worker, commander = make_worker(store)
        commander.process_job.side_effect = RuntimeError("boom")

        await worker._process(make_job(attempts=1, max_attempts=3))

        job_updates = store.updates_for("workflow_jobs")
        self.assertEqual(len(job_updates), 1)
        self.assertEqual(job_updates[0][1]["status"], "queued")
        commander._block_workflow.assert_not_awaited()

    async def test_failure_on_last_attempt_blocks(self):
        store = FakeStore()
        worker, commander = make_worker(store)
        commander.process_job.side_effect = RuntimeError("boom")

        await worker._process(make_job(attempts=3, max_attempts=3))

        job_updates = store.updates_for("workflow_jobs")
        self.assertEqual(job_updates[0][1]["status"], "failed")
        self.assertEqual(store.updates_for("ai_tasks")[0][1]["status"], "blocked")
        commander._block_workflow.assert_awaited_once()

    async def test_stale_lease_error_from_older_attempt_is_not_reported(self):
        store = FakeStore()
        worker, commander = make_worker(store)
        job = make_job(attempts=3, last_error={"type": "LeaseExpired", "attempt": 2})

        await worker._process(job)

        commander.create_event.assert_not_awaited()
        commander.process_job.assert_awaited_once()

    async def test_job_writes_are_fenced_by_attempt(self):
        store = FakeStore()
        worker, commander = make_worker(store)

        await worker._process(make_job(attempts=2))

        filters = store.updates_for("workflow_jobs")[0][0]
        self.assertEqual(
            filters, {"id": "eq.job-1", "status": "eq.leased", "attempts": "eq.2"}
        )

    async def test_lost_lease_on_success_is_ignored(self):
        store = FakeStore(update_rows=False)
        worker, commander = make_worker(store)

        await worker._process(make_job())

        commander.process_job.assert_awaited_once()
        self.assertEqual(len(store.updates_for("workflow_jobs")), 1)

    async def test_lost_lease_on_retry_does_not_raise(self):
        store = FakeStore(update_rows=False)
        worker, commander = make_worker(store)
        commander.process_job.side_effect = RuntimeError("boom")

        await worker._process(make_job(attempts=1, max_attempts=3))

        job_updates = store.updates_for("workflow_jobs")
        self.assertEqual(len(job_updates), 1)
        self.assertEqual(job_updates[0][0]["attempts"], "eq.1")

    async def test_lost_lease_on_last_attempt_does_not_block(self):
        store = FakeStore(update_rows=False)
        worker, commander = make_worker(store)
        commander.process_job.side_effect = RuntimeError("boom")

        await worker._process(make_job(attempts=3, max_attempts=3))

        self.assertEqual(store.updates_for("ai_tasks"), [])
        commander._block_workflow.assert_not_awaited()
        commander.create_event.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
