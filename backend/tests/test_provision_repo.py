from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from fastapi.testclient import TestClient

from backend.config import settings
from backend.main import app
from backend.routers.internal import _repo_name_for_project


class RepoNameSlugTests(unittest.TestCase):
    def test_repo_name_is_slugified_and_suffixed_with_short_id(self):
        name = _repo_name_for_project("Онбординг Nordwind!!!", "abcd1234-5678-90ef-aaaa-bbbbbbbbbbbb")
        self.assertTrue(name.endswith("-abcd1234"))
        self.assertRegex(name, r"^[a-z0-9-]+$")

    def test_repo_name_falls_back_to_project_when_name_has_no_latin_chars(self):
        name = _repo_name_for_project("клиент", "abcd1234-0000-0000-0000-000000000000")
        self.assertTrue(name.startswith("project-abcd1234"))


class ProvisionRepoEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)
        self.organization_id = str(uuid4())
        self.project_id = str(uuid4())
        self.insert_payload = {
            "type": "INSERT",
            "table": "projects",
            "record": {"id": self.project_id, "organization_id": self.organization_id, "name": "Test Project"},
        }

    def test_requires_internal_token(self) -> None:
        with patch.object(settings, "INTERNAL_API_TOKEN", "expected-token"):
            response = self.client.post("/api/internal/projects/provision-repo", json=self.insert_payload)
        self.assertEqual(response.status_code, 401)

    def test_skips_non_insert_events(self) -> None:
        payload = {**self.insert_payload, "type": "UPDATE"}
        with patch.object(settings, "INTERNAL_API_TOKEN", "expected-token"):
            response = self.client.post(
                "/api/internal/projects/provision-repo",
                headers={"Authorization": "Bearer expected-token"},
                json=payload,
            )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["skipped"])

    def test_skips_when_github_token_missing(self) -> None:
        with (
            patch.object(settings, "INTERNAL_API_TOKEN", "expected-token"),
            patch.object(settings, "GITHUB_TOKEN", ""),
        ):
            response = self.client.post(
                "/api/internal/projects/provision-repo",
                headers={"Authorization": "Bearer expected-token"},
                json=self.insert_payload,
            )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["skipped"])

    @patch("backend.routers.internal.ai_workflow_store.update", new_callable=AsyncMock)
    @patch("backend.routers.internal.httpx.AsyncClient")
    def test_successful_creation_updates_project_with_repo_link(self, client_cls_mock, update_mock) -> None:
        response_mock = MagicMock()
        response_mock.status_code = 201
        response_mock.json.return_value = {
            "owner": {"login": "orbit-autopilot-projects"},
            "name": "test-project-abcd1234",
            "html_url": "https://github.com/orbit-autopilot-projects/test-project-abcd1234",
        }
        client_instance = MagicMock()
        client_instance.post = AsyncMock(return_value=response_mock)
        client_cls_mock.return_value.__aenter__ = AsyncMock(return_value=client_instance)
        client_cls_mock.return_value.__aexit__ = AsyncMock(return_value=False)

        with (
            patch.object(settings, "INTERNAL_API_TOKEN", "expected-token"),
            patch.object(settings, "GITHUB_TOKEN", "fake-token"),
        ):
            response = self.client.post(
                "/api/internal/projects/provision-repo",
                headers={"Authorization": "Bearer expected-token"},
                json=self.insert_payload,
            )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["success"])
        self.assertEqual(body["repo_url"], "https://github.com/orbit-autopilot-projects/test-project-abcd1234")
        update_mock.assert_awaited_once()
        _, kwargs = update_mock.call_args
        self.assertEqual(kwargs["payload"]["github_repo_status"], "created")
        self.assertEqual(kwargs["payload"]["github_repo_url"], "https://github.com/orbit-autopilot-projects/test-project-abcd1234")

    @patch("backend.routers.internal.ai_workflow_store.update", new_callable=AsyncMock)
    @patch("backend.routers.internal.httpx.AsyncClient")
    def test_github_error_marks_project_failed(self, client_cls_mock, update_mock) -> None:
        response_mock = MagicMock()
        response_mock.status_code = 422
        response_mock.text = "name already exists on this account"
        client_instance = MagicMock()
        client_instance.post = AsyncMock(return_value=response_mock)
        client_cls_mock.return_value.__aenter__ = AsyncMock(return_value=client_instance)
        client_cls_mock.return_value.__aexit__ = AsyncMock(return_value=False)

        with (
            patch.object(settings, "INTERNAL_API_TOKEN", "expected-token"),
            patch.object(settings, "GITHUB_TOKEN", "fake-token"),
        ):
            response = self.client.post(
                "/api/internal/projects/provision-repo",
                headers={"Authorization": "Bearer expected-token"},
                json=self.insert_payload,
            )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["success"])
        update_mock.assert_awaited_once()
        _, kwargs = update_mock.call_args
        self.assertEqual(kwargs["payload"]["github_repo_status"], "failed")


class InternalTokenNonAsciiTests(unittest.TestCase):
    """A stray non-ASCII character in the *configured* token must produce a 401,
    never a 500. compare_digest() raises TypeError on non-ASCII str, which
    previously broke every internal endpoint — including /health — whenever the
    deployed token held a lookalike character from a copy-paste."""

    def setUp(self) -> None:
        self.client = TestClient(app)

    def test_non_ascii_configured_token_yields_401_not_500(self) -> None:
        with patch.object(settings, "INTERNAL_API_TOKEN", "tokenсwith-cyrillic"):
            response = self.client.get(
                "/api/internal/health", headers={"Authorization": "Bearer plain-ascii-token"}
            )
        self.assertEqual(response.status_code, 401)

    def test_matching_ascii_token_still_authorizes(self) -> None:
        with patch.object(settings, "INTERNAL_API_TOKEN", "plain-ascii-token"):
            response = self.client.get(
                "/api/internal/health", headers={"Authorization": "Bearer plain-ascii-token"}
            )
        self.assertEqual(response.status_code, 200)


if __name__ == "__main__":
    unittest.main()
