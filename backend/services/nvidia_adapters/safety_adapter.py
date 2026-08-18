"""Safety adapter — handles llama-guard-4-12b and nemotron-3.5-content-safety."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from backend.services.nvidia_adapters.base import AdapterResult, NVIDIAAdapter
from backend.services.nvidia_model_registry import ModelDefinition

logger = logging.getLogger(__name__)


class SafetyAdapter(NVIDIAAdapter):
    """Adapter for safety/classification models.

    These models use the chat endpoint but with special parameters:
    - Very low max_tokens (5-512)
    - conversation field for nemotron-3.5-content-safety
    - chat_template_kwargs for content-safety categories
    """

    async def invoke(
        self,
        model_def: ModelDefinition,
        messages: list[dict[str, Any]],
        *,
        stream: Optional[bool]= None,
        conversation: list[dict[str, Any]] | None = None,
        **overrides: Any,
    ) -> AdapterResult:
        params = dict(model_def.source_parameters)
        params["messages"] = messages
        params["stream"] = False
        params.update(overrides)

        def _call() -> AdapterResult:
            client = self._build_client()
            try:
                sdk_params: dict[str, Any] = {
                    "model": params.get("model"),
                    "messages": messages,
                    "temperature": params.get("temperature", 0.2),
                    "top_p": params.get("top_p", 0.7),
                    "max_tokens": params.get("max_tokens", 512),
                    "stream": False,
                }

                extra_body: dict[str, Any] = {}

                if "chat_template_kwargs" in params:
                    extra_body["chat_template_kwargs"] = params["chat_template_kwargs"]

                if conversation is not None:
                    extra_body["conversation"] = conversation

                if extra_body:
                    sdk_params["extra_body"] = extra_body

                completion = client.chat.completions.create(**sdk_params)
                message = completion.choices[0].message
                content = getattr(message, "content", "") or ""
                reasoning = getattr(message, "reasoning_content", None)

                return AdapterResult(
                    success=True,
                    content=str(content),
                    reasoning=reasoning,
                    model=params.get("model", ""),
                    raw_response=completion,
                )
            except Exception as e:
                logger.error(f"SafetyAdapter error: {e}")
                return AdapterResult(
                    success=False,
                    error=str(e),
                    model=params.get("model", ""),
                )

        return await asyncio.to_thread(_call)
