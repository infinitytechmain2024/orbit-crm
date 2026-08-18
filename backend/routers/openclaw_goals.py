"""OpenClaw Goals router for Self-Development.

Uses centralized config and openclaw_client service.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from backend.config import settings
from backend.services.openclaw_client import openclaw_client
from backend.services.supabase_client import supabase_service

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/openclaw/goals",
    tags=["OpenClaw Goals"],
)

_bearer_scheme = HTTPBearer(auto_error=False)


async def _verify_webhook_token(
    credentials: HTTPAuthorizationCredentials | None = Security(_bearer_scheme),
) -> None:
    """Verify OpenClaw webhook authorization token.

    Production: fail closed if OPENCLAW_WEBHOOK_TOKEN not configured.
    Development: warn but allow unauthenticated requests.
    """
    expected = settings.OPENCLAW_WEBHOOK_TOKEN
    is_production = not settings.DEBUG and os.environ.get("RENDER")

    if not expected:
        if is_production:
            logger.error(
                "OPENCLAW_WEBHOOK_TOKEN not configured in production. "
                "Webhook requests will be rejected. Set OPENCLAW_WEBHOOK_TOKEN."
            )
            raise HTTPException(
                status_code=500,
                detail="Webhook authentication not configured. Contact administrator.",
            )
        logger.warning(
            "OPENCLAW_WEBHOOK_TOKEN not configured. "
            "Webhook is unprotected. Set OPENCLAW_WEBHOOK_TOKEN for production."
        )
        return

    if not credentials or credentials.credentials != expected:
        raise HTTPException(status_code=401, detail="Invalid webhook token")


class GoalCreate(BaseModel):
    label: str = Field(min_length=1, max_length=240)
    description: str = Field(default="", max_length=12000)
    acceptance_criteria: list[str] = Field(default_factory=list)
    priority: str = Field(default="normal", pattern="^(low|normal|high|critical)$")
    organization_id: str | None = Field(default=None, max_length=36)


class GoalUpdate(BaseModel):
    status: str | None = Field(default=None, pattern="^(active|paused|completed|error|cancelled)$")
    label: str | None = Field(default=None, min_length=1, max_length=240)
    description: str | None = Field(default=None, max_length=12000)
    priority: str | None = Field(default=None, pattern="^(low|normal|high|critical)$")


class ImprovementApprove(BaseModel):
    improvement_id: str


@router.post("/create")
async def create_goal(goal: GoalCreate):
    """Create a self-development goal and register it with OpenClaw."""
    # 1. Save to database
    result = supabase_service.client.table("openclaw_goals").insert({
        "label": goal.label,
        "description": goal.description,
        "acceptance_criteria": goal.acceptance_criteria,
        "organization_id": goal.organization_id,
        "priority": goal.priority,
        "status": "active",
    }).execute()

    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create goal in database")

    goal_id = result.data[0]["id"]

    # 2. Register with OpenClaw via centralized client
    execution = await openclaw_client.execute_chat(
        task_id=str(goal_id),
        message=f"Register self-development goal: {goal.label}",
        system_prompt=(
            "You are registering a self-development goal. "
            "Scan the codebase and suggest improvements."
        ),
        context={
            "label": goal.label,
            "description": goal.description,
            "criteria": goal.acceptance_criteria,
        },
    )

    if not execution.success:
        logger.warning("OpenClaw goal registration returned: %s", execution.error)

    return {"goal_id": goal_id, "status": "active"}


@router.get("/list")
async def list_goals(
    status: str | None = None,
    limit: int = 20,
):
    """List self-development goals."""
    query = supabase_service.client.table("openclaw_goals").select("*")

    if status:
        query = query.eq("status", status)

    result = query.order("created_at", desc=True).limit(limit).execute()

    return {"goals": result.data or [], "count": len(result.data or [])}


@router.get("/status/{goal_id}")
async def get_goal_status(goal_id: str):
    """Get the status of a self-development goal."""
    result = supabase_service.client.table("openclaw_goals") \
        .select("*") \
        .eq("id", goal_id) \
        .single()

    if not result.data:
        raise HTTPException(status_code=404, detail="Goal not found")

    return result.data


@router.patch("/update/{goal_id}")
async def update_goal(goal_id: str, update: GoalUpdate):
    """Update a self-development goal."""
    update_data: dict[str, Any] = {"updated_at": datetime.now().isoformat()}

    if update.status is not None:
        update_data["status"] = update.status
        if update.status == "completed":
            update_data["completed_at"] = datetime.now().isoformat()
    if update.label is not None:
        update_data["label"] = update.label
    if update.description is not None:
        update_data["description"] = update.description
    if update.priority is not None:
        update_data["priority"] = update.priority

    supabase_service.client.table("openclaw_goals").update(
        update_data
    ).eq("id", goal_id).execute()

    return {"status": "updated"}


@router.get("/improvements/list")
async def list_improvements(
    goal_id: str | None = None,
    status: str | None = None,
    limit: int = 50,
):
    """List improvement suggestions."""
    query = supabase_service.client.table("openclaw_improvements").select("*")

    if goal_id:
        query = query.eq("goal_id", goal_id)
    if status:
        query = query.eq("status", status)

    result = query.order("created_at", desc=True).limit(limit).execute()

    return {"improvements": result.data or [], "count": len(result.data or [])}


@router.post("/improvements/approve")
async def approve_improvement(improvement: ImprovementApprove):
    """Approve an improvement for application."""
    result = supabase_service.client.table("openclaw_improvements") \
        .select("*") \
        .eq("id", improvement.improvement_id) \
        .single()

    if not result.data:
        raise HTTPException(status_code=404, detail="Improvement not found")

    supabase_service.client.table("openclaw_improvements").update({
        "status": "approved",
    }).eq("id", improvement.improvement_id).execute()

    improvement_data = result.data
    execution = await openclaw_client.execute_chat(
        task_id=improvement.improvement_id,
        message=f"Apply improvement: {improvement_data.get('suggestion', '')}",
        system_prompt="Apply the approved code improvement.",
        context={
            "goal_id": improvement_data.get("goal_id"),
            "file_path": improvement_data.get("file_path"),
            "code_before": improvement_data.get("code_before"),
            "code_after": improvement_data.get("code_after"),
        },
    )

    if not execution.success:
        logger.warning("OpenClaw improvement dispatch returned: %s", execution.error)

    return {"status": "approved"}


@router.get("/analyses/list")
async def list_analyses(
    goal_id: str | None = None,
    limit: int = 20,
):
    """List analyses for goals."""
    query = supabase_service.client.table("openclaw_analyses").select("*")

    if goal_id:
        query = query.eq("goal_id", goal_id)

    result = query.order("created_at", desc=True).limit(limit).execute()

    return {"analyses": result.data or [], "count": len(result.data or [])}


@router.post("/webhook")
async def openclaw_goal_webhook(
    request: Request,
    _auth: None = Depends(_verify_webhook_token),
):
    """Webhook endpoint for OpenClaw to send goal progress and suggestions.

    Protected by OPENCLAW_WEBHOOK_TOKEN.
    """
    payload = await request.json()

    action = payload.get("action")
    goal_id = payload.get("goal_id")
    data = payload.get("data", {})

    if not goal_id:
        raise HTTPException(status_code=400, detail="goal_id is required")

    if action == "improvement_suggestion":
        supabase_service.client.table("openclaw_improvements").insert({
            "goal_id": goal_id,
            "suggestion": data.get("suggestion", ""),
            "impact": data.get("impact"),
            "file_path": data.get("file_path"),
            "code_before": data.get("code_before"),
            "code_after": data.get("code_after"),
            "status": "pending_review",
        }).execute()

    elif action == "goal_progress":
        supabase_service.client.table("openclaw_goals").update({
            "progress": data.get("progress", {}),
            "updated_at": datetime.now().isoformat(),
        }).eq("id", goal_id).execute()

    elif action == "goal_completed":
        supabase_service.client.table("openclaw_goals").update({
            "status": "completed",
            "completed_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
        }).eq("id", goal_id).execute()

    elif action == "analysis_result":
        supabase_service.client.table("openclaw_analyses").insert({
            "goal_id": goal_id,
            "analysis_type": data.get("analysis_type"),
            "content": data.get("content"),
            "findings": data.get("findings", []),
        }).execute()

    return {"status": "received"}
