from __future__ import annotations

"""Execute one controlled self-development analysis through local OpenClaw."""

import json
import os
import sys
from pathlib import Path

import httpx


def repository_context(root: Path, limit: int = 16_000) -> str:
    """Collect a bounded, non-secret source overview for the analysis agent."""
    chunks: list[str] = []
    size = 0
    allowed = {".py", ".ts", ".tsx", ".sql", ".md", ".json", ".yaml", ".yml"}
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.suffix not in allowed:
            continue
        if any(part in {"node_modules", ".git", ".venv", "venv", "dist"} for part in path.parts):
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            continue
        remaining = limit - size
        if remaining <= 0:
            break
        excerpt = text[: min(2500, remaining)]
        chunks.append(f"\n--- {path.relative_to(root)} ---\n{excerpt}")
        size += len(excerpt)
    return "".join(chunks)


def main() -> None:
    job = json.loads(sys.stdin.read() or os.getenv("SELFDEV_JOB_JSON", "{}"))
    root = Path(os.getenv("SELFDEV_SOURCE_ROOT", "/app/orbit")).resolve()
    metadata = job.get("metadata") or {}
    objective = metadata.get("objective") or metadata.get("prompt") or (
        "Analyze Orbit CRM self-development runtime and identify the highest-impact next improvement."
    )
    prompt = (
        f"Objective: {objective}\n"
        f"Run: {job.get('id')}\nBranch: {job.get('working_branch')}\n\n"
        "Inspect the supplied source snapshot. Return a concise engineering report with: "
        "root cause, exact files to change, acceptance criteria, tests, risks, and release recommendation. "
        "Do not claim that code was changed or deployed.\n\nSOURCE SNAPSHOT:\n"
        f"{repository_context(root)}"
    )
    response = httpx.post(
        os.getenv("OPENCLAW_URL", "http://127.0.0.1:18789").rstrip("/") + "/v1/chat/completions",
        headers={
            "authorization": f"Bearer {os.getenv('OPENCLAW_GATEWAY_TOKEN', '')}",
            "content-type": "application/json",
            "x-openclaw-agent-id": "main",
        },
        json={
            "model": "openclaw",
            "messages": [
                {
                    "role": "system",
                    "content": "You are the controlled self-development reviewer for Orbit CRM.",
                },
                {"role": "user", "content": prompt},
            ],
            "stream": False,
            "max_completion_tokens": 800,
        },
        timeout=90,
    )
    response.raise_for_status()
    payload = response.json()
    print(payload["choices"][0]["message"]["content"])


if __name__ == "__main__":
    main()
