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


def _message_content(payload: dict) -> str:
    choices = payload.get("choices") or []
    if not choices:
        return ""
    message = choices[0].get("message") or {}
    return str(message.get("content") or "")


def _chat_payload(prompt: str, *, model: str) -> dict:
    return {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": "You are the controlled self-development reviewer for Orbit CRM.",
            },
            {"role": "user", "content": prompt},
        ],
        "stream": False,
        "max_completion_tokens": 800,
    }


def _run_openclaw(prompt: str) -> str:
    response = httpx.post(
        os.getenv("OPENCLAW_URL", "http://127.0.0.1:18789").rstrip("/")
        + "/v1/chat/completions",
        headers={
            "authorization": f"Bearer {os.getenv('OPENCLAW_GATEWAY_TOKEN', '')}",
            "content-type": "application/json",
            "x-openclaw-agent-id": "main",
        },
        json=_chat_payload(prompt, model="openclaw"),
        timeout=float(os.getenv("SELFDEV_OPENCLAW_TIMEOUT_SECONDS") or "45"),
    )
    response.raise_for_status()
    return _message_content(response.json())


NVIDIA_FALLBACK_MODEL = "nvidia/nemotron-3-ultra-550b-a55b"


def _fallback_provider() -> tuple[str, str, str, str]:
    """Return (name, base_url, api_key, model), preferring NVIDIA over Groq."""
    nvidia_key = os.getenv("NVIDIA_API_KEY", "").strip()
    if nvidia_key:
        return (
            "nvidia",
            os.getenv("NVIDIA_BASE_URL", "").strip() or "https://integrate.api.nvidia.com/v1",
            nvidia_key,
            os.getenv("SELFDEV_NVIDIA_MODEL", "").strip() or NVIDIA_FALLBACK_MODEL,
        )
    groq_key = os.getenv("GROQ_API_KEY", "").strip()
    if groq_key:
        return (
            "groq",
            os.getenv("GROQ_BASE_URL", "").strip() or "https://api.groq.com/openai/v1",
            groq_key,
            os.getenv("SELFDEV_GROQ_MODEL", "").strip() or "llama-3.1-8b-instant",
        )
    raise RuntimeError("OpenClaw failed and neither NVIDIA_API_KEY nor GROQ_API_KEY is configured")


def _run_model_fallback(prompt: str) -> str:
    name, base_url, api_key, model = _fallback_provider()
    response = httpx.post(
        f"{base_url.rstrip('/')}/chat/completions",
        headers={
            "authorization": f"Bearer {api_key}",
            "content-type": "application/json",
        },
        json=_chat_payload(prompt, model=model),
        timeout=float(os.getenv("SELFDEV_FALLBACK_TIMEOUT_SECONDS") or os.getenv("SELFDEV_GROQ_TIMEOUT_SECONDS") or "120"),
    )
    response.raise_for_status()
    content = _message_content(response.json())
    return f"[fallback:{name}]\n" + (content or f"{name} completed without textual output.")


def run_analysis(prompt: str) -> str:
    try:
        return _run_openclaw(prompt)
    except (httpx.HTTPError, RuntimeError) as exc:
        fallback = _run_model_fallback(prompt)
        return f"{fallback}\n\n[openclaw_error]\n{type(exc).__name__}: {str(exc)[:500]}"


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
    print(run_analysis(prompt))


if __name__ == "__main__":
    main()
