"""Base adapter class for NVIDIA models."""

from __future__ import annotations

import abc
import logging
from dataclasses import dataclass, field
from typing import Any

from openai import OpenAI

from backend.services.nvidia_model_registry import ModelDefinition

logger = logging.getLogger(__name__)


@dataclass
class AdapterResult:
    success: bool
    content: str = ""
    reasoning: Optional[str]= None
    model: str = ""
    provider: str = "nvidia"
    prompt_tokens: int = 0
    completion_tokens: int = 0
    raw_response: Any = field(default=None, repr=False)
    error: Optional[str]= None
    stream_object: Any = field(default=None, repr=False)


class NVIDIAAdapter(abc.ABC):
    """Base class for all NVIDIA model adapters.

    Each adapter builds the exact request parameters from the model's
    source_parameters dict, preserving individual API contracts.
    """

    def __init__(self, api_key: str, base_url: str = "https://integrate.api.nvidia.com/v1") -> None:
        self.api_key = api_key
        self.base_url = base_url

    @property
    def client(self) -> OpenAI:
        return OpenAI(
            base_url=self.base_url,
            api_key=self.api_key or "missing-nvidia-api-key",
            timeout=75.0,
            max_retries=0,
        )

    @abc.abstractmethod
    async def invoke(
        self,
        model_def: ModelDefinition,
        messages: list[dict[str, Any]],
        *,
        stream: Optional[bool]= None,
        **overrides: Any,
    ) -> AdapterResult:
        """Invoke the model using its source parameters.

        Args:
            model_def: The model definition with source_parameters.
            messages: Chat messages (may include image content for VLM).
            stream: Override stream setting. None = use model default.
            **overrides: Additional parameters to merge into the request.
        """
        ...

    def _build_client(self) -> OpenAI:
        return OpenAI(
            base_url=self.base_url,
            api_key=self.api_key or "missing-nvidia-api-key",
            timeout=75.0,
            max_retries=0,
        )
