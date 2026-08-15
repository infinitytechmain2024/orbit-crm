"""OpenClaw integration router for Orbit CRM."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
import httpx

from backend.config import settings
from backend.services.supabase_client import supabase_service

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/openclaw",
    tags=["OpenClaw"],
)

OPENCLAW_URL = "http://localhost:18789"
OPENCLAW_TOKEN = settings.INTERNAL_API_TOKEN


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
    # 1. Save to database
    result = supabase_service.client.table("openclaw_tasks").insert({
        "title": task.title,
        "description": task.description,
        "organization_id": task.organization_id,
        "status": "queued",
    }).execute()

    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create task in database")

    task_id = result.data[0]["id"]

    # 2. Send to OpenClaw
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{OPENCLAW_URL}/api/command",
                json={
                    "command": task.description or task.title,
                    "context": {"task_id": str(task_id)},
                },
                headers={"Authorization": f"Bearer {OPENCLAW_TOKEN}"},
            )
            response.raise_for_status()
    except httpx.ConnectError:
        supabase_service.client.table("openclaw_tasks").update({
            "status": "error",
            "error": "OpenClaw gateway is not running",
        }).eq("id", task_id).execute()
        raise HTTPException(status_code=503, detail="OpenClaw gateway is not running")
    except httpx.HTTPStatusError as e:
        supabase_service.client.table("openclaw_tasks").update({
            "status": "error",
            "error": f"OpenClaw returned {e.response.status_code}",
        }).eq("id", task_id).execute()
        raise HTTPException(status_code=502, detail=f"OpenClaw error: {e.response.status_code}")
    except Exception as e:
        supabase_service.client.table("openclaw_tasks").update({
            "status": "error",
            "error": str(e),
        }).eq("id", task_id).execute()
        raise HTTPException(status_code=500, detail=f"Failed to send to OpenClaw: {str(e)}")

    # 3. Update status to processing
    supabase_service.client.table("openclaw_tasks").update({
        "status": "processing",
    }).eq("id", task_id).execute()

    return {"task_id": task_id, "status": "processing"}


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


@router.post("/webhook")
async def openclaw_webhook(request: Request):
    """Webhook endpoint for OpenClaw to send task results."""
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

    update_result = supabase_service.client.table("openclaw_tasks").update(
        update_data
    ).eq("id", task_id).execute()

    return {"status": "received"}
