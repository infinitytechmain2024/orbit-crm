"""OpenClaw integration router for Orbit CRM.

Uses centralized config (OPENCLAW_URL, OPENCLAW_GATEWAY_TOKEN) and
the openclaw_client service for all Gateway communication.
"""

from __future__ import annotations

import logging
import hashlib
import json
from datetime import datetime, timezone
from secrets import compare_digest
from typing import Any, Literal, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from backend.config import settings
from backend.auth import WorkflowActor, require_workflow_actor, require_workflow_permission
from backend.services.openclaw_client import openclaw_client
from backend.services.supabase_client import supabase_service
from backend.services.ai_workflow_store import ai_workflow_store

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/openclaw",
    tags=["OpenClaw"],
)

_bearer_scheme = HTTPBearer(auto_error=False)


async def _verify_webhook_token(
    credentials: Optional[HTTPAuthorizationCredentials]= Security(_bearer_scheme),
) -> None:
    """Verify OpenClaw webhook authorization token.

    Fail closed in every environment so development cannot normalize an unsafe setup.
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


class OpenClawTaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=240)
    description: str = Field(default="", max_length=12000)
    organization_id: str = Field(min_length=36, max_length=36)
    entity_type: Optional[Literal["client", "lead", "deal", "task", "calendar_event"]] = None
    entity_id: Optional[str] = Field(default=None, min_length=36, max_length=36)
    idempotency_key: Optional[str] = Field(default=None, min_length=8, max_length=200)


class OpenClawAssistRequest(BaseModel):
    organization_id: str = Field(min_length=36, max_length=36)
    entity_type: Literal["client", "lead", "deal", "task", "calendar_event"]
    entity_id: str = Field(min_length=36, max_length=36)
    objective: Literal["draft_message", "next_action", "summarize_history", "plan_task", "qa_review"]
    instructions: str = Field(default="", max_length=4000)


async def _load_entity_context(
    organization_id: str, entity_type: str, entity_id: str, user_id: str
) -> dict[str, Any]:
    table_by_type = {
        "client": "lead_clients",
        "lead": "lead_clients",
        "deal": "deals",
        "task": "tasks",
        "calendar_event": "calendar_events",
    }
    columns_by_type = {
        "client": "id,business_name,category,city_location,status,priority,website_url",
        "lead": "id,business_name,category,city_location,status,priority,website_url",
        "deal": "id,title,stage,value,currency,expected_close_at,client_id,project_id",
        "task": "id,title,description,status,priority,due_date,project_id",
        "calendar_event": "id,title,client_name,starts_at,ends_at,status,client_id,deal_id,task_id",
    }
    entity = await ai_workflow_store.one(
        table_by_type[entity_type],
        organization_id=organization_id,
        row_id=entity_id,
        columns=columns_by_type[entity_type],
    )
    context: dict[str, Any] = {"entity_type": entity_type, "entity": entity}
    if entity_type == "task":
        context["checklist"] = await ai_workflow_store.select(
            "task_checklist_items",
            organization_id=organization_id,
            filters={"task_id": f"eq.{entity_id}"},
            columns="id,title,completed_at,sort_order",
            order="sort_order.asc",
            limit=100,
        )
        context["recent_comments"] = await ai_workflow_store.select(
            "task_comments",
            organization_id=organization_id,
            filters={"task_id": f"eq.{entity_id}"},
            columns="body,created_at",
            order="created_at.desc",
            limit=settings.OPENCLAW_MAX_CONTEXT_RECORDS,
        )
        # File contents and storage paths are deliberately excluded from AI context.
        context["file_catalog"] = await ai_workflow_store.select(
            "files",
            organization_id=organization_id,
            filters={"task_id": f"eq.{entity_id}"},
            columns="id,file_name,mime_type,size_bytes,created_at",
            order="created_at.desc",
            limit=50,
        )
    client_id = entity_id if entity_type in {"client", "lead"} else entity.get("client_id")
    if client_id:
        context["recent_interactions"] = await ai_workflow_store.select(
            "client_interactions",
            organization_id=organization_id,
            filters={"client_id": f"eq.{client_id}"},
            columns="interaction_type,direction,subject,content,occurred_at",
            order="occurred_at.desc",
            limit=settings.OPENCLAW_MAX_CONTEXT_RECORDS,
        )
        context["open_deals"] = await ai_workflow_store.select(
            "deals",
            organization_id=organization_id,
            filters={"client_id": f"eq.{client_id}", "stage": "not.in.(won,lost)"},
            columns="id,title,stage,value,currency,expected_close_at",
            order="updated_at.desc",
            limit=10,
        )
        context["recent_outcomes"] = await ai_workflow_store.select(
            "ai_outcomes",
            organization_id=organization_id,
            filters={"client_id": f"eq.{client_id}"},
            columns="action_type,outcome,score,evidence,created_at",
            order="created_at.desc",
            limit=settings.OPENCLAW_MAX_CONTEXT_RECORDS,
        )
    return context


class OpenClawWebhookPayload(BaseModel):
    task_id: str
    event_id: Optional[str] = Field(default=None, min_length=8, max_length=200)
    status: str = "completed"
    result: Any = None
    error: Optional[str]= None


@router.post("/tasks/create")
async def create_openclaw_task(
    task: OpenClawTaskCreate,
    request: Request,
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    """Create a task and send it to OpenClaw for processing."""
    await require_workflow_permission(task.organization_id, actor, "workflow.create")
    if bool(task.entity_type) != bool(task.entity_id):
        raise HTTPException(status_code=422, detail="entity_type and entity_id must be provided together")
    context = (
        await _load_entity_context(task.organization_id, task.entity_type, task.entity_id, actor.user_id)
        if task.entity_type and task.entity_id
        else {}
    )
    idempotency_key = task.idempotency_key or request.headers.get("idempotency-key") or str(uuid4())
    correlation_id = str(uuid4())
    payload = {
        "title": task.title,
        "description": task.description,
        "organization_id": task.organization_id,
        "created_by": actor.user_id,
        "entity_type": task.entity_type,
        "entity_id": task.entity_id,
        "status": "queued",
        "idempotency_key": idempotency_key,
        "correlation_id": correlation_id,
    }
    result = supabase_service.client.table("openclaw_tasks").upsert(
        payload,
        on_conflict="organization_id,idempotency_key",
        ignore_duplicates=True,
    ).execute()

    if not result.data:
        existing = supabase_service.client.table("openclaw_tasks").select("*").eq(
            "organization_id", task.organization_id
        ).eq("idempotency_key", idempotency_key).single().execute()
        if not existing.data:
            raise HTTPException(status_code=500, detail="Failed to resolve idempotent task")
        return {
            "task_id": existing.data["id"],
            "correlation_id": existing.data["correlation_id"],
            "status": existing.data["status"],
            "result": existing.data.get("result"),
            "idempotency_replayed": True,
        }

    task_id = result.data[0]["id"]
    correlation_id = result.data[0]["correlation_id"]
    supabase_service.client.table("openclaw_tasks").update({"status": "processing"}).eq(
        "id", task_id
    ).eq("organization_id", task.organization_id).execute()

    execution = await openclaw_client.execute_chat(
        task_id=str(task_id),
        message=task.description or task.title,
        agent_id="main",
        context=context,
    )

    if not execution.success:
        error_msg = execution.error or "Unknown error"
        supabase_service.client.table("openclaw_tasks").update({
            "status": "error",
            "error": error_msg,
        }).eq("id", task_id).execute()
        raise HTTPException(status_code=503, detail="OpenClaw is temporarily unavailable")

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
        "correlation_id": correlation_id,
        "status": "completed",
        "result": execution.result,
        "model": execution.model,
        "execution_time_ms": execution.execution_time_ms,
        "idempotency_replayed": False,
    }


@router.post("/assist")
async def assist_with_crm_entity(
    request: OpenClawAssistRequest,
    http_request: Request,
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    """Prepare a draft or recommendation. This endpoint never sends external messages."""
    await require_workflow_permission(request.organization_id, actor, "workflow.create")
    objectives_by_entity = {
        "client": {"draft_message", "next_action", "summarize_history"},
        "lead": {"draft_message", "next_action", "summarize_history"},
        # Deals remain disabled until their business model is approved.
        "deal": set(),
        "task": {"next_action", "summarize_history", "plan_task", "qa_review"},
        "calendar_event": {"next_action", "summarize_history"},
    }
    if request.objective not in objectives_by_entity[request.entity_type]:
        raise HTTPException(
            status_code=409,
            detail=f"Objective '{request.objective}' is not enabled for {request.entity_type}",
        )
    start_of_day = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    recent_actions = await ai_workflow_store.select(
        "ai_action_audit",
        organization_id=request.organization_id,
        filters={"user_id": f"eq.{actor.user_id}", "created_at": f"gte.{start_of_day}"},
        columns="id",
        limit=settings.OPENCLAW_DAILY_ACTION_LIMIT,
    )
    if len(recent_actions) >= settings.OPENCLAW_DAILY_ACTION_LIMIT:
        raise HTTPException(status_code=429, detail="Daily OpenClaw action limit reached")
    context = await _load_entity_context(
        request.organization_id, request.entity_type, request.entity_id, actor.user_id
    )
    prompts = {
        "draft_message": (
            "Prepare one concise message draft. Do not send it. Mark assumptions and personal data used."
        ),
        "next_action": (
            "Recommend the next three actions, with evidence, priority, risk, and whether human approval is required."
        ),
        "summarize_history": "Summarize the interaction history using only the supplied CRM facts.",
        "plan_task": (
            "Create a concise execution plan for this task. Use only supplied facts, identify blockers, "
            "and do not change the CRM record."
        ),
        "qa_review": (
            "Review the task, checklist, comments, and file metadata for completeness and risks. "
            "Do not claim to have read file contents and do not change the CRM record."
        ),
    }
    execution = await openclaw_client.execute_chat(
        task_id=f"assist:{request.entity_id}",
        message=f"{prompts[request.objective]}\nAdditional instructions: {request.instructions}",
        agent_id="main",
        context=context,
    )
    audit_status = "executed" if execution.success else "failed"
    supabase_service.client.table("ai_action_audit").insert({
        "organization_id": request.organization_id,
        "user_id": actor.user_id,
        "action": request.objective,
        "entity_type": request.entity_type,
        "entity_id": request.entity_id,
        "risk_level": "low",
        "status": audit_status,
        "input_summary": {"instructions_present": bool(request.instructions)},
        "output_summary": {"model": execution.model, "success": execution.success},
        "correlation_id": getattr(http_request.state, "correlation_id", str(uuid4())),
    }).execute()
    if not execution.success:
        logger.warning("OpenClaw assist failed for %s: %s", request.entity_type, execution.error)
        raise HTTPException(status_code=503, detail="OpenClaw is temporarily unavailable")
    return {
        "status": "draft",
        "objective": request.objective,
        "content": execution.result,
        "requires_human_confirmation": request.objective == "draft_message",
        "external_action_performed": False,
    }


@router.get("/health")
async def openclaw_health(_actor: WorkflowActor = Depends(require_workflow_actor)):
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
async def get_task_status(
    task_id: str,
    organization_id: str = Query(min_length=36, max_length=36),
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    """Get the status and result of an OpenClaw task."""
    await require_workflow_permission(organization_id, actor, "workflow.read")
    result = supabase_service.client.table("openclaw_tasks") \
        .select("*") \
        .eq("id", task_id) \
        .eq("organization_id", organization_id) \
        .single() \
        .execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Task not found")

    return result.data


@router.get("/tasks")
async def list_tasks(
    organization_id: str = Query(min_length=36, max_length=36),
    status: Optional[str]= None,
    limit: int = Query(default=20, ge=1, le=100),
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    """List recent OpenClaw tasks."""
    await require_workflow_permission(organization_id, actor, "workflow.read")
    query = supabase_service.client.table("openclaw_tasks").select("*").eq(
        "organization_id", organization_id
    )

    if status:
        query = query.eq("status", status)

    result = query.order("created_at", desc=True).limit(limit).execute()

    return {"tasks": result.data or [], "count": len(result.data or [])}


@router.get("/agents")
async def list_openclaw_agents(_actor: WorkflowActor = Depends(require_workflow_actor)):
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
    raw_payload = await request.json()
    payload = OpenClawWebhookPayload.model_validate(raw_payload)
    canonical_payload = json.dumps(raw_payload, sort_keys=True, separators=(",", ":"), default=str)
    payload_digest = hashlib.sha256(canonical_payload.encode()).hexdigest()
    idempotency_key = (
        request.headers.get("idempotency-key") or payload.event_id or payload_digest
    )
    rpc = supabase_service.client.rpc("apply_openclaw_task_webhook", {
        "p_task_id": payload.task_id,
        "p_idempotency_key": idempotency_key,
        "p_payload_digest": payload_digest,
        "p_status": payload.status,
        "p_result": payload.result,
        "p_error": payload.error,
    }).execute()
    if not rpc.data:
        raise HTTPException(status_code=404, detail="Task not found")
    outcome = rpc.data[0]
    return {
        "status": "duplicate" if outcome["duplicate"] else "received",
        "applied": outcome["applied"],
        "correlation_id": outcome["correlation_id"],
        "task_status": outcome["current_status"],
    }
