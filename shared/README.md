# shared

Platform kernel: everything the services must agree on. Not a service — it has
no entry point and is never run on its own.

## Contents

| Module | What it holds |
|---|---|
| `events.py` | Event schemas (`TickEvent`, `AlertTriggeredEvent`) — the wire contract |
| `broker.py` | RabbitMQ topology: exchanges, queues, bindings, dead-letter setup, `declare_alerts_topology()` |
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
- **A shared value implies shared behaviour.** Queue names lived here while
  "who declares what" was spelled out separately in the evaluator and the
  notifier; the declaration now lives next to the definitions it uses
  (`declare_alerts_topology`). If several services need the same invariant over
  a value defined here, the invariant belongs here too.

## Tests

`tests/integration/` runs against a **live RabbitMQ container**, because it
covers what an in-memory `TestBroker` cannot see — those are behaviours of the
broker, not of our handlers:

- a rejected message actually reaches `alerts.triggered.dead` (dead-lettering
  into a missing exchange is a *silent* no-op, which is how it bit us once);
- every queue bound to the alerts exchange receives its own copy (fan-out, not
  competition — the notifier and the WS bridge must not steal alerts from each
  other);
- the topology can be declared repeatedly without `PRECONDITION_FAILED`, since
  every service declares it at startup.

`tests/test_events.py` guards the wire contract itself: `Decimal` survives the
JSON boundary and an event rebuilds exactly on the consumer side.

See the [root README](../README.md) for the full picture.
