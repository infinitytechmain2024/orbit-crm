from __future__ import annotations

import base64
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, PropertyMock, patch
from uuid import UUID

from fastapi.testclient import TestClient

from backend.config import settings
from backend.main import app
from backend.services.supabase_client import supabase_service


class OpenClawSecurityTests(unittest.TestCase):
    def setUp(self) -> None:
        # CI has no .env: configure the tokens so rejections are 401, not 503.
        for name, value in (
            ("INTERNAL_API_TOKEN", "test-internal-token"),
            ("OPENCLAW_WEBHOOK_TOKEN", "test-webhook-token"),
        ):
            patcher = patch.object(settings, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.client = TestClient(app)

    def test_health_rejects_missing_server_auth(self) -> None:
        response = self.client.get("/api/openclaw/health")
        self.assertEqual(response.status_code, 401)
        UUID(response.headers["x-correlation-id"])

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

    def test_learning_patterns_reject_missing_authentication(self) -> None:
        response = self.client.get(
            "/api/learning/patterns",
            params={"organization_id": "00000000-0000-0000-0000-000000000000"},
        )
        self.assertEqual(response.status_code, 401)

    def test_proposal_decision_rejects_missing_authentication(self) -> None:
        response = self.client.post(
            "/api/learning/proposals/00000000-0000-0000-0000-000000000001/reject",
            json={"reason": "Not enough evidence"},
        )
        self.assertEqual(response.status_code, 401)

    def test_websocket_authenticates_session_and_membership(self) -> None:
        organization_id = "00000000-0000-0000-0000-000000000000"
        encoded = base64.urlsafe_b64encode(b"test-session-token").decode().rstrip("=")
        with (
            patch(
                "backend.routers.websocket.ai_workflow_store.verify_user",
                AsyncMock(return_value={"id": "00000000-0000-0000-0000-000000000001"}),
            ),
            patch(
                "backend.routers.websocket.ai_workflow_store.ensure_membership",
                AsyncMock(return_value=None),
            ),
        ):
            with self.client.websocket_connect(
                f"/ws/activity?organization_id={organization_id}",
                subprotocols=["orbit-auth", f"orbit-token.{encoded}"],
            ) as websocket:
                message = websocket.receive_json()
                self.assertEqual(message["type"], "connected")

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
        database = MagicMock(rpc=rpc)
        # Patch the property itself: reading supabase_service.client would build a real client.
        with patch.object(type(supabase_service), "client", new_callable=PropertyMock, return_value=database):
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
