from __future__ import annotations

import logging
import re
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.auth import require_internal_token
from backend.config import settings
from backend.services.ai_workflow_store import ai_workflow_store

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/internal",
    tags=["internal"],
    dependencies=[Depends(require_internal_token)],
)

GITHUB_API = "https://api.github.com"


@router.get("/health")
async def internal_health():
    return {"status": "ok", "service": settings.APP_NAME, "version": settings.APP_VERSION}


class SupabaseProjectWebhook(BaseModel):
    """Payload shape sent by a Supabase Database Webhook."""

    type: str
    table: str
    record: dict[str, Any]


def _repo_name_for_project(name: str, project_id: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40] or "project"
    short_id = str(project_id).replace("-", "")[:8]
    return f"{slug}-{short_id}"


@router.post("/projects/provision-repo")
async def provision_project_repo(payload: SupabaseProjectWebhook):
    """Auto-creates a dedicated GitHub repository for every new CRM Project.

    Triggered by a Supabase Database Webhook on INSERT into public.projects
    (configured manually in the Supabase dashboard, not in code — this is the
    single choke point that catches project creation regardless of whether it
    happened through the CRM UI or the AI workflow planner).
    """
    if payload.table != "projects" or payload.type != "INSERT":
        return {"skipped": True, "reason": "not a projects insert"}

    record = payload.record
    project_id = str(record.get("id") or "")
    organization_id = str(record.get("organization_id") or "")
    name = str(record.get("name") or "project")
    if not project_id or not organization_id:
        raise HTTPException(status_code=400, detail="Webhook payload is missing project id/organization_id")

    token = settings.GITHUB_TOKEN
    if not token:
        logger.warning("provision_project_repo: GITHUB_TOKEN is not configured, skipping repo creation")
        return {"skipped": True, "reason": "GITHUB_TOKEN is not configured"}

    repo_name = _repo_name_for_project(name, project_id)
    create_path = f"/orgs/{settings.GITHUB_PROJECTS_ORG}/repos" if settings.GITHUB_PROJECTS_ORG else "/user/repos"

    async with httpx.AsyncClient(
        base_url=GITHUB_API,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        timeout=30.0,
    ) as client:
        response = await client.post(
            create_path,
            json={"name": repo_name, "private": True, "description": f"Orbit CRM project: {name}"[:350]},
        )

    if response.status_code >= 400:
        error_text = response.text[:500]
        logger.error("provision_project_repo failed for project %s: %s", project_id, error_text)
        await ai_workflow_store.update(
            "projects",
            organization_id=organization_id,
            filters={"id": f"eq.{project_id}"},
            payload={"github_repo_status": "failed"},
        )
        return {"success": False, "error": error_text}

    data = response.json()
    await ai_workflow_store.update(
        "projects",
        organization_id=organization_id,
        filters={"id": f"eq.{project_id}"},
        payload={
            "github_repo_owner": (data.get("owner") or {}).get("login"),
            "github_repo_name": data.get("name"),
            "github_repo_url": data.get("html_url"),
            "github_repo_status": "created",
        },
    )
    return {"success": True, "repo_url": data.get("html_url")}
