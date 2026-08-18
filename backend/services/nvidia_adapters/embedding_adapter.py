"""Embedding adapter — handles nv-embedcode-7b-v1 via /v1/embeddings."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from backend.services.nvidia_adapters.base import AdapterResult, NVIDIAAdapter
from backend.services.nvidia_model_registry import ModelDefinition

logger = logging.getLogger(__name__)


class EmbeddingAdapter(NVIDIAAdapter):
    """Adapter for NVIDIA embedding models.

    Uses client.embeddings.create() with extra_body for input_type and truncate.
    """

    async def invoke(
        self,
        model_def: ModelDefinition,
        messages: list[dict[str, Any]],
        *,
        stream: bool | None = None,
        **overrides: Any,
    ) -> AdapterResult:
        params = dict(model_def.source_parameters)
        params.update(overrides)

        # Extract text from messages — embeddings take a single string
        text = ""
        if messages:
            last_msg = messages[-1]
            text = last_msg.get("content", "")
            if isinstance(text, list):
                text = " ".join(
                    part.get("text", "") for part in text if isinstance(part, dict)
                )

        def _call() -> AdapterResult:
            client = self._build_client()
            try:
                extra_body = params.get("extra_body", {})
                response = client.embeddings.create(
                    input=[text],
                    model=params.get("model", "nvidia/nv-embedcode-7b-v1"),
                    encoding_format=params.get("encoding_format", "float"),
                    extra_body=extra_body,
                )
                embedding = response.data[0].embedding
                return AdapterResult(
                    success=True,
                    content=str(embedding),
                    model=params.get("model", ""),
                    raw_response=response,
                )
            except Exception as e:
                logger.error(f"EmbeddingAdapter error: {e}")
                return AdapterResult(
                    success=False,
                    error=str(e),
                    model=params.get("model", ""),
                )

        return await asyncio.to_thread(_call)
