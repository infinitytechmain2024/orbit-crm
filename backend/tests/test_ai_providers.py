from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from backend.services.ai_providers import OpenAICompatibleProvider


class OpenAICompatibleProviderTests(unittest.IsolatedAsyncioTestCase):
    async def test_complete_returns_the_requested_model(self):
        completion = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="ok"))],
            usage=SimpleNamespace(prompt_tokens=2, completion_tokens=1),
        )
        client = SimpleNamespace(
            chat=SimpleNamespace(
                completions=SimpleNamespace(create=lambda **_kwargs: completion),
            ),
        )
        provider = OpenAICompatibleProvider(
            "nvidia",
            "https://integrate.api.nvidia.com/v1",
            "test-key",
        )

        with patch("backend.services.ai_providers.OpenAI", return_value=client):
            result = await provider.complete(
                "meta/llama-3.3-70b-instruct",
                [{"role": "user", "content": "test"}],
            )

        self.assertEqual(result.model, "meta/llama-3.3-70b-instruct")
        self.assertEqual(result.content, "ok")
        self.assertEqual(result.prompt_tokens, 2)
        self.assertEqual(result.completion_tokens, 1)


if __name__ == "__main__":
    unittest.main()
