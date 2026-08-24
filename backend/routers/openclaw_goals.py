"""OpenClaw Goals router for Self-Development.

Uses centralized config and openclaw_client service.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from secrets import compare_digest
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from backend.config import settings
from backend.auth import WorkflowActor, require_workflow_actor, require_workflow_permission
from backend.services.openclaw_client import openclaw_client
from backend.services.supabase_client import supabase_service

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/openclaw/goals",
    tags=["OpenClaw Goals"],
)

_bearer_scheme = HTTPBearer(auto_error=False)


async def _verify_webhook_token(
    credentials: Optional[HTTPAuthorizationCredentials]= Security(_bearer_scheme),
) -> None:
    """Verify OpenClaw webhook authorization token.

    Fail closed in every environment.
    """
    expected = settings.OPENCLAW_WEBHOOK_TOKEN
    if not expected:
        logger.error("OPENCLAW_WEBHOOK_TOKEN is not configured; rejecting webhook")
        raise HTTPException(
            status_code=503,
            detail="Webhook authentication is not configured.",
        )

    if not credentials or not compare_digest(credentials.credentials, expected):
        raise HTTPException(status_code=401, detail="Invalid webhook token")


class GoalCreate(BaseModel):
    label: str = Field(min_length=1, max_length=240)
    description: str = Field(default="", max_length=12000)
    acceptance_criteria: list[str] = Field(default_factory=list)
    priority: str = Field(default="normal", pattern="^(low|normal|high|critical)$")
    organization_id: str = Field(min_length=36, max_length=36)


class GoalUpdate(BaseModel):
    status: Optional[str]= Field(default=None, pattern="^(active|paused|completed|error|cancelled)$")
    label: Optional[str]= Field(default=None, min_length=1, max_length=240)
    description: Optional[str]= Field(default=None, max_length=12000)
    priority: Optional[str]= Field(default=None, pattern="^(low|normal|high|critical)$")


class ImprovementApprove(BaseModel):
    improvement_id: str


@router.post("/create")
async def create_goal(
    goal: GoalCreate,
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    """Create a self-development goal and register it with OpenClaw."""
    await require_workflow_permission(goal.organization_id, actor, "workflow.create")
    # 1. Save to database
    result = supabase_service.client.table("openclaw_goals").insert({
        "label": goal.label,
        "description": goal.description,
        "acceptance_criteria": goal.acceptance_criteria,
        "organization_id": goal.organization_id,
        "created_by": actor.user_id,
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
    organization_id: str = Query(min_length=36, max_length=36),
    status: Optional[str]= None,
    limit: int = Query(default=20, ge=1, le=100),
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    """List self-development goals."""
    await require_workflow_permission(organization_id, actor, "workflow.read")
    query = supabase_service.client.table("openclaw_goals").select("*").eq(
        "organization_id", organization_id
    )

    if status:
        query = query.eq("status", status)

    result = query.order("created_at", desc=True).limit(limit).execute()

    return {"goals": result.data or [], "count": len(result.data or [])}


@router.get("/status/{goal_id}")
async def get_goal_status(
    goal_id: str,
    organization_id: str = Query(min_length=36, max_length=36),
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    """Get the status of a self-development goal."""
    await require_workflow_permission(organization_id, actor, "workflow.read")
    result = supabase_service.client.table("openclaw_goals") \
        .select("*") \
        .eq("id", goal_id) \
        .eq("organization_id", organization_id) \
        .single() \
        .execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Goal not found")

    return result.data


@router.patch("/update/{goal_id}")
async def update_goal(
    goal_id: str,
    update: GoalUpdate,
    organization_id: str = Query(min_length=36, max_length=36),
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    """Update a self-development goal."""
    await require_workflow_permission(organization_id, actor, "workflow.control")
    update_data: dict[str, Any] = {"updated_at": datetime.now(UTC).isoformat()}

    if update.status is not None:
        update_data["status"] = update.status
        if update.status == "completed":
            update_data["completed_at"] = datetime.now(UTC).isoformat()
    if update.label is not None:
        update_data["label"] = update.label
    if update.description is not None:
        update_data["description"] = update.description
    if update.priority is not None:
        update_data["priority"] = update.priority

    supabase_service.client.table("openclaw_goals").update(
        update_data
    ).eq("id", goal_id).eq("organization_id", organization_id).execute()

    return {"status": "updated"}


@router.get("/improvements/list")
async def list_improvements(
    organization_id: str = Query(min_length=36, max_length=36),
    goal_id: Optional[str]= None,
    status: Optional[str]= None,
    limit: int = Query(default=50, ge=1, le=100),
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    """List improvement suggestions."""
    await require_workflow_permission(organization_id, actor, "workflow.read")
    query = supabase_service.client.table("openclaw_improvements").select(
        "*, openclaw_goals!inner(organization_id)"
    ).eq("openclaw_goals.organization_id", organization_id)

    if goal_id:
        query = query.eq("goal_id", goal_id)
    if status:
        query = query.eq("status", status)

    result = query.order("created_at", desc=True).limit(limit).execute()

    return {"improvements": result.data or [], "count": len(result.data or [])}


@router.post("/improvements/approve")
async def approve_improvement(
    improvement: ImprovementApprove,
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    """Approve an improvement for application."""
    result = supabase_service.client.table("openclaw_improvements") \
        .select("*") \
        .eq("id", improvement.improvement_id) \
        .single() \
        .execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Improvement not found")

    goal = supabase_service.client.table("openclaw_goals").select("organization_id").eq(
        "id", result.data["goal_id"]
    ).single().execute()
    if not goal.data:
        raise HTTPException(status_code=404, detail="Goal not found")
    await require_workflow_permission(goal.data["organization_id"], actor, "workflow.control")

    supabase_service.client.table("openclaw_improvements").update({
        "status": "approved",
        "approved_by": actor.user_id,
        "approved_at": datetime.now(UTC).isoformat(),
    }).eq("id", improvement.improvement_id).execute()

    # Approval records the human decision only. Production code and configuration
    # are never modified by the agent from this endpoint.
    return {"status": "approved", "automatic_code_change": False}


@router.get("/analyses/list")
async def list_analyses(
    organization_id: str = Query(min_length=36, max_length=36),
    goal_id: Optional[str]= None,
    limit: int = Query(default=20, ge=1, le=100),
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    """List analyses for goals."""
    await require_workflow_permission(organization_id, actor, "workflow.read")
    query = supabase_service.client.table("openclaw_analyses").select(
        "*, openclaw_goals!inner(organization_id)"
    ).eq("openclaw_goals.organization_id", organization_id)

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
            "updated_at": datetime.now(UTC).isoformat(),
        }).eq("id", goal_id).execute()

    elif action == "goal_completed":
        supabase_service.client.table("openclaw_goals").update({
            "status": "completed",
            "completed_at": datetime.now(UTC).isoformat(),
            "updated_at": datetime.now(UTC).isoformat(),
        }).eq("id", goal_id).execute()

    elif action == "analysis_result":
        supabase_service.client.table("openclaw_analyses").insert({
            "goal_id": goal_id,
            "analysis_type": data.get("analysis_type"),
            "content": data.get("content"),
            "findings": data.get("findings", []),
        }).execute()

    return {"status": "received"}
