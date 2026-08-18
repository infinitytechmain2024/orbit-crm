"""NVIDIA model adapters — each model's source parameters are sacred."""

from backend.services.nvidia_adapters.base import NVIDIAAdapter, AdapterResult
from backend.services.nvidia_adapters.chat_adapter import ChatAdapter
from backend.services.nvidia_adapters.vlm_adapter import VLMAdapter
from backend.services.nvidia_adapters.embedding_adapter import EmbeddingAdapter
from backend.services.nvidia_adapters.rerank_adapter import RerankAdapter
from backend.services.nvidia_adapters.safety_adapter import SafetyAdapter

ADAPTER_MAP: dict[str, type[NVIDIAAdapter]] = {
    "chat": ChatAdapter,
    "vlm": VLMAdapter,
    "embedding": EmbeddingAdapter,
    "rerank": RerankAdapter,
    "safety": SafetyAdapter,
}

__all__ = [
    "NVIDIAAdapter",
    "AdapterResult",
    "ChatAdapter",
    "VLMAdapter",
    "EmbeddingAdapter",
    "RerankAdapter",
    "SafetyAdapter",
    "ADAPTER_MAP",
]
