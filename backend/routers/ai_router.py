"""
AI Router API endpoints
Provides task routing and model selection
"""

import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from backend.services.ai_router import ai_router, TaskType

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ai-router", tags=["AI Router"])


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
async def mark_model_unavailable(model_id: str):
    """Mark a model as unavailable (e.g., rate limited)"""
    ai_router.mark_model_unavailable(model_id)
    return {"status": "ok", "model_id": model_id, "available": False}


@router.post("/models/{model_id}/available")
async def mark_model_available(model_id: str):
    """Mark a model as available"""
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