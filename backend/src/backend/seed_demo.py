"""Seed the published demo account.

Runs as a one-shot service after migrations — `python -m backend.seed_demo` —
in the same slot as `alembic upgrade head`. It is deliberately not a migration:
migrations describe schema, demo data is environment state, and a migration
would also run against the test database and be caught by the schema-drift test.

Nothing depends on this service completing. A broken seeder must not be able to
hold up the product: the demo account is a courtesy, not a precondition.
"""

import asyncio
from decimal import Decimal
from typing import Any, cast

from loguru import logger
from sqlalchemy import CursorResult, delete
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.config import settings
from backend.core.db import AsyncSessionLocal
from backend.core.security import hash_password
from backend.models.alert import Alert, AlertCondition
from backend.repositories.alert import AlertRepository
from backend.repositories.user import UserRepository
from backend.schemas.alert import AlertCreate, AlertCreateInternal
from backend.schemas.user import UserCreateInternal
from shared.logging import configure_logging

# Thresholds sit far from the market on purpose. The tempting alternative — one
# example close enough to fire, so a visitor sees the whole pipeline work — cannot
# be written down: a threshold hardcoded near today's price stops being near it,
# and an example that quietly rots is worse than one that never fires.
EXAMPLE_ALERTS = (
    AlertCreate(
        symbol="BTCUSDT",
        condition=AlertCondition.PRICE_ABOVE,
        threshold=Decimal("250000"),
    ),
    AlertCreate(
        symbol="ETHUSDT",
        condition=AlertCondition.PRICE_BELOW,
        threshold=Decimal("500"),
    ),
)


async def seed_demo(session: AsyncSession) -> None:
    """Create or refresh the demo account. Idempotent, and never deletes.

    Takes a session rather than making one so that a test can drive it on the
    same savepoint-isolated session as every other service test.
    """
    cfg = settings.demo
    users = UserRepository(session=session)

    user = await users.get_by_email(cfg.email)
    if user is None:
        user = await users.create(
            UserCreateInternal(
                username=cfg.username,
                email=cfg.email,
                hashed_password=hash_password(cfg.password),
            )
        )
        logger.bind(email=cfg.email).info("demo user created")
    else:
        # The password is public, so restoring it every run costs nothing and
        # makes the account self-healing after any accident.
        user.hashed_password = hash_password(cfg.password)
        logger.bind(email=cfg.email).info("demo user refreshed")

    # Set on the model, not through the schema: `UserCreateInternal` is the
    # registration contract, and registration must never be able to mark itself
    # verified. This account has no mailbox to verify against.
    user.is_verified = True

    alerts = AlertRepository(session=session)
    _, existing = await alerts.list_for_user(user_id=user.id, limit=1)
    if existing == 0:
        for example in EXAMPLE_ALERTS:
            await alerts.create(
                AlertCreateInternal(**example.model_dump(), user_id=user.id)
            )
        logger.bind(count=len(EXAMPLE_ALERTS)).info("demo alerts seeded")

    await session.commit()


async def reset_demo(session: AsyncSession) -> int:
    """Return the demo account to its seeded state; report what was removed.

    Deletes every Alert on the account and then re-seeds, which restores the
    examples because the account is empty by that point. Password and verified
    flag are refreshed on the way through, so this is a full reset rather than
    just a cleanup.
    """
    user = await UserRepository(session=session).get_by_email(settings.demo.email)
    if user is None:
        # Nothing to reset, but the account should exist — treat its absence as
        # the thing to fix rather than a reason to do nothing.
        await seed_demo(session=session)
        return 0

    # DML execute returns a CursorResult at runtime; the signature says Result
    removed = cast(
        CursorResult[Any],
        await session.execute(delete(Alert).where(Alert.user_id == user.id)),
    )
    await seed_demo(session)  # commits both the delete and the fresh examples
    logger.bind(removed=removed.rowcount).info("demo account reset")
    # rowcount is a SQLAlchemy memoized_property; PyCharm reads the raw function
    # noinspection PyTypeChecker
    return removed.rowcount


async def main() -> None:
    configure_logging(settings.log)
    if not settings.demo.enabled:
        logger.info("demo account disabled, nothing to seed")
        return
    async with AsyncSessionLocal() as session:
        await seed_demo(session=session)


if __name__ == "__main__":
    asyncio.run(main())
