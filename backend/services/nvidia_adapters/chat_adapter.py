"""Chat completions adapter — handles 25+ models via /v1/chat/completions."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from backend.services.nvidia_adapters.base import AdapterResult, NVIDIAAdapter
from backend.services.nvidia_model_registry import ModelDefinition

logger = logging.getLogger(__name__)

# Parameters that are passed directly to the OpenAI SDK
_OPENAI_PARAMS = {"model", "messages", "temperature", "top_p", "max_tokens", "stream"}
# Parameters that go into extra_body
_EXTRA_BODY_KEYS = {
    "chat_template_kwargs", "reasoning_budget",
    "min_thinking_tokens", "max_thinking_tokens",
    "seed", "frequency_penalty", "presence_penalty",
}


class ChatAdapter(NVIDIAAdapter):
    """Adapter for chat completion models.

    Preserves each model's exact source_parameters:
    - chat_template_kwargs for thinking models (gemma, nemotron-3.x)
    - reasoning_budget for reasoning models
    - min/max_thinking_tokens for nano-9b-v2
    - seed for glm-5.2
    - frequency_penalty/presence_penalty for nemotron models
    """

    async def invoke(
        self,
        model_def: ModelDefinition,
        messages: list[dict[str, Any]],
        *,
        stream: Optional[bool]= None,
        **overrides: Any,
    ) -> AdapterResult:
        params = dict(model_def.source_parameters)
        params["messages"] = messages

        if stream is not None:
            params["stream"] = stream
        elif "stream" not in params:
            params["stream"] = False

        params.update(overrides)

        use_stream = params.get("stream", False)

        def _call() -> AdapterResult:
            client = self._build_client()
            sdk_params: dict[str, Any] = {}

            for key in _OPENAI_PARAMS:
                if key in params:
                    sdk_params[key] = params[key]

            extra_body = {}
            for key in _EXTRA_BODY_KEYS:
                if key in params:
                    extra_body[key] = params[key]

            if extra_body:
                sdk_params["extra_body"] = extra_body

            try:
                completion = client.chat.completions.create(**sdk_params)

                if use_stream:
                    return AdapterResult(
                        success=True,
                        model=params.get("model", ""),
                        stream_object=completion,
                    )

                message = completion.choices[0].message
                usage = getattr(completion, "usage", None)
                content = getattr(message, "content", "") or ""
                reasoning = getattr(message, "reasoning_content", None)

                return AdapterResult(
                    success=True,
                    content=str(content),
                    reasoning=reasoning,
                    model=params.get("model", ""),
                    prompt_tokens=int(getattr(usage, "prompt_tokens", 0) or 0),
                    completion_tokens=int(getattr(usage, "completion_tokens", 0) or 0),
                    raw_response=completion,
                )
            except Exception as e:
                logger.error(f"ChatAdapter error for {params.get('model')}: {e}")
                return AdapterResult(
                    success=False,
                    error=str(e),
                    model=params.get("model", ""),
                )

        return await asyncio.to_thread(_call)
