from __future__ import annotations

import asyncio
import json
import logging
import os
import platform
import shlex
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
    agent_command: tuple[str, ...]
    job_timeout_seconds: float

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
        execution_enabled = os.getenv("SELFDEV_EXECUTION_ENABLED", "false").lower() == "true"
        command = tuple(shlex.split(os.getenv("SELFDEV_AGENT_COMMAND", "").strip()))
        if execution_enabled and not command:
            raise RuntimeError("SELFDEV_AGENT_COMMAND is required when execution is enabled")
        return cls(
            backend_url=required["SELFDEV_BACKEND_URL"].rstrip("/"),
            token=required["SELFDEV_PROVIDER_TOKEN"],
            organization_id=required["SELFDEV_ORGANIZATION_ID"],
            name=os.getenv("SELFDEV_PROVIDER_NAME", "local-docker-provider").strip(),
            heartbeat_seconds=max(5.0, float(os.getenv("SELFDEV_HEARTBEAT_SECONDS", "15"))),
            execution_enabled=execution_enabled,
            agent_command=command,
            job_timeout_seconds=max(60.0, float(os.getenv("SELFDEV_JOB_TIMEOUT_SECONDS", "1800"))),
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

    async def heartbeat(self, *, status: str = "available", active_runs: int = 0) -> None:
        if not self.provider_id:
            raise RuntimeError("Provider is not registered")
        response = await self.client.post(
            "/api/selfdev/providers/heartbeat",
            json={
                "provider_id": self.provider_id,
                "status": status,
                "active_runs": active_runs,
                "metadata": {"execution_enabled": self.config.execution_enabled},
            },
        )
        response.raise_for_status()

    async def lease(self) -> dict[str, Any] | None:
        if not self.provider_id:
            return None
        response = await self.client.post(
            "/api/selfdev/jobs/lease",
            json={"provider_id": self.provider_id},
        )
        response.raise_for_status()
        return response.json().get("job")

    async def update_run(
        self,
        job: dict[str, Any],
        status: str,
        *,
        message: str,
        result_summary: str | None = None,
        exit_code: int | None = None,
        error_class: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        response = await self.client.post(
            "/api/selfdev/runs/update",
            json={
                "provider_id": self.provider_id,
                "run_id": job["id"],
                "status": status,
                "message": message,
                "result_summary": result_summary,
                "exit_code": exit_code,
                "error_class": error_class,
                "metadata": metadata or {},
            },
        )
        response.raise_for_status()

    async def execute(self, job: dict[str, Any]) -> None:
        await self.update_run(job, "preparing", message="Preparing isolated development execution.")
        command = list(self.config.agent_command)
        repository = str(job.get("repository") or "")
        cwd = repository if repository and os.path.isdir(repository) else None
        env = {
            **os.environ,
            "SELFDEV_RUN_ID": str(job["id"]),
            "SELFDEV_WORKING_BRANCH": str(job["working_branch"]),
            "SELFDEV_BASE_COMMIT": str(job["base_commit"]),
            "SELFDEV_JOB_JSON": json.dumps(job, default=str),
        }
        await self.update_run(
            job,
            "running",
            message="Configured self-development agent started.",
            metadata={"command": command[0], "cwd_available": bool(cwd)},
        )
        process = await asyncio.create_subprocess_exec(
            *command,
            cwd=cwd,
            env=env,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        payload = (json.dumps(job, ensure_ascii=False, default=str) + "\n").encode()
        communicate = asyncio.create_task(process.communicate(payload))
        deadline = asyncio.get_running_loop().time() + self.config.job_timeout_seconds
        while not communicate.done():
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                process.kill()
                await process.wait()
                communicate.cancel()
                raise TimeoutError("Self-development agent exceeded job timeout")
            try:
                await asyncio.wait_for(asyncio.shield(communicate), timeout=min(self.config.heartbeat_seconds, remaining))
            except TimeoutError:
                await self.heartbeat(status="busy", active_runs=1)
        stdout, _ = communicate.result()
        output = stdout.decode("utf-8", errors="replace")[-12000:]
        if process.returncode != 0:
            await self.update_run(
                job,
                "failed",
                message="Self-development agent failed.",
                result_summary=output,
                exit_code=process.returncode,
                error_class="AgentCommandFailed",
            )
            return
        await self.update_run(job, "qa", message="Agent finished; result entered QA.")
        await self.update_run(
            job,
            "completed",
            message="Self-development run completed.",
            result_summary=output or "Agent completed without textual output.",
            exit_code=0,
        )

    async def run(self) -> None:
        while not self.stop_event.is_set():
            try:
                if not self.provider_id:
                    await self.register()
                await self.heartbeat()
                if self.config.execution_enabled:
                    job = await self.lease()
                    if job:
                        try:
                            await self.execute(job)
                        except Exception as exc:
                            logger.exception("development_run_failed run_id=%s", job.get("id"))
                            await self.update_run(
                                job,
                                "failed",
                                message="Provider failed while executing the run.",
                                result_summary=str(exc)[:2000],
                                exit_code=1,
                                error_class=type(exc).__name__,
                            )
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
