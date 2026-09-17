from __future__ import annotations

"""
AI Router API endpoints
Provides task routing, model selection, and NVIDIA model registry
"""

import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from backend.auth import WorkflowActor, require_workflow_actor, require_workflow_permission
from backend.services.ai_router import ai_router, TaskType
from backend.services.nvidia_model_registry import nvidia_model_registry

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/ai-router",
    tags=["AI Router"],
    dependencies=[Depends(require_workflow_actor)],
)


class RouteTaskRequest(BaseModel):
    title: str
    description: str = ""
    prefer_cost_efficient: bool = True


class RouteTaskResponse(BaseModel):
    model_id: Optional[str]
    task_type: str
    provider: Optional[str]
    cost_tier: Optional[int]
    max_tokens: Optional[int]
    error: Optional[str] = None


class ModelInfo(BaseModel):
    model_id: str
    provider: str
    strengths: list[str]
    cost_tier: int
    available: bool


@router.post("/route", response_model=RouteTaskResponse)
async def route_task(request: RouteTaskRequest):
    """
    Route a task to the optimal AI model.
    
    Analyzes task title and description to classify the task type,
    then selects the most appropriate model based on capabilities
    and cost efficiency preferences.
    """
    result = await ai_router.route_task(
        title=request.title,
        description=request.description,
        prefer_cost_efficient=request.prefer_cost_efficient,
    )
    
    return RouteTaskResponse(**result)


@router.get("/models", response_model=list[ModelInfo])
async def get_available_models():
    """
    Get list of available AI models and their capabilities.
    """
    return ai_router.get_available_models()


@router.post("/models/{model_id}/unavailable")
async def mark_model_unavailable(
    model_id: str,
    organization_id: str = Query(...),
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    """Mark a model as unavailable (e.g., rate limited)"""
    # Availability is global to this process, so only organization owners/admins may change it.
    await require_workflow_permission(organization_id, actor, "ai_router.manage")
    ai_router.mark_model_unavailable(model_id)
    return {"status": "ok", "model_id": model_id, "available": False}


@router.post("/models/{model_id}/available")
async def mark_model_available(
    model_id: str,
    organization_id: str = Query(...),
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    """Mark a model as available"""
    await require_workflow_permission(organization_id, actor, "ai_router.manage")
    ai_router.mark_model_available(model_id)
    return {"status": "ok", "model_id": model_id, "available": True}


@router.get("/classify")
async def classify_task_type(title: str, description: str = ""):
    """
    Classify a task type without routing.
    Useful for debugging task classification.
    """
    task_type = ai_router.classify_task_type(title, description)
    return {"task_type": task_type.value}


# ---------------------------------------------------------------------------
# NVIDIA Model Registry endpoints
# ---------------------------------------------------------------------------


class NVIDIAModelInfo(BaseModel):
    display_name: str
    model_id: str
    type: str
    endpoint: str
    adapter: str
    stream: bool
    reasoning: bool
    status: str
    deprecated_date: Optional[str] = None
    declared_limit: str
    priority: int


@router.get("/nvidia/models", response_model=list[NVIDIAModelInfo])
async def list_nvidia_models(
    model_type: Optional[str] = None,
    active_only: bool = True,
):
    """List all NVIDIA models from the registry."""
    from backend.services.nvidia_model_registry import ModelType

    type_filter = None
    if model_type:
        try:
            type_filter = ModelType(model_type)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid model_type: {model_type}. "
                f"Valid: {[t.value for t in ModelType]}",
            )

    if active_only and not type_filter:
        models = nvidia_model_registry.list_active()
    elif type_filter:
        models = nvidia_model_registry.list_by_type(type_filter)
    else:
        from backend.services.nvidia_model_registry import NVIDIA_MODELS

        models = NVIDIA_MODELS

    return [NVIDIAModelInfo(**m.__dict__) for m in models]


@router.get("/nvidia/models/{display_name}", response_model=NVIDIAModelInfo)
async def get_nvidia_model(display_name: str):
    """Get a specific NVIDIA model by display name."""
    model = nvidia_model_registry.get(display_name)
    if not model:
        raise HTTPException(status_code=404, detail=f"Model not found: {display_name}")
    return NVIDIAModelInfo(**model.__dict__)


@router.get("/nvidia/models/{display_name}/source-parameters")
async def get_nvidia_model_source_params(display_name: str):
    """Get the exact source parameters for a model (read-only, sacred)."""
    model = nvidia_model_registry.get(display_name)
    if not model:
        raise HTTPException(status_code=404, detail=f"Model not found: {display_name}")
    return {
        "display_name": model.display_name,
        "model_id": model.model_id,
        "source_parameters": model.source_parameters,
    }