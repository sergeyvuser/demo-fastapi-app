import pytest
from pydantic import ValidationError

from backend.models.alert import AlertCondition, AlertRepeatPolicy
from backend.schemas.alert import AlertCreate

PAYLOAD = {
    "symbol": "BTCUSDT",
    "condition": AlertCondition.PRICE_ABOVE,
    "threshold": "64000.5",
}


def test_a_once_alert_keeps_no_cooldown() -> None:
    """Nothing to space out, so the field is not allowed to claim otherwise."""
    alert = AlertCreate(
        **PAYLOAD, repeat_policy=AlertRepeatPolicy.ONCE, cooldown_seconds=3600
    )

    assert alert.cooldown_seconds is None


def test_a_present_cooldown_is_still_floored() -> None:
    with pytest.raises(ValidationError):
        AlertCreate(**PAYLOAD, cooldown_seconds=59)


def test_an_absent_cooldown_is_allowed_on_a_crossing_alert() -> None:
    alert = AlertCreate(
        **PAYLOAD, repeat_policy=AlertRepeatPolicy.ON_CROSS, cooldown_seconds=None
    )

    assert alert.cooldown_seconds is None


def test_the_default_policy_is_todays_behaviour() -> None:
    assert AlertCreate(**PAYLOAD).repeat_policy is AlertRepeatPolicy.WHILE_TRUE
