"""Роутер мультиагентной системы «Виртуальная компания».

Принимает описание задачи от фронтенда, запускает
:class:`backend.company.orchestrator.CompanyOrchestrator` и возвращает
структурированные результаты работы каждого «отдела» корпорации.
"""

from typing import Dict, Any

from fastapi import APIRouter, Depends

from backend.company.orchestrator import (
    CompanyOrchestrator,
    CompanyTaskRequest,
    CompanyWorkflowResult,
)
# Переиспользуем существующий механизм проверки токена из agent_router.
from backend.routers.agent_router import verify_internal_token

router = APIRouter(prefix="/api/company", tags=["Company"])

# Оркестратор — синглтон на уровне процесса (провайдер тоже создаётся лениво).
_orchestrator = CompanyOrchestrator()


@router.post("/run-workflow", response_model=CompanyWorkflowResult)
async def run_company_workflow(
    payload: CompanyTaskRequest,
    token: str = Depends(verify_internal_token),
) -> Dict[str, Any]:
    """Прогнать задачу через CEO -> Developer -> Marketer.

    Требует валидный `Authorization: Bearer <INTERNAL_API_TOKEN>` заголовок.
    """
    result = _orchestrator.run_workflow(payload)
    # FastAPI сериализует Pydantic-модель; возвращаем как dict для гибкости.
    return result.model_dump()
