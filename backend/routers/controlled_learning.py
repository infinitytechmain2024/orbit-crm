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


class ProposalCreate(BaseModel):
    organization_id: str = Field(min_length=36, max_length=36)
    target_type: Literal["template", "business_process"]
    title: str = Field(min_length=1, max_length=240)
    rationale: str = Field(min_length=1, max_length=12000)
    evidence: list[dict[str, Any]] = Field(default_factory=list)
    proposed_content: dict[str, Any]
    risk_level: Literal["low", "medium", "high", "critical"] = "medium"
    confidence: float | None = Field(default=None, ge=0, le=1)


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
    rows = await ai_workflow_store.insert(
        "ai_improvement_proposals",
        {**request.model_dump(), "created_by": actor.user_id, "status": "pending_review"},
    )
    return rows[0]


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
    result = supabase_service.client.rpc(
        "review_improvement_proposal",
        {
            "p_proposal_id": proposal_id,
            "p_reviewer_id": actor.user_id,
            "p_decision": "approve",
            "p_reason": request.reason,
        },
    ).execute()
    return result.data


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
