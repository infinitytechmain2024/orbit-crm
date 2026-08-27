from __future__ import annotations

"""Provider protocol for local Docker Self-Development runners."""

from datetime import datetime, timedelta, timezone
from hashlib import sha256
from secrets import compare_digest
from typing import Any, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from backend.auth import WorkflowActor, require_workflow_actor, require_workflow_permission
from backend.config import settings
from backend.services.ai_workflow_store import ai_workflow_store


router = APIRouter(prefix="/api/selfdev", tags=["Self Development"])


def _token_hash(token: str) -> str:
    return sha256(token.encode("utf-8")).hexdigest()


async def require_selfdev_provider(authorization: str = Header(default="")) -> str:
    expected = settings.SELFDEV_PROVIDER_TOKEN
    if not expected:
        raise HTTPException(status_code=503, detail="Self-development provider token is not configured")
    supplied = authorization.removeprefix("Bearer ").strip()
    if not supplied or not compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="Invalid or missing provider token")
    return _token_hash(supplied)


class ProviderRegisterRequest(BaseModel):
    organization_id: UUID
    name: str = Field(min_length=1, max_length=120)
    platform: str = Field(min_length=1, max_length=80)
    architecture: str = Field(min_length=1, max_length=40)
    capabilities: list[str] = Field(default_factory=list, max_length=40)
    max_concurrent_runs: int = Field(default=1, ge=1, le=8)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ProviderHeartbeatRequest(BaseModel):
    provider_id: UUID
    status: Literal["available", "busy", "draining", "degraded"] = "available"
    active_runs: int = Field(default=0, ge=0, le=8)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ProviderLeaseRequest(BaseModel):
    provider_id: UUID


class DevelopmentRunCreateRequest(BaseModel):
    organization_id: UUID
    workflow_run_id: UUID
    repository: str = Field(min_length=1, max_length=500)
    base_branch: str = Field(default="main", min_length=1, max_length=200)
    base_commit: str = Field(min_length=7, max_length=64)
    idempotency_key: str = Field(min_length=8, max_length=200)


RUN_STATUSES = Literal[
    "preparing", "running", "controller_review", "qa", "awaiting_approval",
    "approved", "pushing", "preview_deployed", "verified", "completed",
    "waiting_for_model", "waiting_for_dependency", "revision_required",
    "paused", "failed", "cancelled", "rolled_back",
]


class DevelopmentRunUpdateRequest(BaseModel):
    provider_id: UUID
    run_id: UUID
    status: RUN_STATUSES
    message: str = Field(default="", max_length=4000)
    result_summary: str | None = Field(default=None, max_length=12000)
    exit_code: int | None = None
    error_class: str | None = Field(default=None, max_length=200)
    metadata: dict[str, Any] = Field(default_factory=dict)


@router.post("/providers/register")
async def register_provider(
    request: ProviderRegisterRequest,
    token_hash: str = Depends(require_selfdev_provider),
):
    organization_id = str(request.organization_id)
    existing = await ai_workflow_store.select(
        "development_providers",
        organization_id=organization_id,
        filters={"name": f"eq.{request.name}"},
        limit=1,
    )
    payload = {
        "organization_id": organization_id,
        "name": request.name,
        "provider_type": "self_hosted_docker",
        "platform": request.platform,
        "architecture": request.architecture,
        "capabilities": sorted(set(request.capabilities)),
        "status": "available",
        "max_concurrent_runs": request.max_concurrent_runs,
        "active_runs": 0,
        "last_heartbeat_at": datetime.now(timezone.utc).isoformat(),
        "token_hash": token_hash,
        "metadata": request.metadata,
    }
    if existing:
        rows = await ai_workflow_store.update(
            "development_providers",
            organization_id=organization_id,
            filters={"id": f"eq.{existing[0]['id']}"},
            payload=payload,
        )
    else:
        members = await ai_workflow_store.select(
            "organization_members",
            organization_id=organization_id,
            columns="user_id",
            order="created_at.asc",
            limit=1,
        )
        if not members:
            raise HTTPException(status_code=404, detail="Organization has no member to own provider registration")
        payload["created_by"] = members[0]["user_id"]
        rows = await ai_workflow_store.insert("development_providers", payload)
    if not rows:
        raise HTTPException(status_code=502, detail="Provider registration was not persisted")
    provider = rows[0]
    return {"provider_id": provider["id"], "status": provider["status"]}


@router.post("/providers/heartbeat")
async def provider_heartbeat(
    request: ProviderHeartbeatRequest,
    _: str = Depends(require_selfdev_provider),
):
    rows = await ai_workflow_store.select(
        "development_providers",
        filters={"id": f"eq.{request.provider_id}"},
        limit=1,
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Provider not found")
    provider = rows[0]
    updated = await ai_workflow_store.update(
        "development_providers",
        organization_id=provider["organization_id"],
        filters={"id": f"eq.{request.provider_id}"},
        payload={
            "status": request.status,
            "active_runs": request.active_runs,
            "last_heartbeat_at": datetime.now(timezone.utc).isoformat(),
            "metadata": request.metadata,
        },
    )
    return {"provider_id": str(request.provider_id), "status": updated[0]["status"]}


@router.post("/jobs/lease")
async def lease_job(
    request: ProviderLeaseRequest,
    _: str = Depends(require_selfdev_provider),
):
    result = await ai_workflow_store.rpc(
        "claim_selfdev_development_run",
        {
            "p_provider_id": str(request.provider_id),
            "p_lease_seconds": settings.SELFDEV_PROVIDER_LEASE_SECONDS,
        },
    )
    rows = result or []
    if not rows:
        return {"job": None}
    job = rows[0]
    await ai_workflow_store.update(
        "development_providers",
        organization_id=job["organization_id"],
        filters={"id": f"eq.{request.provider_id}"},
        payload={"status": "busy", "active_runs": 1},
    )
    await ai_workflow_store.insert(
        "development_run_events",
        {
            "organization_id": job["organization_id"],
            "development_run_id": job["id"],
            "event_type": "leased",
            "message": "Self-development provider accepted the run.",
            "metadata": {"provider_id": str(request.provider_id), "attempt": job["attempt"]},
        },
    )
    return {"job": job}


@router.post("/runs/update")
async def update_development_run(
    request: DevelopmentRunUpdateRequest,
    _: str = Depends(require_selfdev_provider),
):
    rows = await ai_workflow_store.select(
        "development_runs",
        filters={"id": f"eq.{request.run_id}"},
        limit=1,
    )
    if not rows or str(rows[0].get("provider_id")) != str(request.provider_id):
        raise HTTPException(status_code=404, detail="Development run not assigned to provider")
    run = rows[0]
    terminal = request.status in {"completed", "failed", "cancelled", "rolled_back"}
    payload: dict[str, Any] = {
        "status": request.status,
        "result_summary": request.result_summary,
        "exit_code": request.exit_code,
        "error_class": request.error_class,
        "metadata": {**(run.get("metadata") or {}), **request.metadata},
    }
    if terminal:
        payload["completed_at"] = datetime.now(timezone.utc).isoformat()
        payload["leased_until"] = None
    updated = await ai_workflow_store.update(
        "development_runs",
        organization_id=run["organization_id"],
        filters={"id": f"eq.{request.run_id}"},
        payload=payload,
    )
    await ai_workflow_store.insert(
        "development_run_events",
        {
            "organization_id": run["organization_id"],
            "development_run_id": str(request.run_id),
            "event_type": request.status,
            "message": request.message or request.status.replace("_", " ").title(),
            "metadata": request.metadata,
        },
    )
    if terminal:
        await ai_workflow_store.update(
            "development_providers",
            organization_id=run["organization_id"],
            filters={"id": f"eq.{request.provider_id}"},
            payload={"status": "available", "active_runs": 0},
        )
    return {"run": updated[0] if updated else None}


@router.get("/status")
async def selfdev_status(
    organization_id: UUID,
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    organization = str(organization_id)
    await require_workflow_permission(organization, actor, "workflow.read")
    providers = await ai_workflow_store.select(
        "development_providers",
        organization_id=organization,
        order="created_at.desc",
        limit=20,
    )
    stale_before = datetime.now(timezone.utc) - timedelta(seconds=60)
    for provider in providers:
        heartbeat = provider.get("last_heartbeat_at")
        if heartbeat:
            parsed = datetime.fromisoformat(str(heartbeat).replace("Z", "+00:00"))
            if parsed < stale_before and provider.get("status") not in {"disabled", "draining"}:
                provider["status"] = "offline"
    runs = await ai_workflow_store.select(
        "development_runs",
        organization_id=organization,
        order="created_at.desc",
        limit=50,
    )
    run_ids = [str(run["id"]) for run in runs]
    events = []
    if run_ids:
        events = await ai_workflow_store.select(
            "development_run_events",
            organization_id=organization,
            filters={"development_run_id": f"in.({','.join(run_ids)})"},
            order="created_at.desc",
            limit=200,
        )
    return {"providers": providers, "runs": runs, "events": events}


@router.post("/runs")
async def create_development_run(
    request: DevelopmentRunCreateRequest,
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    organization_id = str(request.organization_id)
    await require_workflow_permission(organization_id, actor, "workflow.create")
    short_id = uuid4().hex[:12]
    rows = await ai_workflow_store.insert(
        "development_runs",
        {
            "organization_id": organization_id,
            "workflow_run_id": str(request.workflow_run_id),
            "repository": request.repository,
            "base_branch": request.base_branch,
            "base_commit": request.base_commit,
            "working_branch": f"codex/selfdev-{short_id}",
            "status": "queued",
            "idempotency_key": request.idempotency_key,
            "metadata": {"requested_by": actor.user_id},
        },
        upsert=True,
        on_conflict="organization_id,idempotency_key",
    )
    return {"run": rows[0]}
