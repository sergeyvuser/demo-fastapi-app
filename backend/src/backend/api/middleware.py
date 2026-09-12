import re
import time
import uuid

from loguru import logger
from starlette.types import ASGIApp, Receive, Scope, Send

from shared.logging import correlation_id

_SKIP_PATHS = {"/metrics", "/healthz", "/readyz"}

# What we are willing to reuse as a correlation id. A bytes pattern, because a
# header value is bytes and may not be text at all — the shape is checked
# before anything is decoded. `fullmatch` rather than `^...$`: in `re`, `$`
# also matches in front of a trailing newline, so "abcdefgh\n" would pass.
_REQUEST_ID_SHAPE = re.compile(rb"[A-Za-z0-9._-]{8,64}")


def _accept_or_mint(incoming: bytes | None) -> str:
    """Reuse the caller's correlation id only when it has the pinned shape.

    Our own ids are `uuid4().hex` — 32 characters inside this alphabet — so a
    downstream service applying the same rule accepts what we send it.
    """
    if incoming is not None and _REQUEST_ID_SHAPE.fullmatch(incoming):
        return incoming.decode("ascii")
    return uuid.uuid4().hex


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
        rid = _accept_or_mint(incoming)
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
