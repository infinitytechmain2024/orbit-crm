from __future__ import annotations

"""Authenticated API surface for Orbit CRM AI Workflow."""


import asyncio
import io
import logging
import os
from datetime import datetime
from typing import Optional, Any, Dict, List, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field, field_validator

from backend.auth import WorkflowActor, require_workflow_actor, require_workflow_permission
from backend.config import settings
from backend.services.ai_providers import redact_error
from backend.services.ai_workflow_store import ai_workflow_store
from backend.services.orbit_commander import orbit_commander
from backend.services.stt import stt_service
from backend.services.nvidia_model_registry import nvidia_model_registry

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/ai-workflow",
    tags=["AI Workflow"],
)

TaskStatus = Literal[
    "planning",
    "queued",
    "in_progress",
    "paused",
    "review",
    "approval_required",
    "done",
    "blocked",
    "revisions_requested",
    "cancelled",
]
TaskPriority = Literal["low", "medium", "high", "critical"]


class TaskCreateRequest(BaseModel):
    organization_id: str = Field(min_length=36, max_length=36)
    project_id: Optional[str]= Field(default=None, min_length=36, max_length=36)
    title: str = Field(min_length=1, max_length=240)
    original_request: Optional[str]= Field(default=None, max_length=12000)
    description: str = Field(default="", max_length=12000)
    source: Literal["text", "voice", "manual", "project", "note", "client", "api"] = "text"
    source_entity_type: Optional[str]= Field(default=None, max_length=80)
    source_entity_id: Optional[str]= Field(default=None, min_length=36, max_length=36)
    priority: TaskPriority = "medium"
    due_at: Optional[datetime]= None
    attachments: list[str] = Field(default_factory=list, max_length=12)
    links: list[str] = Field(default_factory=list, max_length=12)
    department_id: Optional[str]= Field(default=None, min_length=36, max_length=36)
    agent_id: Optional[str]= Field(default=None, min_length=36, max_length=36)
    auto_assign: bool = True
    requires_approval: Optional[bool]= None
    related_entities: list[dict[str, str]] = Field(default_factory=list, max_length=30)

    @field_validator("title", "description")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("attachments", "links")
    @classmethod
    def clean_references(cls, values: list[str]) -> list[str]:
        return [value.strip()[:2000] for value in values if value.strip()]


class TaskPatchRequest(BaseModel):
    organization_id: str = Field(min_length=36, max_length=36)
    title: Optional[str]= Field(default=None, min_length=1, max_length=240)
    description: Optional[str]= Field(default=None, max_length=12000)
    status: Optional[TaskStatus]= None
    priority: Optional[TaskPriority]= None
    due_at: Optional[datetime]= None
    clear_due_at: bool = False
    department_id: Optional[str]= Field(default=None, min_length=36, max_length=36)
    agent_id: Optional[str]= Field(default=None, min_length=36, max_length=36)
    clear_agent: bool = False
    requires_approval: Optional[bool]= None


class TaskActionRequest(BaseModel):
    organization_id: str = Field(min_length=36, max_length=36)


class ApprovalDecisionRequest(TaskActionRequest):
    decision_comment: Optional[str]= Field(default=None, max_length=2000)


class ApprovalRequestDecision(BaseModel):
    organization_id: str = Field(min_length=36, max_length=36)
    decision: Literal["approve", "reject", "request_changes"]
    decision_comment: Optional[str]= Field(default=None, max_length=2000)


class RouterAssignRequest(TaskActionRequest):
    task_id: str = Field(min_length=36, max_length=36)
    department_id: Optional[str]= Field(default=None, min_length=36, max_length=36)
    agent_id: Optional[str]= Field(default=None, min_length=36, max_length=36)


async def _authorize(
    organization_id: str,
    actor: WorkflowActor,
    permission: str = "workflow.read",
) -> str:
    return await require_workflow_permission(organization_id, actor, permission)


async def _get_task(organization_id: str, task_id: str) -> dict[str, Any]:
    return await ai_workflow_store.one(
        "ai_tasks",
        organization_id=organization_id,
        row_id=task_id,
    )


async def _gather_safe(coros: list) -> list:
    """Run the overview queries and never let one missing table 503 the rest.

    The AI Workflow surface is only fully provisioned once the organization
    multi-tenant foundation and the workflow migrations are applied. Until then
    individual tables may be absent; we return an empty list for those so the
    dashboard still renders instead of throwing a gateway 503.
    """
    results = await asyncio.gather(*coros, return_exceptions=True)
    cleaned: list = []
    for item in results:
        if isinstance(item, Exception):
            logger.warning("ai-workflow overview section failed: %s", redact_error(item))
            cleaned.append([])
        else:
            cleaned.append(item or [])
    return cleaned


async def _ensure_manual_approval(task: dict[str, Any]) -> None:
    pending = await ai_workflow_store.select(
        "approval_requests",
        organization_id=task["organization_id"],
        filters={"task_id": f"eq.{task['id']}", "status": "eq.pending"},
        limit=1,
    )
    if pending:
        return
    await orbit_commander.request_approval(
        task,
        {
            "action": "Подтвердить критическое действие",
            "reason": "Пользователь или агент отметил действие как требующее решения.",
            "risk": "high",
            "consequences": "Workflow продолжится только после явного решения.",
        },
    )


@router.get("/overview")
async def get_overview(
    organization_id: str = Query(min_length=36, max_length=36),
    project_id: Optional[str]= Query(default=None, min_length=36, max_length=36),
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    from backend.services.openclaw_client import openclaw_client

    await _authorize(organization_id, actor)
    await orbit_commander.ensure_bootstrap(organization_id, actor.user_id)
    task_filters = {"project_id": f"eq.{project_id}"} if project_id else None
    (
        departments,
        agents,
        tasks,
        events,
        artifacts,
        approvals,
        projects,
        models,
        workflow_runs,
        dependencies,
        agent_runs,
        notifications,
    ) = await _gather_safe([
        ai_workflow_store.select("ai_departments", organization_id=organization_id, order="name.asc"),
        ai_workflow_store.select("ai_agents", organization_id=organization_id, order="created_at.asc"),
        ai_workflow_store.select(
            "ai_tasks",
            organization_id=organization_id,
            filters=task_filters,
            order="updated_at.desc",
            limit=250,
        ),
        ai_workflow_store.select(
            "task_events",
            organization_id=organization_id,
            filters=task_filters,
            order="created_at.desc",
            limit=60,
        ),
        ai_workflow_store.select(
            "artifacts",
            organization_id=organization_id,
            filters=task_filters,
            order="created_at.desc",
            limit=40,
        ),
        ai_workflow_store.select(
            "approval_requests",
            organization_id=organization_id,
            filters={"status": "eq.pending"},
            order="created_at.asc",
            limit=25,
        ),
        ai_workflow_store.select(
            "projects",
            organization_id=organization_id,
            filters={"archived_at": "is.null"},
            order="created_at.asc",
        ),
        ai_workflow_store.select(
            "ai_model_configs",
            organization_id=organization_id,
            filters={"is_enabled": "eq.true"},
            order="priority.desc",
        ),
        ai_workflow_store.select(
            "workflow_runs",
            organization_id=organization_id,
            order="updated_at.desc",
            limit=100,
        ),
        ai_workflow_store.select(
            "task_dependencies",
            organization_id=organization_id,
            limit=500,
        ),
        ai_workflow_store.select(
            "agent_runs",
            organization_id=organization_id,
            order="created_at.desc",
            limit=100,
        ),
        ai_workflow_store.select(
            "notifications",
            organization_id=organization_id,
            filters={"read_at": "is.null"},
            order="created_at.desc",
            limit=50,
        ),
    ])
    task_ids = {task["id"] for task in tasks}
    if project_id:
        approvals = [item for item in approvals if item.get("task_id") in task_ids]
    openclaw_configured = bool(settings.OPENCLAW_GATEWAY_TOKEN)
    openclaw_health = await openclaw_client.health() if openclaw_configured else None
    openclaw_connected = bool(
        openclaw_health
        and openclaw_health.status == "online"
        and openclaw_health.gateway
    )
    return {
        "departments": departments,
        "agents": agents,
        "tasks": tasks,
        "events": events,
        "artifacts": artifacts,
        "approval_requests": approvals,
        "projects": projects,
        "model_configs": models,
        "workflow_runs": workflow_runs,
        "task_dependencies": dependencies,
        "agent_runs": agent_runs,
        "notifications": notifications,
        "provider": {
            "nvidia_configured": bool(settings.NVIDIA_API_KEY),
            "nvidia_missing": [] if settings.NVIDIA_API_KEY else ["NVIDIA_API_KEY"],
            "supabase_configured": bool(
                settings.SUPABASE_URL and settings.SUPABASE_SERVICE_ROLE_KEY
            ),
            "supabase_missing": [
                name
                for name, value in (
                    ("SUPABASE_URL", settings.SUPABASE_URL),
                    ("SUPABASE_SERVICE_ROLE_KEY", settings.SUPABASE_SERVICE_ROLE_KEY),
                )
                if not value
            ],
            "openclaw_configured": openclaw_configured,
            "openclaw_url": settings.OPENCLAW_URL,
            "openclaw_configured_detail": {
                "configured": openclaw_configured,
                "connected": openclaw_connected,
                "missing": [] if openclaw_configured else ["OPENCLAW_GATEWAY_TOKEN"],
            },
            "configured": [
                name
                for name, enabled in (
                    ("nvidia", bool(settings.NVIDIA_API_KEY)),
                    ("openclaw", openclaw_connected),
                )
                if enabled
            ],
            "voice_configured": bool(settings.OPENAI_API_KEY),
            "autorun": True,
        },
}
@router.get("/system-status", include_in_schema=False)
async def get_system_status():
    """Return detailed system status for AI Workflow diagnostics.

    Never returns secret values. Only returns variable names in "missing"
    array, never their values.
    """
    from backend.services.openclaw_client import openclaw_client

    # Supabase check
    supabase_configured = bool(settings.SUPABASE_URL and settings.SUPABASE_SERVICE_ROLE_KEY)
    supabase_missing: List[str] = []
    if not settings.SUPABASE_URL:
        supabase_missing.append("SUPABASE_URL")
    if not settings.SUPABASE_SERVICE_ROLE_KEY:
        supabase_missing.append("SUPABASE_SERVICE_ROLE_KEY")

    # NVIDIA check
    nvidia_api_key = settings.NVIDIA_API_KEY
    nvidia_configured = bool(nvidia_api_key)
    nvidia_missing: List[str] = []
    if not nvidia_api_key:
        nvidia_missing.append("NVIDIA_API_KEY")

    # Count healthy/total models from registry
    all_models = nvidia_model_registry.NVIDIA_MODELS
    total_models = len(all_models)
    healthy_models = len(nvidia_model_registry.list_active())

    # OpenClaw check
    openclaw_configured = bool(settings.OPENCLAW_GATEWAY_TOKEN)
    openclaw_missing: List[str] = []
    if not settings.OPENCLAW_GATEWAY_TOKEN:
        openclaw_missing.append("OPENCLAW_GATEWAY_TOKEN")

    # Determine online/offline for backend based on health check
    # The /api/health endpoint just checks if the app is running
    backend_online = True

    # Build missing vars list across all providers
    all_missing: List[str] = []
    if supabase_missing:
        all_missing.extend(supabase_missing)
    if nvidia_missing:
        all_missing.extend(nvidia_missing)
    if openclaw_missing:
        all_missing.extend(openclaw_missing)

    # Determine per-provider status messages for UI
    supabase_status: Dict[str, any] = {
        "configured": supabase_configured,
        "connected": supabase_configured,  # connected = configured (URL + key set)
        "missing": supabase_missing if supabase_missing else [],
    }

    nvidia_status: Dict[str, any] = {
        "configured": nvidia_configured,
        "connected": nvidia_configured,
        "healthy_models": healthy_models,
        "total_models": total_models,
        "missing": nvidia_missing if nvidia_missing else [],
    }

    openclaw_status: Dict[str, any] = {
        "configured": openclaw_configured,
        "connected": openclaw_configured,
        "missing": openclaw_missing if openclaw_missing else [],
    }

    # Determine if workflow should fall back to available providers
    # Don't put entire workflow in demo mode if only one optional provider is missing
    workflow_degraded = False
    if not nvidia_configured and supabase_configured and openclaw_configured:
        # NVIDIA is the only missing optional provider - workflow continues via fallback
        workflow_degraded = False
    elif not supabase_configured:
        # Supabase is required - workflow cannot continue without it
        workflow_degraded = True
    elif not openclaw_configured:
        # OpenClaw is optional - workflow continues without it
        workflow_degraded = False
    else:
        workflow_degraded = False

    return {
        "backend": {
            "configured": True,
            "online": backend_online,
        },
        "supabase": supabase_status,
        "nvidia": nvidia_status,
        "openclaw": openclaw_status,
    }


@router.post("/tasks", status_code=201)
async def create_task(
    request: TaskCreateRequest,
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    await _authorize(request.organization_id, actor, "workflow.create")
    await orbit_commander.ensure_bootstrap(request.organization_id, actor.user_id)
    if request.project_id:
        await ai_workflow_store.one(
            "projects",
            organization_id=request.organization_id,
            row_id=request.project_id,
        )
    if request.department_id:
        await ai_workflow_store.one(
            "ai_departments",
            organization_id=request.organization_id,
            row_id=request.department_id,
        )
    if request.agent_id:
        await ai_workflow_store.one(
            "ai_agents",
            organization_id=request.organization_id,
            row_id=request.agent_id,
        )
    input_data: dict[str, Any] = {
        "attachments": request.attachments,
        "links": request.links,
        "related_entities": request.related_entities,
        "auto_assign": request.auto_assign,
    }
    if request.requires_approval is not None:
        input_data["requires_approval"] = request.requires_approval
    rows = await ai_workflow_store.insert(
        "ai_tasks",
        {
            "organization_id": request.organization_id,
            "project_id": request.project_id,
            "department_id": request.department_id,
            "agent_id": request.agent_id,
            "title": request.title,
            "original_request": (request.original_request or request.description or request.title).strip(),
            "description": request.description,
            "source": request.source,
            "source_entity_type": request.source_entity_type,
            "source_entity_id": request.source_entity_id,
            "status": "planning",
            "priority": request.priority,
            "due_at": request.due_at.isoformat() if request.due_at else None,
            "input_data": input_data,
            "approval_required": bool(request.requires_approval),
            "goal": request.title,
            "created_by": actor.user_id,
        },
    )
    task = rows[0]
    await orbit_commander.create_event(task, "created", "Пользователь создал новую задачу.")
    task, run = await orbit_commander.create_workflow(task)
    return {
        "task": task,
        "workflow_run": run,
        "queued_for_execution": True,
    }


@router.get("/tasks")
async def get_tasks(
    organization_id: str = Query(min_length=36, max_length=36),
    project_id: Optional[str]= Query(default=None, min_length=36, max_length=36),
    department_id: Optional[str]= Query(default=None, min_length=36, max_length=36),
    agent_id: Optional[str]= Query(default=None, min_length=36, max_length=36),
    status: Optional[TaskStatus]= None,
    search: str = Query(default="", max_length=120),
    limit: int = Query(default=100, ge=1, le=250),
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    await _authorize(organization_id, actor)
    filters: dict[str, str] = {}
    if project_id:
        filters["project_id"] = f"eq.{project_id}"
    if department_id:
        filters["department_id"] = f"eq.{department_id}"
    if agent_id:
        filters["agent_id"] = f"eq.{agent_id}"
    if status:
        filters["status"] = f"eq.{status}"
    tasks = await ai_workflow_store.select(
        "ai_tasks",
        organization_id=organization_id,
        filters=filters or None,
        order="updated_at.desc",
        limit=limit,
    )
    needle = search.strip().casefold()
    if needle:
        tasks = [
            task
            for task in tasks
            if needle in f"{task.get('title', '')} {task.get('description', '')}".casefold()
        ]
    return {"tasks": tasks, "count": len(tasks)}


@router.patch("/tasks/{task_id}")
async def patch_task(
    task_id: str,
    request: TaskPatchRequest,
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    await _authorize(request.organization_id, actor, "workflow.control")
    current = await _get_task(request.organization_id, task_id)
    payload: dict[str, Any] = {}
    for field in ("title", "description", "status", "priority", "department_id", "agent_id"):
        value = getattr(request, field)
        if value is not None:
            payload[field] = value.strip() if isinstance(value, str) else value
    if request.clear_agent:
        payload["agent_id"] = None
    if request.clear_due_at:
        payload["due_at"] = None
    elif request.due_at is not None:
        payload["due_at"] = request.due_at.isoformat()
    if request.requires_approval is not None:
        input_data = dict(current.get("input_data") or {})
        input_data["requires_approval"] = request.requires_approval
        payload["input_data"] = input_data
        payload["approval_required"] = request.requires_approval
    if payload.get("status") == "done" and current.get("qa_status") != "passed":
        raise HTTPException(
            status_code=409,
            detail="Задача может быть завершена только после успешной проверки QA.",
        )
    if not payload:
        raise HTTPException(status_code=422, detail="No task fields to update")
    rows = await ai_workflow_store.update(
        "ai_tasks",
        organization_id=request.organization_id,
        filters={"id": f"eq.{task_id}"},
        payload=payload,
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Task not found")
    task = rows[0]
    await orbit_commander.create_event(
        task,
        "updated",
        "Параметры задачи обновлены.",
        metadata={"fields": sorted(payload.keys())},
    )
    if request.status == "approval_required":
        await _ensure_manual_approval(task)
    return {"task": task}


@router.post("/tasks/{task_id}/run")
async def run_task(
    task_id: str,
    request: TaskActionRequest,
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    await _authorize(request.organization_id, actor, "workflow.control")
    task = await _get_task(request.organization_id, task_id)
    if task.get("workflow_run_id"):
        if task["status"] == "paused":
            task = await orbit_commander.resume(task, actor.user_id)
        elif task["status"] in ("blocked", "revisions_requested", "cancelled"):
            task = await orbit_commander.retry(task, actor.user_id)
        else:
            root, run = await orbit_commander._root_and_run(task)
            await orbit_commander.enqueue_ready(run)
            task = root if task["id"] == root["id"] else task
    else:
        task, _ = await orbit_commander.create_workflow(task)
    return {"task": task, "queued_for_execution": True}


@router.post("/tasks/{task_id}/approve")
async def approve_task(
    task_id: str,
    request: ApprovalDecisionRequest,
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    await _authorize(request.organization_id, actor, "approval.decide")
    task = await _get_task(request.organization_id, task_id)
    pending = await ai_workflow_store.select(
        "approval_requests",
        organization_id=request.organization_id,
        filters={"task_id": f"eq.{task_id}", "status": "eq.pending"},
        limit=1,
    )
    if not pending:
        raise HTTPException(status_code=404, detail="Pending approval request not found")
    decision = await orbit_commander.resolve_approval(
        pending[0]["id"],
        request.organization_id,
        actor.user_id,
        "approved",
        request.decision_comment,
    )
    return {"decision": decision, "task": await _get_task(request.organization_id, task["id"])}


@router.post("/tasks/{task_id}/reject")
async def reject_task(
    task_id: str,
    request: ApprovalDecisionRequest,
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    await _authorize(request.organization_id, actor, "approval.decide")
    task = await _get_task(request.organization_id, task_id)
    pending = await ai_workflow_store.select(
        "approval_requests",
        organization_id=request.organization_id,
        filters={"task_id": f"eq.{task_id}", "status": "eq.pending"},
        limit=1,
    )
    if not pending:
        raise HTTPException(status_code=404, detail="Pending approval request not found")
    decision = await orbit_commander.resolve_approval(
        pending[0]["id"],
        request.organization_id,
        actor.user_id,
        "rejected",
        request.decision_comment,
    )
    return {"decision": decision, "task": await _get_task(request.organization_id, task["id"])}


@router.post("/approvals/{approval_id}/decision")
async def decide_approval(
    approval_id: str,
    request: ApprovalRequestDecision,
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    await _authorize(request.organization_id, actor, "approval.decide")
    decision_map = {
        "approve": "approved",
        "reject": "rejected",
        "request_changes": "changes_requested",
    }
    try:
        approval = await orbit_commander.resolve_approval(
            approval_id,
            request.organization_id,
            actor.user_id,
            decision_map[request.decision],
            request.decision_comment,
        )
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return {"approval": approval}


@router.get("/tasks/{task_id}/plan")
async def get_task_plan(
    task_id: str,
    organization_id: str = Query(min_length=36, max_length=36),
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    await _authorize(organization_id, actor)
    task = await _get_task(organization_id, task_id)
    root, run = await orbit_commander._root_and_run(task)
    subtasks, dependencies, runs, messages = await asyncio.gather(
        ai_workflow_store.select(
            "ai_tasks",
            organization_id=organization_id,
            filters={"parent_task_id": f"eq.{root['id']}"},
            order="created_at.asc",
        ),
        ai_workflow_store.select("task_dependencies", organization_id=organization_id),
        ai_workflow_store.select(
            "agent_runs",
            organization_id=organization_id,
            filters={"workflow_run_id": f"eq.{run['id']}"},
            order="created_at.desc",
        ),
        ai_workflow_store.select(
            "agent_messages",
            organization_id=organization_id,
            filters={"workflow_run_id": f"eq.{run['id']}"},
            order="created_at.desc",
        ),
    )
    task_ids = {item["id"] for item in subtasks}
    return {
        "task": root,
        "workflow_run": run,
        "subtasks": subtasks,
        "dependencies": [item for item in dependencies if item["task_id"] in task_ids],
        "agent_runs": runs,
        "agent_messages": messages,
    }


@router.get("/graph-context")
async def get_workflow_graph_context(
    organization_id: str = Query(min_length=36, max_length=36),
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    await _authorize(organization_id, actor)
    # The durable knowledge graph lives in `graph_nodes` / `graph_relations`.
    # (`knowledge_nodes` / `knowledge_edges` were drop-in views removed by the
    # v2 knowledge-graph migration.) Degrade gracefully if the tables are not
    # yet provisioned so the UI never receives a hard gateway 503.
    try:
        nodes, edges = await asyncio.gather(
            ai_workflow_store.select(
                "graph_nodes",
                organization_id=organization_id,
                order="created_at.desc",
                limit=500,
            ),
            ai_workflow_store.select(
                "graph_relations",
                organization_id=organization_id,
                order="created_at.desc",
                limit=750,
            ),
        )
    except Exception:
        logger.exception("graph-context unavailable; returning empty graph")
        nodes, edges = [], []
    return {"nodes": nodes or [], "edges": edges or []}


async def _control_task(
    action: Literal["pause", "resume", "retry", "cancel"],
    task_id: str,
    request: TaskActionRequest,
    actor: WorkflowActor,
):
    await _authorize(request.organization_id, actor, "workflow.control")
    task = await _get_task(request.organization_id, task_id)
    handler = getattr(orbit_commander, action)
    result = await handler(task, actor.user_id)
    return {"task": result, "action": action}


@router.post("/tasks/{task_id}/pause")
async def pause_task(task_id: str, request: TaskActionRequest, actor: WorkflowActor = Depends(require_workflow_actor)):
    return await _control_task("pause", task_id, request, actor)


@router.post("/tasks/{task_id}/resume")
async def resume_task(task_id: str, request: TaskActionRequest, actor: WorkflowActor = Depends(require_workflow_actor)):
    return await _control_task("resume", task_id, request, actor)


@router.post("/tasks/{task_id}/retry")
async def retry_task(task_id: str, request: TaskActionRequest, actor: WorkflowActor = Depends(require_workflow_actor)):
    return await _control_task("retry", task_id, request, actor)


@router.post("/tasks/{task_id}/cancel")
async def cancel_task(task_id: str, request: TaskActionRequest, actor: WorkflowActor = Depends(require_workflow_actor)):
    return await _control_task("cancel", task_id, request, actor)


@router.get("/agents")
async def get_agents(
    organization_id: str = Query(min_length=36, max_length=36),
    department_id: Optional[str]= Query(default=None, min_length=36, max_length=36),
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    await _authorize(organization_id, actor)
    filters = {"department_id": f"eq.{department_id}"} if department_id else None
    agents, departments, tasks = await asyncio.gather(
        ai_workflow_store.select("ai_agents", organization_id=organization_id, filters=filters),
        ai_workflow_store.select("ai_departments", organization_id=organization_id),
        ai_workflow_store.select("ai_tasks", organization_id=organization_id, limit=250),
    )
    for agent in agents:
        assigned = [task for task in tasks if task.get("agent_id") == agent["id"]]
        agent["task_counts"] = {
            "queued": sum(task["status"] == "queued" for task in assigned),
            "in_progress": sum(task["status"] == "in_progress" for task in assigned),
            "done": sum(task["status"] == "done" for task in assigned),
        }
    return {"agents": agents, "departments": departments}


@router.get("/events")
async def get_events(
    organization_id: str = Query(min_length=36, max_length=36),
    project_id: Optional[str]= Query(default=None, min_length=36, max_length=36),
    limit: int = Query(default=50, ge=1, le=200),
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    await _authorize(organization_id, actor)
    filters = {"project_id": f"eq.{project_id}"} if project_id else None
    events = await ai_workflow_store.select(
        "task_events",
        organization_id=organization_id,
        filters=filters,
        order="created_at.desc",
        limit=limit,
    )
    return {"events": events}


@router.get("/artifacts")
async def get_artifacts(
    organization_id: str = Query(min_length=36, max_length=36),
    project_id: Optional[str]= Query(default=None, min_length=36, max_length=36),
    limit: int = Query(default=50, ge=1, le=200),
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    await _authorize(organization_id, actor)
    filters = {"project_id": f"eq.{project_id}"} if project_id else None
    artifacts = await ai_workflow_store.select(
        "artifacts",
        organization_id=organization_id,
        filters=filters,
        order="created_at.desc",
        limit=limit,
    )
    return {"artifacts": artifacts}


@router.post("/voice/transcribe")
async def transcribe_voice_task(
    organization_id: str = Form(min_length=36, max_length=36),
    audio: UploadFile = File(...),
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    await _authorize(organization_id, actor, "workflow.create")
    content = await audio.read()
    if not content:
        raise HTTPException(status_code=400, detail="Аудиозапись пустая")
    if len(content) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Аудиозапись превышает 25 МБ")
    try:
        transcript = await stt_service.transcribe(
            io.BytesIO(content),
            filename=audio.filename or "task.webm",
        )
    except Exception as error:
        logger.exception("AI Workflow voice transcription failed")
        raise HTTPException(
            status_code=503,
            detail="Сервис транскрипции сейчас недоступен. Создайте задачу вручную.",
        ) from error
    if not transcript.strip():
        raise HTTPException(
            status_code=422,
            detail="Не удалось распознать речь. Можно отредактировать задачу вручную.",
        )
    return {"transcript": transcript.strip()}


@router.post("/router/assign")
async def assign_task(
    request: RouterAssignRequest,
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    await _authorize(request.organization_id, actor, "workflow.control")
    task = await _get_task(request.organization_id, request.task_id)
    payload: dict[str, Any] = {}
    if request.agent_id:
        agent = await ai_workflow_store.one(
            "ai_agents",
            organization_id=request.organization_id,
            row_id=request.agent_id,
        )
        payload["agent_id"] = agent["id"]
        payload["department_id"] = agent.get("department_id")
    elif request.department_id:
        await ai_workflow_store.one(
            "ai_departments",
            organization_id=request.organization_id,
            row_id=request.department_id,
        )
        payload["department_id"] = request.department_id
    else:
        raise HTTPException(status_code=422, detail="agent_id or department_id is required")
    rows = await ai_workflow_store.update(
        "ai_tasks",
        organization_id=request.organization_id,
        filters={"id": f"eq.{task['id']}"},
        payload=payload,
    )
    assigned = rows[0]
    await orbit_commander.create_event(
        assigned,
        "reassigned",
        "Исполнитель этапа изменён пользователем.",
        metadata={"agent_id": request.agent_id, "department_id": payload.get("department_id")},
    )
    await orbit_commander.audit(
        request.organization_id,
        actor_type="user",
        actor_id=actor.user_id,
        action="task.reassign",
        entity_type="task",
        entity_id=task["id"],
        summary="Исполнитель этапа изменён.",
    )
    return {"task": assigned}
