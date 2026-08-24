from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from backend.config import settings
from backend.main import app
from backend.services.supabase_client import supabase_service


class OpenClawSecurityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def test_health_rejects_missing_server_auth(self) -> None:
        response = self.client.get("/api/openclaw/health")
        self.assertEqual(response.status_code, 401)

    def test_health_rejects_missing_user_session(self) -> None:
        response = self.client.get(
            "/api/openclaw/health",
            headers={"Authorization": f"Bearer {settings.INTERNAL_API_TOKEN}"},
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"], "Missing authenticated user session")

    def test_task_webhook_rejects_invalid_token(self) -> None:
        response = self.client.post(
            "/api/openclaw/webhook",
            headers={"Authorization": "Bearer invalid"},
            json={"task_id": "00000000-0000-0000-0000-000000000000"},
        )
        self.assertEqual(response.status_code, 401)

    def test_goal_webhook_rejects_invalid_token(self) -> None:
        response = self.client.post(
            "/api/openclaw/goals/webhook",
            headers={"Authorization": "Bearer invalid"},
            json={"goal_id": "00000000-0000-0000-0000-000000000000"},
        )
        self.assertEqual(response.status_code, 401)

    def test_learning_api_rejects_missing_authentication(self) -> None:
        response = self.client.get(
            "/api/learning/knowledge",
            params={"organization_id": "00000000-0000-0000-0000-000000000000"},
        )
        self.assertEqual(response.status_code, 401)

    def test_webhook_uses_stable_idempotency_key_for_retries(self) -> None:
        execute = MagicMock(return_value=SimpleNamespace(data=[{
            "applied": True,
            "duplicate": False,
            "correlation_id": "10000000-0000-4000-8000-000000000001",
            "current_status": "completed",
        }]))
        rpc = MagicMock(return_value=SimpleNamespace(execute=execute))
        payload = {
            "task_id": "20000000-0000-4000-8000-000000000002",
            "status": "completed",
            "result": {"summary": "done"},
        }
        with (
            patch.object(settings, "OPENCLAW_WEBHOOK_TOKEN", "test-webhook-token"),
            patch.object(supabase_service.client, "rpc", rpc),
        ):
            first = self.client.post(
                "/api/openclaw/webhook",
                headers={"Authorization": "Bearer test-webhook-token"},
                json=payload,
            )
            second = self.client.post(
                "/api/openclaw/webhook",
                headers={"Authorization": "Bearer test-webhook-token"},
                json=payload,
            )
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        first_params = rpc.call_args_list[0].args[1]
        second_params = rpc.call_args_list[1].args[1]
        self.assertEqual(first_params["p_idempotency_key"], second_params["p_idempotency_key"])
        self.assertEqual(len(first_params["p_payload_digest"]), 64)


if __name__ == "__main__":
    unittest.main()
