"""Non-destructive OpenClaw gateway smoke test.

Loads the normal backend settings, never prints credentials, and verifies the
three API contracts required by Orbit CRM.
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.config import settings


async def main() -> int:
    base_url = settings.OPENCLAW_URL.rstrip("/")
    token = settings.OPENCLAW_GATEWAY_TOKEN
    if not token:
        print(json.dumps({"ok": False, "error": "OPENCLAW_GATEWAY_TOKEN is missing"}))
        return 2

    headers = {"Authorization": f"Bearer {token}"}
    results: list[dict[str, object]] = []
    async with httpx.AsyncClient(timeout=settings.OPENCLAW_REQUEST_TIMEOUT) as client:
        health = await client.get(f"{base_url}/healthz", headers=headers)
        results.append({"endpoint": "/healthz", "status": health.status_code})

        models_response = await client.get(f"{base_url}/v1/models", headers=headers)
        model_ids: list[str] = []
        if models_response.is_success:
            model_ids = [
                str(item.get("id"))
                for item in models_response.json().get("data", [])
                if item.get("id")
            ]
        results.append(
            {"endpoint": "/v1/models", "status": models_response.status_code, "models": model_ids}
        )

        chat: httpx.Response | None = None
        for attempt in range(1, 4):
            chat = await client.post(
                f"{base_url}/v1/chat/completions",
                headers={**headers, "x-openclaw-agent-id": "main"},
                json={
                    "model": "openclaw",
                    "messages": [
                        {"role": "user", "content": "Reply with exactly ORBIT_GATEWAY_OK"}
                    ],
                    "stream": False,
                },
            )
            if chat.is_success:
                break
            if attempt < 3:
                await asyncio.sleep(attempt)
        assert chat is not None
        content = ""
        if chat.is_success:
            body = chat.json()
            content = ((body.get("choices") or [{}])[0].get("message") or {}).get("content", "")
        results.append(
            {
                "endpoint": "/v1/chat/completions",
                "status": chat.status_code,
                "expected_reply": content.strip() == "ORBIT_GATEWAY_OK",
                "attempts": attempt,
            }
        )

    ok = all(item["status"] == 200 for item in results) and bool(
        results[-1].get("expected_reply")
    )
    print(json.dumps({"ok": ok, "results": results}, ensure_ascii=False))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
