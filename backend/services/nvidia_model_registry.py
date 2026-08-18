"""NVIDIA Model Registry — single source of truth for all 29 NVIDIA models.

Each ModelDefinition preserves the EXACT parameters from the original source code.
Do NOT merge models into generic patterns — individual parameters are sacred.
"""

from __future__ import annotations

import enum
import logging
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


class ModelType(str, enum.Enum):
    CHAT = "chat"
    VLM = "vlm"
    EMBEDDING = "embedding"
    RERANK = "rerank"
    SAFETY = "safety"


class EndpointType(str, enum.Enum):
    CHAT_COMPLETIONS = "chat_completions"
    VLM = "vlm"
    EMBEDDINGS = "embeddings"
    RERANKING = "reranking"


@dataclass
class ModelDefinition:
    display_name: str
    model_id: str
    type: ModelType
    endpoint: EndpointType
    adapter: str
    source_parameters: dict[str, Any]
    stream: bool = False
    reasoning: bool = False
    status: str = "active"
    deprecated_date: str | None = None
    declared_limit: str = ""
    priority: int = 50
    auto_route: bool = True
    fallback_only: bool = False
    cooldown_until: str | None = field(default=None, repr=False)
    last_error: str | None = field(default=None, repr=False)


NVIDIA_MODELS: list[ModelDefinition] = [
    ModelDefinition(
        display_name="gemma-4-31b-it",
        model_id="google/gemma-4-31b-it",
        type=ModelType.CHAT,
        endpoint=EndpointType.CHAT_COMPLETIONS,
        adapter="chat",
        source_parameters={
            "model": "google/gemma-4-31b-it",
            "temperature": 1,
            "top_p": 0.95,
            "max_tokens": 16384,
            "chat_template_kwargs": {"enable_thinking": True},
        },
        stream=False,
        reasoning=True,
        status="active",
        declared_limit="6M",
        priority=90,
    ),
    ModelDefinition(
        display_name="glm-5.2",
        model_id="z-ai/glm-5.2",
        type=ModelType.CHAT,
        endpoint=EndpointType.CHAT_COMPLETIONS,
        adapter="chat",
        source_parameters={
            "model": "z-ai/glm-5.2",
            "temperature": 1,
            "top_p": 1,
            "max_tokens": 16384,
            "seed": 42,
        },
        stream=True,
        reasoning=False,
        status="active",
        declared_limit="8M",
        priority=70,
    ),
    ModelDefinition(
        display_name="gpt-oss-120b",
        model_id="openai/gpt-oss-120b",
        type=ModelType.CHAT,
        endpoint=EndpointType.CHAT_COMPLETIONS,
        adapter="chat",
        source_parameters={
            "model": "openai/gpt-oss-120b",
            "temperature": 1,
            "top_p": 1,
            "max_tokens": 4096,
        },
        stream=False,
        reasoning=True,
        status="active",
        declared_limit="45M",
        priority=85,
    ),
    ModelDefinition(
        display_name="gpt-oss-20b",
        model_id="openai/gpt-oss-20b",
        type=ModelType.CHAT,
        endpoint=EndpointType.CHAT_COMPLETIONS,
        adapter="chat",
        source_parameters={
            "model": "openai/gpt-oss-20b",
            "temperature": 1,
            "top_p": 1,
            "max_tokens": 4096,
        },
        stream=False,
        reasoning=True,
        status="active",
        declared_limit="19M",
        priority=75,
    ),
    ModelDefinition(
        display_name="laguna-xs-2.1",
        model_id="poolside/laguna-xs-2.1",
        type=ModelType.CHAT,
        endpoint=EndpointType.CHAT_COMPLETIONS,
        adapter="chat",
        source_parameters={
            "model": "poolside/laguna-xs-2.1",
            "temperature": 1,
            "top_p": 0.95,
            "max_tokens": 8192,
        },
        stream=False,
        reasoning=False,
        status="active",
        declared_limit="26d",
        priority=50,
    ),
    ModelDefinition(
        display_name="llama-3.1-70b-instruct",
        model_id="meta/llama-3.1-70b-instruct",
        type=ModelType.CHAT,
        endpoint=EndpointType.CHAT_COMPLETIONS,
        adapter="chat",
        source_parameters={
            "model": "meta/llama-3.1-70b-instruct",
            "temperature": 0.2,
            "top_p": 0.7,
            "max_tokens": 1024,
        },
        stream=False,
        reasoning=False,
        status="deprecated",
        deprecated_date="2026-08-25",
        declared_limit="5M",
        priority=0,
    ),
    ModelDefinition(
        display_name="llama-3.1-8b-instruct",
        model_id="meta/llama-3.1-8b-instruct",
        type=ModelType.CHAT,
        endpoint=EndpointType.CHAT_COMPLETIONS,
        adapter="chat",
        source_parameters={
            "model": "meta/llama-3.1-8b-instruct",
            "temperature": 0.2,
            "top_p": 0.7,
            "max_tokens": 1024,
        },
        stream=False,
        reasoning=False,
        status="deprecated",
        deprecated_date="2026-08-25",
        declared_limit="19M",
        priority=0,
    ),
    ModelDefinition(
        display_name="llama-3.1-nemotron-nano-8b-v1",
        model_id="nvidia/llama-3.1-nemotron-nano-8b-v1",
        type=ModelType.CHAT,
        endpoint=EndpointType.CHAT_COMPLETIONS,
        adapter="chat",
        source_parameters={
            "model": "nvidia/llama-3.1-nemotron-nano-8b-v1",
            "temperature": 0.6,
            "top_p": 0.95,
            "max_tokens": 4096,
            "frequency_penalty": 0,
            "presence_penalty": 0,
        },
        stream=False,
        reasoning=False,
        status="deprecated",
        deprecated_date="2026-08-25",
        declared_limit="1M",
        priority=0,
    ),
    ModelDefinition(
        display_name="llama-3.1-nemotron-nano-vl-8b-v1",
        model_id="nvidia/llama-3.1-nemotron-nano-vl-8b-v1",
        type=ModelType.VLM,
        endpoint=EndpointType.VLM,
        adapter="vlm",
        source_parameters={
            "model": "nvidia/llama-3.1-nemotron-nano-vl-8b-v1",
            "temperature": 1,
            "top_p": 0.01,
            "max_tokens": 1024,
            "seed": 50,
        },
        stream=False,
        reasoning=False,
        status="deprecated",
        deprecated_date="2026-08-25",
        declared_limit="14M",
        priority=0,
    ),
    ModelDefinition(
        display_name="llama-3.2-1b-instruct",
        model_id="meta/llama-3.2-1b-instruct",
        type=ModelType.CHAT,
        endpoint=EndpointType.CHAT_COMPLETIONS,
        adapter="chat",
        source_parameters={
            "model": "meta/llama-3.2-1b-instruct",
            "temperature": 0.2,
            "top_p": 0.7,
            "max_tokens": 1024,
        },
        stream=False,
        reasoning=False,
        status="deprecated",
        deprecated_date="2026-08-25",
        declared_limit="40K",
        priority=0,
    ),
    ModelDefinition(
        display_name="llama-3.2-3b-instruct",
        model_id="meta/llama-3.2-3b-instruct",
        type=ModelType.CHAT,
        endpoint=EndpointType.CHAT_COMPLETIONS,
        adapter="chat",
        source_parameters={
            "model": "meta/llama-3.2-3b-instruct",
            "temperature": 0.2,
            "top_p": 0.7,
            "max_tokens": 1024,
        },
        stream=False,
        reasoning=False,
        status="deprecated",
        deprecated_date="2026-08-25",
        declared_limit="27K",
        priority=0,
    ),
    ModelDefinition(
        display_name="llama-3.3-70b-instruct",
        model_id="meta/llama-3.3-70b-instruct",
        type=ModelType.CHAT,
        endpoint=EndpointType.CHAT_COMPLETIONS,
        adapter="chat",
        source_parameters={
            "model": "meta/llama-3.3-70b-instruct",
            "temperature": 0.2,
            "top_p": 0.7,
            "max_tokens": 1024,
        },
        stream=False,
        reasoning=False,
        status="deprecated",
        deprecated_date="2026-08-25",
        declared_limit="27M",
        priority=0,
    ),
    ModelDefinition(
        display_name="llama-3.3-nemotron-super-49b-v1",
        model_id="nvidia/llama-3.3-nemotron-super-49b-v1",
        type=ModelType.CHAT,
        endpoint=EndpointType.CHAT_COMPLETIONS,
        adapter="chat",
        source_parameters={
            "model": "nvidia/llama-3.3-nemotron-super-49b-v1",
            "temperature": 0.6,
            "top_p": 0.95,
            "max_tokens": 4096,
            "frequency_penalty": 0,
            "presence_penalty": 0,
        },
        stream=False,
        reasoning=False,
        status="deprecated",
        deprecated_date="2026-08-25",
        declared_limit="6M",
        priority=0,
    ),
    ModelDefinition(
        display_name="llama-3.3-nemotron-super-49b-v1.5",
        model_id="nvidia/llama-3.3-nemotron-super-49b-v1.5",
        type=ModelType.CHAT,
        endpoint=EndpointType.CHAT_COMPLETIONS,
        adapter="chat",
        source_parameters={
            "model": "nvidia/llama-3.3-nemotron-super-49b-v1.5",
            "temperature": 0.6,
            "top_p": 0.95,
            "max_tokens": 65536,
            "frequency_penalty": 0,
            "presence_penalty": 0,
        },
        stream=False,
        reasoning=False,
        status="deprecated",
        deprecated_date="2026-08-25",
        declared_limit="6M",
        priority=0,
    ),
    ModelDefinition(
        display_name="llama-guard-4-12b",
        model_id="meta/llama-guard-4-12b",
        type=ModelType.SAFETY,
        endpoint=EndpointType.CHAT_COMPLETIONS,
        adapter="safety",
        source_parameters={
            "model": "meta/llama-guard-4-12b",
            "max_tokens": 5,
            "temperature": 0.2,
            "top_p": 0.7,
        },
        stream=False,
        reasoning=False,
        status="active",
        declared_limit="357K",
        priority=60,
    ),
    ModelDefinition(
        display_name="minimax-m3",
        model_id="minimaxai/minimax-m3",
        type=ModelType.CHAT,
        endpoint=EndpointType.CHAT_COMPLETIONS,
        adapter="chat",
        source_parameters={
            "model": "minimaxai/minimax-m3",
            "temperature": 1,
            "top_p": 0.95,
            "max_tokens": 8192,
        },
        stream=False,
        reasoning=False,
        status="active",
        declared_limit="10M",
        priority=65,
    ),
    ModelDefinition(
        display_name="mistral-nemotron",
        model_id="mistralai/mistral-nemotron",
        type=ModelType.CHAT,
        endpoint=EndpointType.CHAT_COMPLETIONS,
        adapter="chat",
        source_parameters={
            "model": "mistralai/mistral-nemotron",
            "temperature": 0.6,
            "top_p": 0.7,
            "max_tokens": 4096,
        },
        stream=False,
        reasoning=False,
        status="active",
        declared_limit="1M",
        priority=60,
    ),
    ModelDefinition(
        display_name="muse-glimmer-30b",
        model_id="meta/muse-glimmer-30b",
        type=ModelType.CHAT,
        endpoint=EndpointType.CHAT_COMPLETIONS,
        adapter="chat",
        source_parameters={
            "model": "meta/muse-glimmer-30b",
            "temperature": 1,
            "top_p": 0.95,
            "max_tokens": 8192,
        },
        stream=False,
        reasoning=False,
        status="active",
        declared_limit="1d",
        priority=50,
    ),
    ModelDefinition(
        display_name="nemotron-3-nano-30b-a3b",
        model_id="nvidia/nemotron-3.5-lightning-30b-a3b",
        type=ModelType.CHAT,
        endpoint=EndpointType.CHAT_COMPLETIONS,
        adapter="chat",
        source_parameters={
            "model": "nvidia/nemotron-3.5-lightning-30b-a3b",
            "temperature": 1,
            "top_p": 0.95,
            "max_tokens": 16384,
            "extra_body": {
                "chat_template_kwargs": {"enable_thinking": True},
                "reasoning_budget": 16384,
            },
        },
        stream=True,
        reasoning=True,
        status="active",
        declared_limit="12M",
        priority=85,
    ),
    ModelDefinition(
        display_name="nemotron-3-nano-omni-30b-a3b-reasoning",
        model_id="nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
        type=ModelType.CHAT,
        endpoint=EndpointType.CHAT_COMPLETIONS,
        adapter="chat",
        source_parameters={
            "model": "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
            "max_tokens": 65536,
            "reasoning_budget": 16384,
            "temperature": 0.6,
            "top_p": 0.95,
        },
        stream=False,
        reasoning=True,
        status="active",
        declared_limit="8M",
        priority=80,
    ),
    ModelDefinition(
        display_name="nemotron-3-super-120b-a12b",
        model_id="nvidia/nemotron-3-super-120b-a12b",
        type=ModelType.CHAT,
        endpoint=EndpointType.CHAT_COMPLETIONS,
        adapter="chat",
        source_parameters={
            "model": "nvidia/nemotron-3-super-120b-a12b",
            "temperature": 1,
            "top_p": 0.95,
            "max_tokens": 16384,
            "extra_body": {
                "chat_template_kwargs": {"enable_thinking": True},
                "reasoning_budget": 16384,
            },
        },
        stream=True,
        reasoning=True,
        status="active",
        declared_limit="65M",
        priority=95,
    ),
    ModelDefinition(
        display_name="nemotron-3-ultra-550b-a55b",
        model_id="nvidia/nemotron-3-ultra-550b-a55b",
        type=ModelType.CHAT,
        endpoint=EndpointType.CHAT_COMPLETIONS,
        adapter="chat",
        source_parameters={
            "model": "nvidia/nemotron-3-ultra-550b-a55b",
            "temperature": 1,
            "top_p": 0.95,
            "max_tokens": 16384,
            "extra_body": {
                "chat_template_kwargs": {"enable_thinking": True},
                "reasoning_budget": 16384,
            },
        },
        stream=True,
        reasoning=True,
        status="active",
        declared_limit="52M",
        priority=98,
    ),
    ModelDefinition(
        display_name="nemotron-3.5-content-safety",
        model_id="nvidia/nemotron-3.5-content-safety",
        type=ModelType.SAFETY,
        endpoint=EndpointType.CHAT_COMPLETIONS,
        adapter="safety",
        source_parameters={
            "model": "nvidia/nemotron-3.5-content-safety",
            "max_tokens": 512,
            "temperature": 0.2,
            "top_p": 0.7,
            "chat_template_kwargs": {
                "request_categories": "/categories",
                "enable_thinking": True,
            },
        },
        stream=False,
        reasoning=True,
        status="active",
        declared_limit="2M",
        priority=60,
    ),
    ModelDefinition(
        display_name="nemotron-3.5-lightning-30b-a3b",
        model_id="nvidia/nemotron-3.5-lightning-30b-a3b",
        type=ModelType.CHAT,
        endpoint=EndpointType.CHAT_COMPLETIONS,
        adapter="chat",
        source_parameters={
            "model": "nvidia/nemotron-3.5-lightning-30b-a3b",
            "temperature": 1,
            "top_p": 0.95,
            "max_tokens": 16384,
            "extra_body": {
                "chat_template_kwargs": {"enable_thinking": True},
                "reasoning_budget": 16384,
            },
        },
        stream=True,
        reasoning=True,
        status="active",
        declared_limit="Today",
        priority=88,
    ),
    ModelDefinition(
        display_name="nemotron-mini-4b-instruct",
        model_id="nvidia/nemotron-mini-4b-instruct",
        type=ModelType.CHAT,
        endpoint=EndpointType.CHAT_COMPLETIONS,
        adapter="chat",
        source_parameters={
            "model": "nvidia/nemotron-mini-4b-instruct",
            "temperature": 0.2,
            "top_p": 0.7,
            "max_tokens": 1024,
        },
        stream=False,
        reasoning=False,
        status="active",
        declared_limit="3M",
        priority=55,
    ),
    ModelDefinition(
        display_name="nv-embedcode-7b-v1",
        model_id="nvidia/nv-embedcode-7b-v1",
        type=ModelType.EMBEDDING,
        endpoint=EndpointType.EMBEDDINGS,
        adapter="embedding",
        source_parameters={
            "model": "nvidia/nv-embedcode-7b-v1",
            "encoding_format": "float",
            "extra_body": {"input_type": "query", "truncate": "NONE"},
        },
        stream=False,
        reasoning=False,
        status="provider_error",
        declared_limit="2M",
        priority=70,
        auto_route=False,
        last_error="NVIDIA API returns HTTP 500 for all valid parameter combinations",
    ),
    ModelDefinition(
        display_name="nvidia-nemotron-nano-9b-v2",
        model_id="nvidia/nvidia-nemotron-nano-9b-v2",
        type=ModelType.CHAT,
        endpoint=EndpointType.CHAT_COMPLETIONS,
        adapter="chat",
        source_parameters={
            "model": "nvidia/nvidia-nemotron-nano-9b-v2",
            "temperature": 0.6,
            "top_p": 0.95,
            "max_tokens": 2048,
            "frequency_penalty": 0,
            "presence_penalty": 0,
            "extra_body": {
                "min_thinking_tokens": 1024,
                "max_thinking_tokens": 2048,
            },
        },
        stream=False,
        reasoning=True,
        status="active",
        declared_limit="2M",
        priority=72,
    ),
    ModelDefinition(
        display_name="paligemma",
        model_id="google/paligemma",
        type=ModelType.VLM,
        endpoint=EndpointType.VLM,
        adapter="vlm",
        source_parameters={
            "model": "google/paligemma",
            "max_tokens": 1024,
            "top_p": 0.7,
            "temperature": 0.2,
        },
        stream=False,
        reasoning=False,
        status="configuration_error",
        declared_limit="12K",
        priority=50,
        auto_route=False,
        last_error="NVIDIA API validation bug: content field cannot be passed as either string or list format",
    ),
    ModelDefinition(
        display_name="rerank-qa-mistral-4b",
        model_id="nv-rerank-qa-mistral-4b:1",
        type=ModelType.RERANK,
        endpoint=EndpointType.RERANKING,
        adapter="rerank",
        source_parameters={
            "model": "nv-rerank-qa-mistral-4b:1",
        },
        stream=False,
        reasoning=False,
        status="active",
        declared_limit="1M",
        priority=70,
    ),
]


class NVIDIAModelRegistry:
    """Lookup and manage NVIDIA model definitions."""

    def __init__(self) -> None:
        self._models: dict[str, ModelDefinition] = {
            m.display_name: m for m in NVIDIA_MODELS
        }
        self._by_model_id: dict[str, ModelDefinition] = {
            m.model_id: m for m in NVIDIA_MODELS
        }
        self._runtime_status: dict[str, str] = {}

    def get(self, display_name: str) -> ModelDefinition | None:
        return self._models.get(display_name)

    def get_by_model_id(self, model_id: str) -> ModelDefinition | None:
        return self._by_model_id.get(model_id)

    def list_active(self) -> list[ModelDefinition]:
        return [m for m in NVIDIA_MODELS if m.status == "active"]

    def list_by_type(self, model_type: ModelType) -> list[ModelDefinition]:
        return [m for m in NVIDIA_MODELS if m.type == model_type]

    def list_by_adapter(self, adapter: str) -> list[ModelDefinition]:
        return [m for m in NVIDIA_MODELS if m.adapter == adapter]

    def select_best(
        self,
        model_type: ModelType | None = None,
        exclude_deprecated: bool = True,
    ) -> ModelDefinition | None:
        candidates = NVIDIA_MODELS
        if model_type:
            candidates = [m for m in candidates if m.type == model_type]
        if exclude_deprecated:
            candidates = [m for m in candidates if m.status == "active"]
        candidates = [m for m in candidates if m.priority > 0]
        if not candidates:
            return None
        return max(candidates, key=lambda m: m.priority)

    def list_by_pool(self, pool: str) -> list[ModelDefinition]:
        """List models in a production pool: heavy, standard, fast."""
        pools = {
            "heavy": [
                "nemotron-3-ultra-550b-a55b",
                "nemotron-3-super-120b-a12b",
                "gpt-oss-120b",
            ],
            "standard": [
                "nemotron-3.5-lightning-30b-a3b",
                "nemotron-3-nano-30b-a3b",
                "nemotron-3-nano-omni-30b-a3b-reasoning",
                "gpt-oss-20b",
                "glm-5.2",
            ],
            "fast": [
                "nemotron-mini-4b-instruct",
                "nvidia-nemotron-nano-9b-v2",
                "minimax-m3",
                "muse-glimmer-30b",
                "laguna-xs-2.1",
            ],
        }
        model_names = pools.get(pool, [])
        return [
            m for m in NVIDIA_MODELS
            if m.display_name in model_names and m.auto_route
        ]

    def get_fallback_chain(
        self,
        failed_model: str,
        model_type: ModelType = ModelType.CHAT,
    ) -> list[ModelDefinition]:
        """Get fallback models after a failure, excluding the failed model."""
        candidates = [
            m for m in NVIDIA_MODELS
            if m.type == model_type
            and m.auto_route
            and m.display_name != failed_model
            and m.status == "active"
        ]
        candidates.sort(key=lambda m: -m.priority)
        return candidates

    def update_runtime_status(self, display_name: str, status: str) -> None:
        self._runtime_status[display_name] = status

    def get_runtime_status(self, display_name: str) -> str:
        return self._runtime_status.get(display_name, "unknown")

    def mark_unavailable(self, display_name: str, error: str) -> None:
        model = self.get(display_name)
        if model:
            model.auto_route = False
            model.last_error = error
            self._runtime_status[display_name] = "unavailable"

    def to_dict(self) -> list[dict[str, Any]]:
        return [
            {
                "display_name": m.display_name,
                "model_id": m.model_id,
                "type": m.type.value,
                "endpoint": m.endpoint.value,
                "adapter": m.adapter,
                "stream": m.stream,
                "reasoning": m.reasoning,
                "status": m.status,
                "deprecated_date": m.deprecated_date,
                "declared_limit": m.declared_limit,
                "priority": m.priority,
                "auto_route": m.auto_route,
                "fallback_only": m.fallback_only,
            }
            for m in NVIDIA_MODELS
        ]


nvidia_model_registry = NVIDIAModelRegistry()
