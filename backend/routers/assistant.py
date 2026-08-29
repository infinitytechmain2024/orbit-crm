from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.services.ai_providers import ai_provider_registry

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/assistant", tags=["Assistant"])


class AssistantMessage(BaseModel):
    role: str
    content: str


class AssistantChatRequest(BaseModel):
    messages: list[AssistantMessage] = Field(default_factory=list)


class AssistantChatResponse(BaseModel):
    reply: str
    provider: str | None = None
    model: str | None = None


SYSTEM_PROMPT = (
    "Ты — ассистент Orbit CRM. Отвечай кратко, по делу и на русском языке, "
    "если пользователь не попросил иначе. Помогай с задачами, клиентами, проектами, "
    "аналитикой и следующими шагами. Если у тебя не хватает данных, задай уточняющий вопрос."
)


@router.post("/chat", response_model=AssistantChatResponse)
async def chat(request: AssistantChatRequest):
    if not request.messages:
        raise HTTPException(status_code=400, detail="Missing messages")

    provider_candidates = [
        ("openai", "gpt-4o-mini"),
        ("nvidia", "openai/gpt-oss-120b"),
        ("groq", "openai/gpt-oss-120b"),
        ("ollama", "openai/gpt-oss-120b"),
    ]

    payload = [{"role": m.role, "content": m.content} for m in request.messages]
    if not any(message["role"] == "system" for message in payload):
        payload = [{"role": "system", "content": SYSTEM_PROMPT}, *payload]

    last_error: Exception | None = None
    for provider_name, model_name in provider_candidates:
        provider = ai_provider_registry.get(provider_name)
        if not provider.configured:
            continue
        try:
            result = await provider.complete(model_name, payload, temperature=0.25, max_tokens=800)
            return AssistantChatResponse(reply=result.content, provider=result.provider, model=result.model)
        except Exception as exc:
            logger.warning("assistant chat failed via %s: %s", provider_name, exc)
            last_error = exc

    raise HTTPException(
        status_code=503,
        detail=f"No configured AI provider available: {last_error}" if last_error else "No configured AI provider available",
    )
