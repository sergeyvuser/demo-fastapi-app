from collections.abc import Callable

import pytest
from httpx import AsyncClient

from backend.models import User

ME = "/api/v1/users/me"
PREFERENCES = "/api/v1/users/me/preferences"


async def test_me_reports_an_unverified_account(
    api_client: AsyncClient,
    user: User,
    auth_headers: Callable[[User], dict[str, str]],
) -> None:
    headers = auth_headers(user)
    me = await api_client.get(ME, headers=headers)

    assert me.status_code == 200
    assert me.json()["is_verified"] is False


async def test_me_reports_a_verified_account(
    api_client: AsyncClient,
    verified_user: User,
    auth_headers: Callable[[User], dict[str, str]],
) -> None:
    headers = auth_headers(verified_user)
    me = await api_client.get(ME, headers=headers)

    assert me.status_code == 200
    assert me.json()["is_verified"] is True


async def test_the_digest_is_switched_on_and_stays_on(
    api_client: AsyncClient,
    verified_user: User,
    auth_headers: Callable[[User], dict[str, str]],
) -> None:
    headers = auth_headers(verified_user)

    put = await api_client.put(
        PREFERENCES, json={"digest_enabled": True}, headers=headers
    )
    me = await api_client.get(ME, headers=headers)

    assert put.status_code == 200
    assert put.json()["digest_enabled"] is True
    assert me.json()["digest_enabled"] is True


async def test_an_unverified_account_cannot_change_preferences(
    api_client: AsyncClient,
    user: User,
    auth_headers: Callable[[User], dict[str, str]],
) -> None:
    put = await api_client.put(
        PREFERENCES, json={"digest_enabled": True}, headers=auth_headers(user)
    )

    assert put.status_code == 403


@pytest.mark.parametrize(
    "extra", [{"email": "someone-else@example.com"}, {"username": "someone_else"}]
)
async def test_preferences_cannot_change_who_the_account_is(
    api_client: AsyncClient,
    verified_user: User,
    auth_headers: Callable[[User], dict[str, str]],
    extra: dict[str, str],
) -> None:
    headers = auth_headers(verified_user)
    before = (await api_client.get(ME, headers=headers)).json()

    put = await api_client.put(
        PREFERENCES, json={"digest_enabled": True} | extra, headers=headers
    )
    after = (await api_client.get(ME, headers=headers)).json()

    # refused outright, not silently ignored: the caller learns the field
    # does not belong here
    assert put.status_code == 422
    assert after == before
