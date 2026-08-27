from __future__ import annotations

import os
import unittest
from unittest.mock import Mock, patch

import httpx

from selfdev.provider import openclaw_agent


class SelfDevAgentTests(unittest.TestCase):
    def test_falls_back_to_groq_when_openclaw_http_route_is_unavailable(self) -> None:
        openclaw_response = Mock()
        openclaw_response.raise_for_status.side_effect = httpx.HTTPStatusError(
            "404 Not Found",
            request=httpx.Request("POST", "http://127.0.0.1:18789/v1/chat/completions"),
            response=httpx.Response(404),
        )
        groq_response = Mock()
        groq_response.raise_for_status.return_value = None
        groq_response.json.return_value = {
            "choices": [{"message": {"content": "analysis ready"}}],
        }

        with (
            patch.dict(os.environ, {"GROQ_API_KEY": "test-key"}, clear=False),
            patch(
                "selfdev.provider.openclaw_agent.httpx.post",
                side_effect=[openclaw_response, groq_response],
            ) as post,
        ):
            result = openclaw_agent.run_analysis("Analyze self-development.")

        self.assertIn("[fallback:groq]", result)
        self.assertIn("analysis ready", result)
        self.assertIn("HTTPStatusError", result)
        self.assertEqual(post.call_count, 2)
        self.assertIn("api.groq.com", str(post.call_args_list[1].args[0]))


if __name__ == "__main__":
    unittest.main()
