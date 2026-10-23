from datetime import UTC, datetime

from fastapi import APIRouter

from backend.core.config import settings
from backend.schemas.demo import DemoRead
from backend.seed_demo import next_reset

router = APIRouter(
    prefix=settings.api.v1.demo,
    tags=["Demo"],
)


@router.get("", response_model=DemoRead)
async def get_demo() -> DemoRead:
    """Whether this deployment has a demo account, and how to sign in to it.
    \f
    Public, and the reason it exists at all: the frontend bundle compiles no
    environment values, so without asking it could not know whether a demo
    button would lead anywhere.

    Answers from configuration, not from the database: `enabled` is an
    intention. Whether the published pair actually opens the account is the
    deploy's smoke check to prove, not a query on every page load.

    No rate limiter: no database, no hashing, nothing to amplify.
    """
    cfg = settings.demo
    if not cfg.enabled:
        return DemoRead(enabled=False, email=None, password=None, resets_at=None)
    return DemoRead(
        enabled=True,
        email=cfg.email,
        password=cfg.password,
        resets_at=next_reset(datetime.now(UTC)),
    )
