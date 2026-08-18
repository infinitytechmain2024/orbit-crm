from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Any

import httpx

from backend.config import settings

logger = logging.getLogger(__name__)


@dataclass
class Intent:
    type: str
    entities: dict[str, Any]
    raw_text: str
    confidence: float


INTENT_TYPES = {
    "CREATE_PROJECT": "Создание нового проекта",
    "ADD_TASK": "Добавление задачи в существующий проект",
    "CALCULATE_ESTIMATE": "Расчет сметы ($10/час + 15% буфер)",
    "RUN_LEAD_SEARCH": "Запуск поиска клиентов по городу и нише",
    "UNKNOWN": "Намерение не распознано",
}

SYSTEM_PROMPT = f"""Ты — ИИ-диспетчер Orbit CRM. Твоя задача — анализировать текст пользователя и классифицировать намерение (Intent).

Возможные намерения:
1. CREATE_PROJECT — пользователь хочет создать новый проект. Примеры: "Создай проект CRM для клиента", "Новый проект: редизайн сайта", "Заведи проект по автоматизации".
2. ADD_TASK — пользователь хочет добавить задачу в существующий проект. Примеры: "Добавь задачу в проект CRM: подготовить макеты", "Задача в проекте Редизайн: звонок клиенту", "Создай задачу позвонить Анне в проекте Сайт".
3. CALCULATE_ESTIMATE — пользователь хочет рассчитать смету для проекта. Примеры: "Рассчитай смету для проекта CRM", "Сделай оценку по проекту сайт: 50 часов разработки", "Посчитай стоимость проекта автоматизации". Ставка: $10/час + 15% буфер на риски.
4. RUN_LEAD_SEARCH — пользователь хочет запустить поиск потенциальных клиентов. Примеры: "Найди клиентов в Майами в сфере кровельных работ", "Поиск лидов: интерьерные дизайнеры в Дубае", "Запусти поиск клиентов в Берлине, ниша: фитнес".
5. UNKNOWN — намерение не распознано.

Извлеки сущности (entities):
- projectName: название проекта (для CREATE_PROJECT, ADD_TASK, CALCULATE_ESTIMATE)
- taskTitle: название задачи (для ADD_TASK)
- projectDescription: описание проекта (для CREATE_PROJECT, CALCULATE_ESTIMATE)
- hours: количество часов (для CALCULATE_ESTIMATE, опционально)
- city: город для поиска (для RUN_LEAD_SEARCH, например: "Miami, FL, USA")
- niche: сфера/ниша для поиска (для RUN_LEAD_SEARCH, например: "Roofing contractors")
- maxResults: максимальное количество лидов (для RUN_LEAD_SEARCH, опционально)

Верни результат ТОЛЬКО в формате JSON:
{{
  "type": "CREATE_PROJECT|ADD_TASK|CALCULATE_ESTIMATE|RUN_LEAD_SEARCH|UNKNOWN",
  "entities": {{
    "projectName": "...",
    "taskTitle": "...",
    "projectDescription": "...",
    "hours": 0,
    "city": "...",
    "niche": "...",
    "maxResults": 20
  }},
  "rawText": "...",
  "confidence": 0.95
}}"""


class AIDispatcher:
    def __init__(self):
        self.ollama_url = settings.OLLAMA_BASE_URL
        self.model = settings.OLLAMA_MODEL
        self._client: httpx.Optional[AsyncClient]= None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=60.0)
        return self._client

    async def close(self):
        if self._client:
            await self._client.aclose()
            self._client = None

    async def _call_llm(self, prompt: str, system_prompt: str = "") -> str:
        client = await self._get_client()
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        try:
            response = await client.post(
                f"{self.ollama_url}/chat/completions",
                json={
                    "model": self.model,
                    "messages": messages,
                    "max_tokens": 2048,
                    "temperature": 0.1,
                    "response_format": {"type": "json_object"},
                },
            )
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"]
        except httpx.HTTPStatusError as e:
            logger.error(f"Ollama API error: {e.response.status_code} - {e.response.text}")
            raise RuntimeError(f"Ollama API error: {e.response.status_code}")
        except Exception as e:
            logger.error(f"Failed to call Ollama: {e}")
            raise RuntimeError(f"Failed to call Ollama: {e}")

    def _parse_intent(self, response: str, raw_text: str) -> Intent:
        try:
            data = json.loads(response)
            intent_type = data.get("type", "UNKNOWN")
            entities = data.get("entities", {})
            confidence = float(data.get("confidence", 0.5))

            if intent_type not in INTENT_TYPES:
                intent_type = "UNKNOWN"

            return Intent(
                type=intent_type,
                entities=entities,
                raw_text=raw_text,
                confidence=confidence,
            )
        except (json.JSONDecodeError, KeyError, ValueError) as e:
            logger.warning(f"Failed to parse intent response: {e}, response: {response[:200]}")
            return Intent(
                type="UNKNOWN",
                entities={},
                raw_text=raw_text,
                confidence=0.0,
            )

    async def classify_intent(self, text: str, user_context: Optional[dict]= None) -> Intent:
        """Classify user intent from text using Llama 3.2 via Ollama."""
        context = ""
        if user_context:
            context = f"\n\nКонтекст пользователя: {json.dumps(user_context, ensure_ascii=False)}"

        response = await self._call_llm(text, SYSTEM_PROMPT + context)
        return self._parse_intent(response, text)

    async def generate_suggestions(self, intent: Intent) -> list[str]:
        """Generate action suggestions based on classified intent."""
        suggestions = []
        entities = intent.entities

        if intent.type == "CREATE_PROJECT":
                name = entities.get("projectName") or entities.get("projectDescription") or "Новый проект"
                suggestions.append(f"Создать проект «{name}»")
                suggestions.append("Добавить участников команды")
                suggestions.append("Настроить этапы и дедлайны")

            case "ADD_TASK":
                task = entities.get("taskTitle", "Без названия")
                project = entities.get("projectName", "не указан")
                suggestions.append(f"Добавить задачу «{task}» в проект «{project}»")
                suggestions.append("Установить приоритет: высокий")
                suggestions.append("Назначить ответственного")

            case "CALCULATE_ESTIMATE":
                project = entities.get("projectName") or entities.get("projectDescription") or "Проект"
                hours = entities.get("hours", 0)
                if hours:
                    base = hours * 10
                    buffer = base * 0.15
                    total = base + buffer
                    suggestions.append(f"Рассчитать смету для «{project}»: {hours}ч × $10 = ${base:.0f} + 15% (${buffer:.0f}) = ${total:.0f}")
                else:
                    suggestions.append(f"Рассчитать смету для «{project}» (требуется уточнить часы)")
                suggestions.append("Сгенерировать отчет по смету")
                suggestions.append("Сохранить в документы проекта")

            case "RUN_LEAD_SEARCH":
                city = entities.get("city", "не указан")
                niche = entities.get("niche", "не указана")
                max_r = entities.get("maxResults", 20)
                suggestions.append(f"Запустить поиск лидов: {city} | {niche} (макс. {max_r})")
                suggestions.append("AI-агент соберет контакты (телефон, email, сайт)")
                suggestions.append("Результаты появятся в таблице с кнопкой «Перенести в Клиенты»")

            case _:
                suggestions.append("Не удалось определить намерение. Попробуйте переформулировать.")

        return suggestions


ai_dispatcher = AIDispatcher()