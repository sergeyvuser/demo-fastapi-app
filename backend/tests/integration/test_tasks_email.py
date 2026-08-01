import uuid

import pytest
from redis.asyncio import Redis

from backend.tasks.email import send_verification_email


async def test_verification_task_stores_a_one_time_token_and_mails_it(
    taskiq_broker, clean_redis: Redis, monkeypatch: pytest.MonkeyPatch
) -> None:
    letters = []

    async def fake_send(message, **kwargs) -> None:
        letters.append(message)

    monkeypatch.setattr("aiosmtplib.send", fake_send)
    user_id = str(uuid.uuid7())

    task = await send_verification_email.kiq(
        user_id=user_id, email="alice@example.com", username="alice"
    )
    result = await task.wait_result(timeout=5)

    assert not result.is_err
    assert len(letters) == 1
    assert letters[0]["To"] == "alice@example.com"

    keys = [key async for key in clean_redis.scan_iter("verify:*")]
    assert len(keys) == 1
    assert await clean_redis.get(keys[0]) == user_id
    # the link in the letter must carry that very token, or verification 404s
    assert keys[0].removeprefix("verify:") in letters[0].get_content()
