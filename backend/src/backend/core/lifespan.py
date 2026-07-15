from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from redis.asyncio import Redis

from backend.core.config import settings
from backend.core.db import engine


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
    # Startup
    redis = Redis.from_url(settings.redis.url, decode_responses=True)
    # fail fast: a broken cache config should stop the app at startup,
    # not surface as 500s under traffic
    await redis.ping()
    app.state.redis = redis

    yield
    # Shutdown
    await redis.aclose()
    await engine.dispose()
