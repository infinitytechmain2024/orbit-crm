"""
CEO Router - AI-CEO specific endpoints for multi-project management
Handles approval requests, deployment queue, and CEO dashboard
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from typing import Optional, Literal
from datetime import datetime

from ..auth import require_workflow_actor, WorkflowActor, require_workflow_permission
from ..services.ai_workflow_store import ai_workflow_store

router = APIRouter(prefix="/api/ceo", tags=["AI-CEO"])


# ============================================================
# Request/Response Models
# ============================================================

class ApprovalRequestCreate(BaseModel):
    task_id: str = Field(..., description="Task ID to request approval for")
    action: str = Field(..., description="Action description")
    reason: Optional[str] = Field(None, description="Reason for approval request")
    risk_level: Literal["low", "medium", "high", "critical"] = Field(..., description="Risk level")
    change_summary: Optional[dict] = Field(None, description="Summary of changes")


class ApprovalDecision(BaseModel):
    decision: Literal["approved", "rejected", "changes_requested"] = Field(..., description="Decision")
    comment: Optional[str] = Field(None, description="Decision comment")


class DeploymentRequestCreate(BaseModel):
    task_id: str = Field(..., description="Task ID for deployment")
    project_id: str = Field(..., description="Project ID")
    deployment_type: Literal["frontend", "backend", "database", "config"] = Field(..., description="Deployment type")
    deployment_config: dict = Field(..., description="Deployment configuration")


class DeploymentDecision(BaseModel):
    approved: bool = Field(..., description="Whether to approve deployment")


# ============================================================
# CEO Approval Endpoints
# ============================================================

@router.post("/approvals", response_model=dict)
async def create_approval_request(
    payload: ApprovalRequestCreate,
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    """Create a CEO approval request for a task"""
    # Verify the task exists
    task = await ai_workflow_store.one("tasks", None, payload.task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # Create approval request via RPC
    result = await ai_workflow_store.rpc("request_ceo_approval", {
        "p_task_id": payload.task_id,
        "p_action": payload.action,
        "p_reason": payload.reason,
        "p_risk_level": payload.risk_level,
        "p_change_summary": payload.change_summary,
    })

    return {
        "success": True,
        "approval_id": result,
        "message": "CEO approval request created",
    }


@router.get("/approvals", response_model=list)
async def get_pending_approvals(
    status: Optional[str] = Query(None, description="Filter by status"),
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    """Get CEO approval requests"""
    filters = {}
    if status:
        filters["status"] = status
    else:
        filters["status"] = "pending"

    result = await ai_workflow_store.select(
        "ceo_approval_requests",
        None,
        filters,
        order="created_at.desc",
    )

    return result or []


@router.post("/approvals/{approval_id}/decision", response_model=dict)
async def decide_approval(
    approval_id: str,
    payload: ApprovalDecision,
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    """Decide on a CEO approval request"""
    result = await ai_workflow_store.rpc("decide_ceo_approval", {
        "p_approval_id": approval_id,
        "p_decision": payload.decision,
        "p_comment": payload.comment,
    })

    if not result:
        raise HTTPException(status_code=400, detail="Failed to process decision")

    return {
        "success": True,
        "message": f"Approval {payload.decision}",
    }


# ============================================================
# Deployment Endpoints
# ============================================================

@router.post("/deployments", response_model=dict)
async def create_deployment_request(
    payload: DeploymentRequestCreate,
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    """Create a deployment request"""
    result = await ai_workflow_store.rpc("request_deployment", {
        "p_task_id": payload.task_id,
        "p_project_id": payload.project_id,
        "p_deployment_type": payload.deployment_type,
        "p_deployment_config": payload.deployment_config,
    })

    return {
        "success": True,
        "deployment_id": result,
        "message": "Deployment request created",
    }


@router.get("/deployments", response_model=list)
async def get_pending_deployments(
    status: Optional[str] = Query(None, description="Filter by status"),
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    """Get deployment requests"""
    filters = {}
    if status:
        filters["status"] = status
    else:
        filters["status"] = "pending"

    result = await ai_workflow_store.select(
        "deployment_queue",
        None,
        filters,
        order="created_at.desc",
    )

    return result or []


@router.post("/deployments/{deployment_id}/decision", response_model=dict)
async def decide_deployment(
    deployment_id: str,
    payload: DeploymentDecision,
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    """Approve or reject a deployment"""
    result = await ai_workflow_store.rpc("approve_deployment", {
        "p_deployment_id": deployment_id,
        "p_approved": payload.approved,
    })

    if not result:
        raise HTTPException(status_code=400, detail="Failed to process deployment decision")

    return {
        "success": True,
        "message": "Deployment approved" if payload.approved else "Deployment cancelled",
    }


# ============================================================
# CEO Dashboard Endpoints
# ============================================================

@router.get("/dashboard", response_model=dict)
async def get_ceo_dashboard(
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    """Get CEO dashboard overview"""
    # Get pending approvals count
    pending_approvals = await ai_workflow_store.select(
        "ceo_approval_requests",
        None,
        {"status": "pending"},
        columns="id",
    )

    # Get pending deployments count
    pending_deployments = await ai_workflow_store.select(
        "deployment_queue",
        None,
        {"status": "pending"},
        columns="id",
    )

    # Get tasks by action type
    tasks_by_action = await ai_workflow_store.select(
        "tasks",
        None,
        {},
        columns="action_type",
    )

    # Count tasks by action type
    tasks_by_action_type = {}
    for task in (tasks_by_action or []):
        action_type = task.get("action_type") or "unknown"
        tasks_by_action_type[action_type] = tasks_by_action_type.get(action_type, 0) + 1

    # Get tasks by project
    tasks_by_project = await ai_workflow_store.select(
        "tasks",
        None,
        {},
        columns="project_id, projects(name)",
    )

    # Count tasks by project
    tasks_by_project_map = {}
    for task in (tasks_by_project or []):
        project_name = "Unknown"
        if task.get("projects"):
            project_name = task["projects"].get("name", "Unknown")
        tasks_by_project_map[project_name] = tasks_by_project_map.get(project_name, 0) + 1

    return {
        "pending_approvals": len(pending_approvals or []),
        "pending_deployments": len(pending_deployments or []),
        "tasks_by_action_type": tasks_by_action_type,
        "tasks_by_project": tasks_by_project_map,
    }


# ============================================================
# CEO Task Management
# ============================================================

@router.get("/tasks", response_model=list)
async def get_ceo_tasks(
    action_type: Optional[str] = Query(None, description="Filter by action type"),
    approval_status: Optional[str] = Query(None, description="Filter by approval status"),
    deployment_status: Optional[str] = Query(None, description="Filter by deployment status"),
    project_id: Optional[str] = Query(None, description="Filter by project ID"),
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    """Get tasks with CEO-specific filters"""
    filters = {}
    if action_type:
        filters["action_type"] = action_type
    if approval_status:
        filters["approval_status"] = approval_status
    if deployment_status:
        filters["deployment_status"] = deployment_status
    if project_id:
        filters["project_id"] = project_id

    result = await ai_workflow_store.select(
        "tasks",
        None,
        filters,
        order="created_at.desc",
    )

    return result or []


@router.patch("/tasks/{task_id}", response_model=dict)
async def update_ceo_task(
    task_id: str,
    updates: dict,
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    """Update task with CEO-specific fields"""
    # Filter to only CEO-specific fields
    ceo_fields = [
        "action_type", "approval_status", "deployment_status",
        "risk_assessment", "change_package",
    ]

    ceo_updates = {k: v for k, v in updates.items() if k in ceo_fields}

    if not ceo_updates:
        raise HTTPException(status_code=400, detail="No valid CEO fields to update")

    await ai_workflow_store.update("tasks", None, {"id": task_id}, ceo_updates)

    return {
        "success": True,
        "message": "Task updated",
    }
