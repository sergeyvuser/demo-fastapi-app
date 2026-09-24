from httpx import AsyncClient

ALERTS = "/api/v1/alerts"
PAYLOAD = {
    "symbol": "BTCUSDT",
    "condition": "price_above",
    "threshold": "64000.5",
    "cooldown_seconds": 3600,
}


async def test_anonymous_access_is_rejected(api_client: AsyncClient) -> None:
    assert (await api_client.get(ALERTS)).status_code == 401


async def test_unverified_user_cannot_create_alerts(
    api_client: AsyncClient, user, auth_headers
) -> None:
    response = await api_client.post(ALERTS, json=PAYLOAD, headers=auth_headers(user))

    assert response.status_code == 403


async def test_alert_lifecycle(
    api_client: AsyncClient, verified_user, auth_headers
) -> None:
    headers = auth_headers(verified_user)

    created = await api_client.post(ALERTS, json=PAYLOAD, headers=headers)
    assert created.status_code == 201
    assert created.json()["trigger_count"] == 0
    alert_id = created.json()["id"]

    listed = await api_client.get(ALERTS, headers=headers)
    assert listed.json()["total"] == 1

    paused = await api_client.patch(
        f"{ALERTS}/{alert_id}", json={"status": "paused"}, headers=headers
    )
    assert paused.json()["status"] == "paused"

    assert (
        await api_client.delete(f"{ALERTS}/{alert_id}", headers=headers)
    ).status_code == 204
    assert (
        await api_client.get(f"{ALERTS}/{alert_id}", headers=headers)
    ).status_code == 404


async def test_alert_of_another_user_is_invisible(
    api_client: AsyncClient, verified_user, other_user, auth_headers
) -> None:
    alert_id = (
        await api_client.post(ALERTS, json=PAYLOAD, headers=auth_headers(verified_user))
    ).json()["id"]

    response = await api_client.get(
        f"{ALERTS}/{alert_id}", headers=auth_headers(other_user)
    )

    assert response.status_code == 404


async def test_the_two_symbol_failures_are_told_apart(
    api_client: AsyncClient, verified_user, auth_headers
) -> None:
    """A bad Symbol and an unavailable Symbol are different answers.

    "!!" is not shaped like a Symbol and never reaches the service — 422 from
    the schema. "DOGEUSDT" is a perfectly good Symbol that this system does
    not stream — 400 from our own code, in RFC 9457 form. A UI that explains
    the failure to a person cannot do it if both arrive as 422.
    """
    headers = auth_headers(verified_user)

    malformed = await api_client.post(
        ALERTS, json={**PAYLOAD, "symbol": "!!"}, headers=headers
    )
    not_streamed = await api_client.post(
        ALERTS, json={**PAYLOAD, "symbol": "DOGEUSDT"}, headers=headers
    )

    assert malformed.status_code == 422
    assert not_streamed.status_code == 400
    assert not_streamed.headers["content-type"].startswith("application/problem+json")
    # the message names the Symbol: the client echoes it, it does not guess
    assert "DOGEUSDT" in not_streamed.json()["detail"]


async def test_readyz_touches_the_database(api_client: AsyncClient) -> None:
    assert (await api_client.get("/readyz")).json() == {"status": "ok"}
