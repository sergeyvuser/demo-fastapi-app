import uuid

from starlette.types import ASGIApp, Receive, Scope, Send

from shared.logging import correlation_id


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

        async def send_with_header(message):
            if message["type"] == "http.response.start":
                message.setdefault("headers", []).append(
                    (b"x-request-id", rid.encode())
                )
            await send(message)

        try:
            await self.app(scope, receive, send_with_header)
        finally:
            correlation_id.reset(token)
