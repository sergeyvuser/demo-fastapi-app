from collections.abc import Callable

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.config import settings
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


async def test_a_new_account_is_not_mailed_and_is_not_the_demo(
    api_client: AsyncClient,
    user: User,
    auth_headers: Callable[[User], dict[str, str]],
) -> None:
    me = await api_client.get(ME, headers=auth_headers(user))

    assert me.json()["digest_enabled"] is False
    assert me.json()["is_demo"] is False


async def test_the_demo_account_is_recognised_from_configuration(
    api_client: AsyncClient,
    session: AsyncSession,
    auth_headers: Callable[[User], dict[str, str]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    demo = User(
        username="demo-in-test",
        email=settings.demo.email,
        hashed_password="not-a-real-hash",
        is_verified=True,
    )
    session.add(demo)
    await session.flush()
    headers = auth_headers(demo)

    monkeypatch.setattr(settings.demo, "enabled", True)
    enabled = await api_client.get(ME, headers=headers)
    # Same row, same address, demo switched off: nothing was stored, so
    # nothing is left claiming the account is still the demo.
    monkeypatch.setattr(settings.demo, "enabled", False)
    disabled = await api_client.get(ME, headers=headers)

    assert enabled.json()["is_demo"] is True
    assert disabled.json()["is_demo"] is False
