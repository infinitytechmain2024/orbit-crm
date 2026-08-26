from __future__ import annotations

import asyncio
import logging
import os
import platform
import signal
from dataclasses import dataclass
from typing import Any

import httpx


logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("orbit.selfdev.provider")


@dataclass(frozen=True)
class ProviderConfig:
    backend_url: str
    token: str
    organization_id: str
    name: str
    heartbeat_seconds: float
    execution_enabled: bool

    @classmethod
    def from_env(cls) -> "ProviderConfig":
        required = {
            "SELFDEV_BACKEND_URL": os.getenv("SELFDEV_BACKEND_URL", "").strip(),
            "SELFDEV_PROVIDER_TOKEN": os.getenv("SELFDEV_PROVIDER_TOKEN", "").strip(),
            "SELFDEV_ORGANIZATION_ID": os.getenv("SELFDEV_ORGANIZATION_ID", "").strip(),
        }
        missing = [name for name, value in required.items() if not value]
        if missing:
            raise RuntimeError(f"Missing required environment variables: {', '.join(missing)}")
        return cls(
            backend_url=required["SELFDEV_BACKEND_URL"].rstrip("/"),
            token=required["SELFDEV_PROVIDER_TOKEN"],
            organization_id=required["SELFDEV_ORGANIZATION_ID"],
            name=os.getenv("SELFDEV_PROVIDER_NAME", "local-docker-provider").strip(),
            heartbeat_seconds=max(5.0, float(os.getenv("SELFDEV_HEARTBEAT_SECONDS", "15"))),
            execution_enabled=os.getenv("SELFDEV_EXECUTION_ENABLED", "false").lower() == "true",
        )


class SelfDevProvider:
    def __init__(self, config: ProviderConfig) -> None:
        self.config = config
        self.provider_id: str | None = None
        self.stop_event = asyncio.Event()
        self.client = httpx.AsyncClient(
            base_url=config.backend_url,
            headers={"Authorization": f"Bearer {config.token}"},
            timeout=30.0,
        )

    async def register(self) -> None:
        payload: dict[str, Any] = {
            "organization_id": self.config.organization_id,
            "name": self.config.name,
            "platform": platform.system().lower(),
            "architecture": platform.machine().lower(),
            "capabilities": ["docker", "git", "node", "python", "frontend", "backend", "qa"],
            "max_concurrent_runs": 1,
            "metadata": {"provider_version": "0.1.0", "execution_enabled": self.config.execution_enabled},
        }
        response = await self.client.post("/api/selfdev/providers/register", json=payload)
        response.raise_for_status()
        self.provider_id = str(response.json()["provider_id"])
        logger.info("provider_registered provider_id=%s", self.provider_id)

    async def heartbeat(self) -> None:
        if not self.provider_id:
            raise RuntimeError("Provider is not registered")
        response = await self.client.post(
            "/api/selfdev/providers/heartbeat",
            json={
                "provider_id": self.provider_id,
                "status": "available",
                "active_runs": 0,
                "metadata": {"execution_enabled": self.config.execution_enabled},
            },
        )
        response.raise_for_status()

    async def run(self) -> None:
        while not self.stop_event.is_set():
            try:
                if not self.provider_id:
                    await self.register()
                await self.heartbeat()
            except Exception as exc:
                logger.warning("provider_sync_failed error=%s", str(exc)[:500])
                self.provider_id = None
            try:
                await asyncio.wait_for(self.stop_event.wait(), timeout=self.config.heartbeat_seconds)
            except TimeoutError:
                pass

    async def close(self) -> None:
        self.stop_event.set()
        await self.client.aclose()


async def main() -> None:
    provider = SelfDevProvider(ProviderConfig.from_env())
    loop = asyncio.get_running_loop()
    for signal_name in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(signal_name, provider.stop_event.set)
    try:
        await provider.run()
    finally:
        await provider.close()


if __name__ == "__main__":
    asyncio.run(main())
