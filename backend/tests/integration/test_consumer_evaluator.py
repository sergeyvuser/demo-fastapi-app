import contextlib
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from decimal import Decimal

import pytest
from faststream.rabbit import TestRabbitBroker
from sqlalchemy.ext.asyncio import AsyncSession

from backend.consumers import app as evaluator
from backend.models.alert import AlertCondition
from backend.services.alert import AlertService
from backend.services.prices import PriceCache
from shared.broker import (
    ALERTS_EXCHANGE,
    ALERTS_TRIGGERED_QUEUE,
    TICKS_EVALUATOR_QUEUE,
    TICKS_EXCHANGE,
)
from shared.events import TickEvent

delivered: list[dict] = []


# Stands in for the notifier, bound exactly as the notifier binds. It is not
# only a spy: the test broker raises SubscriberNotFound when a message routes
# nowhere, so this doubles as an assertion that exchange and routing key match.
@evaluator.broker.subscriber(ALERTS_TRIGGERED_QUEUE, ALERTS_EXCHANGE)
async def _collect(event: dict) -> None:
    delivered.append(event)


@pytest.fixture(autouse=True)
def _reset_collected() -> None:
    delivered.clear()


@contextlib.asynccontextmanager
async def _lend(session: AsyncSession) -> AsyncGenerator[AsyncSession]:
    """Hand the consumer the test transaction instead of a fresh session."""
    yield session


async def test_tick_fires_an_alert_and_routes_it_to_the_notifier(
    session, clean_redis, user, alert_factory, monkeypatch
) -> None:
    await AlertService(session).create(
        user_id=user.id,
        data=alert_factory.build(
            condition=AlertCondition.PRICE_ABOVE, threshold=Decimal("100")
        ),
    )

    # The consumer owns two module-level singletons: it opens its own session
    # and keeps the price cache in a global filled by a startup hook. Neither
    # can be injected, so both are patched — a design seam worth noticing.
    monkeypatch.setattr(evaluator, "AsyncSessionLocal", lambda: _lend(session))
    monkeypatch.setattr(evaluator, "_price_cache", PriceCache(clean_redis))

    tick = TickEvent(symbol="BTCUSDT", price=Decimal("101"), ts=datetime.now(UTC))
    async with TestRabbitBroker(evaluator.broker) as br:
        await br.publish(
            tick.model_dump(mode="json"),
            queue=TICKS_EVALUATOR_QUEUE,
            exchange=TICKS_EXCHANGE,
        )

        evaluator.on_ticks.mock.assert_called_once()
        assert len(delivered) == 1
        assert delivered[0]["symbol"] == "BTCUSDT"
        assert delivered[0]["price"] == "101"  # Decimal crosses as a string
        assert delivered[0]["telegram_chat_id"] == user.telegram_chat_id

    # caching the price is part of the same handler's job
    assert await clean_redis.get("price:BTCUSDT") == "101"


async def test_tick_that_matches_nothing_publishes_nothing(
    session, clean_redis, user, alert_factory, monkeypatch
) -> None:
    await AlertService(session).create(
        user_id=user.id,
        data=alert_factory.build(
            condition=AlertCondition.PRICE_ABOVE, threshold=Decimal("100")
        ),
    )
    monkeypatch.setattr(evaluator, "AsyncSessionLocal", lambda: _lend(session))
    monkeypatch.setattr(evaluator, "_price_cache", PriceCache(clean_redis))

    tick = TickEvent(symbol="BTCUSDT", price=Decimal("99"), ts=datetime.now(UTC))
    async with TestRabbitBroker(evaluator.broker) as br:
        await br.publish(
            tick.model_dump(mode="json"),
            queue=TICKS_EVALUATOR_QUEUE,
            exchange=TICKS_EXCHANGE,
        )

        assert delivered == []
