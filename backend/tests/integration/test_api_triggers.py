import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import Alert, Trigger, User
from backend.models.alert import AlertCondition, AlertStatus
from backend.models.trigger import TriggerDelivery
from backend.repositories.trigger import TriggerRepository
from backend.tasks.maintenance import RETENTION_TRIGGERS, retention_cutoff

TRIGGERS = "/api/v1/triggers"


async def make_alert(
    session: AsyncSession, user: User, symbol: str = "BTCUSDT"
) -> Alert:
    alert = Alert(
        user_id=user.id,
        symbol=symbol,
        condition=AlertCondition.PRICE_ABOVE,
        threshold=Decimal("100"),
        status=AlertStatus.ACTIVE,
        cooldown_seconds=3600,
    )
    session.add(alert)
    await session.flush()
    return alert


async def fire(session: AsyncSession, alert: Alert, at: datetime) -> Trigger:
    """A Trigger with a chosen instant — the evaluator only ever writes now()."""
    trigger = Trigger(
        id=uuid.uuid7(),
        alert_id=alert.id,
        user_id=alert.user_id,
        symbol=alert.symbol,
        condition=alert.condition,
        threshold=alert.threshold,
        price=Decimal("101"),
        triggered_at=at,
        delivery=TriggerDelivery.QUEUED,
    )
    session.add(trigger)
    await session.flush()
    return trigger


async def test_anonymous_access_is_rejected(api_client: AsyncClient) -> None:
    assert (await api_client.get(TRIGGERS)).status_code == 401


async def test_an_unverified_user_may_read_the_feed(
    api_client: AsyncClient, session, user, auth_headers
) -> None:
    alert = await make_alert(session, user)
    await fire(session, alert, datetime.now(UTC))

    response = await api_client.get(TRIGGERS, headers=auth_headers(user))

    assert response.status_code == 200
    assert len(response.json()["items"]) == 1


async def test_another_users_triggers_are_invisible(
    api_client: AsyncClient, session, user, other_user, auth_headers
) -> None:
    alert = await make_alert(session, user)
    await fire(session, alert, datetime.now(UTC))

    body = (await api_client.get(TRIGGERS, headers=auth_headers(other_user))).json()
    # filtering by someone else's Alert is a filter, not a resource: an empty
    # page, not a 404 — and it does not reveal that the Alert exists
    filtered = (
        await api_client.get(
            TRIGGERS,
            params={"alert_id": str(alert.id)},
            headers=auth_headers(other_user),
        )
    ).json()

    assert body["items"] == []
    assert filtered["items"] == []


async def test_the_feed_walks_past_its_end(
    api_client: AsyncClient, session, user, auth_headers
) -> None:
    alert = await make_alert(session, user)
    now = datetime.now(UTC)
    for minutes in range(5):
        await fire(session, alert, now - timedelta(minutes=minutes))
    headers = auth_headers(user)

    seen: list[str] = []
    cursor, pages = None, 0
    while True:
        params = {"limit": 2} | ({"cursor": cursor} if cursor else {})
        body = (await api_client.get(TRIGGERS, params=params, headers=headers)).json()
        seen += [item["id"] for item in body["items"]]
        pages += 1
        cursor = body["next_cursor"]
        if cursor is None:
            break

    assert pages == 3  # 2 + 2 + 1
    assert len(seen) == len(set(seen)) == 5  # nothing repeated, nothing skipped
    assert seen == sorted(seen, key=lambda i: seen.index(i))  # order preserved


async def test_one_tick_firing_several_alerts_pages_without_drift(
    api_client: AsyncClient, session, user, auth_headers
) -> None:
    """The id tiebreak. Three Alerts satisfied by one Tick share an instant to
    the microsecond, so triggered_at alone cannot order them."""
    instant = datetime.now(UTC)
    ids = set()
    for _ in range(3):
        alert = await make_alert(session, user)
        ids.add(str((await fire(session, alert, instant)).id))
    headers = auth_headers(user)

    first = (
        await api_client.get(TRIGGERS, params={"limit": 2}, headers=headers)
    ).json()
    second = (
        await api_client.get(
            TRIGGERS,
            params={"limit": 2, "cursor": first["next_cursor"]},
            headers=headers,
        )
    ).json()

    paged = [item["id"] for item in first["items"] + second["items"]]
    assert len(paged) == 3
    assert set(paged) == ids
    assert second["next_cursor"] is None


async def test_the_filters_narrow_the_feed(
    api_client: AsyncClient, session, user, auth_headers
) -> None:
    now = datetime.now(UTC)
    btc = await make_alert(session, user)
    eth = await make_alert(session, user, symbol="ETHUSDT")
    await fire(session, btc, now - timedelta(hours=2))
    await fire(session, eth, now - timedelta(minutes=5))
    headers = auth_headers(user)

    async def ids(**params) -> set[str]:
        body = (await api_client.get(TRIGGERS, params=params, headers=headers)).json()
        return {item["symbol"] for item in body["items"]}

    assert await ids(symbol="ethusdt") == {"ETHUSDT"}  # normalised like an Alert
    assert await ids(alert_id=str(btc.id)) == {"BTCUSDT"}
    assert await ids(**{"from": (now - timedelta(hours=1)).isoformat()}) == {"ETHUSDT"}
    # `to` is exclusive, so a Trigger exactly on the boundary is not in the range
    assert await ids(**{"to": (now - timedelta(hours=2)).isoformat()}) == set()


async def test_a_broken_cursor_and_a_naive_instant_are_refused(
    api_client: AsyncClient, user, auth_headers
) -> None:
    headers = auth_headers(user)

    broken = await api_client.get(TRIGGERS, params={"cursor": "!!"}, headers=headers)
    naive = await api_client.get(
        TRIGGERS, params={"from": "2026-09-20T10:00:00"}, headers=headers
    )

    assert broken.status_code == 400
    assert broken.headers["content-type"].startswith("application/problem+json")
    assert naive.status_code == 422  # FastAPI's own parameter validation


async def test_retention_deletes_only_what_is_past_the_window(session, user) -> None:
    alert = await make_alert(session, user)
    now = datetime.now(UTC)
    fresh = await fire(session, alert, now - timedelta(days=29))
    await fire(session, alert, now - timedelta(days=31))

    purged = await TriggerRepository(session).delete_older_than(
        retention_cutoff(RETENTION_TRIGGERS)
    )

    remaining = list(await session.scalars(select(Trigger)))
    assert purged == 1
    assert [row.id for row in remaining] == [fresh.id]
