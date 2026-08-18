"""OpenClaw Gateway HTTP client.

Encapsulates all communication with the OpenClaw runtime.
Frontend NEVER talks to OpenClaw directly — always through Orbit FastAPI.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

from backend.config import settings

logger = logging.getLogger(__name__)

MAX_RETRIES = 2
RETRY_DELAY_SECONDS = 1.0


@dataclass
class OpenClawHealth:
    status: str = "offline"
    gateway: bool = False
    version: str = ""
    latency_ms: float = 0
    error: str | None = None


@dataclass
class OpenClawExecutionResult:
    success: bool = False
    task_id: str = ""
    run_id: str = ""
    agent_id: str = ""
    model: str = ""
    result: Any = None
    summary: str = ""
    error: str | None = None
    execution_time_ms: float = 0
    tools_used: list[str] = field(default_factory=list)
    skills_used: list[str] = field(default_factory=list)
    raw_response: dict[str, Any] = field(default_factory=dict)


class OpenClawClient:
    """Singleton HTTP client for OpenClaw Gateway communication."""

    def __init__(self) -> None:
        self._client: httpx.AsyncClient | None = None
        self._last_health: OpenClawHealth | None = None
        self._health_cache_time: float = 0
        self._health_cache_ttl: float = 10.0

    @property
    def _headers(self) -> dict[str, str]:
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if settings.OPENCLAW_GATEWAY_TOKEN:
            headers["Authorization"] = f"Bearer {settings.OPENCLAW_GATEWAY_TOKEN}"
        return headers

    @property
    def _base_url(self) -> str:
        return settings.OPENCLAW_URL.rstrip("/")

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(settings.OPENCLAW_REQUEST_TIMEOUT, connect=10.0),
                limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
            )
        return self._client

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    async def health(self, *, use_cache: bool = True) -> OpenClawHealth:
        """Check OpenClaw gateway health with short TTL cache."""
        now = time.monotonic()
        if (
            use_cache
            and self._last_health is not None
            and (now - self._health_cache_time) < self._health_cache_ttl
        ):
            return self._last_health

        start = time.monotonic()
        try:
            client = await self._get_client()
            response = await client.get(
                f"{self._base_url}/healthz",
                headers=self._headers,
            )
            latency = (time.monotonic() - start) * 1000
            if response.status_code == 200:
                data = response.json()
                result = OpenClawHealth(
                    status="online",
                    gateway=True,
                    version=str(data.get("version", "")),
                    latency_ms=round(latency, 1),
                )
            else:
                result = OpenClawHealth(
                    status="error",
                    error=f"HTTP {response.status_code}",
                    latency_ms=round(latency, 1),
                )
        except httpx.ConnectError:
            result = OpenClawHealth(status="offline", error="Connection refused")
        except Exception as exc:
            result = OpenClawHealth(status="error", error=str(exc)[:200])

        self._last_health = result
        self._health_cache_time = time.monotonic()
        return result

    async def execute_chat(
        self,
        task_id: str,
        message: str,
        *,
        agent_id: str | None = None,
        model_override: str | None = None,
        system_prompt: str | None = None,
        context: dict[str, Any] | None = None,
    ) -> OpenClawExecutionResult:
        """Execute a task via OpenClaw /v1/chat/completions endpoint.

        Includes context in the request body so the agent has full task metadata.
        Retries once on transient errors.
        """
        start = time.monotonic()
        messages: list[dict[str, str]] = []

        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})

        user_content = message
        if context:
            import json
            context_block = "\n\n[Task Context]\n" + json.dumps(context, indent=2, default=str)
            user_content = message + context_block

        messages.append({"role": "user", "content": user_content})

        body: dict[str, Any] = {
            "model": model_override or "openclaw/default",
            "messages": messages,
            "stream": False,
        }

        extra_headers = dict(self._headers)
        if agent_id:
            extra_headers["x-openclaw-agent-id"] = agent_id
        if model_override:
            extra_headers["x-openclaw-model"] = model_override

        last_error: str | None = None
        for attempt in range(MAX_RETRIES + 1):
            try:
                client = await self._get_client()
                response = await client.post(
                    f"{self._base_url}/v1/chat/completions",
                    json=body,
                    headers=extra_headers,
                )
                elapsed = (time.monotonic() - start) * 1000
                response.raise_for_status()
                data = response.json()

                content = ""
                if data.get("choices"):
                    content = data["choices"][0].get("message", {}).get("content", "")

                return OpenClawExecutionResult(
                    success=True,
                    task_id=task_id,
                    result=content,
                    summary=content[:500] if content else "",
                    execution_time_ms=round(elapsed, 1),
                    model=data.get("model", body["model"]),
                    raw_response=data,
                )
            except httpx.ConnectError:
                last_error = "OPENCLAW_UNAVAILABLE"
                if attempt < MAX_RETRIES:
                    logger.warning(
                        "OpenClaw connection failed (attempt %d/%d), retrying in %ss",
                        attempt + 1, MAX_RETRIES + 1, RETRY_DELAY_SECONDS,
                    )
                    import asyncio
                    await asyncio.sleep(RETRY_DELAY_SECONDS)
            except httpx.HTTPStatusError as exc:
                elapsed = (time.monotonic() - start) * 1000
                return OpenClawExecutionResult(
                    success=False,
                    task_id=task_id,
                    error=f"HTTP {exc.response.status_code}: {exc.response.text[:500]}",
                    execution_time_ms=round(elapsed, 1),
                )
            except Exception as exc:
                last_error = str(exc)[:2000]
                if attempt < MAX_RETRIES:
                    logger.warning(
                        "OpenClaw request failed (attempt %d/%d), retrying: %s",
                        attempt + 1, MAX_RETRIES + 1, exc,
                    )
                    import asyncio
                    await asyncio.sleep(RETRY_DELAY_SECONDS)

        elapsed = (time.monotonic() - start) * 1000
        return OpenClawExecutionResult(
            success=False,
            task_id=task_id,
            error=last_error or "UNKNOWN_ERROR",
            execution_time_ms=round(elapsed, 1),
        )

    async def list_agents(self) -> list[dict[str, Any]]:
        """List available OpenClaw agents/models."""
        try:
            client = await self._get_client()
            response = await client.get(
                f"{self._base_url}/v1/models",
                headers=self._headers,
            )
            response.raise_for_status()
            data = response.json()
            return data.get("data", [])
        except Exception as exc:
            logger.warning("OpenClaw list agents failed: %s", exc)
            return []


openclaw_client = OpenClawClient()
