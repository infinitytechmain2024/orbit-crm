from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, MagicMock, PropertyMock, patch

import httpx
from fastapi.testclient import TestClient

from backend.auth import WorkflowActor, require_workflow_actor
from backend.main import app
from backend.services.ai_workflow_store import AIWorkflowStore

ORG_ID = "00000000-0000-0000-0000-0000000000a1"
TASK_ID = "00000000-0000-0000-0000-0000000000e1"
ACTOR = WorkflowActor(user_id="00000000-0000-0000-0000-0000000000b1", email="owner@example.com")
TASK = {"id": TASK_ID, "organization_id": ORG_ID, "status": "queued", "workflow_run_id": None}


class RunTaskPreflightTests(unittest.TestCase):
    """POST /api/ai-workflow/tasks/{id}/run pings Supabase before queueing work."""

    def setUp(self) -> None:
        app.dependency_overrides[require_workflow_actor] = lambda: ACTOR
        self.addCleanup(app.dependency_overrides.pop, require_workflow_actor, None)
        self.http = MagicMock(spec=httpx.AsyncClient)
        self.http.get = AsyncMock(return_value=httpx.Response(200))
        health = MagicMock(status="online", error=None)
        started = {**TASK, "status": "in_progress", "workflow_run_id": "run-1"}
        patches = [
            patch("backend.routers.ai_workflow._authorize", new_callable=AsyncMock),
            patch("backend.routers.ai_workflow._get_task", new=AsyncMock(return_value=dict(TASK))),
            patch("backend.routers.ai_workflow._kickoff_next_job", new=MagicMock(return_value=None)),
            patch("backend.routers.ai_workflow.asyncio.create_task"),
            patch.object(AIWorkflowStore, "configured", new_callable=PropertyMock, return_value=True),
            patch.object(AIWorkflowStore, "client", new=AsyncMock(return_value=self.http)),
            patch.object(AIWorkflowStore, "_service_headers", return_value={}),
            patch("backend.services.openclaw_client.openclaw_client.health", new=AsyncMock(return_value=health)),
            patch(
                "backend.routers.ai_workflow.orbit_commander.create_workflow",
                new=AsyncMock(return_value=(started, {"id": "run-1"})),
            ),
        ]
        for patcher in patches:
            patcher.start()
            self.addCleanup(patcher.stop)
        self.client = TestClient(app)

    def run_task(self) -> httpx.Response:
        return self.client.post(
            f"/api/ai-workflow/tasks/{TASK_ID}/run",
            json={"organization_id": ORG_ID},
        )

    def test_reachable_database_lets_the_task_start(self) -> None:
        response = self.run_task()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["queued_for_execution"])
        self.http.get.assert_awaited_once()

    def test_unreachable_database_is_reported(self) -> None:
        self.http.get.side_effect = httpx.ConnectError("connection refused")
        response = self.run_task()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"], "Database connection unavailable. Please try again.")


if __name__ == "__main__":
    unittest.main()
