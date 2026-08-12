"""Authenticated API surface for Orbit CRM AI Workflow."""

from __future__ import annotations

import asyncio
import io
import logging
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field, field_validator

from backend.auth import WorkflowActor, require_workflow_actor
from backend.config import settings
from backend.services.ai_workflow_router import AllModelsFailed, ai_workflow_router
from backend.services.ai_workflow_store import ai_workflow_store
from backend.services.stt import stt_service

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/ai-workflow",
    tags=["AI Workflow"],
)

TaskStatus = Literal[
    "queued",
    "in_progress",
    "approval_required",
    "done",
    "blocked",
    "revisions_requested",
    "cancelled",
]
TaskPriority = Literal["low", "medium", "high", "critical"]


class TaskCreateRequest(BaseModel):
    organization_id: str = Field(min_length=36, max_length=36)
    project_id: str = Field(min_length=36, max_length=36)
    title: str = Field(min_length=1, max_length=240)
    description: str = Field(default="", max_length=12000)
    priority: TaskPriority = "medium"
    due_at: datetime | None = None
    attachments: list[str] = Field(default_factory=list, max_length=12)
    links: list[str] = Field(default_factory=list, max_length=12)
    department_id: str | None = Field(default=None, min_length=36, max_length=36)
    agent_id: str | None = Field(default=None, min_length=36, max_length=36)
    auto_assign: bool = True
    requires_approval: bool | None = None

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
    title: str | None = Field(default=None, min_length=1, max_length=240)
    description: str | None = Field(default=None, max_length=12000)
    status: TaskStatus | None = None
    priority: TaskPriority | None = None
    due_at: datetime | None = None
    clear_due_at: bool = False
    department_id: str | None = Field(default=None, min_length=36, max_length=36)
    agent_id: str | None = Field(default=None, min_length=36, max_length=36)
    clear_agent: bool = False
    requires_approval: bool | None = None


class TaskActionRequest(BaseModel):
    organization_id: str = Field(min_length=36, max_length=36)


class ApprovalDecisionRequest(TaskActionRequest):
    decision_comment: str | None = Field(default=None, max_length=2000)


class RouterAssignRequest(TaskActionRequest):
    task_id: str = Field(min_length=36, max_length=36)
    department_id: str | None = Field(default=None, min_length=36, max_length=36)
    agent_id: str | None = Field(default=None, min_length=36, max_length=36)


async def _authorize(organization_id: str, actor: WorkflowActor) -> None:
    await ai_workflow_store.ensure_membership(organization_id, actor.user_id)


async def _get_task(organization_id: str, task_id: str) -> dict[str, Any]:
    return await ai_workflow_store.one(
        "ai_tasks",
        organization_id=organization_id,
        row_id=task_id,
    )


async def _run_task_safely(task: dict[str, Any]) -> None:
    try:
        await ai_workflow_router.execute_task(task)
    except AllModelsFailed:
        logger.warning("AI Workflow task %s blocked after model fallbacks", task.get("id"))
    except Exception as error:
        logger.exception("AI Workflow task %s failed", task.get("id"))
        try:
            await ai_workflow_store.update(
                "ai_tasks",
                organization_id=task["organization_id"],
                filters={"id": f"eq.{task['id']}"},
                payload={"status": "blocked"},
            )
            await ai_workflow_router.create_event(
                task,
                "blocked",
                "Выполнение остановлено из-за внутренней ошибки. Задачу можно запустить повторно.",
                metadata={"error_type": type(error).__name__},
            )
        except Exception:
            logger.exception("Could not persist AI Workflow task failure")


async def _ensure_manual_approval(task: dict[str, Any]) -> None:
    pending = await ai_workflow_store.select(
        "approval_requests",
        organization_id=task["organization_id"],
        filters={"task_id": f"eq.{task['id']}", "status": "eq.pending"},
        limit=1,
    )
    if pending:
        return
    ceo = await ai_workflow_store.select(
        "ai_agents",
        organization_id=task["organization_id"],
        filters={"role": "eq.CEO", "is_active": "eq.true"},
        limit=1,
    )
    await ai_workflow_store.insert(
        "approval_requests",
        {
            "organization_id": task["organization_id"],
            "task_id": task["id"],
            "requested_by_agent_id": task.get("agent_id"),
            "assigned_to_agent_id": ceo[0]["id"] if ceo else None,
            "status": "pending",
        },
    )
    await ai_workflow_router.create_event(
        task,
        "approval_requested",
        "Задача вручную отправлена CEO на утверждение.",
    )


@router.get("/overview")
async def get_overview(
    organization_id: str = Query(min_length=36, max_length=36),
    project_id: str | None = Query(default=None, min_length=36, max_length=36),
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    await _authorize(organization_id, actor)
    await ai_workflow_router.ensure_bootstrap(organization_id, actor.user_id)
    task_filters = {"project_id": f"eq.{project_id}"} if project_id else None
    departments, agents, tasks, events, artifacts, approvals, projects, models = await asyncio.gather(
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
    )
    task_ids = {task["id"] for task in tasks}
    if project_id:
        approvals = [item for item in approvals if item.get("task_id") in task_ids]
    return {
        "departments": departments,
        "agents": agents,
        "tasks": tasks,
        "events": events,
        "artifacts": artifacts,
        "approval_requests": approvals,
        "projects": projects,
        "model_configs": models,
        "provider": {
            "nvidia_configured": bool(settings.NVIDIA_API_KEY),
            "voice_configured": bool(settings.WHISPER_MODEL),
            "autorun": settings.AI_WORKFLOW_AUTORUN,
        },
    }


@router.post("/tasks", status_code=201)
async def create_task(
    request: TaskCreateRequest,
    background_tasks: BackgroundTasks,
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    await _authorize(request.organization_id, actor)
    await ai_workflow_router.ensure_bootstrap(request.organization_id, actor.user_id)
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
            "description": request.description,
            "status": "queued",
            "priority": request.priority,
            "due_at": request.due_at.isoformat() if request.due_at else None,
            "input_data": input_data,
            "created_by": actor.user_id,
        },
    )
    task = rows[0]
    await ai_workflow_router.create_event(task, "created", "Пользователь создал новую задачу.")
    task = await ai_workflow_router.assign_task(
        task,
        requested_department_id=request.department_id,
        requested_agent_id=request.agent_id,
    )
    if settings.AI_WORKFLOW_AUTORUN:
        background_tasks.add_task(_run_task_safely, task)
    return {"task": task, "queued_for_execution": settings.AI_WORKFLOW_AUTORUN}


@router.get("/tasks")
async def get_tasks(
    organization_id: str = Query(min_length=36, max_length=36),
    project_id: str | None = Query(default=None, min_length=36, max_length=36),
    department_id: str | None = Query(default=None, min_length=36, max_length=36),
    agent_id: str | None = Query(default=None, min_length=36, max_length=36),
    status: TaskStatus | None = None,
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
    await _authorize(request.organization_id, actor)
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
    await ai_workflow_router.create_event(
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
    background_tasks: BackgroundTasks,
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    await _authorize(request.organization_id, actor)
    task = await _get_task(request.organization_id, task_id)
    background_tasks.add_task(_run_task_safely, task)
    return {"task": task, "queued_for_execution": True}


@router.post("/tasks/{task_id}/approve")
async def approve_task(
    task_id: str,
    request: ApprovalDecisionRequest,
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    await _authorize(request.organization_id, actor)
    await _get_task(request.organization_id, task_id)
    decision = await ai_workflow_store.rpc(
        "resolve_ai_approval",
        {
            "p_organization_id": request.organization_id,
            "p_task_id": task_id,
            "p_decision": "approved",
            "p_comment": request.decision_comment,
        },
    )
    return {"decision": decision, "task": await _get_task(request.organization_id, task_id)}


@router.post("/tasks/{task_id}/reject")
async def reject_task(
    task_id: str,
    request: ApprovalDecisionRequest,
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    await _authorize(request.organization_id, actor)
    await _get_task(request.organization_id, task_id)
    decision = await ai_workflow_store.rpc(
        "resolve_ai_approval",
        {
            "p_organization_id": request.organization_id,
            "p_task_id": task_id,
            "p_decision": "rejected",
            "p_comment": request.decision_comment,
        },
    )
    return {"decision": decision, "task": await _get_task(request.organization_id, task_id)}


@router.get("/agents")
async def get_agents(
    organization_id: str = Query(min_length=36, max_length=36),
    department_id: str | None = Query(default=None, min_length=36, max_length=36),
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
    project_id: str | None = Query(default=None, min_length=36, max_length=36),
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
    project_id: str | None = Query(default=None, min_length=36, max_length=36),
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
    await _authorize(organization_id, actor)
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
    await _authorize(request.organization_id, actor)
    task = await _get_task(request.organization_id, request.task_id)
    assigned = await ai_workflow_router.assign_task(
        task,
        requested_department_id=request.department_id,
        requested_agent_id=request.agent_id,
    )
    return {"task": assigned}
