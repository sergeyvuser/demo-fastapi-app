import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from backend.models.alert import Alert, AlertCondition
from backend.services.alert_evaluation import AlertEvaluationService
from shared.events import TickEvent


def make_alert(
    condition: AlertCondition,
    threshold: str,
    *,
    cooldown_seconds: int = 3600,
    last_triggered_at: datetime | None = None,
) -> Alert:
    # Column defaults are applied by the database on flush, so an in-memory
    # instance must spell out every field the code under test reads.
    return Alert(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        symbol="BTCUSDT",
        condition=condition,
        threshold=Decimal(threshold),
        cooldown_seconds=cooldown_seconds,
        last_triggered_at=last_triggered_at,
    )


def make_tick(price: str) -> TickEvent:
    return TickEvent(symbol="BTCUSDT", price=Decimal(price), ts=datetime.now(UTC))


@pytest.mark.parametrize(
    ("condition", "threshold", "price", "fires"),
    [
        (AlertCondition.PRICE_ABOVE, "100", "101", True),
        (AlertCondition.PRICE_ABOVE, "100", "100", True),  # >=: equality fires
        (AlertCondition.PRICE_ABOVE, "100", "99", False),
        (AlertCondition.PRICE_BELOW, "100", "99", True),
        (AlertCondition.PRICE_BELOW, "100", "100", True),  # <=: equality fires
        (AlertCondition.PRICE_BELOW, "100", "101", False),
    ],
)
def test_condition_boundaries(
    condition: AlertCondition, threshold: str, price: str, fires: bool
) -> None:
    alert = make_alert(condition, threshold)

    assert AlertEvaluationService._condition_met(alert, make_tick(price)) is fires


def test_alert_that_never_fired_is_not_in_cooldown() -> None:
    alert = make_alert(AlertCondition.PRICE_ABOVE, "100")

    assert AlertEvaluationService._in_cooldown(alert, datetime.now(UTC)) is False


def test_recent_trigger_is_in_cooldown() -> None:
    now = datetime.now(UTC)
    alert = make_alert(
        AlertCondition.PRICE_ABOVE,
        "100",
        last_triggered_at=now - timedelta(seconds=60),
    )

    assert AlertEvaluationService._in_cooldown(alert, now) is True


def test_cooldown_expires() -> None:
    now = datetime.now(UTC)
    alert = make_alert(
        AlertCondition.PRICE_ABOVE,
        "100",
        last_triggered_at=now - timedelta(seconds=3601),
    )

    assert AlertEvaluationService._in_cooldown(alert, now) is False


@pytest.mark.parametrize("age", [0, 3599, 3600, 3601])
def test_the_cooldown_cutoff_is_the_same_rule_as_its_end(age: int) -> None:
    now = datetime.now(UTC)
    alert = make_alert(
        AlertCondition.PRICE_ABOVE,
        "100",
        last_triggered_at=now - timedelta(seconds=age),
    )
    cutoff = AlertEvaluationService._cooldown_cutoff(alert, now)
    assert cutoff is not None and alert.last_triggered_at is not None

    # the predicate claim_firing puts in its WHERE, read against this row
    claim_refuses = alert.last_triggered_at > cutoff

    assert claim_refuses is AlertEvaluationService._in_cooldown(alert, now)
