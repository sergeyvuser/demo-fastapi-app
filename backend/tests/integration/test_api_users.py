from collections.abc import Callable

from httpx import AsyncClient

from backend.models import User

ME = "/api/v1/users/me"


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
