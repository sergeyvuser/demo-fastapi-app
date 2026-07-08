from contextlib import asynccontextmanager

from fastapi import FastAPI

from backend.core.db import engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    yield
    # Shutdown
    await engine.dispose()
