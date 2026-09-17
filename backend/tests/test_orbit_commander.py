from __future__ import annotations

import unittest
from collections import defaultdict
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

from backend.services.ai_providers import redact_error
from backend.services.orbit_commander import (
    OrbitCommander,
    critical_approval,
    fallback_plan,
    infer_risk,
    _project_match_score,
)
from backend.services.openclaw_client import OpenClawHealth
from backend.services.coding_executor import CodingExecutorUnavailable


class FakeStore:
    def __init__(self, artifacts=None):
        self.artifacts = artifacts or []
        self.events = []

    async def select(self, table, **kwargs):
        if table == "artifacts":
            return self.artifacts
        if table == "ai_model_configs":
            return []
        return []

    async def insert(self, table, payload, **kwargs):
        if table == "task_events":
            self.events.append(payload)
            return [{"id": f"event-{len(self.events)}", **payload}]
        return [{"id": "row-1", **payload}]


class MemoryStore:
    def __init__(self, rows):
        self.tables = defaultdict(list)
        for table, values in rows.items():
            self.tables[table] = [dict(value) for value in values]
        self.sequence = 0

    def _matches(self, row, filters):
        for key, expression in (filters or {}).items():
            if expression.startswith("eq."):
                expected = expression[3:]
                actual = row.get(key)
                if isinstance(actual, bool):
                    if actual is not (expected == "true"):
                        return False
                elif str(actual) != expected:
                    return False
            elif expression == "is.null" and row.get(key) is not None:
                return False
            elif expression.startswith("in.("):
                expected = set(expression[4:-1].split(","))
                if str(row.get(key)) not in expected:
                    return False
        return True

    async def select(
        self,
        table,
        *,
        organization_id=None,
        filters=None,
        columns="*",
        order=None,
        limit=None,
    ):
        rows = [
            dict(row)
            for row in self.tables[table]
            if (not organization_id or row.get("organization_id") == organization_id)
            and self._matches(row, filters)
        ]
        if order and order.endswith(".desc"):
            key = order.split(".")[0]
            rows.sort(key=lambda row: str(row.get(key) or ""), reverse=True)
        elif order:
            key = order.split(".")[0]
            rows.sort(key=lambda row: str(row.get(key) or ""))
        return rows[:limit] if limit is not None else rows

    async def one(self, table, *, organization_id, row_id, columns="*"):
        for row in self.tables[table]:
            if row.get("organization_id") == organization_id and row.get("id") == row_id:
                return dict(row)
        raise AssertionError(f"Missing {table}:{row_id}")

    async def insert(self, table, payload, *, upsert=False, on_conflict=None):
        values = payload if isinstance(payload, list) else [payload]
        inserted = []
        for value in values:
            row = dict(value)
            self.sequence += 1
            row.setdefault("id", f"{table}-{self.sequence}")
            row.setdefault("created_at", datetime.now(timezone.utc).isoformat())
            row.setdefault("updated_at", row["created_at"])
            self.tables[table].append(row)
            inserted.append(dict(row))
        return inserted

    async def update(self, table, *, organization_id, filters, payload):
        updated = []
        for row in self.tables[table]:
            if row.get("organization_id") == organization_id and self._matches(row, filters):
                row.update(payload)
                row["updated_at"] = datetime.now(timezone.utc).isoformat()
                updated.append(dict(row))
        return updated


class OrbitCommanderPolicyTests(unittest.TestCase):
    def test_project_match_prefers_explicit_project_name(self):
        text = "Разложи задачи по проекту Orbit CRM и сразу начни выполнение"
        self.assertGreater(
            _project_match_score("Orbit CRM", text),
            _project_match_score("OSNOVA", text),
        )

    def test_finance_feature_decomposes_to_backend_frontend_and_qa(self):
        plan = fallback_plan(
            "Добавь в CRM раздел финансов с доходами, расходами и связью с проектами",
            "",
        )
        self.assertEqual(
            [step["role"] for step in plan["steps"]],
            ["Backend Engineer", "Frontend Engineer", "QA Agent"],
        )
        self.assertEqual(plan["steps"][-1]["depends_on"], ["backend", "frontend"])

    def test_only_business_critical_action_requires_approval(self):
        self.assertIsNone(critical_approval("Подготовь внутренний технический план"))
        request = critical_approval("Опубликуй изменения в production")
        self.assertIsNotNone(request)
        self.assertEqual(request["risk"], "high")
        self.assertEqual(infer_risk("Удалить данные клиента", "medium"), "critical")

    def test_provider_errors_are_redacted(self):
        safe = redact_error("Authorization: Bearer nvapi-secret-value api_key=gsk-secret")
        self.assertNotIn("nvapi-secret-value", safe)
        self.assertNotIn("gsk-secret", safe)


class OrbitCommanderQATests(unittest.IsolatedAsyncioTestCase):
    def base_task(self):
        return {
            "id": "task-1",
            "organization_id": "org-1",
            "project_id": "project-1",
            "agent_id": "agent-1",
            "created_by": "user-1",
            "title": "Проверяемый этап",
            "acceptance_criteria": ["Создан результат"],
        }

    async def test_qa_fails_without_result_or_artifact(self):
        commander = OrbitCommander(FakeStore())
        verdict = await commander._task_qa_verdict(self.base_task())
        self.assertFalse(verdict["passed"])
        self.assertTrue(verdict["issues"])

    async def test_qa_passes_with_result_and_artifact(self):
        store = FakeStore(artifacts=[{"id": "artifact-1"}])
        commander = OrbitCommander(store)
        task = {**self.base_task(), "result": {"summary": "Готово"}}
        verdict = await commander._task_qa_verdict(task)
        self.assertTrue(verdict["passed"])
        self.assertEqual(verdict["issues"], [])


class OrbitCommanderEndToEndTests(unittest.IsolatedAsyncioTestCase):
    @patch("backend.services.orbit_commander.coding_executor.run", new_callable=AsyncMock)
    @patch("backend.services.orbit_commander.openclaw_client.health", new_callable=AsyncMock)
    async def test_finance_scenario_reaches_completed_only_after_final_qa(self, health_mock, coding_executor_mock):
        health_mock.return_value = OpenClawHealth(status="offline", gateway=False)
        # Engineering roles now try coding_executor first — force it "unavailable"
        # here so this test stays offline and hits the local model-chain fallback,
        # exactly like before coding_executor existed.
        coding_executor_mock.side_effect = CodingExecutorUnavailable("not configured in tests")
        organization_id = "org-1"
        user_id = "user-1"
        root = {
            "id": "root-task",
            "organization_id": organization_id,
            "project_id": "project-1",
            "department_id": None,
            "agent_id": None,
            "parent_task_id": None,
            "workflow_run_id": "run-1",
            "title": "Добавь в CRM раздел финансов с доходами, расходами и связью с проектами",
            "description": "Сохранить текущий интерфейс и показать результат в графе.",
            "original_request": "Добавь в CRM раздел финансов с доходами, расходами и связью с проектами",
            "source": "text",
            "status": "planning",
            "priority": "high",
            "due_at": None,
            "input_data": {},
            "result": None,
            "execution_plan": {},
            "attempt_count": 0,
            "max_attempts": 3,
            "timeout_seconds": 900,
            "created_by": user_id,
            "created_at": "2026-08-13T00:00:00+00:00",
            "updated_at": "2026-08-13T00:00:00+00:00",
        }
        run = {
            "id": "run-1",
            "organization_id": organization_id,
            "root_task_id": root["id"],
            "status": "planning",
            "progress": 0,
            "current_phase": "analysis",
            "commander_state": {},
            "created_by": user_id,
        }
        roles = ["Orbit Commander", "Backend Engineer", "Frontend Engineer", "QA Agent", "Business Analyst"]
        agents = [
            {
                "id": f"agent-{index}",
                "organization_id": organization_id,
                "department_id": f"department-{index}",
                "name": role,
                "role": role,
                "description": role,
                "status": "idle",
                "capabilities": ["analysis", "reasoning", "coding"],
                "allowed_tools": [],
                "fallback_models": [],
                "system_instruction": "Создай проверяемый результат.",
                "is_active": True,
                "created_at": f"2026-08-13T00:00:0{index}+00:00",
            }
            for index, role in enumerate(roles)
        ]
        store = MemoryStore(
            {
                "ai_tasks": [root],
                "workflow_runs": [run],
                "ai_agents": agents,
                "projects": [
                    {
                        "id": "project-1",
                        "organization_id": organization_id,
                        "name": "Orbit CRM",
                    }
                ],
                "ai_model_configs": [],
            }
        )
        commander = OrbitCommander(store)

        await commander.plan_workflow(root, run)
        children = await store.select(
            "ai_tasks",
            organization_id=organization_id,
            filters={"parent_task_id": "eq.root-task"},
            order="created_at.asc",
        )
        self.assertEqual(
            [next(agent["role"] for agent in agents if agent["id"] == child["agent_id"]) for child in children],
            ["Backend Engineer", "Frontend Engineer", "QA Agent"],
        )

        backend_task, frontend_task, final_qa_task = children
        await commander.execute_specialist(backend_task, run)
        await commander.qa_review(backend_task, run)
        await commander.execute_specialist(frontend_task, run)
        await commander.qa_review(frontend_task, run)

        root_before_final_qa = await store.one(
            "ai_tasks", organization_id=organization_id, row_id=root["id"]
        )
        self.assertNotEqual(root_before_final_qa["status"], "done")

        await commander.qa_review(final_qa_task, run)
        completed_root = await store.one(
            "ai_tasks", organization_id=organization_id, row_id=root["id"]
        )
        completed_run = await store.one(
            "workflow_runs", organization_id=organization_id, row_id=run["id"]
        )
        self.assertEqual(completed_root["status"], "done")
        self.assertEqual(completed_root["qa_status"], "passed")
        self.assertEqual(completed_run["status"], "completed")
        self.assertEqual(completed_run["progress"], 100)
        self.assertGreaterEqual(len(store.tables["artifacts"]), 4)


class OrbitCommanderStepApprovalTests(unittest.IsolatedAsyncioTestCase):
    """A critical step should pause on its own without stalling independent siblings."""

    def build_store(self):
        organization_id = "org-1"
        run = {
            "id": "run-1",
            "organization_id": organization_id,
            "root_task_id": "root-task",
            "status": "running",
            "progress": 10,
            "current_phase": "execution",
            "commander_state": {},
            "created_by": "user-1",
        }
        root = {
            "id": "root-task",
            "organization_id": organization_id,
            "parent_task_id": None,
            "workflow_run_id": "run-1",
            "title": "Root",
            "description": "",
            "status": "in_progress",
            "created_by": "user-1",
        }
        critical_task = {
            "id": "task-critical",
            "organization_id": organization_id,
            "parent_task_id": "root-task",
            "workflow_run_id": "run-1",
            "agent_id": "agent-1",
            "title": "Опубликуй релиз в production",
            "description": "",
            "status": "queued",
            "approval_required": True,
            "risk_level": "high",
            "execution_plan": {"phase": "execution"},
            "attempt_count": 0,
            "created_by": "user-1",
        }
        normal_task = {
            "id": "task-normal",
            "organization_id": organization_id,
            "parent_task_id": "root-task",
            "workflow_run_id": "run-1",
            "agent_id": "agent-1",
            "title": "Обнови README",
            "description": "",
            "status": "queued",
            "approval_required": False,
            "risk_level": "low",
            "execution_plan": {"phase": "execution"},
            "attempt_count": 0,
            "created_by": "user-1",
        }
        agent = {
            "id": "agent-1",
            "organization_id": organization_id,
            "role": "Backend Engineer",
            "status": "idle",
            "is_active": True,
        }
        store = MemoryStore(
            {
                "ai_tasks": [root, critical_task, normal_task],
                "workflow_runs": [run],
                "ai_agents": [agent],
                "task_dependencies": [],
            }
        )
        return store, run

    async def test_critical_step_pauses_alone_while_sibling_keeps_running(self):
        store, run = self.build_store()
        commander = OrbitCommander(store)

        await commander.enqueue_ready(run)

        critical = await store.one("ai_tasks", organization_id="org-1", row_id="task-critical")
        self.assertEqual(critical["status"], "approval_required")

        job_task_ids = {job["task_id"] for job in store.tables["workflow_jobs"]}
        self.assertNotIn("task-critical", job_task_ids)
        self.assertIn("task-normal", job_task_ids)

        approvals = store.tables["approval_requests"]
        self.assertEqual(len(approvals), 1)
        self.assertEqual(approvals[0]["task_id"], "task-critical")

    async def test_approving_step_resumes_it_without_pausing_the_run(self):
        store, run = self.build_store()
        commander = OrbitCommander(store)
        await commander.enqueue_ready(run)
        approval_id = store.tables["approval_requests"][0]["id"]

        await commander.resolve_approval(
            approval_id, "org-1", actor_id="user-1", decision="approved", comment=None
        )

        critical = await store.one("ai_tasks", organization_id="org-1", row_id="task-critical")
        self.assertEqual(critical["status"], "queued")
        self.assertFalse(critical["approval_required"])

        run_after = await store.one("workflow_runs", organization_id="org-1", row_id="run-1")
        self.assertEqual(run_after["status"], "running")

        job_task_ids = {job["task_id"] for job in store.tables["workflow_jobs"]}
        self.assertIn("task-critical", job_task_ids)

    async def test_rejecting_step_cancels_only_that_step(self):
        store, run = self.build_store()
        commander = OrbitCommander(store)
        await commander.enqueue_ready(run)
        approval_id = store.tables["approval_requests"][0]["id"]

        await commander.resolve_approval(
            approval_id, "org-1", actor_id="user-1", decision="rejected", comment="нет"
        )

        critical = await store.one("ai_tasks", organization_id="org-1", row_id="task-critical")
        self.assertEqual(critical["status"], "cancelled")

        run_after = await store.one("workflow_runs", organization_id="org-1", row_id="run-1")
        self.assertNotEqual(run_after["status"], "cancelled")


if __name__ == "__main__":
    unittest.main()


class ExecuteJobTimeoutTests(unittest.IsolatedAsyncioTestCase):
    """The queue kills a job at `workflow_jobs.timeout_seconds`. With the old
    900s default, an execute job routed to the coding executor was killed
    mid-verification every time — the browser self test could never finish."""

    class _Store:
        def __init__(self, agent_role: str | None):
            self.agent_role = agent_role
            self.inserted: list[dict] = []

        async def one(self, table, **kwargs):
            if table == "ai_agents":
                if self.agent_role is None:
                    raise RuntimeError("agent lookup failed")
                return {"id": "agent-1", "role": self.agent_role}
            raise AssertionError(table)

        async def insert(self, table, payload, **kwargs):
            self.inserted.append(payload)
            return [{"id": "job-1", **payload}]

    def _commander(self, agent_role: str | None):
        store = self._Store(agent_role)
        commander = OrbitCommander.__new__(OrbitCommander)
        commander.store = store
        return commander, store

    async def _enqueue(self, agent_role: str | None, job_type: str, timeout_seconds=None):
        commander, store = self._commander(agent_role)
        task = {
            "id": "task-1",
            "organization_id": "org-1",
            "agent_id": "agent-1",
            "attempt_count": 0,
            "timeout_seconds": timeout_seconds,
        }
        with patch.object(OrbitCommander, "create_event", new_callable=AsyncMock):
            await commander.enqueue_job({"id": "run-1"}, task, job_type)
        return store.inserted[0]["timeout_seconds"]

    async def test_coding_executor_execute_job_gets_the_full_run_budget(self):
        from backend.services import coding_executor

        timeout = await self._enqueue("Backend Engineer", "execute")
        self.assertGreaterEqual(timeout, coding_executor.total_run_budget_seconds())
        self.assertGreater(timeout, 900)

    async def test_other_phases_keep_the_short_timeout(self):
        self.assertEqual(await self._enqueue("Backend Engineer", "qa"), 900)

    async def test_non_coding_roles_keep_the_short_timeout(self):
        # A hung OpenClaw job must still be declared dead on the old schedule.
        self.assertEqual(await self._enqueue("Research Analyst", "execute"), 900)

    async def test_an_explicitly_longer_task_timeout_is_never_shortened(self):
        self.assertEqual(await self._enqueue("Research Analyst", "execute", timeout_seconds=5000), 5000)

    async def test_a_failed_agent_lookup_falls_back_instead_of_blocking_enqueue(self):
        self.assertEqual(await self._enqueue(None, "execute"), 900)
