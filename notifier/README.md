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
  leak it into traces (and httpx request logging into logs).

See the [root README](../README.md) for the full picture and quickstart.
