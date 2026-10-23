from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient

from backend.core.config import settings

DEMO = "/api/v1/demo"


async def test_a_deployment_without_a_demo_says_so(api_client: AsyncClient) -> None:
    # Not a 404: "there is no demo here" is an answer, and the Landing needs it
    # to leave the button out.
    response = await api_client.get(DEMO)

    assert response.status_code == 200
    assert response.json() == {
        "enabled": False,
        "email": None,
        "password": None,
        "resets_at": None,
    }


async def test_the_demo_is_published_without_a_session(
    api_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings.demo, "enabled", True)

    response = await api_client.get(DEMO)  # no Authorization header

    assert response.status_code == 200
    body = response.json()
    # exactly these four: anything added here is published to everyone
    assert body.keys() == {"enabled", "email", "password", "resets_at"}
    assert body["enabled"] is True
    assert body["email"] == settings.demo.email
    assert body["password"] == settings.demo.password
    resets_at = datetime.fromisoformat(body["resets_at"])
    assert resets_at.utcoffset() == timedelta(0)
    assert timedelta(0) < resets_at - datetime.now(UTC) <= timedelta(days=1)
