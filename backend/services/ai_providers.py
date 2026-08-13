"""Provider-neutral AI model execution for Orbit Commander.

All supported providers expose an OpenAI-compatible chat endpoint. Provider
secrets are read only from server environment variables and are never copied
to database configuration, task events, or exception messages.
"""

from __future__ import annotations

import asyncio
import json
import re
from dataclasses import dataclass
from typing import Any

from openai import OpenAI

from backend.config import settings


def redact_error(value: Any) -> str:
    message = str(value)
    message = re.sub(r"(?i)(bearer|api[_ -]?key|token|secret)\s*[:=]?\s*\S+", r"\1 [redacted]", message)
    message = re.sub(r"\b(?:sk|gsk|nvapi)-[A-Za-z0-9_-]+", "[redacted]", message)
    return message[:500]


def _coerce_text(content: Any) -> str:
    """Normalize a chat completion message payload into plain text.

    Some OpenAI-compatible endpoints (e.g. meta/llama-3.3-70b-instruct) return
    the message content as a list of content parts or a JSON array rather than
    a single string. We normalize every shape so downstream parsing is stable.
    """
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                parts.append(str(item.get("text") or item.get("content") or ""))
        return "\n".join(part for part in parts if part)
    if isinstance(content, (dict, list)):
        try:
            return json.dumps(content, ensure_ascii=False)
        except (TypeError, ValueError):
            return str(content)
    return str(content)


@dataclass(frozen=True)
class ProviderResult:
    provider: str
    model: str
    content: str
    prompt_tokens: int = 0
    completion_tokens: int = 0


class ProviderUnavailable(RuntimeError):
    pass


class OpenAICompatibleProvider:
    def __init__(self, name: str, base_url: str, api_key: str | None) -> None:
        self.name = name
        self.base_url = base_url
        self.api_key = api_key

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    async def complete(
        self,
        model: str,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.2,
        max_tokens: int = 4096,
    ) -> ProviderResult:
        if not self.configured:
            raise ProviderUnavailable(f"Provider {self.name} is not configured")

        def request() -> ProviderResult:
            client = OpenAI(
                base_url=self.base_url,
                api_key=self.api_key or "missing-provider-key",
                timeout=75.0,
                max_retries=0,
            )
            completion = client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                stream=False,
            )
            message = completion.choices[0].message
            usage = getattr(completion, "usage", None)
            return ProviderResult(
                provider=self.name,
                model=model_name,
                content=_coerce_text(getattr(message, "content", "") or ""),
                prompt_tokens=int(getattr(usage, "prompt_tokens", 0) or 0),
                completion_tokens=int(getattr(usage, "completion_tokens", 0) or 0),
            )

        return await asyncio.to_thread(request)


class AIProviderRegistry:
    """Resolves a configured provider without coupling workflows to one vendor."""

    def __init__(self) -> None:
        self._providers = {
            "nvidia": OpenAICompatibleProvider(
                "nvidia", settings.NVIDIA_BASE_URL, settings.NVIDIA_API_KEY
            ),
            "openai": OpenAICompatibleProvider(
                "openai", settings.OPENAI_BASE_URL, settings.OPENAI_API_KEY
            ),
            "groq": OpenAICompatibleProvider(
                "groq", settings.GROQ_BASE_URL, settings.GROQ_API_KEY
            ),
            "ollama": OpenAICompatibleProvider(
                "ollama", settings.OLLAMA_BASE_URL, settings.OLLAMA_API_KEY
            ),
        }

    def get(self, name: str) -> OpenAICompatibleProvider:
        provider = self._providers.get(name.casefold())
        if not provider:
            raise ProviderUnavailable(f"Unknown AI provider: {name}")
        return provider

    def is_configured(self, name: str) -> bool:
        try:
            return self.get(name).configured
        except ProviderUnavailable:
            return False

    def configured_names(self) -> list[str]:
        return [name for name, provider in self._providers.items() if provider.configured]


ai_provider_registry = AIProviderRegistry()
