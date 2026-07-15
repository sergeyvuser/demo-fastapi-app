from fastapi import APIRouter
from sqlalchemy import text

from backend.core.db import AsyncSessionDep

router = APIRouter(tags=["Health"])


@router.get("/healthz")
async def healthz() -> dict[str, str]:
    """Liveness: the process is up and serving requests."""
    return {"status": "ok"}


@router.get("/readyz")
async def readyz(session: AsyncSessionDep) -> dict[str, str]:
    """Readiness: dependencies (database) are reachable."""
    await session.execute(text("SELECT 1"))
    return {"status": "ok"}
