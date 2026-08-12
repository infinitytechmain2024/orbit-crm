"""Мультиагентная система «Виртуальная компания».

Оркестратор последовательно проводит задачу пользователя через три роли
(отдела) корпорации, каждая из которых работает на своей модели через
единый провайдер :class:`backend.ai_provider.NVIDIAUnifiedProvider`:

    CEO        -> стратегия и техническое задание (ТЗ)
    Developer  -> написание кода (с режимом мышления / reasoning)
    Marketer   -> оформление и презентация итогового результата

Все этапы изолированы: ошибка на одном из них не обрушивает весь пайплайн,
а возвращается в составе структурированного ответа.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from backend.ai_provider import NVIDIAUnifiedProvider

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Конфигурация моделей для каждой роли
# ---------------------------------------------------------------------------

CEO_MODEL = "meta/llama-3.3-70b-instruct"
DEVELOPER_MODEL = "google/gemma-4-31b-it"
MARKETER_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b"


# ---------------------------------------------------------------------------
# Pydantic-модели для типизированного ввода/вывода
# ---------------------------------------------------------------------------

class CompanyTaskRequest(BaseModel):
    """Входящая задача от фронтенда."""

    task: str = Field(..., min_length=1, description="Описание задачи пользователя")
    context: Optional[str] = Field(
        default=None,
        description="Опциональный дополнительный контекст/требования",
    )
    # Параметры генерации (опционально переопределяются извне)
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens: int = Field(default=4096, ge=1, le=8192)


class DepartmentResult(BaseModel):
    """Результат работы одного «отдела» (роли)."""

    role: str
    model: str
    success: bool
    output: Optional[str] = None
    reasoning: Optional[str] = None
    error: Optional[str] = None
    meta: Dict[str, Any] = Field(default_factory=dict)


class CompanyWorkflowResult(BaseModel):
    """Итоговый ответ оркестратора."""

    success: bool = Field(description="Успешно ли прошёл весь пайплайн целиком")
    task: str
    ceo: Optional[DepartmentResult] = None
    developer: Optional[DepartmentResult] = None
    marketer: Optional[DepartmentResult] = None
    final_answer: Optional[str] = Field(
        default=None, description="Собранный и оформленный итоговый результат"
    )
    errors: List[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Внутренние контракты промежуточных шагов
# ---------------------------------------------------------------------------

@dataclass
class _StepContext:
    """Промежуточное состояние, передаваемое между ролями."""

    original_task: str
    context: Optional[str] = None
    ceo_spec: Optional[str] = None
    developer_code: Optional[str] = None
    developer_reasoning: Optional[str] = None
    errors: List[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Оркестратор
# ---------------------------------------------------------------------------

class CompanyOrchestrator:
    """Последовательный оркестратор виртуальной компании.

    Порядок работы:
        1. CEO        — формирует стратегию и ТЗ на базе задачи.
        2. Developer  — реализует ТЗ в виде кода, возвращает мысли (reasoning).
        3. Marketer   — упаковывает результат в презентабельный ответ.
    """

    def __init__(self, provider: Optional[NVIDIAUnifiedProvider] = None):
        self.provider = provider or NVIDIAUnifiedProvider()

    # ------------------------------------------------------------------
    # Публичный API
    # ------------------------------------------------------------------

    def run_workflow(self, request: CompanyTaskRequest) -> CompanyWorkflowResult:
        """Запустить полный пайплайн компании и вернуть структурированный результат."""
        state = _StepContext(
            original_task=request.task,
            context=request.context,
        )

        ceo_result = self._run_ceo(state, request)
        state.ceo_spec = ceo_result.output if ceo_result.success else None

        developer_result = self._run_developer(state, request)
        state.developer_code = developer_result.output if developer_result.success else None
        state.developer_reasoning = developer_result.reasoning

        marketer_result = self._run_marketer(state, request)

        final_answer = self._assemble_final_answer(state, marketer_result)

        overall_success = all(
            r is None or r.success
            for r in (ceo_result, developer_result, marketer_result)
        )

        return CompanyWorkflowResult(
            success=overall_success,
            task=request.task,
            ceo=ceo_result,
            developer=developer_result,
            marketer=marketer_result,
            final_answer=final_answer,
            errors=state.errors,
        )

    # ------------------------------------------------------------------
    # Этап 1 — CEO (стратегия и ТЗ)
    # ------------------------------------------------------------------

    def _run_ceo(self, state: _StepContext, request: CompanyTaskRequest) -> DepartmentResult:
        system_prompt = (
            "Ты — CEO виртуальной IT-компании. Твоя задача — превратить запрос "
            "пользователя в чёткую стратегию и структурированное техническое "
            "задание (ТЗ) для команды разработки. Опиши цели, требования, "
            "функциональность, ограничения и критерии успеха. Отвечай на русском "
            "языке, по возможности используй маркированные списки."
        )

        user_prompt = self._build_user_prompt(state.original_task, state.context)
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        return self._call_role(
            role="CEO",
            model=CEO_MODEL,
            messages=messages,
            temperature=request.temperature,
            max_tokens=request.max_tokens,
            state=state,
        )

    # ------------------------------------------------------------------
    # Этап 2 — Developer (код + reasoning)
    # ------------------------------------------------------------------

    def _run_developer(self, state: _StepContext, request: CompanyTaskRequest) -> DepartmentResult:
        system_prompt = (
            "Ты — ведущий разработчик виртуальной компании. На основе "
            "предоставленного технического задания (ТЗ) напиши готовый, "
            "рабочий и хорошо структурированный код, который решает поставленную "
            "задачу. Используй лучшие практики, добавляй комментарии там, где это "
            "уместно. Включи режим мышления (reasoning), чтобы проанализировать "
            "задачу перед написанием кода."
        )

        ceo_spec = state.ceo_spec or "(ТЗ не сформировано из-за ошибки на этапе CEO)"
        user_prompt = (
            f"Исходная задача пользователя:\n{state.original_task}\n\n"
            f"Техническое задание от CEO:\n{ceo_spec}\n\n"
            "Реализуй решение в виде кода и кратко опиши, что и как работает."
        )
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        # Модель gemma через NVIDIAUnifiedProvider автоматически получает
        # enable_thinking=True (см. ai_provider.chat_completion), поэтому
        # reasoning-контент будет доступен в ответе.
        result = self._call_role(
            role="Developer",
            model=DEVELOPER_MODEL,
            messages=messages,
            temperature=request.temperature,
            max_tokens=request.max_tokens,
            state=state,
        )
        return result

    # ------------------------------------------------------------------
    # Этап 3 — Marketer (оформление и презентация)
    # ------------------------------------------------------------------

    def _run_marketer(self, state: _StepContext, request: CompanyTaskRequest) -> DepartmentResult:
        system_prompt = (
            "Ты — маркетолог виртуальной компании. Твоя задача — взять "
            "техническое решение и код, подготовленные командой, и упаковать их "
            "в понятный, привлекательный и структурированный результат для "
            "клиента/пользователя. Сделай акцент на ценности, ключевых "
            "особенностях и готовности к использованию. Отвечай на русском языке."
        )

        ceo_spec = state.ceo_spec or "(нет)"
        developer_code = state.developer_code or "(код не получен из-за ошибки)"
        developer_reasoning = state.developer_reasoning or "(мышление недоступно)"

        user_prompt = (
            f"Исходная задача:\n{state.original_task}\n\n"
            f"ТЗ от CEO:\n{ceo_spec}\n\n"
            f"Код/решение от разработчика:\n{developer_code}\n\n"
            f"Мысли разработчика (reasoning):\n{developer_reasoning}\n\n"
            "Подготовь итоговую презентацию результата для пользователя."
        )
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        return self._call_role(
            role="Marketer",
            model=MARKETER_MODEL,
            messages=messages,
            temperature=request.temperature,
            max_tokens=request.max_tokens,
            state=state,
        )

    # ------------------------------------------------------------------
    # Общий вызов роли через провайдер
    # ------------------------------------------------------------------

    def _call_role(
        self,
        *,
        role: str,
        model: str,
        messages: List[Dict[str, str]],
        temperature: float,
        max_tokens: int,
        state: _StepContext,
    ) -> DepartmentResult:
        try:
            raw = self.provider.chat_completion(
                model_name=model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
            )
        except Exception as exc:  # неожиданный сбой на уровне провайдера
            logger.exception("Роль '%s' завершилась исключением", role)
            error_msg = f"Unexpected error in {role}: {exc}"
            state.errors.append(error_msg)
            return DepartmentResult(
                role=role, model=model, success=False, error=error_msg
            )

        if not raw.get("success"):
            error_msg = raw.get("error", "Unknown provider error")
            logger.error("Роль '%s' вернула ошибку провайдера: %s", role, error_msg)
            state.errors.append(f"{role}: {error_msg}")
            return DepartmentResult(
                role=role, model=model, success=False, error=error_msg
            )

        return DepartmentResult(
            role=role,
            model=model,
            success=True,
            output=raw.get("content"),
            reasoning=raw.get("reasoning"),
            meta={"model": raw.get("model", model)},
        )

    # ------------------------------------------------------------------
    # Сборка итогового ответа
    # ------------------------------------------------------------------

    def _assemble_final_answer(
        self, state: _StepContext, marketer_result: DepartmentResult
    ) -> Optional[str]:
        if marketer_result.success and marketer_result.output:
            return marketer_result.output

        # Запасной вариант сборки, если маркетолог не отработал
        parts: List[str] = []
        if state.ceo_spec:
            parts.append("## Стратегия и ТЗ (CEO)\n" + state.ceo_spec)
        if state.developer_code:
            parts.append("## Реализация (Developer)\n" + state.developer_code)
        if not parts:
            return None
        return "\n\n".join(parts)

    # ------------------------------------------------------------------
    # Утилиты
    # ------------------------------------------------------------------

    @staticmethod
    def _build_user_prompt(task: str, context: Optional[str]) -> str:
        prompt = f"Задача пользователя:\n{task}"
        if context:
            prompt += f"\n\nДополнительный контекст:\n{context}"
        return prompt
