from __future__ import annotations

from dataclasses import dataclass
from secrets import compare_digest
from typing import Optional

from fastapi import Header, HTTPException

from backend.config import settings
from backend.services.ai_workflow_store import ai_workflow_store


async def require_internal_token(authorization: str = Header(default="")):
    expected = settings.INTERNAL_API_TOKEN
    if not expected:
        raise HTTPException(status_code=503, detail="Internal API token is not configured")
    if not compare_digest(authorization, f"Bearer {expected}"):
        raise HTTPException(status_code=401, detail="Invalid or missing bearer token")


@dataclass(frozen=True)
class WorkflowActor:
    user_id: str
    email: Optional[str]
ROLE_PERMISSIONS: dict[str, set[str]] = {
    "owner": {"*"},
    "admin": {"*"},
    "manager": {"workflow.read", "workflow.create", "workflow.control"},
    "accountant": {"workflow.read", "workflow.create"},
    "member": {"workflow.read", "workflow.create"},
}


async def require_workflow_permission(
    organization_id: str,
    actor: WorkflowActor,
    permission: str,
) -> str:
    """Enforce the organization role before using the service-role store."""

    role = await ai_workflow_store.membership_role(organization_id, actor.user_id)
    allowed = ROLE_PERMISSIONS.get(role, set())
    if "*" not in allowed and permission not in allowed:
        raise HTTPException(status_code=403, detail=f"Permission required: {permission}")
    return role


async def require_workflow_actor(
    authorization: str = Header(default=""),
    x_supabase_authorization: str = Header(
        default="",
        alias="X-Supabase-Authorization",
    ),
) -> WorkflowActor:
    """Authenticate both the trusted frontend proxy and the Supabase user."""

    await require_internal_token(authorization)
    prefix = "Bearer "
    if not x_supabase_authorization.startswith(prefix):
        raise HTTPException(status_code=401, detail="Missing authenticated user session")
    access_token = x_supabase_authorization[len(prefix) :].strip()
    if not access_token:
        raise HTTPException(status_code=401, detail="Missing authenticated user session")
    user = await ai_workflow_store.verify_user(access_token)
    return WorkflowActor(user_id=str(user["id"]), email=user.get("email"))
