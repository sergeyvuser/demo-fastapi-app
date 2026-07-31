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


async def test_malformed_symbol_is_rejected_before_the_service(
    api_client: AsyncClient, verified_user, auth_headers
) -> None:
    response = await api_client.post(
        ALERTS, json={**PAYLOAD, "symbol": "!!"}, headers=auth_headers(verified_user)
    )

    assert response.status_code == 422


async def test_readyz_touches_the_database(api_client: AsyncClient) -> None:
    assert (await api_client.get("/readyz")).json() == {"status": "ok"}
