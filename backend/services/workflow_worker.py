"""Async workers for the durable Orbit Commander queue."""

from __future__ import annotations

import asyncio
import logging
import socket
from datetime import UTC, datetime, timedelta
from typing import Any

from backend.config import settings
from backend.services.ai_providers import redact_error
from backend.services.ai_workflow_store import AIWorkflowStore, ai_workflow_store
from backend.services.orbit_commander import OrbitCommander, orbit_commander

logger = logging.getLogger(__name__)


class WorkflowWorker:
    def __init__(
        self,
        store: AIWorkflowStore = ai_workflow_store,
        commander: OrbitCommander = orbit_commander,
    ) -> None:
        self.store = store
        self.commander = commander
        self._stop = asyncio.Event()
        self._tasks: list[asyncio.Task[None]] = []
        self._worker_prefix = f"{socket.gethostname()}:{id(self)}"

    async def start(self) -> None:
        if self._tasks or not settings.AI_WORKFLOW_WORKER_ENABLED or not self.store.configured:
            return
        self._stop.clear()
        concurrency = max(1, min(settings.AI_WORKFLOW_WORKER_CONCURRENCY, 20))
        self._tasks = [
            asyncio.create_task(self._loop(index), name=f"orbit-workflow-{index}")
            for index in range(concurrency)
        ]
        logger.info("Orbit Commander queue started with %s workers", concurrency)

    async def stop(self) -> None:
        if not self._tasks:
            return
        self._stop.set()
        for task in self._tasks:
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()
        logger.info("Orbit Commander queue stopped")

    async def _claim(self, worker_id: str) -> dict[str, Any] | None:
        result = await self.store.rpc("claim_workflow_job", {"p_worker_id": worker_id})
        if isinstance(result, list) and result:
            return result[0]
        if isinstance(result, dict) and result.get("id"):
            return result
        return None

    async def _loop(self, index: int) -> None:
        worker_id = f"{self._worker_prefix}:{index}"
        poll = max(0.25, settings.AI_WORKFLOW_POLL_INTERVAL_SECONDS)
        while not self._stop.is_set():
            try:
                job = await self._claim(worker_id)
                if not job:
                    await asyncio.sleep(poll)
                    continue
                await self._process(job)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                logger.exception("Orbit queue worker loop failed: %s", redact_error(error))
                await asyncio.sleep(min(poll * 2, 5.0))

    async def _process(self, job: dict[str, Any]) -> None:
        try:
            await asyncio.wait_for(
                self.commander.process_job(job),
                timeout=max(30, int(job.get("timeout_seconds") or 900)),
            )
            await self.store.update(
                "workflow_jobs",
                organization_id=job["organization_id"],
                filters={"id": f"eq.{job['id']}", "status": "eq.leased"},
                payload={"status": "succeeded", "completed_at": datetime.now(UTC).isoformat()},
            )
        except Exception as error:
            attempts = int(job.get("attempts") or 1)
            max_attempts = int(job.get("max_attempts") or 3)
            safe_error = {"type": type(error).__name__, "message": redact_error(error)}
            if attempts < max_attempts:
                delay = min(2**attempts, 60)
                await self.store.update(
                    "workflow_jobs",
                    organization_id=job["organization_id"],
                    filters={"id": f"eq.{job['id']}"},
                    payload={
                        "status": "queued",
                        "available_at": (datetime.now(UTC) + timedelta(seconds=delay)).isoformat(),
                        "locked_at": None,
                        "locked_by": None,
                        "last_error": safe_error,
                    },
                )
                logger.warning("Workflow job %s will retry: %s", job["id"], safe_error["message"])
                return

            await self.store.update(
                "workflow_jobs",
                organization_id=job["organization_id"],
                filters={"id": f"eq.{job['id']}"},
                payload={
                    "status": "failed",
                    "last_error": safe_error,
                    "completed_at": datetime.now(UTC).isoformat(),
                },
            )
            task = await self.store.one(
                "ai_tasks",
                organization_id=job["organization_id"],
                row_id=job["task_id"],
            )
            run = await self.store.one(
                "workflow_runs",
                organization_id=job["organization_id"],
                row_id=job["workflow_run_id"],
            )
            await self.store.update(
                "ai_tasks",
                organization_id=job["organization_id"],
                filters={"id": f"eq.{task['id']}"},
                payload={"status": "blocked", "blocker_reason": safe_error["message"]},
            )
            await self.commander.create_event(
                task,
                "blocked",
                "Этап заблокирован после исчерпания retry policy.",
                metadata={"job_id": job["id"], "error_type": safe_error["type"]},
            )
            await self.commander._block_workflow(run, task, safe_error["message"])
            logger.error("Workflow job %s exhausted retries: %s", job["id"], safe_error["message"])


workflow_worker = WorkflowWorker()
