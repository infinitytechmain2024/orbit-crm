"""Rerank adapter — handles rerank-qa-mistral-4b via /v1/retrieval/nvidia/reranking."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import requests

from backend.services.nvidia_adapters.base import AdapterResult, NVIDIAAdapter
from backend.services.nvidia_model_registry import ModelDefinition

logger = logging.getLogger(__name__)


class RerankAdapter(NVIDIAAdapter):
    """Adapter for NVIDIA reranking models.

    Uses the dedicated /v1/retrieval/nvidia/reranking endpoint.
    Accepts query + passages format instead of chat messages.
    """

    async def invoke(
        self,
        model_def: ModelDefinition,
        messages: list[dict[str, Any]],
        *,
        stream: bool | None = None,
        query: str = "",
        passages: list[dict[str, str]] | None = None,
        **overrides: Any,
    ) -> AdapterResult:
        params = dict(model_def.source_parameters)
        params.update(overrides)

        # Allow passing query/passages directly, or extracting from messages
        if not query and messages:
            query = messages[-1].get("content", "")
        if passages is None:
            passages = [{"text": query}]

        def _call() -> AdapterResult:
            try:
                invoke_url = "https://ai.api.nvidia.com/v1/retrieval/nvidia/reranking"
                headers = {
                    "Authorization": f"Bearer {self.api_key}",
                    "Accept": "application/json",
                }
                payload = {
                    "model": params.get("model", "nv-rerank-qa-mistral-4b:1"),
                    "query": {"text": query},
                    "passages": passages,
                }

                response = requests.post(
                    invoke_url, headers=headers, json=payload, timeout=75
                )
                response.raise_for_status()
                body = response.json()

                return AdapterResult(
                    success=True,
                    content=str(body),
                    model=params.get("model", ""),
                    raw_response=body,
                )
            except Exception as e:
                logger.error(f"RerankAdapter error: {e}")
                return AdapterResult(
                    success=False,
                    error=str(e),
                    model=params.get("model", ""),
                )

        return await asyncio.to_thread(_call)
