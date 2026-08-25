from __future__ import annotations

from datetime import UTC, datetime, timedelta
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


class MemoryUpsert(BaseModel):
    organization_id: str = Field(min_length=36, max_length=36)
    entity_type: Literal[
        "project", "task", "contact", "client", "company", "synonym", "preference", "outcome"
    ]
    entity_id: str | None = Field(default=None, min_length=36, max_length=36)
    key_phrase: str = Field(min_length=1, max_length=500)
    memory_value: dict[str, Any]
    confidence: float = Field(default=1.0, ge=0, le=1)
    expires_in_days: int | None = Field(default=None, ge=1, le=3650)


class MemoryCorrection(BaseModel):
    organization_id: str = Field(min_length=36, max_length=36)
    memory_value: dict[str, Any]
    correction_note: str = Field(min_length=1, max_length=2000)
    confidence: float = Field(default=1.0, ge=0, le=1)


class ProposalReview(BaseModel):
    reason: str = Field(min_length=3, max_length=2000)


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


@router.get("/memory")
async def list_memory(
    organization_id: str = Query(min_length=36, max_length=36),
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    await require_workflow_permission(organization_id, actor, "workflow.read")
    rows = await ai_workflow_store.select(
        "ai_user_memory",
        organization_id=organization_id,
        filters={
            "user_id": f"eq.{actor.user_id}",
            "or": f"(expires_at.is.null,expires_at.gt.{datetime.now(UTC).isoformat()})",
        },
        columns=(
            "id,entity_type,entity_id,key_phrase,memory_value,confidence,source,approved_at,"
            "expires_at,last_verified_at,correction_note,created_at,updated_at"
        ),
        order="updated_at.desc",
        limit=200,
    )
    return {"memory": rows}


@router.post("/memory")
async def upsert_memory(
    request: MemoryUpsert,
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    await require_workflow_permission(request.organization_id, actor, "workflow.create")
    now = datetime.now(UTC)
    expires_at = (
        (now + timedelta(days=request.expires_in_days)).isoformat()
        if request.expires_in_days
        else None
    )
    rows = await ai_workflow_store.insert(
        "ai_user_memory",
        {
            "organization_id": request.organization_id,
            "user_id": actor.user_id,
            "entity_type": request.entity_type,
            "entity_id": request.entity_id,
            "key_phrase": request.key_phrase.strip().lower(),
            "memory_value": request.memory_value,
            "confidence": request.confidence,
            "source": "user",
            "approved_at": now.isoformat(),
            "last_verified_at": now.isoformat(),
            "expires_at": expires_at,
            "corrected_by": actor.user_id,
        },
        upsert=True,
        on_conflict="user_id,organization_id,entity_type,key_phrase",
    )
    return rows[0]


@router.post("/memory/{memory_id}/correct")
async def correct_memory(
    memory_id: str,
    request: MemoryCorrection,
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    await require_workflow_permission(request.organization_id, actor, "workflow.create")
    existing = await ai_workflow_store.one(
        "ai_user_memory", organization_id=request.organization_id, row_id=memory_id,
        columns="id,user_id",
    )
    if existing["user_id"] != actor.user_id:
        raise HTTPException(status_code=403, detail="Only the memory owner can correct this fact")
    rows = await ai_workflow_store.update(
        "ai_user_memory",
        organization_id=request.organization_id,
        filters={"id": f"eq.{memory_id}", "user_id": f"eq.{actor.user_id}"},
        payload={
            "memory_value": request.memory_value,
            "confidence": request.confidence,
            "source": "user",
            "approved_at": datetime.now(UTC).isoformat(),
            "last_verified_at": datetime.now(UTC).isoformat(),
            "correction_note": request.correction_note,
            "corrected_by": actor.user_id,
        },
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Memory fact not found")
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


@router.get("/patterns")
async def list_outcome_patterns(
    organization_id: str = Query(min_length=36, max_length=36),
    min_occurrences: int = Query(default=3, ge=2, le=100),
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    await require_workflow_permission(organization_id, actor, "workflow.read")
    outcomes = await ai_workflow_store.select(
        "ai_outcomes",
        organization_id=organization_id,
        columns=(
            "id,client_id,action_type,recommendation,outcome,score,evidence,created_at"
        ),
        order="created_at.desc",
        limit=1000,
    )
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for outcome in outcomes:
        key = (str(outcome["action_type"]), str(outcome["outcome"]))
        grouped.setdefault(key, []).append(outcome)

    patterns: list[dict[str, Any]] = []
    for (action_type, result), rows in grouped.items():
        if len(rows) < min_occurrences:
            continue
        scores = [float(row["score"]) for row in rows if row.get("score") is not None]
        clients = {row["client_id"] for row in rows if row.get("client_id")}
        examples = [
            row["recommendation"] for row in rows
            if row.get("recommendation")
        ][:3]
        patterns.append({
            "pattern_key": f"{action_type}:{result}",
            "action_type": action_type,
            "outcome": result,
            "occurrences": len(rows),
            "client_count": len(clients),
            "average_score": round(sum(scores) / len(scores), 2) if scores else None,
            "first_seen_at": rows[-1]["created_at"],
            "last_seen_at": rows[0]["created_at"],
            "examples": examples,
            "evidence_outcome_ids": [row["id"] for row in rows[:20]],
            "explanation": (
                f"{len(rows)} outcomes with result '{result}' were recorded "
                f"for action '{action_type}' across {len(clients)} clients."
            ),
        })
    patterns.sort(key=lambda item: item["occurrences"], reverse=True)
    return {"patterns": patterns, "analyzed_outcomes": len(outcomes)}


@router.get("/proposals/{proposal_id}/events")
async def list_proposal_events(
    proposal_id: str,
    organization_id: str = Query(min_length=36, max_length=36),
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    await require_workflow_permission(organization_id, actor, "workflow.read")
    await ai_workflow_store.one(
        "ai_improvement_proposals",
        organization_id=organization_id,
        row_id=proposal_id,
        columns="id",
    )
    rows = await ai_workflow_store.select(
        "ai_improvement_proposal_events",
        organization_id=organization_id,
        filters={"proposal_id": f"eq.{proposal_id}"},
        order="created_at.desc",
        limit=100,
    )
    return {"events": rows}


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


async def _review_proposal(
    proposal_id: str,
    actor: WorkflowActor,
    action: str,
    reason: str,
):
    proposal_rows = await ai_workflow_store.select(
        "ai_improvement_proposals",
        filters={"id": f"eq.{proposal_id}"},
        limit=1,
    )
    if not proposal_rows:
        raise HTTPException(status_code=404, detail="Proposal not found")
    proposal = proposal_rows[0]
    await require_workflow_permission(proposal["organization_id"], actor, "approval.decide")
    await ai_workflow_store.update(
        "ai_improvement_proposals",
        organization_id=proposal["organization_id"],
        filters={
            "id": f"eq.{proposal_id}",
            "status": (
                "eq.applied"
                if action == "rollback_knowledge_proposal"
                else "eq.pending_review"
            ),
        },
        payload={"review_note": reason.strip()},
    )
    result = supabase_service.client.rpc(
        action,
        {"p_proposal_id": proposal_id, "p_reviewer_id": actor.user_id},
    ).execute()
    return result.data


@router.post("/proposals/{proposal_id}/approve")
async def approve_proposal(
    proposal_id: str,
    request: ProposalReview,
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    proposal = await ai_workflow_store.select(
        "ai_improvement_proposals",
        filters={"id": f"eq.{proposal_id}"},
        columns="organization_id,target_type",
        limit=1,
    )
    if not proposal:
        raise HTTPException(status_code=404, detail="Proposal not found")
    await require_workflow_permission(
        proposal[0]["organization_id"], actor, "approval.decide"
    )
    action = (
        "apply_knowledge_proposal"
        if proposal[0]["target_type"] == "knowledge"
        else "review_improvement_proposal"
    )
    if action == "review_improvement_proposal":
        result = supabase_service.client.rpc(
            action,
            {
                "p_proposal_id": proposal_id,
                "p_reviewer_id": actor.user_id,
                "p_decision": "approve",
                "p_reason": request.reason,
            },
        ).execute()
        return result.data
    return await _review_proposal(proposal_id, actor, action, request.reason)


@router.post("/proposals/{proposal_id}/reject")
async def reject_proposal(
    proposal_id: str,
    request: ProposalReview,
    actor: WorkflowActor = Depends(require_workflow_actor),
):
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
        "review_improvement_proposal",
        {
            "p_proposal_id": proposal_id,
            "p_reviewer_id": actor.user_id,
            "p_decision": "reject",
            "p_reason": request.reason,
        },
    ).execute()
    return result.data


@router.post("/proposals/{proposal_id}/rollback")
async def rollback_proposal(
    proposal_id: str,
    request: ProposalReview,
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    return await _review_proposal(
        proposal_id, actor, "rollback_knowledge_proposal", request.reason
    )
