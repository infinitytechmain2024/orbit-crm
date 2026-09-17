from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.auth import WorkflowActor, require_workflow_actor
from backend.config import settings
from backend.main import app

ORG_ID = "00000000-0000-0000-0000-0000000000a1"
ACTOR = WorkflowActor(user_id="00000000-0000-0000-0000-0000000000b1", email="owner@example.com")
OTHER_USER_ID = "00000000-0000-0000-0000-0000000000c1"
AUDIO = {"audio": ("audio.webm", b"fake-audio", "audio/webm")}

# (method, path, request kwargs) for every endpoint that used to accept anonymous calls.
PROTECTED_ENDPOINTS = [
    ("post", "/api/voice/stt", {"files": AUDIO}),
    ("post", "/api/voice/process", {"files": AUDIO}),
    ("post", "/api/voice/execute", {"json": {"intent": {"type": "CREATE_TASK"}}}),
    ("get", "/api/clients", {"params": {"organization_id": ORG_ID}}),
    ("post", "/api/clients", {"json": {"organization_id": ORG_ID, "name": "Acme"}}),
    ("post", "/api/leads/search", {"json": {"organization_id": ORG_ID, "city": "Kyiv", "niche": "dentist"}}),
    ("post", "/api/lead-search", {"json": {"niche": "dentist", "city": "Kyiv", "country": "Ukraine"}}),
    ("get", "/api/leads/search/00000000-0000-0000-0000-0000000000d1", {}),
    ("post", "/api/assistant/chat", {"json": {"messages": [{"role": "user", "content": "hi"}]}}),
    ("post", "/api/ai-router/route", {"json": {"title": "Write tests"}}),
    ("get", "/api/ai-router/models", {}),
    ("post", "/api/ai-router/models/some-model/unavailable", {"params": {"organization_id": ORG_ID}}),
    ("post", "/api/ai-router/models/some-model/available", {"params": {"organization_id": ORG_ID}}),
    ("get", "/api/ai-router/classify", {"params": {"title": "Write tests"}}),
    ("get", "/api/ai-router/nvidia/models", {}),
    ("get", "/api/ai-router/nvidia/models/some-model", {}),
    ("get", "/api/ai-router/nvidia/models/some-model/source-parameters", {}),
    ("get", "/api/ai-workflow/system-status", {}),
]


def isolate_side_effects(test: unittest.TestCase) -> dict[str, MagicMock]:
    """Replace every external effect these endpoints can trigger.

    If authentication ever regresses, the tests must fail without writing to
    the real database, calling paid models, or starting a browser search.
    """
    targets = {
        "database": ("backend.services.supabase_client.supabase_service", MagicMock()),
        "execute_intent": ("backend.main.execute_intent", AsyncMock()),
        "lead_search": ("backend.main.lead_search_pipeline.search", AsyncMock(return_value=[])),
        "background_search": ("backend.main._execute_lead_search", AsyncMock()),
        "transcribe": ("backend.main.stt_service.transcribe", AsyncMock(return_value="")),
        "providers": ("backend.routers.assistant.ai_provider_registry", MagicMock()),
    }
    mocks = {}
    for name, (target, mock) in targets.items():
        patcher = patch(target, mock)
        mocks[name] = patcher.start()
        test.addCleanup(patcher.stop)
    return mocks


class AnonymousAccessTests(unittest.TestCase):
    def setUp(self) -> None:
        self.mocks = isolate_side_effects(self)
        self.client = TestClient(app)

    def test_endpoints_reject_missing_server_auth(self) -> None:
        for method, path, kwargs in PROTECTED_ENDPOINTS:
            with self.subTest(method=method, path=path):
                response = getattr(self.client, method)(path, **kwargs)
                self.assertEqual(response.status_code, 401, response.text)
        self.mocks["database"].client.table.assert_not_called()
        self.mocks["execute_intent"].assert_not_awaited()
        self.mocks["lead_search"].assert_not_awaited()
        self.mocks["transcribe"].assert_not_awaited()

    def test_endpoints_reject_missing_user_session(self) -> None:
        with patch.object(settings, "INTERNAL_API_TOKEN", "test-internal-token"):
            headers = {"Authorization": "Bearer test-internal-token"}
            for method, path, kwargs in PROTECTED_ENDPOINTS:
                with self.subTest(method=method, path=path):
                    response = getattr(self.client, method)(path, headers=headers, **kwargs)
                    self.assertEqual(response.status_code, 401, response.text)
                    self.assertEqual(response.json()["detail"], "Missing authenticated user session")
        self.mocks["database"].client.table.assert_not_called()

    def test_public_health_stays_open(self) -> None:
        self.assertEqual(self.client.get("/api/health").status_code, 200)


class AuthenticatedActorTests(unittest.TestCase):
    def setUp(self) -> None:
        app.dependency_overrides[require_workflow_actor] = lambda: ACTOR
        self.client = TestClient(app)

    def tearDown(self) -> None:
        app.dependency_overrides.pop(require_workflow_actor, None)

    def test_voice_execute_rejects_foreign_user_id(self) -> None:
        with patch("backend.main.execute_intent", new_callable=AsyncMock) as execute_intent:
            response = self.client.post(
                "/api/voice/execute",
                json={"user_id": OTHER_USER_ID, "intent": {"type": "CREATE_TASK"}},
            )
        self.assertEqual(response.status_code, 403)
        execute_intent.assert_not_awaited()

    def test_voice_execute_acts_as_authenticated_user(self) -> None:
        result = SimpleNamespace(success=True, action="create_task", result={}, error=None)
        with patch("backend.main.execute_intent", new_callable=AsyncMock, return_value=result) as execute_intent:
            response = self.client.post("/api/voice/execute", json={"intent": {"type": "CREATE_TASK"}})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(execute_intent.await_args.args[0], ACTOR.user_id)

    def test_clients_require_organization_membership(self) -> None:
        database = MagicMock()
        denied = AsyncMock(side_effect=HTTPException(status_code=403, detail="Permission required: workflow.read"))
        with (
            patch("backend.main.require_workflow_permission", denied),
            patch("backend.services.supabase_client.supabase_service", SimpleNamespace(client=database)),
        ):
            response = self.client.get("/api/clients", params={"organization_id": ORG_ID})
        self.assertEqual(response.status_code, 403)
        database.table.assert_not_called()

    def test_clients_are_scoped_to_organization(self) -> None:
        database = MagicMock()
        query = database.table.return_value.select.return_value.eq.return_value
        query.order.return_value.limit.return_value.execute.return_value = SimpleNamespace(data=[])
        with (
            patch("backend.main.require_workflow_permission", new_callable=AsyncMock) as permission,
            patch("backend.services.supabase_client.supabase_service", SimpleNamespace(client=database)),
        ):
            response = self.client.get("/api/clients", params={"organization_id": ORG_ID})
        self.assertEqual(response.status_code, 200, response.text)
        permission.assert_awaited_once_with(ORG_ID, ACTOR, "workflow.read")
        database.table.return_value.select.return_value.eq.assert_called_once_with("organization_id", ORG_ID)

    def test_created_client_belongs_to_authenticated_user(self) -> None:
        database = MagicMock()
        insert = database.table.return_value.insert
        insert.return_value.execute.return_value = SimpleNamespace(data=[{"id": "client-1"}])
        with (
            patch("backend.main.require_workflow_permission", new_callable=AsyncMock) as permission,
            patch("backend.services.supabase_client.supabase_service", SimpleNamespace(client=database)),
        ):
            response = self.client.post("/api/clients", json={"organization_id": ORG_ID, "name": "Acme"})
        self.assertEqual(response.status_code, 200, response.text)
        permission.assert_awaited_once_with(ORG_ID, ACTOR, "workflow.create")
        row = insert.call_args.args[0]
        self.assertEqual(row["user_id"], ACTOR.user_id)
        self.assertEqual(row["organization_id"], ORG_ID)

    def test_lead_search_job_hidden_from_other_users(self) -> None:
        database = MagicMock()
        chain = database.table.return_value.select.return_value.eq.return_value.limit.return_value
        chain.execute.return_value = SimpleNamespace(data=[{"id": "job-1", "user_id": OTHER_USER_ID, "organization_id": None}])
        with patch("backend.services.supabase_client.supabase_service", SimpleNamespace(client=database)):
            response = self.client.get("/api/leads/search/job-1")
        self.assertEqual(response.status_code, 404)

    def test_model_availability_requires_organization_admin(self) -> None:
        denied = AsyncMock(side_effect=HTTPException(status_code=403, detail="Permission required: ai_router.manage"))
        with (
            patch("backend.routers.ai_router.require_workflow_permission", denied),
            patch("backend.routers.ai_router.ai_router.mark_model_unavailable") as mark_unavailable,
        ):
            response = self.client.post(
                "/api/ai-router/models/some-model/unavailable",
                params={"organization_id": ORG_ID},
            )
        self.assertEqual(response.status_code, 403)
        denied.assert_awaited_once_with(ORG_ID, ACTOR, "ai_router.manage")
        mark_unavailable.assert_not_called()


class TelegramWebhookTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)
        self.update = {"update_id": 1}

    def test_rejects_calls_when_secret_is_not_configured(self) -> None:
        with patch.object(settings, "TELEGRAM_WEBHOOK_SECRET", ""):
            response = self.client.post("/api/telegram/webhook", json=self.update)
        self.assertEqual(response.status_code, 503)

    def test_rejects_wrong_secret(self) -> None:
        with patch.object(settings, "TELEGRAM_WEBHOOK_SECRET", "expected-secret"):
            response = self.client.post(
                "/api/telegram/webhook",
                headers={"X-Telegram-Bot-Api-Secret-Token": "wrong"},
                json=self.update,
            )
        self.assertEqual(response.status_code, 401)

    def test_accepts_matching_secret(self) -> None:
        with patch.object(settings, "TELEGRAM_WEBHOOK_SECRET", "expected-secret"):
            response = self.client.post(
                "/api/telegram/webhook",
                headers={"X-Telegram-Bot-Api-Secret-Token": "expected-secret"},
                json=self.update,
            )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"status": "ignored"})


if __name__ == "__main__":
    unittest.main()
