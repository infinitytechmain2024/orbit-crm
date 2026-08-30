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


def _short_error(exc: Exception) -> str:
    """Compact, secret-free description of a failure for the webhook response."""
    return f"{type(exc).__name__}: {str(exc)[:200]}"


async def _mark_repo_failed(organization_id: str, project_id: str) -> str | None:
    """Best-effort `github_repo_status = failed`. Returns an error string if the
    write itself failed, so the caller can report *which* step actually broke."""
    try:
        await ai_workflow_store.update(
            "projects",
            organization_id=organization_id,
            filters={"id": f"eq.{project_id}"},
            payload={"github_repo_status": "failed"},
        )
        return None
    except Exception as exc:
        logger.exception("provision_project_repo: could not mark project %s as failed", project_id)
        return _short_error(exc)


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
        logger.error(
            "provision_project_repo: GitHub %s %s -> %s: %s",
            create_path, repo_name, response.status_code, error_text,
        )
        db_error = await _mark_repo_failed(organization_id, project_id)
        return {
            "success": False,
            "stage": "github",
            "github_status": response.status_code,
            "error": error_text,
            "db_write_error": db_error,
        }

    data = response.json()
    repo_url = data.get("html_url")
    try:
        await ai_workflow_store.update(
            "projects",
            organization_id=organization_id,
            filters={"id": f"eq.{project_id}"},
            payload={
                "github_repo_owner": (data.get("owner") or {}).get("login"),
                "github_repo_name": data.get("name"),
                "github_repo_url": repo_url,
                "github_repo_status": "created",
            },
        )
    except Exception as exc:
        # The repository exists — losing the DB write must not read as a total
        # failure, or a retry would try to create the same repository again.
        logger.exception("provision_project_repo: repo %s created but DB write failed", repo_name)
        return {
            "success": True,
            "repo_url": repo_url,
            "warning": "repository created but project row was not updated",
            "db_write_error": _short_error(exc),
        }
    return {"success": True, "repo_url": repo_url}
