import os
from openai import OpenAI
from typing import List, Dict, Any, Optional


class NVIDIAUnifiedProvider:
    def __init__(self):
        self.api_key = os.getenv("NVIDIA_API_KEY")
        self.client = OpenAI(
            base_url=os.getenv("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1"),
            api_key=self.api_key or "missing-nvidia-api-key",
            timeout=75.0,
            max_retries=0,
        )

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key)

    def chat_completion(
        self,
        model_name: str,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 4096,
        stream: bool = False
    ) -> Dict[str, Any]:
        """
        Универсальный метод для всех текстовых и reasoning моделей из списка
        """
        if not self.is_configured:
            return {"success": False, "error": "NVIDIA_API_KEY is not configured"}

        params: Dict[str, Any] = {
            "model": model_name,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "top_p": 0.95,
            "stream": stream
        }

        if any(m in model_name for m in ["gemma", "nemotron-3", "gpt-oss", "nvidia-nemotron-nano-9b"]):
            extra = {"chat_template_kwargs": {"enable_thinking": True}}
            if "nemotron-3" in model_name or "super" in model_name:
                extra["reasoning_budget"] = 16384
            if "nvidia-nemotron-nano-9b" in model_name:
                extra = {"min_thinking_tokens": 1024, "max_thinking_tokens": 2048}
            params["extra_body"] = extra

        try:
            completion = self.client.chat.completions.create(**params)

            if stream:
                return {"success": True, "stream_object": completion}

            message = completion.choices[0].message
            content = getattr(message, "content", "")
            reasoning = getattr(message, "reasoning_content", None)

            return {
                "success": True,
                "model": model_name,
                "content": content,
                "reasoning": reasoning
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }

    def get_embedding(self, text: str, model_name: str = "nvidia/nv-embedcode-7b-v1") -> List[float]:
        """
        Метод для работы с эмбеддингами
        """
        response = self.client.embeddings.create(
            input=[text],
            model=model_name,
            encoding_format="float",
            extra_body={"input_type": "query", "truncate": "NONE"}
        )
        return response.data[0].embedding
