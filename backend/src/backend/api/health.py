from fastapi import APIRouter
from sqlalchemy import text

from backend.core.db import AsyncSessionDep

# Liveness and readiness are for the container healthcheck and for callers
# inside the compose network; the door answers 404, so they are not published.
router = APIRouter(tags=["Health"], include_in_schema=False)


@router.get("/healthz")
async def healthz() -> dict[str, str]:
    """Liveness: the process is up and serving requests."""
    return {"status": "ok"}


@router.get("/readyz")
async def readyz(session: AsyncSessionDep) -> dict[str, str]:
    """Readiness: dependencies (database) are reachable."""
    await session.execute(text("SELECT 1"))
    return {"status": "ok"}
