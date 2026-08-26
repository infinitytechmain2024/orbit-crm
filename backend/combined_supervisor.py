from __future__ import annotations

"""Run FastAPI and an internal OpenClaw gateway in one Render container."""

import asyncio
import json
import logging
import os
from pathlib import Path
import shutil
import signal
from urllib.request import urlopen


logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("orbit.combined")

OPENCLAW_HEALTH_URL = "http://127.0.0.1:18789/healthz"


def prepare_openclaw_config() -> None:
    config_path = Path(
        os.getenv("OPENCLAW_CONFIG_PATH", "/home/node/.openclaw/openclaw.json")
    )
    config_path.parent.mkdir(parents=True, exist_ok=True)
    Path(os.getenv("OPENCLAW_WORKSPACE_DIR", "/home/node/.openclaw/workspace")).mkdir(
        parents=True,
        exist_ok=True,
    )
    if not config_path.exists() or config_path.stat().st_size == 0:
        shutil.copyfile("/app/orbit/openclaw.default.json", config_path)
        config_path.chmod(0o600)

    default_model = os.getenv("OPENCLAW_DEFAULT_MODEL", "").strip()
    if default_model:
        config = json.loads(config_path.read_text(encoding="utf-8"))
        config.setdefault("agents", {}).setdefault("defaults", {})["model"] = {
            "primary": default_model
        }
        config_path.write_text(
            json.dumps(config, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        config_path.chmod(0o600)


def openclaw_is_ready() -> bool:
    try:
        with urlopen(OPENCLAW_HEALTH_URL, timeout=2) as response:  # noqa: S310
            return 200 <= response.status < 300
    except Exception:
        return False


async def terminate(process: asyncio.subprocess.Process | None, name: str) -> None:
    if process is None or process.returncode is not None:
        return
    logger.info("stopping_process name=%s pid=%s", name, process.pid)
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        await asyncio.wait_for(process.wait(), timeout=15)
    except TimeoutError:
        logger.warning("killing_process name=%s pid=%s", name, process.pid)
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        await process.wait()


async def wait_for_openclaw(
    process: asyncio.subprocess.Process,
    *,
    timeout_seconds: float = 90,
) -> None:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout_seconds
    while loop.time() < deadline:
        if process.returncode is not None:
            raise RuntimeError(f"OpenClaw exited during startup with code {process.returncode}")
        if await asyncio.to_thread(openclaw_is_ready):
            logger.info("openclaw_ready url=%s", OPENCLAW_HEALTH_URL)
            return
        await asyncio.sleep(1)
    raise RuntimeError(f"OpenClaw did not become ready within {timeout_seconds:.0f}s")


async def run() -> int:
    prepare_openclaw_config()
    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()
    for signal_name in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(signal_name, stop_event.set)

    openclaw: asyncio.subprocess.Process | None = None
    backend: asyncio.subprocess.Process | None = None
    try:
        openclaw = await asyncio.create_subprocess_exec(
            "node",
            "/app/openclaw.mjs",
            "gateway",
            "--bind",
            "loopback",
            "--port",
            "18789",
            start_new_session=True,
        )
        logger.info("process_started name=openclaw pid=%s", openclaw.pid)
        await wait_for_openclaw(openclaw)

        backend = await asyncio.create_subprocess_exec(
            "/opt/orbit-venv/bin/uvicorn",
            "backend.main:app",
            "--host",
            "0.0.0.0",
            "--port",
            os.getenv("PORT", "8000"),
            start_new_session=True,
        )
        logger.info("process_started name=backend pid=%s", backend.pid)

        stop_waiter = asyncio.create_task(stop_event.wait())
        openclaw_waiter = asyncio.create_task(openclaw.wait())
        backend_waiter = asyncio.create_task(backend.wait())
        done, pending = await asyncio.wait(
            {stop_waiter, openclaw_waiter, backend_waiter},
            return_when=asyncio.FIRST_COMPLETED,
        )
        for waiter in pending:
            waiter.cancel()
        if stop_waiter in done:
            return 0
        if openclaw_waiter in done:
            logger.error("critical_process_exited name=openclaw code=%s", openclaw.returncode)
            return openclaw.returncode or 1
        logger.error("critical_process_exited name=backend code=%s", backend.returncode)
        return backend.returncode or 1
    finally:
        await terminate(backend, "backend")
        await terminate(openclaw, "openclaw")


def main() -> None:
    raise SystemExit(asyncio.run(run()))


if __name__ == "__main__":
    main()
