# shared

Platform kernel: everything the services must agree on. Not a service — it has
no entry point and is never run on its own.

## Contents

| Module | What it holds |
|---|---|
| `events.py` | Event schemas (`TickEvent`, `AlertTriggeredEvent`) — the wire contract |
| `broker.py` | RabbitMQ topology: exchanges, queues, bindings, dead-letter setup |
| `config.py` | `BaseServiceSettings` + configs for shared infra (rabbitmq, redis, log, otel) |
| `logging.py` | Structured logging setup, correlation-id contextvar, stdlib intercept |
| `middlewares.py` | FastStream middleware carrying the correlation id through messages |
| `metrics.py` | Prometheus metric definitions — names are a contract too |
| `tracing.py` | OpenTelemetry provider/exporter setup |

## Rules

- **Everyone depends on shared; shared depends on no one.** No imports from
  `backend`, `ingestor` or `notifier`.
- **No business logic and no service-private config** (db, auth, telegram —
  those belong to their owner).
- **Declare every dependency you import.** A module here forces its imports into
  every service's dependency closure; an undeclared one breaks their images
  (this already happened once with taskiq and loguru).
- Anything used by only one service does not belong here — the taskiq
  correlation middleware lives in `backend/tasks/` for exactly this reason.

See the [root README](../README.md) for the full picture.
