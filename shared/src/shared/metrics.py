"""Prometheus metric definitions shared across services.

Metric names are a contract (dashboards/alerts depend on them) — one
source of truth, like event schemas and broker topology.
"""

from prometheus_client import Counter, Gauge

ticks_published = Counter(
    "ticks_published_total",
    "Ticks published by ingestor",
    ["symbol"],
)
ticks_processed = Counter(
    "ticks_processed_total",
    "Ticks processed by evaluator",
)
alerts_fired = Counter(
    "alerts_fired_total",
    "Alerts triggered",
    ["condition"],
)
notifications_sent = Counter(
    "notifications_sent_total",
    "Telegram messages sent",
)
notifications_failed = Counter(
    "notifications_failed_total",
    "Telegram deliveries dead-lettered",
)
ws_connections = Gauge(
    "ws_active_connections",
    "Active WebSocket connections",
)
