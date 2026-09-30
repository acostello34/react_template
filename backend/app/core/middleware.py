"""Per-request context: correlation id and timing.

Both end up in the envelope's ``metadata``, so a screenshot of a failed
request in the UI is enough to find the matching server log line.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Awaitable, Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

REQUEST_ID_HEADER = "X-Request-ID"


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        # Honour an upstream id (gateway, another service) so a trace survives
        # across hops; mint one otherwise.
        request_id = request.headers.get(REQUEST_ID_HEADER) or str(uuid.uuid4())
        request.state.request_id = request_id
        request.state.start_time = time.perf_counter()

        response = await call_next(request)
        response.headers[REQUEST_ID_HEADER] = request_id
        return response


def request_id(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)


def elapsed_ms(request: Request) -> float | None:
    start = getattr(request.state, "start_time", None)
    if start is None:
        return None
    return round((time.perf_counter() - start) * 1000, 2)
