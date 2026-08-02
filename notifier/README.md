# notifier

Delivers triggered alerts to users via Telegram.

```
exchange "alerts" ──► queue alerts.triggered ──► notifier ──► Telegram Bot API
                                    (rejected) ──► alerts.dlx ──► alerts.triggered.dead
```

- **Entry point**: `notifier.app:app`, run with `faststream run` (`make notifier`).
- **Consumes**: `AlertTriggeredEvent` (see `shared.events`).
- **Config**: `APP_CONFIG__TELEGRAM__BOT_TOKEN` plus the shared infra sections
  (rabbitmq, redis, log, otel).

## Design notes

- **No database.** Everything needed for delivery — including `telegram_chat_id`
  — arrives inside the event: enrichment happens at the source (evaluator). If a
  new field is needed here, add it to the event rather than querying the DB.
- **At-least-once with best-effort dedup**: a Redis `SET NX` keyed by
  `alert_id + triggered_at` suppresses redeliveries. Duplicates are narrowed,
  not eliminated — exactly-once delivery does not exist.
- **Failure policy**: transient errors (network, 5xx, 429) are retried
  in-process; permanent ones (bad chat id, blocked bot) are dead-lettered to
  `alerts.triggered.dead` — never silently dropped.
- **The bot token is redacted** from tracing span attributes before export:
  Telegram puts it in the URL path, so observability tooling would otherwise
  leak it into traces (and httpx request logging into logs). The redaction
  helper lives in its own module (`redaction.py`) rather than in `app.py`,
  which configures logging, tracing and a broker at import — a unit test must
  not have to start a service to check one regex.

## Tests

- `tests/unit/test_redaction.py` — a regression test for the leak above: the
  token really was published once and had to be revoked through BotFather.
- `tests/integration/` — the consumer over `TestRabbitBroker` (in-memory
  delivery) with a real Redis container and a stub sender in place of the
  Telegram API. Covers what the dedup contract promises: a redelivered message
  reaches the user once, a failed delivery **releases** the dedup key so a
  retry can happen, and a user without a linked chat is skipped rather than
  failed.

  The dead-letter path itself is verified one level down, in `shared/tests/` —
  whether a rejected message actually lands in `alerts.triggered.dead` is a
  property of the broker, and an in-memory one cannot show it.

See the [root README](../README.md) for the full picture and quickstart.
