from __future__ import annotations

from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.config import settings
from backend.main import app
from backend.routers import whisper_router


class WhisperApiTests(TestCase):
    TOKEN = "unit-test-internal-token"

    @classmethod
    def setUpClass(cls) -> None:
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.client.close()

    def setUp(self) -> None:
        self.original_token = settings.INTERNAL_API_TOKEN
        settings.INTERNAL_API_TOKEN = self.TOKEN

    def tearDown(self) -> None:
        settings.INTERNAL_API_TOKEN = self.original_token

    @property
    def authorization(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.TOKEN}"}

    def test_health_does_not_load_whisper(self) -> None:
        with patch.object(
            whisper_router,
            "_load_model",
            side_effect=AssertionError("health must not load Whisper"),
        ):
            response = self.client.get("/api/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")

    def test_transcription_requires_internal_token(self) -> None:
        response = self.client.post(
            "/api/speech/transcribe",
            files={"audio": ("recording.webm", b"audio", "audio/webm")},
        )

        self.assertEqual(response.status_code, 401)

    def test_empty_audio_returns_400_without_loading_model(self) -> None:
        with patch.object(
            whisper_router,
            "_load_model",
            side_effect=AssertionError("empty audio must not load Whisper"),
        ):
            response = self.client.post(
                "/api/speech/transcribe",
                headers=self.authorization,
                files={"audio": ("recording.webm", b"", "audio/webm")},
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "Uploaded audio file is empty")

    def test_empty_transcript_returns_422_and_deletes_temporary_file(self) -> None:
        temporary_path: Path | None = None

        def empty_transcription(path: Path) -> tuple[str, str]:
            nonlocal temporary_path
            temporary_path = path
            return "", "ru"

        with (
            patch.object(whisper_router, "_load_model", return_value=object()),
            patch.object(whisper_router, "_transcribe_file", side_effect=empty_transcription),
        ):
            response = self.client.post(
                "/api/speech/transcribe",
                headers=self.authorization,
                files={"audio": ("recording.webm", b"audio", "audio/webm")},
            )

        self.assertEqual(response.status_code, 422)
        self.assertIsNotNone(temporary_path)
        self.assertFalse(temporary_path.exists())

    def test_success_response_contract_and_temporary_file_cleanup(self) -> None:
        temporary_path: Path | None = None

        def successful_transcription(path: Path) -> tuple[str, str]:
            nonlocal temporary_path
            temporary_path = path
            return "Тестовая расшифровка", "ru"

        with (
            patch.object(whisper_router, "_load_model", return_value=object()),
            patch.object(
                whisper_router,
                "_transcribe_file",
                side_effect=successful_transcription,
            ),
        ):
            response = self.client.post(
                "/api/speech/transcribe",
                headers=self.authorization,
                files={"audio": ("recording.webm", b"audio", "audio/webm")},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "text": "Тестовая расшифровка",
                "success": True,
                "language": "ru",
            },
        )
        self.assertIsNotNone(temporary_path)
        self.assertFalse(temporary_path.exists())
