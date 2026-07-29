"""Keep the Telegram bot token out of logs and span attributes.

Lives apart from app.py so it is testable without importing the service
entry point, which configures logging, tracing and a broker at import time.
"""

import re

_TOKEN_RE = re.compile(r"/bot[^/]+/")


def redact_bot_token(url: str) -> str:
    return _TOKEN_RE.sub("/bot<redacted>/", url)
