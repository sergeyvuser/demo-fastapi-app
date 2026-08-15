# Crypto Alerts

[![CI](https://github.com/sergeyvuser/demo-fastapi-app/actions/workflows/ci.yml/badge.svg)](https://github.com/sergeyvuser/demo-fastapi-app/actions/workflows/ci.yml)

Async price-alert service for crypto markets. Users register, create alerts
("BTCUSDT above 120k"), an ingestor streams Bybit tickers into RabbitMQ, an
evaluator matches ticks against active alerts, a notifier delivers Telegram
alerts, and background jobs send email (verification, daily digest). A
`/ws` endpoint streams live ticks and alerts to clients — ready for a
realtime dashboard frontend.

> Learning project: built stage by stage to practice a modern async Python
> stack. See [Roadmap](#roadmap) for what is real today vs planned.

## Stack

| Layer                     | Choice                                                                   |
|---------------------------|--------------------------------------------------------------------------|
| Runtime                   | Python 3.14, [uv](https://docs.astral.sh/uv/) workspace monorepo         |
| API                       | FastAPI on [Granian](https://github.com/emmett-framework/granian) (ASGI) |
| Database                  | PostgreSQL 18, SQLAlchemy 2.0 (async) + asyncpg, Alembic migrations      |
| Auth                      | JWT access + rotating opaque refresh tokens, argon2 (pwdlib)             |
| Messaging                 | RabbitMQ + FastStream (events), Taskiq (background + scheduled jobs)     |
| Cache                     | Redis (price cache, rate limiting, dedup, result backend)               |
| Email                     | aiosmtplib + Mailpit (dev SMTP sandbox)                                  |
| Observability             | Prometheus + Grafana (metrics), structured JSON logs with correlation id, OpenTelemetry + Jaeger (traces) |

## Repository layout

```
├── backend/          # FastAPI app + evaluator (consumer) + taskiq worker/scheduler
│   └── src/backend/
│       ├── api/          # HTTP layer: routers, deps — thin by rule
│       ├── consumers/    # FastStream evaluator: ticks → alert events
│       ├── tasks/        # taskiq jobs: email verify, digest, token cleanup
│       ├── core/         # settings, db engine, security, errors
│       ├── models/       # SQLAlchemy ORM (registered for Alembic here)
│       ├── repositories/ # data access; flush only, no commit
│       ├── schemas/      # pydantic request/response boundary
│       ├── services/     # business rules; owns transactions
│       └── alembic/      # async migration environment
├── ingestor/         # Bybit WS → RabbitMQ ticks
├── notifier/         # alert events → Telegram
├── shared/           # event schemas, broker topology, shared infra config
├── observability/    # prometheus config, grafana provisioning (datasource, dashboards)
├── .github/workflows/ # CI: lint, types, tests, secret scan, image builds
├── compose.yaml      # db, redis, rabbitmq, migrate, api, evaluator, ingestor, notifier,
│                     #   worker, scheduler, prometheus, grafana, jaeger
│                     #   + `tools` profile: mailpit, pgadmin
├── conftest.py       # test env + fixtures shared by every package
├── .gitleaks.toml    # secret-scanner rules
├── Makefile          # dev entrypoints (see `make`)
└── .env.template     # copy to .env and fill in
```

Tests live inside the package they cover (`backend/tests/`, `shared/tests/`,
`notifier/tests/`), split into `unit/` (no Docker) and `integration/`.

uv workspace members: `backend`, `ingestor`, `notifier`, `shared` — one
`uv.lock` at the root, each service builds a minimal image from its own
`--package` closure.

## Quickstart

Prerequisites: `uv`, `docker compose`, `make` (Git Bash on Windows).

```bash
cp .env.template .env
# generate a real secret:
python -c "import secrets; print(secrets.token_hex(32))"   # -> APP_CONFIG__AUTH__SECRET_KEY
# edit DB credentials; set APP_CONFIG__TELEGRAM__BOT_TOKEN for notifications

make up          # build + start the full stack (migrations run automatically)
```

- API & Swagger: http://127.0.0.1:8000/docs
- RabbitMQ UI: http://127.0.0.1:15672
- Mailpit (caught emails): http://127.0.0.1:8025
- Grafana (dashboards): http://127.0.0.1:3000
- Prometheus: http://127.0.0.1:9090 · Jaeger (traces): http://127.0.0.1:16686
- pgAdmin: http://127.0.0.1:5050

Mailpit and pgAdmin are development tools behind the `tools` compose profile; the
Makefile enables it for you (`COMPOSE_PROFILES=tools`), so `make up` starts them as
usual. A plain `docker compose up` — what a deployment runs — starts neither.

> Use `127.0.0.1`, not `localhost`: ports are published on IPv4 only, and on
> Windows `localhost` resolves to `::1` first.

Local development without containerizing the app:

```bash
make db-up       # infrastructure only (postgres, redis, rabbitmq, mailpit)
make migrate
make run         # API on http://127.0.0.1:8080
```

## Development

| Command                              | Purpose                                                 |
|--------------------------------------|---------------------------------------------------------|
| `make`                               | list all targets                                        |
| `make up` / `make down`              | start / stop the full container stack                   |
| `make dev`                           | full stack with live-reload (`compose watch`)           |
| `make run`                           | API locally (Granian, auto-reload)                      |
| `make db-up`                         | infrastructure only (postgres, redis, rabbitmq, mailpit)|
| `make tools`                         | dev tools only (mailpit, pgadmin)                       |
| `make evaluator` / `ingestor` / `notifier` | run a stream service locally                      |
| `make worker` / `make scheduler`     | taskiq worker / scheduler locally                       |
| `make lint` / `make format`          | ruff (whole workspace)                                  |
| `make types`                         | mypy (blocking in CI)                                   |
| `make test`                          | full suite (starts throwaway containers)                |
| `make test-unit` / `make test-integration` | fast slice without Docker / Docker-backed only    |
| `make migration m="msg"`             | new autogenerate migration (review it before applying!) |
| `make migrate` / `make migrate-down` | apply / roll back one                                   |
| `make migrate-check`                 | downgrade→upgrade round-trip + model/schema drift check |
| `make docker-clean`                  | reclaim build cache and test leftovers (keeps volumes)  |

Conventions:

- **Conventional Commits**, scope = workspace package: `feat(backend): ...`,
  `feat(infra): ...`, `chore(ci): ...`.
- Layering: `api → services → repositories → models`; imports point down only.
- Schema changes go through Alembic only; `make migrate-check` must stay green.
- Code comments and docstrings in English.
- Nothing merges red: ruff, mypy and the whole test suite run on every push.

## Auth model (implemented)

- `POST /api/v1/auth/register` → user with argon2-hashed password
- `POST /api/v1/auth/login` (OAuth2 form) → short-lived JWT access +
  long-lived opaque refresh (sha256 stored server-side)
- `POST /api/v1/auth/refresh` → rotation; reuse of a revoked token revokes
  the whole session family (theft detection)
- `GET /api/v1/auth/verify?token=...` → confirm email (one-time token);
  creating alerts requires a verified email
- Protected routes via `Authorization: Bearer` (`GET /users/me`)

## Event flow (implemented)

Bybit WS → **ingestor** → RabbitMQ `ticks` (topic, key = symbol)
→ **evaluator** (matches active alerts, cooldown, writes price cache)
→ RabbitMQ `alerts` → **notifier** → Telegram.

Reliability: durable queues (rabbitmq volume), supervised WS pump with
reconnect, idempotent delivery (redis `SET NX`), dead-letter queue for
undeliverable notifications.

## Realtime (implemented)

`GET ws://<host>/ws?token=<access_jwt>` — authenticated WebSocket. Not in
Swagger (OpenAPI has no WebSocket); this is the contract:

```
client → {"action": "subscribe",   "symbols": ["BTCUSDT"]}
client → {"action": "unsubscribe", "symbols": ["BTCUSDT"]}
server → {"type": "subscriptions", "symbols": [...]}          # ack
server → {"type": "tick",  "symbol": "...", "price": "...", "ts": "..."}
server → {"type": "alert", "alert_id": "...", "symbol": "...", ...}  # this user only
```

Ticks are filtered by subscription; alerts are delivered only to their
owner. The browser must reconnect on drop (server restart closes sockets).

## Background jobs (implemented)

Taskiq worker + scheduler over RabbitMQ, Redis result backend:

- **verification email** — enqueued on register, one-time token in Redis
- **daily digest** (cron) — email summary of alerts triggered in the last 24h
- **refresh-token cleanup** (cron) — purge tokens expired/revoked > 30 days ago

## Observability (implemented)

Three pillars, each answering a different question:

- **Metrics** — `/metrics` on every service (RED metrics for HTTP plus custom
  counters: ticks, alerts fired, notifications, auth failures, WS connections).
  Scraped by Prometheus, charted in Grafana.
- **Logs** — flat JSON to stdout, one line per event, with structured fields
  (`logger.bind(...)`). Every line carries `correlation_id` (propagated across
  HTTP → broker → tasks) and `trace_id`, so one grep reconstructs a whole
  cross-service operation.
- **Traces** — OpenTelemetry with automatic instrumentation (FastAPI,
  SQLAlchemy, Redis, httpx) and context propagation through RabbitMQ, so a
  single trace spans ingestor → evaluator → notifier. Exported to Jaeger.

Sampling is per service (`APP_CONFIG__OTEL__SAMPLE_RATIO`); secrets are
redacted from span attributes before export.

## Tests & CI (implemented)

53 tests in five layers, each catching what the layer below cannot:

| Layer | Backed by | Catches |
|---|---|---|
| unit | nothing | boundaries, security properties, pure logic |
| services | postgres container | SQL, transactions, ownership, schema drift |
| HTTP | `ASGITransport` + redis container | status codes, auth, rate limiting, error shape |
| broker (in-memory) | `TestBroker`, `InMemoryBroker` | our handlers: parsing, publishing, dedup |
| broker (live) | RabbitMQ container | dead-lettering, queue arguments, fan-out |

Containers are started by the tests themselves (testcontainers), so a fresh
clone needs nothing but Docker. Each test runs inside a transaction that is
rolled back afterwards — the service layer commits freely and still leaks
nothing between tests.

```bash
make test-unit   # ~1s, no Docker
make test        # everything
```

CI runs six jobs in parallel on every push: `lint` (ruff check + format),
`types` (mypy), `test`, `secrets` (gitleaks over the **full history**), and
image builds for all three services. There is no separate "migrations are up
to date" job — a test asserts that models and migrations agree against a live
database.

## Roadmap

- [x] 0–1. Skeleton fixes, async SQLAlchemy, first migrations
- [x] 2. Auth: JWT + rotating refresh, service layer owning transactions
- [x] 3. Alerts domain: CRUD, ownership, pagination, RFC 9457 errors
- [x] 4. Docker: multi-stage uv image, full compose with one-shot migrate
- [x] 5. Redis: price cache, login rate limiting
- [x] 6. RabbitMQ + FastStream: ingestor / evaluator / notifier
- [x] 7. Taskiq: background & scheduled jobs (email verify, digest, cleanup)
- [x] 8. WebSocket realtime feed (frontend entry point)
- [x] 9. Observability: Prometheus/Grafana, OpenTelemetry, structured logs
- [x] 10. Tests (pytest-asyncio, testcontainers) + mypy + GitHub Actions