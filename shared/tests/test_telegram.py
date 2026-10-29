"""How the client reads Telegram's answers.

No network: httpx.MockTransport answers in-process. The bodies are shaped
like the Bot API's real error envelope ({"ok": false, "error_code": ...,
"description": ...}), with descriptions as the Bot API server writes them
today — see .scratch/stage-13-ui/research/telegram-binding.md §3.
"""

import httpx
import pytest

from shared.telegram import (
    RefusalReason,
    TelegramClient,
    TelegramError,
    TelegramRefused,
    TelegramUnavailable,
)


def client_answering(status: int, body: dict | None = None) -> TelegramClient:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json=body or {})

    return TelegramClient("123:token", transport=httpx.MockTransport(handler))


def error(code: int, description: str, **parameters: int) -> dict:
    body: dict = {"ok": False, "error_code": code, "description": description}
    if parameters:
        body["parameters"] = parameters
    return body


async def test_accepted_message_returns() -> None:
    sent: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return httpx.Response(200, json={"ok": True, "result": {}})

    client = TelegramClient("123:token", transport=httpx.MockTransport(handler))
    await client.send_message(42, "hi")

    assert sent[0].url.path == "/bot123:token/sendMessage"
    assert sent[0].read() == b'{"chat_id":42,"text":"hi"}'


@pytest.mark.parametrize(
    ("status", "description"),
    [
        (400, "Bad Request: chat not found"),
        (400, "Bad Request: private chat not found"),
        (403, "Forbidden: bot can't initiate conversation with a user"),
        (403, "Forbidden: user is deactivated"),
    ],
)
async def test_a_chat_that_never_started_the_bot_is_refused(
    status: int, description: str
) -> None:
    client = client_answering(status, error(status, description))

    with pytest.raises(TelegramRefused) as refused:
        await client.send_message(42, "hi")

    assert refused.value.reason is RefusalReason.NOT_STARTED


async def test_a_blocked_bot_is_a_refusal_of_its_own() -> None:
    client = client_answering(403, error(403, "Forbidden: bot was blocked by the user"))

    with pytest.raises(TelegramRefused) as refused:
        await client.send_message(42, "hi")

    assert refused.value.reason is RefusalReason.BLOCKED


async def test_flood_control_is_transient_and_names_the_wait() -> None:
    client = client_answering(
        429, error(429, "Too Many Requests: retry after 7", retry_after=7)
    )

    with pytest.raises(TelegramUnavailable) as unavailable:
        await client.send_message(42, "hi")

    assert unavailable.value.retry_after == 7


async def test_a_server_error_without_json_is_transient() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(502, text="<html>Bad Gateway</html>")

    client = TelegramClient("123:token", transport=httpx.MockTransport(handler))

    with pytest.raises(TelegramUnavailable) as unavailable:
        await client.send_message(42, "hi")

    assert unavailable.value.retry_after is None


async def test_a_network_failure_is_transient_and_hides_the_token() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    client = TelegramClient("123:secret", transport=httpx.MockTransport(handler))

    with pytest.raises(TelegramUnavailable) as unavailable:
        await client.send_message(42, "hi")

    assert "secret" not in str(unavailable.value)
    assert unavailable.value.__cause__ is None  # nothing chained that holds the URL


async def test_a_rejected_token_is_not_blamed_on_the_chat() -> None:
    client = client_answering(401, error(401, "Unauthorized"))

    with pytest.raises(TelegramError) as failed:
        await client.send_message(42, "hi")

    assert not isinstance(failed.value, TelegramRefused | TelegramUnavailable)


async def test_the_bot_names_itself_once() -> None:
    asked: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        asked.append(request.url.path)
        body = {"ok": True, "result": {"id": 123, "is_bot": True, "username": "a_bot"}}
        return httpx.Response(200, json=body)

    client = TelegramClient("123:token", transport=httpx.MockTransport(handler))

    assert await client.bot_username() == "a_bot"
    assert await client.bot_username() == "a_bot"
    assert asked == ["/bot123:token/getMe"]  # the second answer came from memory


async def test_a_failed_name_is_asked_again() -> None:
    answers = iter(
        [
            httpx.Response(502, text="<html>Bad Gateway</html>"),
            httpx.Response(200, json={"ok": True, "result": {"username": "a_bot"}}),
        ]
    )
    client = TelegramClient(
        "123:token", transport=httpx.MockTransport(lambda _: next(answers))
    )

    with pytest.raises(TelegramUnavailable):
        await client.bot_username()
    assert await client.bot_username() == "a_bot"
