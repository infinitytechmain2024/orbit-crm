"""OpenClaw integration router for Orbit CRM.

Uses centralized config (OPENCLAW_URL, OPENCLAW_GATEWAY_TOKEN) and
the openclaw_client service for all Gateway communication.
"""

from __future__ import annotations

import logging
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
    prefix="/api/openclaw",
    tags=["OpenClaw"],
)

_bearer_scheme = HTTPBearer(auto_error=False)


async def _verify_webhook_token(
    credentials: HTTPAuthorizationCredentials | None = Security(_bearer_scheme),
) -> None:
    """Verify OpenClaw webhook authorization token."""
    expected = settings.OPENCLAW_WEBHOOK_TOKEN
    if not expected:
        return
    if not credentials or credentials.credentials != expected:
        raise HTTPException(status_code=401, detail="Invalid webhook token")


class OpenClawTaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=240)
    description: str = Field(default="", max_length=12000)
    organization_id: str | None = Field(default=None, max_length=36)


class OpenClawWebhookPayload(BaseModel):
    task_id: str
    status: str = "completed"
    result: Any = None
    error: str | None = None


@router.post("/tasks/create")
async def create_openclaw_task(task: OpenClawTaskCreate):
    """Create a task and send it to OpenClaw for processing."""
    result = supabase_service.client.table("openclaw_tasks").insert({
        "title": task.title,
        "description": task.description,
        "organization_id": task.organization_id,
        "status": "queued",
    }).execute()

    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create task in database")

    task_id = result.data[0]["id"]

    execution = await openclaw_client.execute_chat(
        task_id=str(task_id),
        message=task.description or task.title,
    )

    if not execution.success:
        error_msg = execution.error or "Unknown error"
        supabase_service.client.table("openclaw_tasks").update({
            "status": "error",
            "error": error_msg,
        }).eq("id", task_id).execute()
        raise HTTPException(status_code=503, detail=error_msg)

    supabase_service.client.table("openclaw_tasks").update({
        "status": "completed",
        "result": {
            "summary": execution.summary,
            "model": execution.model,
            "execution_time_ms": execution.execution_time_ms,
            "content": execution.result,
        },
    }).eq("id", task_id).execute()

    return {
        "task_id": task_id,
        "status": "completed",
        "result": execution.result,
        "model": execution.model,
        "execution_time_ms": execution.execution_time_ms,
    }


@router.get("/health")
async def openclaw_health():
    """Check OpenClaw gateway health status."""
    health = await openclaw_client.health()
    return {
        "status": health.status,
        "gateway": health.gateway,
        "version": health.version,
        "latency_ms": health.latency_ms,
        "error": health.error,
    }


@router.get("/tasks/status/{task_id}")
async def get_task_status(task_id: str):
    """Get the status and result of an OpenClaw task."""
    result = supabase_service.client.table("openclaw_tasks") \
        .select("*") \
        .eq("id", task_id) \
        .single()

    if not result.data:
        raise HTTPException(status_code=404, detail="Task not found")

    return result.data


@router.get("/tasks")
async def list_tasks(
    status: str | None = None,
    limit: int = 20,
):
    """List recent OpenClaw tasks."""
    query = supabase_service.client.table("openclaw_tasks").select("*")

    if status:
        query = query.eq("status", status)

    result = query.order("created_at", desc=True).limit(limit).execute()

    return {"tasks": result.data or [], "count": len(result.data or [])}


@router.get("/agents")
async def list_openclaw_agents():
    """List available OpenClaw agents/models."""
    agents = await openclaw_client.list_agents()
    return {"agents": agents}


@router.post("/webhook")
async def openclaw_webhook(
    request: Request,
    _auth: None = Depends(_verify_webhook_token),
):
    """Webhook endpoint for OpenClaw to send task results.

    Protected by OPENCLAW_WEBHOOK_TOKEN. Must be provided in
    Authorization: Bearer <token> header.
    """
    payload = await request.json()

    task_id = payload.get("task_id")
    if not task_id:
        raise HTTPException(status_code=400, detail="task_id is required")

    status = payload.get("status", "completed")
    result = payload.get("result")
    error = payload.get("error")

    update_data: dict[str, Any] = {
        "status": status,
        "updated_at": datetime.now().isoformat(),
    }

    if result is not None:
        update_data["result"] = result
    if error:
        update_data["error"] = error

    supabase_service.client.table("openclaw_tasks").update(
        update_data
    ).eq("id", task_id).execute()

    return {"status": "received"}
