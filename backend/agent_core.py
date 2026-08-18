from __future__ import annotations

from backend.ai_provider import NVIDIAUnifiedProvider


class MasterAgent:
    def __init__(self):
        # Инициализируем наш единый провайдер вместо прямого httpx
        self.provider = NVIDIAUnifiedProvider()

        # Словарь моделей под разные задачи
        self.models = {
            "reasoning": "google/gemma-4-31b-it",
            "default": "meta/llama-3.3-70b-instruct",
            "nemotron": "nvidia/nemotron-3.5-lightning-30b-a3b"
        }

    def select_model_for_task(self, task_description: str) -> str:
        task_lower = task_description.lower()
        if "код" in task_lower or "логик" in task_lower or "анализ" in task_lower:
            return self.models["reasoning"]
        elif "nemotron" in task_lower:
            return self.models["nemotron"]
        return self.models["default"]

    def run_task(self, messages: list, task_type_hint: str = "", model_name: str = None) -> dict:
        # Если модель явно передана с фронтенда — используем её, иначе выбираем умным агентом
        chosen_model = model_name if model_name else self.select_model_for_task(
            messages[-1]["content"] if messages else task_type_hint
        )

        # Определяем, нужен ли режим мышления (thinking)
        enable_thinking = "gemma" in chosen_model or "nemotron" in chosen_model or "gpt-oss" in chosen_model

        # Вызываем наш единый провайдер
        result = self.provider.chat_completion(
            model_name=chosen_model,
            messages=messages,
            temperature=0.7,
            max_tokens=4096
        )

        if result.get("success"):
            # Если есть блок reasoning (мыслей) и content, объединяем их для удобства
            content = result.get("content", "")
            reasoning = result.get("reasoning")

            final_response = content
            if reasoning:
                final_response = f"[Мысли модели]:\n{reasoning}\n\n[Ответ]:\n{content}"

            return {
                "success": True,
                "model_used": chosen_model,
                "response": final_response
            }
        else:
            return {
                "success": False,
                "error": result.get("error", "Unknown error")
            }
