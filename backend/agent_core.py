import httpx
from typing import List, Dict, Any

from backend.config import settings


class MasterAgent:
    def __init__(self):
        self.nvidia_api_key = settings.NVIDIA_API_KEY
        self.nvidia_url = "https://integrate.api.nvidia.com/v1/chat/completions"

        self.models = {
            "reasoning": "google/gemma-4-31b-it",
            "default": "meta/llama-3.3-70b-instruct",
            "nemotron": "meta/llama-3.1-nemotron-nano-8b-v1",
        }

    def select_model_for_task(self, task_description: str) -> str:
        task_lower = task_description.lower()
        if "код" in task_lower or "логик" in task_lower or "анализ" in task_lower:
            return self.models["reasoning"]
        elif "nemotron" in task_lower:
            return self.models["nemotron"]
        return self.models["default"]

    def run_task(
        self,
        messages: List[Dict[str, str]],
        task_type_hint: str = "",
    ) -> Dict[str, Any]:
        last_message = messages[-1]["content"] if messages else ""
        chosen_model = self.select_model_for_task(last_message or task_type_hint)

        headers = {
            "Authorization": f"Bearer {self.nvidia_api_key}",
            "Accept": "application/json",
        }

        payload = {
            "messages": messages,
            "model": chosen_model,
            "max_tokens": 4096,
            "stream": False,
            "temperature": 0.7,
        }

        if "gemma" in chosen_model or "reasoning" in chosen_model:
            payload["chat_template_kwargs"] = {"enable_thinking": True}

        response = httpx.post(
            self.nvidia_url,
            headers=headers,
            json=payload,
            timeout=60.0,
        )

        if response.status_code == 200:
            result = response.json()
            return {
                "success": True,
                "model_used": chosen_model,
                "response": result.get("choices", [{}])[0]
                .get("message", {})
                .get("content", ""),
            }
        return {
            "success": False,
            "error": response.text,
        }
