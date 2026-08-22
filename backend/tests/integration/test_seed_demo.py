import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.config import settings
from backend.core.security import hash_password, verify_password
from backend.models import User
from backend.repositories.alert import AlertRepository
from backend.repositories.user import UserRepository
from backend.seed_demo import EXAMPLE_ALERTS, reset_demo, seed_demo
from backend.services.alert import AlertService


async def demo_user(session: AsyncSession) -> User:
    user = await UserRepository(session).get_by_email(settings.demo.email)
    assert user is not None, "the demo account should exist by now"
    return user


async def alert_count(session: AsyncSession, user_id: uuid.UUID) -> int:
    _, total = await AlertRepository(session).list_for_user(user_id, limit=1)
    return total


async def test_seeding_creates_a_verified_account_with_examples(session) -> None:
    await seed_demo(session)

    user = await demo_user(session)
    # verified matters: an unverified demo account cannot reach the endpoints
    # that make the demo worth visiting, and it has no mailbox to fix that
    assert user.is_verified
    assert verify_password(settings.demo.password, user.hashed_password)
    assert await alert_count(session, user.id) == len(EXAMPLE_ALERTS)


async def test_seeding_twice_duplicates_nothing(session) -> None:
    await seed_demo(session)
    await seed_demo(session)

    user = await demo_user(session)
    assert await alert_count(session, user.id) == len(EXAMPLE_ALERTS)


async def test_a_deleted_account_is_recreated(session) -> None:
    await seed_demo(session)
    await session.delete(await demo_user(session))
    await session.commit()

    await seed_demo(session)

    assert await alert_count(session, (await demo_user(session)).id) == len(
        EXAMPLE_ALERTS
    )


async def test_the_published_password_is_restored(session) -> None:
    await seed_demo(session)
    user = await demo_user(session)
    user.hashed_password = hash_password("changed-by-someone")
    await session.commit()

    await seed_demo(session)

    assert verify_password(
        settings.demo.password, (await demo_user(session)).hashed_password
    )


async def test_alerts_added_by_visitors_survive_seeding(session, alert_factory) -> None:
    """The seeder must never delete. Deploys are not the reset mechanism."""
    await seed_demo(session)
    user = await demo_user(session)
    await AlertService(session).create(user_id=user.id, data=alert_factory.build())

    await seed_demo(session)

    assert await alert_count(session, user.id) == len(EXAMPLE_ALERTS) + 1


async def test_reset_returns_the_account_to_its_seeded_state(
    session, alert_factory
) -> None:
    """The nightly job is the reset mechanism, and it is the only one."""
    await seed_demo(session)
    user = await demo_user(session)
    await AlertService(session).create(user_id=user.id, data=alert_factory.build())

    removed = await reset_demo(session)

    assert removed == len(EXAMPLE_ALERTS) + 1
    assert await alert_count(session, user.id) == len(EXAMPLE_ALERTS)
