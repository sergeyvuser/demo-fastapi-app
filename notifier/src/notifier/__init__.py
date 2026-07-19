"""Notifier: delivers triggered alerts to users via Telegram.

Deliberately database-free: every fact needed for delivery (including
telegram_chat_id) arrives inside AlertTriggeredEvent — enrichment
happens at the source (evaluator). If you find yourself wanting a DB
query here, put the data into the event instead.

Delivery semantics: at-least-once with best-effort dedup (redis SET NX
keyed by alert_id + triggered_at). Duplicates are narrowed, not
eliminated — exactly-once delivery does not exist.

Failure policy: transient errors (network, 5xx, 429) are retried
in-process; permanent ones (bad chat id, blocked bot) are dead-lettered
to alerts.triggered.dead — never silently dropped.
"""
