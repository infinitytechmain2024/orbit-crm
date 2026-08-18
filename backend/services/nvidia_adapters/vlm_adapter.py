"""VLM adapter — handles paligemma and nemotron-vl via /v1/vlm/ endpoint."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import requests

from backend.services.nvidia_adapters.base import AdapterResult, NVIDIAAdapter
from backend.services.nvidia_model_registry import ModelDefinition

logger = logging.getLogger(__name__)


class VLMAdapter(NVIDIAAdapter):
    """Adapter for Vision Language Models.

    PaliGemma uses a dedicated VLM endpoint with a 'prompt' field.
    Nemotron-VL uses the chat endpoint with image content in messages.
    Both are routed here for unified handling.
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
        params.update(overrides)

        def _call() -> AdapterResult:
            try:
                model_id = params.get("model", model_def.model_id)

                if "paligemma" in model_id.lower():
                    return self._call_paligemma(model_id, params)
                else:
                    return self._call_nemotron_vl(model_id, params, messages)
            except Exception as e:
                logger.error(f"VLMAdapter error for {params.get('model')}: {e}")
                return AdapterResult(
                    success=False,
                    error=str(e),
                    model=params.get("model", ""),
                )

        return await asyncio.to_thread(_call)

    def _call_paligemma(self, model_id: str, params: dict) -> AdapterResult:
        """PaliGemma uses /v1/vlm/google/paligemma with prompt field."""
        invoke_url = f"https://ai.api.nvidia.com/v1/vlm/google/paligemma"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Accept": "application/json",
        }
        payload = {
            "max_tokens": params.get("max_tokens", 1024),
            "top_p": params.get("top_p", 0.7),
            "temperature": params.get("temperature", 0.2),
            "prompt": params.get("prompt", "Describe the image."),
        }

        response = requests.post(invoke_url, headers=headers, json=payload, timeout=75)
        response.raise_for_status()
        body = response.json()

        content = ""
        if "choices" in body and body["choices"]:
            content = body["choices"][0].get("message", {}).get("content", "")
        elif "output" in body:
            content = str(body["output"])

        return AdapterResult(
            success=True,
            content=content,
            model=model_id,
            raw_response=body,
        )

    def _call_nemotron_vl(
        self, model_id: str, params: dict, messages: list[dict]
    ) -> AdapterResult:
        """Nemotron-VL uses standard chat completions with image content."""
        client = self._build_client()
        sdk_params: dict[str, Any] = {
            "model": model_id,
            "messages": messages,
            "temperature": params.get("temperature", 1),
            "top_p": params.get("top_p", 0.01),
            "max_tokens": params.get("max_tokens", 1024),
            "stream": False,
        }
        if "seed" in params:
            sdk_params["seed"] = params["seed"]

        completion = client.chat.completions.create(**sdk_params)
        message = completion.choices[0].message
        content = getattr(message, "content", "") or ""

        return AdapterResult(
            success=True,
            content=str(content),
            model=model_id,
            raw_response=completion,
        )
