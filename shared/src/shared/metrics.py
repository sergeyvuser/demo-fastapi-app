"""Prometheus metric definitions shared across services.

Metric names are a contract (dashboards/alerts depend on them) — one
source of truth, like event schemas and broker topology.
"""

from prometheus_client import Counter, Gauge

# Metrics endpoints. FastStream services have no HTTP server of their own,
# so each starts a tiny one; the API exposes /metrics on its own port.
# Keep in sync with observability/prometheus.yml.
INGESTOR_METRICS_PORT = 9100
EVALUATOR_METRICS_PORT = 9101
NOTIFIER_METRICS_PORT = 9102

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
auth_failures = Counter(
    "auth_failures_total",
    "Failed authentication attempts",
    ["reason"],
)
auth_successes = Counter(
    "auth_successes_total",
    "Successful logins",
)
rate_limit_hits = Counter(
    "rate_limit_hits_total",
    "Requests rejected by the rate limiter",
    ["scope"],
)
