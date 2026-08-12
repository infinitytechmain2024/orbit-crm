"""Small async PostgREST client for the AI Workflow backend.

It deliberately keeps the Supabase service-role key server-side. Every caller
must authenticate through ``require_workflow_actor`` before using this store.
"""

from __future__ import annotations

from typing import Any

import httpx
from fastapi import HTTPException

from backend.config import settings


class AIWorkflowStore:
    def __init__(self) -> None:
        self._client: httpx.AsyncClient | None = None

    @property
    def configured(self) -> bool:
        return bool(settings.SUPABASE_URL and settings.SUPABASE_SERVICE_ROLE_KEY)

    async def client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=30.0)
        return self._client

    def _service_headers(self, prefer: str | None = None) -> dict[str, str]:
        if not self.configured:
            raise HTTPException(status_code=503, detail="Supabase backend is not configured")
        headers = {
            "apikey": settings.SUPABASE_SERVICE_ROLE_KEY,
            "authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}",
            "content-type": "application/json",
        }
        if prefer:
            headers["prefer"] = prefer
        return headers

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str | int] | None = None,
        payload: Any = None,
        prefer: str | None = None,
    ) -> Any:
        client = await self.client()
        response = await client.request(
            method,
            f"{settings.SUPABASE_URL.rstrip('/')}/rest/v1/{path.lstrip('/')}",
            params=params,
            json=payload,
            headers=self._service_headers(prefer),
        )
        if response.status_code >= 400:
            try:
                detail = response.json().get("message") or response.json().get("details")
            except Exception:
                detail = response.text
            raise HTTPException(
                status_code=502,
                detail=f"Database request failed: {detail or response.status_code}",
            )
        if response.status_code == 204 or not response.content:
            return None
        return response.json()

    async def verify_user(self, access_token: str) -> dict[str, Any]:
        if not settings.SUPABASE_URL:
            raise HTTPException(status_code=503, detail="Supabase backend is not configured")
        api_key = settings.SUPABASE_PUBLISHABLE_KEY or settings.SUPABASE_SERVICE_ROLE_KEY
        if not api_key:
            raise HTTPException(status_code=503, detail="Supabase API key is not configured")
        client = await self.client()
        response = await client.get(
            f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1/user",
            headers={
                "apikey": api_key,
                "authorization": f"Bearer {access_token}",
            },
        )
        if response.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid or expired user session")
        user = response.json()
        if not user.get("id"):
            raise HTTPException(status_code=401, detail="Invalid authenticated user")
        return user

    async def select(
        self,
        table: str,
        *,
        organization_id: str | None = None,
        filters: dict[str, str] | None = None,
        columns: str = "*",
        order: str | None = None,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        params: dict[str, str | int] = {"select": columns}
        if organization_id:
            params["organization_id"] = f"eq.{organization_id}"
        if filters:
            params.update(filters)
        if order:
            params["order"] = order
        if limit is not None:
            params["limit"] = limit
        result = await self._request("GET", table, params=params)
        return result or []

    async def one(
        self,
        table: str,
        *,
        organization_id: str,
        row_id: str,
        columns: str = "*",
    ) -> dict[str, Any]:
        rows = await self.select(
            table,
            organization_id=organization_id,
            filters={"id": f"eq.{row_id}"},
            columns=columns,
            limit=1,
        )
        if not rows:
            raise HTTPException(status_code=404, detail=f"{table} row not found")
        return rows[0]

    async def insert(
        self,
        table: str,
        payload: dict[str, Any] | list[dict[str, Any]],
        *,
        upsert: bool = False,
        on_conflict: str | None = None,
    ) -> list[dict[str, Any]]:
        params = {"on_conflict": on_conflict} if on_conflict else None
        prefer = "return=representation"
        if upsert:
            prefer += ",resolution=merge-duplicates"
        result = await self._request(
            "POST",
            table,
            params=params,
            payload=payload,
            prefer=prefer,
        )
        return result or []

    async def update(
        self,
        table: str,
        *,
        organization_id: str,
        filters: dict[str, str],
        payload: dict[str, Any],
    ) -> list[dict[str, Any]]:
        params: dict[str, str] = {"organization_id": f"eq.{organization_id}"}
        params.update(filters)
        result = await self._request(
            "PATCH",
            table,
            params=params,
            payload=payload,
            prefer="return=representation",
        )
        return result or []

    async def rpc(self, name: str, payload: dict[str, Any]) -> Any:
        return await self._request("POST", f"rpc/{name}", payload=payload)

    async def ensure_membership(self, organization_id: str, user_id: str) -> None:
        rows = await self.select(
            "organization_members",
            filters={
                "organization_id": f"eq.{organization_id}",
                "user_id": f"eq.{user_id}",
            },
            columns="organization_id",
            limit=1,
        )
        if not rows:
            raise HTTPException(status_code=403, detail="You are not a member of this organization")


ai_workflow_store = AIWorkflowStore()
