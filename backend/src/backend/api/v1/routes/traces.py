"""The browser's way into the trace store.

THE RULE FOR EVERYTHING THAT ARRIVES HERE — ticket 30 produces it, and any
later producer inherits it: credentials never appear in telemetry. A span may
carry a User's id and nothing else that identifies anyone: no e-mail address,
no username, no token, no full URL with its query string, no request or
response bodies. Telemetry leaks by being copied outward — a screenshot, a
pasted log line, a trace attached to a bug report. This endpoint cannot
enforce the rule, because it forwards bytes it never reads; the producer must.

Why an API route and not the trace store's own receiver on the internet: that
would be an anonymous write channel into the one thing this project exists to
show, and the edge proxy has no way to rate-limit it.
"""

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, Request, Response
from loguru import logger

from backend.api.deps import RedisDep, TraceStoreDep, get_current_user
from backend.core.config import settings
from backend.core.exceptions import ContentTooLargeError, UnsupportedMediaTypeError
from backend.core.rate_limit import FixedWindowRateLimiter

router = APIRouter(prefix=settings.api.v1.traces, tags=["Traces"])

# The two encodings OTLP/HTTP defines, each mapped to what an accepting
# receiver answers: an empty ExportTraceServiceResponse in the same encoding.
_ACCEPTED: dict[str, bytes] = {
    "application/x-protobuf": b"",
    "application/json": b"{}",
}


def _media_type(request: Request) -> str:
    """The body's media type; anything but uncompressed OTLP is refused."""
    media_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if media_type not in _ACCEPTED:
        raise UnsupportedMediaTypeError(
            detail="OTLP as application/json or application/x-protobuf"
        )
    encoding = request.headers.get("content-encoding", "identity").strip().lower()
    if encoding != "identity":
        # The cap counts the bytes that arrive here. A compressed body would be
        # inflated past it inside the trace store, where nothing counts.
        raise UnsupportedMediaTypeError(detail="compressed bodies are not accepted")
    return media_type


async def _read_capped(request: Request, cap: int) -> bytes:
    """The whole body, or a 413 — never a truncated body."""
    too_large = ContentTooLargeError(detail=f"at most {cap} bytes")
    declared = request.headers.get("content-length")
    # An honest client says the size up front: refuse without reading a byte.
    if declared is not None and declared.isdigit() and int(declared) > cap:
        raise too_large
        # A chunked body declares nothing, so count while reading and stop the
    # moment it crosses the cap instead of buffering whatever is sent.
    body = bytearray()
    async for chunk in request.stream():
        body += chunk
        if len(body) > cap:
            raise too_large
    return bytes(body)


async def _forward(client: httpx.AsyncClient, body: bytes, media_type: str) -> None:
    """Hand the body on; on any failure drop it and say so in the log.

    Runs after the response is sent. Nothing here may raise: the browser has
    already been answered, and lost telemetry is a log line, not an incident.
    """
    try:
        response = await client.post(
            settings.traces.forward_url,
            content=body,
            headers={"Content-Type": media_type},
        )
    except httpx.HTTPError as exc:
        logger.bind(reason=type(exc).__name__).warning("trace forward failed")
        return
    if response.is_error:
        logger.bind(status=response.status_code).warning("trace forward refused")


@router.post(
    "",
    response_class=Response,
    # Signed in is enough — the unverified included: their first steps are the
    # ones most likely to go wrong for a newcomer.
    dependencies=[Depends(get_current_user)],
    # The body is read raw, so FastAPI cannot infer it; this documents it.
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                "application/x-protobuf": {
                    "schema": {"type": "string", "format": "binary"}
                },
                "application/json": {"schema": {"type": "object"}},
            },
        }
    },
)
async def export_traces(
    request: Request,
    redis: RedisDep,
    trace_store: TraceStoreDep,
    background_tasks: BackgroundTasks,
) -> Response:
    """Accept OTLP spans from a signed-in browser and pass them to the trace store.
    \f
    The answer does not depend on the trace store: it is the same whether the
    spans were stored, refused or lost. Telemetry that can slow down or fail
    the application it observes has inverted its purpose.
    """
    limiter = FixedWindowRateLimiter(
        redis=redis,
        prefix="traces",
        limit=settings.traces.rate_limit,
        window=settings.traces.rate_window_seconds,
    )
    client_ip = request.client.host if request.client else "unknown"
    # spent before anything else: an oversized or malformed attempt costs too
    await limiter.hit(f"ip:{client_ip}")
    media_type = _media_type(request)
    body = await _read_capped(request, settings.traces.max_body_bytes)
    background_tasks.add_task(_forward, trace_store, body, media_type)
    return Response(content=_ACCEPTED[media_type], media_type=media_type)
