from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError

from backend.models.alert import AlertCondition, AlertRepeatPolicy
from backend.schemas.alert import AlertCreate, AlertUpdate, ExpiryPreset

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


def test_an_expiry_is_asked_for_as_a_preset_duration() -> None:
    alert = AlertCreate(**PAYLOAD, expires_in_seconds=86_400)

    assert alert.expires_in_seconds is ExpiryPreset.HOURS_24


def test_a_duration_outside_the_presets_cannot_be_asked_for() -> None:
    with pytest.raises(ValidationError):
        AlertCreate(**PAYLOAD, expires_in_seconds=3600)


def test_an_alert_is_created_without_an_expiry_by_default() -> None:
    assert AlertCreate(**PAYLOAD).expires_in_seconds is None


def test_a_preset_counts_its_expiry_from_the_given_instant() -> None:
    now = datetime(2026, 10, 2, 12, 0, tzinfo=UTC)

    assert ExpiryPreset.DAYS_7.expiry_from(now) == now + timedelta(days=7)


@pytest.mark.parametrize("field", ["threshold", "status"])
def test_an_edit_cannot_send_null_for_what_cannot_be_removed(field: str) -> None:
    with pytest.raises(ValidationError):
        AlertUpdate.model_validate({field: None})


def test_an_edit_can_send_null_to_remove_the_cooldown() -> None:
    assert (
        AlertUpdate.model_validate({"cooldown_seconds": None}).cooldown_seconds is None
    )


def test_an_edit_tells_an_omitted_expiry_from_a_removed_one() -> None:
    omitted = AlertUpdate.model_validate({})
    removed = AlertUpdate.model_validate({"expires_in_seconds": None})

    assert "expires_in_seconds" not in omitted.model_fields_set
    assert "expires_in_seconds" in removed.model_fields_set
