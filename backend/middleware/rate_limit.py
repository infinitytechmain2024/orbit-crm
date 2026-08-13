"""Small abuse guard for the authenticated AI Workflow API.

This is intentionally process-local for the MVP. The durable workflow queue is
database-backed; deployments with multiple API replicas should move counters to
the platform gateway or Redis without changing route contracts.
"""

from __future__ import annotations

import hashlib
import time
from collections import defaultdict, deque

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response


class WorkflowRateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, *, reads_per_minute: int = 240, writes_per_minute: int = 90):
        super().__init__(app)
        self.reads_per_minute = reads_per_minute
        self.writes_per_minute = writes_per_minute
        self._windows: dict[str, deque[float]] = defaultdict(deque)

    async def dispatch(self, request: Request, call_next) -> Response:
        if not request.url.path.startswith("/api/ai-workflow"):
            return await call_next(request)
        supplied = request.headers.get("x-supabase-authorization")
        if not supplied:
            supplied = request.client.host if request.client else "unknown"
        identity = hashlib.sha256(str(supplied).encode("utf-8")).hexdigest()[:24]
        write = request.method not in ("GET", "HEAD", "OPTIONS")
        key = f"{identity}:{'write' if write else 'read'}"
        limit = self.writes_per_minute if write else self.reads_per_minute
        now = time.monotonic()
        window = self._windows[key]
        while window and window[0] <= now - 60:
            window.popleft()
        if len(window) >= limit:
            return JSONResponse(
                status_code=429,
                content={"detail": "Слишком много запросов. Повторите через минуту."},
                headers={"retry-after": "60"},
            )
        window.append(now)
        return await call_next(request)
