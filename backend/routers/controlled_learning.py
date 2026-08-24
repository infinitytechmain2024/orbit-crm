from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from backend.auth import WorkflowActor, require_workflow_actor, require_workflow_permission
from backend.services.ai_workflow_store import ai_workflow_store
from backend.services.supabase_client import supabase_service

router = APIRouter(prefix="/api/learning", tags=["Controlled learning"])


class OutcomeCreate(BaseModel):
    organization_id: str = Field(min_length=36, max_length=36)
    client_id: str | None = Field(default=None, min_length=36, max_length=36)
    action_type: str = Field(min_length=1, max_length=120)
    recommendation: str = Field(default="", max_length=12000)
    outcome: Literal["successful", "unsuccessful", "neutral", "unknown"]
    score: float | None = Field(default=None, ge=-100, le=100)
    evidence: dict[str, Any] = Field(default_factory=dict)


class KnowledgeCreate(BaseModel):
    organization_id: str = Field(min_length=36, max_length=36)
    slug: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]{1,119}$")
    title: str = Field(min_length=1, max_length=240)
    category: str = Field(default="general", max_length=120)
    content: dict[str, Any]


class ProposalCreate(BaseModel):
    organization_id: str = Field(min_length=36, max_length=36)
    target_type: Literal["knowledge", "template", "business_process"]
    knowledge_id: str | None = Field(default=None, min_length=36, max_length=36)
    title: str = Field(min_length=1, max_length=240)
    rationale: str = Field(min_length=1, max_length=12000)
    evidence: list[dict[str, Any]] = Field(default_factory=list)
    proposed_content: dict[str, Any]
    risk_level: Literal["low", "medium", "high", "critical"] = "medium"
    confidence: float | None = Field(default=None, ge=0, le=1)


@router.post("/outcomes")
async def record_outcome(
    request: OutcomeCreate,
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    await require_workflow_permission(request.organization_id, actor, "workflow.create")
    if request.client_id:
        await ai_workflow_store.one(
            "lead_clients",
            organization_id=request.organization_id,
            row_id=request.client_id,
            columns="id",
        )
    rows = await ai_workflow_store.insert(
        "ai_outcomes",
        {
            **request.model_dump(),
            "recorded_by": actor.user_id,
        },
    )
    return rows[0]


@router.get("/knowledge")
async def list_knowledge(
    organization_id: str = Query(min_length=36, max_length=36),
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    await require_workflow_permission(organization_id, actor, "workflow.read")
    entries = await ai_workflow_store.select(
        "company_knowledge",
        organization_id=organization_id,
        filters={"is_active": "eq.true"},
        order="updated_at.desc",
        limit=200,
    )
    versions = await ai_workflow_store.select(
        "company_knowledge_versions",
        organization_id=organization_id,
        order="version.desc",
        limit=1000,
    )
    current = {(row["knowledge_id"], row["version"]): row for row in versions}
    return {
        "knowledge": [
            {**entry, "content": current.get((entry["id"], entry["current_version"]), {}).get("content")}
            for entry in entries
        ]
    }


@router.post("/knowledge")
async def create_knowledge(
    request: KnowledgeCreate,
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    await require_workflow_permission(request.organization_id, actor, "approval.decide")
    result = supabase_service.client.rpc(
        "create_knowledge_entry",
        {
            "p_organization_id": request.organization_id,
            "p_slug": request.slug,
            "p_title": request.title,
            "p_category": request.category,
            "p_content": request.content,
            "p_created_by": actor.user_id,
        },
    ).execute()
    return result.data


@router.get("/proposals")
async def list_proposals(
    organization_id: str = Query(min_length=36, max_length=36),
    status: str = Query(default="pending_review", max_length=40),
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    await require_workflow_permission(organization_id, actor, "workflow.read")
    rows = await ai_workflow_store.select(
        "ai_improvement_proposals",
        organization_id=organization_id,
        filters={"status": f"eq.{status}"},
        order="created_at.desc",
        limit=100,
    )
    return {"proposals": rows}


@router.post("/proposals")
async def create_proposal(
    request: ProposalCreate,
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    await require_workflow_permission(request.organization_id, actor, "workflow.create")
    if request.target_type == "knowledge" and not request.knowledge_id:
        raise HTTPException(status_code=422, detail="knowledge_id is required for knowledge proposals")
    if request.knowledge_id:
        await ai_workflow_store.one(
            "company_knowledge",
            organization_id=request.organization_id,
            row_id=request.knowledge_id,
            columns="id",
        )
    rows = await ai_workflow_store.insert(
        "ai_improvement_proposals",
        {**request.model_dump(), "created_by": actor.user_id, "status": "pending_review"},
    )
    return rows[0]


async def _review_proposal(proposal_id: str, actor: WorkflowActor, action: str):
    proposal_rows = await ai_workflow_store.select(
        "ai_improvement_proposals",
        filters={"id": f"eq.{proposal_id}"},
        limit=1,
    )
    if not proposal_rows:
        raise HTTPException(status_code=404, detail="Proposal not found")
    proposal = proposal_rows[0]
    await require_workflow_permission(proposal["organization_id"], actor, "approval.decide")
    result = supabase_service.client.rpc(
        action,
        {"p_proposal_id": proposal_id, "p_reviewer_id": actor.user_id},
    ).execute()
    return result.data


@router.post("/proposals/{proposal_id}/approve")
async def approve_proposal(
    proposal_id: str,
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    return await _review_proposal(proposal_id, actor, "apply_knowledge_proposal")


@router.post("/proposals/{proposal_id}/rollback")
async def rollback_proposal(
    proposal_id: str,
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    return await _review_proposal(proposal_id, actor, "rollback_knowledge_proposal")
