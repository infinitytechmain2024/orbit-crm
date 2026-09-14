"""Async workers for the durable Orbit Commander queue."""

from __future__ import annotations

import asyncio
import logging
import socket
import time
from datetime import datetime, timedelta, timezone
from typing import Optional, Any

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
        self._clock = time.monotonic
        self._last_sweep = float("-inf")

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

    async def claim_once(self, worker_id: str = "api:kickoff") -> dict[str, Any] | None:
        """Try to claim one queued job without starting the full background loop."""
        return await self._claim(worker_id)

    async def _maybe_sweep(self, index: int) -> None:
        """Fail abandoned jobs that ran out of attempts; one worker per process sweeps.

        The SQL function blocks task, run and root task atomically; here we only
        record a visible event for each returned job.
        """
        if index != 0:
            return
        now = self._clock()
        interval = max(5.0, settings.AI_WORKFLOW_SWEEP_INTERVAL_SECONDS)
        if now - self._last_sweep < interval:
            return
        self._last_sweep = now
        try:
            rows = await self.store.rpc("fail_exhausted_workflow_jobs", {})
        except Exception as error:
            logger.warning("Workflow lease sweep failed: %s", redact_error(error))
            return
        for job in rows or []:
            logger.error("Workflow job %s abandoned with no attempts left", job["id"])
            try:
                task = await self.store.one(
                    "ai_tasks",
                    organization_id=job["organization_id"],
                    row_id=job["task_id"],
                )
                await self.commander.create_event(
                    task,
                    "blocked",
                    "Этап заблокирован: worker потерян, попытки исчерпаны.",
                    metadata={"job_id": job["id"], "error_type": "LeaseExpired"},
                )
            except Exception as error:
                logger.warning(
                    "Failed to record blocked event for job %s: %s", job["id"], redact_error(error)
                )

    async def _loop(self, index: int) -> None:
        worker_id = f"{self._worker_prefix}:{index}"
        poll = max(0.25, settings.AI_WORKFLOW_POLL_INTERVAL_SECONDS)
        while not self._stop.is_set():
            try:
                await self._maybe_sweep(index)
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
        await self._report_recovery(job)
        try:
            await asyncio.wait_for(
                self.commander.process_job(job),
                timeout=max(30, int(job.get("timeout_seconds") or 900)),
            )
            rows = await self.store.update(
                "workflow_jobs",
                organization_id=job["organization_id"],
                filters=self._lease_filters(job),
                payload={"status": "succeeded", "completed_at": datetime.now(timezone.utc).isoformat()},
            )
            if not rows:
                logger.warning("Workflow job %s lease was lost before completion was recorded", job["id"])
        except Exception as error:
            attempts = int(job.get("attempts") or 1)
            max_attempts = int(job.get("max_attempts") or 3)
            safe_error = {"type": type(error).__name__, "message": redact_error(error)}
            if attempts < max_attempts:
                delay = min(2**attempts, 60)
                rows = await self.store.update(
                    "workflow_jobs",
                    organization_id=job["organization_id"],
                    filters=self._lease_filters(job),
                    payload={
                        "status": "queued",
                        "available_at": (datetime.now(timezone.utc) + timedelta(seconds=delay)).isoformat(),
                        "locked_at": None,
                        "locked_by": None,
                        "last_error": safe_error,
                    },
                )
                if not rows:
                    logger.warning("Workflow job %s lease was lost; retry not scheduled", job["id"])
                    return
                logger.warning("Workflow job %s will retry: %s", job["id"], safe_error["message"])
                return

            await self._block_exhausted(job, safe_error)

    async def _report_recovery(self, job: dict[str, Any]) -> None:
        error = job.get("last_error") or {}
        if error.get("type") != "LeaseExpired" or error.get("attempt") != job.get("attempts"):
            return
        logger.warning(
            "Recovered stale workflow job %s from %s",
            job["id"],
            error.get("previous_worker") or "unknown worker",
        )
        try:
            task = await self.store.one(
                "ai_tasks",
                organization_id=job["organization_id"],
                row_id=job["task_id"],
            )
            await self.commander.create_event(
                task,
                "recovered",
                "Этап восстановлен после потери worker'а.",
                metadata={"job_id": job["id"], "attempt": job.get("attempts")},
            )
        except Exception as event_error:
            logger.warning("Failed to record workflow recovery event: %s", redact_error(event_error))

    async def _block_exhausted(self, job: dict[str, Any], safe_error: dict[str, str]) -> None:
        rows = await self.store.update(
            "workflow_jobs",
            organization_id=job["organization_id"],
            filters=self._lease_filters(job),
            payload={
                "status": "failed",
                "last_error": safe_error,
                "completed_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        if not rows:
            logger.warning("Workflow job %s lease was lost; not blocking the workflow", job["id"])
            return
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

    @staticmethod
    def _lease_filters(job: dict[str, Any]) -> dict[str, str]:
        """Match the job only while this worker's lease (identified by attempt) is current."""
        return {
            "id": f"eq.{job['id']}",
            "status": "eq.leased",
            "attempts": f"eq.{job['attempts']}",
        }


workflow_worker = WorkflowWorker()
