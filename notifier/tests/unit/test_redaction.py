from notifier.redaction import redact_bot_token


def test_bot_token_is_removed_from_the_url() -> None:
    url = "https://api.telegram.org/bot123456:AAHsecret-value/sendMessage?chat_id=1"

    redacted = redact_bot_token(url)

    assert "AAHsecret-value" not in redacted
    assert redacted == ("https://api.telegram.org/bot<redacted>/sendMessage?chat_id=1")


def test_unrelated_url_is_left_alone() -> None:
    url = "https://example.com/health"

    assert redact_bot_token(url) == url
