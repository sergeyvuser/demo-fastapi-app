from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from redis.asyncio import Redis

from backend.api.ws.stream import stream_router
from backend.core.config import settings
from backend.core.db import engine
from backend.tasks.broker import broker as taskiq_broker
from shared.tracing import configure_tracing


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
    # Tracing must be set up in the process that serves requests: granian
    # forks a worker, and BatchSpanProcessor's export thread does not
    # survive the fork.
    configure_tracing("api", settings.otel)
    # Startup
    redis = Redis.from_url(
        settings.redis.url,
        decode_responses=True,
        socket_connect_timeout=3,
        socket_timeout=3,
    )
    # fail fast: a broken cache config should stop the app at startup,
    # not surface as 500s under traffic
    await redis.ping()
    app.state.redis = redis

    # API process is a taskiq CLIENT: it must connect to the broker to
    # enqueue tasks. The worker/scheduler processes call startup() on
    # their own side (via the taskiq CLI); the guard avoids a double
    # startup if this module is ever imported there.
    if not taskiq_broker.is_worker_process:
        await taskiq_broker.startup()

    async with stream_router.lifespan_context(app):
        yield

    # Shutdown
    if not taskiq_broker.is_worker_process:
        await taskiq_broker.shutdown()
    await redis.aclose()
    await engine.dispose()
