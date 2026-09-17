from __future__ import annotations

import os
import unittest
from unittest.mock import Mock, patch

import httpx

from backend.combined_supervisor import (
    GROQ_DEFAULT_OPENCLAW_MODEL,
    NVIDIA_DEFAULT_OPENCLAW_MODEL,
    default_openclaw_model,
)
from selfdev.provider import openclaw_agent

FALLBACK_ENV_KEYS = ("NVIDIA_API_KEY", "NVIDIA_BASE_URL", "SELFDEV_NVIDIA_MODEL", "GROQ_API_KEY", "SELFDEV_GROQ_MODEL")


def openclaw_unavailable() -> Mock:
    response = Mock()
    response.raise_for_status.side_effect = httpx.HTTPStatusError(
        "404 Not Found",
        request=httpx.Request("POST", "http://127.0.0.1:18789/v1/chat/completions"),
        response=httpx.Response(404),
    )
    return response


def model_answer(content: str) -> Mock:
    response = Mock()
    response.raise_for_status.return_value = None
    response.json.return_value = {"choices": [{"message": {"content": content}}]}
    return response


class SelfDevAgentTests(unittest.TestCase):
    def setUp(self) -> None:
        # Start every test from an environment without fallback credentials.
        patcher = patch.dict(os.environ, {}, clear=False)
        patcher.start()
        self.addCleanup(patcher.stop)
        for key in FALLBACK_ENV_KEYS:
            os.environ.pop(key, None)

    def test_falls_back_to_nvidia_when_openclaw_http_route_is_unavailable(self) -> None:
        os.environ["NVIDIA_API_KEY"] = "test-nvidia-key"
        os.environ["GROQ_API_KEY"] = "test-groq-key"
        with patch(
            "selfdev.provider.openclaw_agent.httpx.post",
            side_effect=[openclaw_unavailable(), model_answer("analysis ready")],
        ) as post:
            result = openclaw_agent.run_analysis("Analyze self-development.")

        self.assertIn("[fallback:nvidia]", result)
        self.assertIn("analysis ready", result)
        self.assertIn("HTTPStatusError", result)
        self.assertEqual(post.call_count, 2)
        fallback_call = post.call_args_list[1]
        self.assertIn("integrate.api.nvidia.com", str(fallback_call.args[0]))
        self.assertEqual(fallback_call.kwargs["json"]["model"], openclaw_agent.NVIDIA_FALLBACK_MODEL)
        self.assertEqual(fallback_call.kwargs["headers"]["authorization"], "Bearer test-nvidia-key")

    def test_falls_back_to_groq_without_nvidia_key(self) -> None:
        os.environ["GROQ_API_KEY"] = "test-groq-key"
        with patch(
            "selfdev.provider.openclaw_agent.httpx.post",
            side_effect=[openclaw_unavailable(), model_answer("analysis ready")],
        ) as post:
            result = openclaw_agent.run_analysis("Analyze self-development.")

        self.assertIn("[fallback:groq]", result)
        self.assertIn("api.groq.com", str(post.call_args_list[1].args[0]))

    def test_fails_clearly_without_any_fallback_key(self) -> None:
        with (
            patch("selfdev.provider.openclaw_agent.httpx.post", side_effect=[openclaw_unavailable()]),
            self.assertRaisesRegex(RuntimeError, "NVIDIA_API_KEY nor GROQ_API_KEY"),
        ):
            openclaw_agent.run_analysis("Analyze self-development.")


class DefaultOpenClawModelTests(unittest.TestCase):
    def test_explicit_setting_wins(self) -> None:
        env = {"OPENCLAW_DEFAULT_MODEL": "nvidia/custom/model", "NVIDIA_API_KEY": "k", "GROQ_API_KEY": "k"}
        self.assertEqual(default_openclaw_model(env), "nvidia/custom/model")

    def test_prefers_nvidia_over_groq(self) -> None:
        self.assertEqual(
            default_openclaw_model({"NVIDIA_API_KEY": "k", "GROQ_API_KEY": "k"}),
            NVIDIA_DEFAULT_OPENCLAW_MODEL,
        )

    def test_uses_groq_when_only_groq_is_configured(self) -> None:
        self.assertEqual(default_openclaw_model({"GROQ_API_KEY": "k"}), GROQ_DEFAULT_OPENCLAW_MODEL)

    def test_leaves_model_unset_without_keys(self) -> None:
        self.assertEqual(default_openclaw_model({"NVIDIA_API_KEY": "  "}), "")


if __name__ == "__main__":
    unittest.main()
