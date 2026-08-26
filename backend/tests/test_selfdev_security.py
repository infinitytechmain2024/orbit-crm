from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi.testclient import TestClient

from backend.config import settings
from backend.main import app


class SelfDevelopmentSecurityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)
        self.organization_id = str(uuid4())

    def test_provider_registration_is_disabled_without_server_token(self) -> None:
        with patch.object(settings, "SELFDEV_PROVIDER_TOKEN", ""):
            response = self.client.post(
                "/api/selfdev/providers/register",
                json={
                    "organization_id": self.organization_id,
                    "name": "local-test",
                    "platform": "darwin",
                    "architecture": "arm64",
                },
            )
        self.assertEqual(response.status_code, 503)

    def test_provider_registration_rejects_invalid_token(self) -> None:
        with patch.object(settings, "SELFDEV_PROVIDER_TOKEN", "expected-token"):
            response = self.client.post(
                "/api/selfdev/providers/register",
                headers={"Authorization": "Bearer wrong-token"},
                json={
                    "organization_id": self.organization_id,
                    "name": "local-test",
                    "platform": "darwin",
                    "architecture": "arm64",
                },
            )
        self.assertEqual(response.status_code, 401)

    def test_provider_registration_persists_only_token_hash(self) -> None:
        provider_id = str(uuid4())
        select = AsyncMock(
            side_effect=[
                [],
                [{"user_id": str(uuid4())}],
            ]
        )
        insert = AsyncMock(return_value=[{"id": provider_id, "status": "available"}])
        with (
            patch.object(settings, "SELFDEV_PROVIDER_TOKEN", "secret-provider-token"),
            patch("backend.routers.selfdev.ai_workflow_store.select", select),
            patch("backend.routers.selfdev.ai_workflow_store.insert", insert),
        ):
            response = self.client.post(
                "/api/selfdev/providers/register",
                headers={"Authorization": "Bearer secret-provider-token"},
                json={
                    "organization_id": self.organization_id,
                    "name": "local-test",
                    "platform": "darwin",
                    "architecture": "arm64",
                    "capabilities": ["git", "docker", "git"],
                },
            )

        self.assertEqual(response.status_code, 200)
        payload = insert.await_args.args[1]
        self.assertNotEqual(payload["token_hash"], "secret-provider-token")
        self.assertEqual(len(payload["token_hash"]), 64)
        self.assertEqual(payload["capabilities"], ["docker", "git"])

    def test_job_lease_returns_no_job_when_queue_is_empty(self) -> None:
        provider_id = str(uuid4())
        rpc = AsyncMock(return_value=[])
        with (
            patch.object(settings, "SELFDEV_PROVIDER_TOKEN", "secret-provider-token"),
            patch("backend.routers.selfdev.ai_workflow_store.rpc", rpc),
        ):
            response = self.client.post(
                "/api/selfdev/jobs/lease",
                headers={"Authorization": "Bearer secret-provider-token"},
                json={"provider_id": provider_id},
            )

        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["job"])
        rpc.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
