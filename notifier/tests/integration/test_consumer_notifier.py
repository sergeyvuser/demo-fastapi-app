import uuid
from datetime import UTC, datetime
from decimal import Decimal

import pytest
from faststream.rabbit import TestRabbitBroker
from redis.asyncio import Redis

from notifier import app as notifier
from notifier.telegram import TelegramSendError
from shared.broker import ALERTS_EXCHANGE, ALERTS_TRIGGERED_QUEUE
from shared.events import AlertTriggeredEvent


def make_event(**overrides) -> AlertTriggeredEvent:
    return AlertTriggeredEvent(
        alert_id=uuid.uuid7(),
        user_id=uuid.uuid7(),
        telegram_chat_id=overrides.pop("telegram_chat_id", 4242),
        symbol="BTCUSDT",
        condition="price_above",
        threshold=Decimal("100"),
        price=Decimal("101"),
        triggered_at=datetime.now(UTC),
        **overrides,
    )


class RecordingSender:
    def __init__(self) -> None:
        self.sent: list[tuple[int, str]] = []

    async def send_message(self, chat_id: int, text: str) -> None:
        self.sent.append((chat_id, text))


class FailingSender:
    async def send_message(self, chat_id: int, text: str) -> None:
        raise TelegramSendError("telegram is unreachable")


async def test_redelivery_does_not_spam_the_user(
    clean_redis: Redis, monkeypatch: pytest.MonkeyPatch
) -> None:
    sender = RecordingSender()
    monkeypatch.setattr(notifier, "_redis", clean_redis)
    monkeypatch.setattr(notifier, "_sender", sender)
    payload = make_event().model_dump(mode="json")

    async with TestRabbitBroker(notifier.broker) as br:
        # a crash between send and ack makes rabbit redeliver the same message
        await br.publish(
            payload, queue=ALERTS_TRIGGERED_QUEUE, exchange=ALERTS_EXCHANGE
        )
        await br.publish(
            payload, queue=ALERTS_TRIGGERED_QUEUE, exchange=ALERTS_EXCHANGE
        )

        assert len(sender.sent) == 1


async def test_failed_delivery_releases_the_dedup_key(
    clean_redis: Redis, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(notifier, "_redis", clean_redis)
    monkeypatch.setattr(notifier, "_sender", FailingSender())
    event = make_event()

    async with TestRabbitBroker(notifier.broker) as br:
        # RejectMessage is a control signal, not an error: the ack middleware
        # consumes it, so publish() returns normally. What must be observable
        # is the key being handed back, or a redelivery would be swallowed
        # as a duplicate and the alert lost for good.
        await br.publish(
            event.model_dump(mode="json"),
            queue=ALERTS_TRIGGERED_QUEUE,
            exchange=ALERTS_EXCHANGE,
        )

    dedup_key = f"notified:{event.alert_id}:{event.triggered_at.isoformat()}"
    assert await clean_redis.get(dedup_key) is None


async def test_user_without_telegram_is_skipped(
    clean_redis: Redis, monkeypatch: pytest.MonkeyPatch
) -> None:
    sender = RecordingSender()
    monkeypatch.setattr(notifier, "_redis", clean_redis)
    monkeypatch.setattr(notifier, "_sender", sender)

    async with TestRabbitBroker(notifier.broker) as br:
        await br.publish(
            make_event(telegram_chat_id=None).model_dump(mode="json"),
            queue=ALERTS_TRIGGERED_QUEUE,
            exchange=ALERTS_EXCHANGE,
        )

        assert sender.sent == []
