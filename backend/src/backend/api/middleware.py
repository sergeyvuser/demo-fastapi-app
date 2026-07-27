import time
import uuid

from loguru import logger
from starlette.types import ASGIApp, Receive, Scope, Send

from shared.logging import correlation_id

_SKIP_PATHS = {"/metrics", "/healthz", "/readyz"}


class CorrelationIdMiddleware:
    """Set a correlation id per request: reuse incoming X-Request-ID or mint one."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = dict(scope["headers"])
        incoming = headers.get(b"x-request-id")
        rid = incoming.decode() if incoming else uuid.uuid4().hex
        token = correlation_id.set(rid)

        start = time.perf_counter()
        status = 500  # if the app blows up before responding

        async def send_with_header(message):
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                message.setdefault("headers", []).append(
                    (b"x-request-id", rid.encode())
                )
            await send(message)

        try:
            await self.app(scope, receive, send_with_header)
        finally:
            if scope["path"] not in _SKIP_PATHS:
                logger.bind(
                    method=scope["method"],
                    path=scope["path"],
                    status=status,
                    duration_ms=round((time.perf_counter() - start) * 1000, 1),
                ).info("request handled")
            correlation_id.reset(token)
