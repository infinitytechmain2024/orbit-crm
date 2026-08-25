from __future__ import annotations

import logging
import time
from uuid import UUID, uuid4

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger("orbit.request")


class CorrelationMiddleware(BaseHTTPMiddleware):
    """Attach a safe correlation ID and emit metadata-only request logs."""

    async def dispatch(self, request: Request, call_next) -> Response:
        supplied = request.headers.get("x-correlation-id", "")
        try:
            correlation_id = str(UUID(supplied))
        except (ValueError, AttributeError):
            correlation_id = str(uuid4())
        request.state.correlation_id = correlation_id
        started = time.monotonic()
        response = await call_next(request)
        duration_ms = round((time.monotonic() - started) * 1000, 1)
        response.headers["x-correlation-id"] = correlation_id
        logger.info(
            "request_complete method=%s path=%s status=%s duration_ms=%s correlation_id=%s",
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
            correlation_id,
        )
        return response
