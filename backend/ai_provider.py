"""NVIDIA Unified Provider — routes model calls through registry + adapters.

Preserves the existing chat_completion() and get_embedding() interfaces
while delegating to model-specific adapters that preserve individual
source parameters from the NVIDIA examples.
"""

import os
from typing import List, Dict, Any, Optional

from backend.services.nvidia_model_registry import (
    nvidia_model_registry,
    ModelDefinition,
    ModelType,
)
from backend.services.nvidia_adapters import ADAPTER_MAP
from backend.services.nvidia_adapters.base import AdapterResult


class NVIDIAUnifiedProvider:
    def __init__(self):
        self.api_key = os.getenv("NVIDIA_API_KEY")
        self.base_url = os.getenv(
            "NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1"
        )
        self._adapters: dict[str, Any] = {}

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key)

    def _get_adapter(self, adapter_name: str):
        if adapter_name not in self._adapters:
            adapter_cls = ADAPTER_MAP.get(adapter_name)
            if not adapter_cls:
                raise ValueError(f"Unknown adapter: {adapter_name}")
            self._adapters[adapter_name] = adapter_cls(
                api_key=self.api_key or "missing-nvidia-api-key",
                base_url=self.base_url,
            )
        return self._adapters[adapter_name]

    def _resolve_model(self, model_name: str) -> Optional[ModelDefinition]:
        """Resolve a model by name or model_id."""
        defn = nvidia_model_registry.get(model_name)
        if defn:
            return defn
        defn = nvidia_model_registry.get_by_model_id(model_name)
        if defn:
            return defn
        # Fallback: partial match on display_name or model_id
        for m in nvidia_model_registry.list_active():
            if model_name in m.display_name or model_name in m.model_id:
                return m
        return None

    def chat_completion(
        self,
        model_name: str,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 4096,
        stream: bool = False,
        **overrides: Any,
    ) -> Dict[str, Any]:
        """Universal method for all chat/reasoning models from the NVIDIA registry.

        Routes through the model-specific adapter which preserves individual
        source_parameters (thinking, reasoning_budget, seed, etc.).
        """
        if not self.is_configured:
            return {"success": False, "error": "NVIDIA_API_KEY is not configured"}

        model_def = self._resolve_model(model_name)

        if model_def and model_def.adapter in ADAPTER_MAP:
            import asyncio
            adapter = self._get_adapter(model_def.adapter)

            async def _invoke() -> AdapterResult:
                return await adapter.invoke(
                    model_def,
                    messages,
                    stream=stream,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    **overrides,
                )

            loop = asyncio.new_event_loop()
            try:
                result = loop.run_until_complete(_invoke())
            finally:
                loop.close()

            return {
                "success": result.success,
                "model": result.model or model_name,
                "content": result.content,
                "reasoning": result.reasoning,
                "error": result.error,
                "stream_object": result.stream_object,
            }

        # Fallback: direct OpenAI SDK call for unknown models
        return self._legacy_chat_completion(
            model_name, messages, temperature, max_tokens, stream, **overrides
        )

    def _legacy_chat_completion(
        self,
        model_name: str,
        messages: List[Dict[str, str]],
        temperature: float,
        max_tokens: int,
        stream: bool,
        **overrides: Any,
    ) -> Dict[str, Any]:
        """Legacy fallback for models not in the registry."""
        from openai import OpenAI

        client = OpenAI(
            base_url=self.base_url,
            api_key=self.api_key or "missing-nvidia-api-key",
            timeout=75.0,
            max_retries=0,
        )

        params: Dict[str, Any] = {
            "model": model_name,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "top_p": 0.95,
            "stream": stream,
        }

        if any(
            m in model_name
            for m in ["gemma", "nemotron-3", "gpt-oss", "nvidia-nemotron-nano-9b"]
        ):
            extra: Dict[str, Any] = {
                "chat_template_kwargs": {"enable_thinking": True}
            }
            if "nemotron-3" in model_name or "super" in model_name:
                extra["reasoning_budget"] = 16384
            if "nvidia-nemotron-nano-9b" in model_name:
                extra = {"min_thinking_tokens": 1024, "max_thinking_tokens": 2048}
            params["extra_body"] = extra

        params.update(overrides)

        try:
            completion = client.chat.completions.create(**params)

            if stream:
                return {"success": True, "stream_object": completion}

            message = completion.choices[0].message
            content = getattr(message, "content", "")
            reasoning = getattr(message, "reasoning_content", None)

            return {
                "success": True,
                "model": model_name,
                "content": content,
                "reasoning": reasoning,
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    def get_embedding(
        self, text: str, model_name: str = "nvidia/nv-embedcode-7b-v1"
    ) -> List[float]:
        """Get embedding vector using the embedding adapter."""
        if not self.is_configured:
            raise RuntimeError("NVIDIA_API_KEY is not configured")

        model_def = nvidia_model_registry.get_by_model_id(model_name)
        if not model_def:
            model_def = nvidia_model_registry.get("nv-embedcode-7b-v1")

        if model_def:
            import asyncio

            adapter = self._get_adapter(model_def.adapter)

            async def _invoke() -> AdapterResult:
                return await adapter.invoke(
                    model_def,
                    [{"role": "user", "content": text}],
                )

            loop = asyncio.new_event_loop()
            try:
                result = loop.run_until_complete(_invoke())
            finally:
                loop.close()

            if result.success:
                import ast

                try:
                    return ast.literal_eval(result.content)
                except (ValueError, SyntaxError):
                    return []

        # Fallback: direct call
        from openai import OpenAI

        client = OpenAI(
            base_url=self.base_url,
            api_key=self.api_key or "missing-nvidia-api-key",
            timeout=75.0,
            max_retries=0,
        )
        response = client.embeddings.create(
            input=[text],
            model=model_name,
            encoding_format="float",
            extra_body={"input_type": "query", "truncate": "NONE"},
        )
        return response.data[0].embedding

    def invoke_rerank(
        self,
        query: str,
        passages: List[Dict[str, str]],
        model_name: str = "nv-rerank-qa-mistral-4b:1",
    ) -> Dict[str, Any]:
        """Invoke reranking model via the rerank adapter."""
        if not self.is_configured:
            return {"success": False, "error": "NVIDIA_API_KEY is not configured"}

        model_def = nvidia_model_registry.get_by_model_id(model_name)
        if not model_def:
            model_def = nvidia_model_registry.get("rerank-qa-mistral-4b")

        if not model_def:
            return {"success": False, "error": f"Rerank model not found: {model_name}"}

        import asyncio

        adapter = self._get_adapter(model_def.adapter)

        async def _invoke() -> AdapterResult:
            return await adapter.invoke(
                model_def,
                [{"role": "user", "content": query}],
                query=query,
                passages=passages,
            )

        loop = asyncio.new_event_loop()
        try:
            result = loop.run_until_complete(_invoke())
        finally:
            loop.close()

        return {
            "success": result.success,
            "content": result.content,
            "error": result.error,
        }

    def invoke_safety(
        self,
        messages: List[Dict[str, str]],
        model_name: str = "meta/llama-guard-4-12b",
        conversation: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """Invoke safety model via the safety adapter."""
        if not self.is_configured:
            return {"success": False, "error": "NVIDIA_API_KEY is not configured"}

        model_def = nvidia_model_registry.get_by_model_id(model_name)
        if not model_def:
            return {"success": False, "error": f"Safety model not found: {model_name}"}

        import asyncio

        adapter = self._get_adapter(model_def.adapter)

        async def _invoke() -> AdapterResult:
            return await adapter.invoke(
                model_def,
                messages,
                conversation=conversation,
            )

        loop = asyncio.new_event_loop()
        try:
            result = loop.run_until_complete(_invoke())
        finally:
            loop.close()

        return {
            "success": result.success,
            "content": result.content,
            "reasoning": result.reasoning,
            "error": result.error,
        }

    def invoke_vlm(
        self,
        messages: List[Dict[str, Any]],
        model_name: str = "google/paligemma",
        **overrides: Any,
    ) -> Dict[str, Any]:
        """Invoke VLM model via the VLM adapter."""
        if not self.is_configured:
            return {"success": False, "error": "NVIDIA_API_KEY is not configured"}

        model_def = nvidia_model_registry.get_by_model_id(model_name)
        if not model_def:
            return {"success": False, "error": f"VLM model not found: {model_name}"}

        import asyncio

        adapter = self._get_adapter(model_def.adapter)

        async def _invoke() -> AdapterResult:
            return await adapter.invoke(model_def, messages, **overrides)

        loop = asyncio.new_event_loop()
        try:
            result = loop.run_until_complete(_invoke())
        finally:
            loop.close()

        return {
            "success": result.success,
            "content": result.content,
            "error": result.error,
        }


nvidia_provider = NVIDIAUnifiedProvider()
