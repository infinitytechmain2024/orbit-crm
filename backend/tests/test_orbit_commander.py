from __future__ import annotations

import unittest
from collections import defaultdict
from datetime import UTC, datetime

from backend.services.ai_providers import redact_error
from backend.services.orbit_commander import (
    OrbitCommander,
    critical_approval,
    fallback_plan,
    infer_risk,
)


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
            row.setdefault("created_at", datetime.now(UTC).isoformat())
            row.setdefault("updated_at", row["created_at"])
            self.tables[table].append(row)
            inserted.append(dict(row))
        return inserted

    async def update(self, table, *, organization_id, filters, payload):
        updated = []
        for row in self.tables[table]:
            if row.get("organization_id") == organization_id and self._matches(row, filters):
                row.update(payload)
                row["updated_at"] = datetime.now(UTC).isoformat()
                updated.append(dict(row))
        return updated


class OrbitCommanderPolicyTests(unittest.TestCase):
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
    async def test_finance_scenario_reaches_completed_only_after_final_qa(self):
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


if __name__ == "__main__":
    unittest.main()
