# Crypto Alerts

[![CI](https://github.com/sergeyvuser/demo-fastapi-app/actions/workflows/ci.yml/badge.svg)](https://github.com/sergeyvuser/demo-fastapi-app/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Async price-alert service for crypto markets. Users register, create alerts
("BTCUSDT above 120k"), an ingestor streams Bybit tickers into RabbitMQ, an
evaluator matches ticks against active alerts, a notifier delivers Telegram
alerts, and background jobs send email (verification, daily digest). A
`/api/v1/ws` endpoint streams live ticks and Triggers to clients — ready for a
realtime dashboard frontend.

> Learning project: built stage by stage to practice a modern async Python
> stack. See [Roadmap](#roadmap) for what is real today vs planned.

## Live demo

- Application — https://alerts.vorobev.dev
- API documentation (Swagger) — https://alerts.vorobev.dev/api/docs
- Dashboards, read-only — https://grafana.vorobev.dev

Sign in with **`demo@vorobev.dev`** / **`demo-alerts-2026`**, or register with your own address.

Three things are worth knowing before you click:

- **The demo account is shared.** Alerts other visitors created are visible on it, the account is
  reset to its seeded state every night at 04:00 UTC, and the per-account limit is 20 Alerts — so
  treat anything you create there as temporary.
- **Registering with a real address really sends mail**, and the message may land in spam: the
  sending domain is young, and reputation takes time even with SPF, DKIM and DMARC all passing.
  Creating an Alert requires the address to be verified.
- **Telegram delivery needs a linked chat**, which is set server-side today and which the demo
  account does not have. On that account a Trigger shows up in the live WebSocket feed and in the
  daily digest rather than in a chat.

## Stack

| Layer         | Choice                                                                                                    |
|---------------|-----------------------------------------------------------------------------------------------------------|
| Runtime       | Python 3.14, [uv](https://docs.astral.sh/uv/) workspace monorepo                                          |
| API           | FastAPI on [Granian](https://github.com/emmett-framework/granian) (ASGI)                                  |
| Database      | PostgreSQL 18, SQLAlchemy 2.0 (async) + asyncpg, Alembic migrations                                       |
| Auth          | JWT access + rotating opaque refresh in an httpOnly cookie, argon2 (pwdlib)                               |
| Messaging     | RabbitMQ + FastStream (events), Taskiq (background + scheduled jobs)                                      |
| Cache         | Redis (price cache, rate limiting, dedup, result backend)                                                 |
| Email         | aiosmtplib + Mailpit (dev SMTP sandbox)                                                                   |
| Observability | Prometheus + Grafana (metrics), structured JSON logs with correlation id, OpenTelemetry + Jaeger (traces) |

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
└── .env.example      # copy to .env and fill in
```

Tests live inside the package they cover (`backend/tests/`, `shared/tests/`,
`notifier/tests/`), split into `unit/` (no Docker) and `integration/`.

uv workspace members: `backend`, `ingestor`, `notifier`, `shared` — one
`uv.lock` at the root, each service builds a minimal image from its own
`--package` closure.

## Quickstart

Prerequisites: `uv`, `docker compose`, `make` (Git Bash on Windows).

```bash
cp .env.example .env
# generate a real secret:
python -c "import secrets; print(secrets.token_hex(32))"   # -> APP_CONFIG__AUTH__SECRET_KEY
# edit DB credentials; set APP_CONFIG__TELEGRAM__BOT_TOKEN for notifications

make up          # build + start the full stack (migrations run automatically)
```

- API & Swagger: http://127.0.0.1:8000/api/docs
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

| Command                                    | Purpose                                                  |
|--------------------------------------------|----------------------------------------------------------|
| `make`                                     | list all targets                                         |
| `make up` / `make down`                    | start / stop the full container stack                    |
| `make dev`                                 | full stack with live-reload (`compose watch`)            |
| `make run`                                 | API locally (Granian, auto-reload)                       |
| `make db-up`                               | infrastructure only (postgres, redis, rabbitmq, mailpit) |
| `make tools`                               | dev tools only (mailpit, pgadmin)                        |
| `make evaluator` / `ingestor` / `notifier` | run a stream service locally                             |
| `make worker` / `make scheduler`           | taskiq worker / scheduler locally                        |
| `make lint` / `make format`                | ruff (whole workspace)                                   |
| `make types`                               | mypy (blocking in CI)                                    |
| `make test`                                | full suite (starts throwaway containers)                 |
| `make test-unit` / `make test-integration` | fast slice without Docker / Docker-backed only           |
| `make migration m="msg"`                   | new autogenerate migration (review it before applying!)  |
| `make migrate` / `make migrate-down`       | apply / roll back one                                    |
| `make migrate-check`                       | downgrade→upgrade round-trip + model/schema drift check  |
| `make docker-clean`                        | reclaim build cache and test leftovers (keeps volumes)   |

Conventions:

- **Conventional Commits**, scope = workspace package: `feat(backend): ...`,
  `feat(infra): ...`, `chore(ci): ...`.
- Layering: `api → services → repositories → models`; imports point down only.
- Schema changes go through Alembic only; `make migrate-check` must stay green.
- Code comments and docstrings in English.
- Nothing merges red: ruff, mypy and the whole test suite run on every push.
- Domain vocabulary is settled in [CONTEXT.md](CONTEXT.md) — use those words, including in issues
  and test names. Decisions that would be expensive to reverse live in [docs/adr/](docs/adr/).

## Auth model (implemented)

- `POST /api/v1/auth/register` → user with argon2-hashed password
- `POST /api/v1/auth/login` (OAuth2 form) → a short-lived JWT access token in
  the body, and a long-lived opaque refresh token (sha256 stored server-side)
  that exists nowhere but an `HttpOnly; Secure; SameSite=Strict` cookie scoped
  by `Path` to `/api/v1/auth` — never sent with any other request, never
  readable by JavaScript
- `POST /api/v1/auth/refresh` → no body; reads the cookie, rotates it, returns
  a new access token. Reuse of a revoked token revokes the whole session
  family (theft detection)
- `POST /api/v1/auth/logout` → bearer-authenticated, no body. Revokes this
  device's refresh cookie, and through a per-user token epoch every access
  token already issued to the account — checked on the user row each request
  loads anyway, so it costs no extra I/O. Other devices re-refresh and carry
  on. It also closes the account's open WebSockets, which holds only while the
  API runs as a single instance
- The access token is meant to live in memory, so no state-changing route is
  authenticated by a cookie and `/refresh` is the whole CSRF surface. A script
  keeps the session with curl's cookie jar (`-c`/`-b`)
- `POST /api/v1/auth/verify` → confirm email. The one-time token travels in
  the request body and never in a URL, so it cannot be left behind in a
  server span or a proxy access log. Three answers, which the UI words
  differently: `200` verified, `409` the link was already used (next step:
  sign in), `410` it expired or never existed (next step: ask for another)
- `POST /api/v1/auth/resend-verification` → another verification mail for the
  signed-in account, rate-limited by address; `409` if already verified
- Creating alerts requires a verified email
- Protected routes via `Authorization: Bearer` (`GET /users/me`, which reports
  `is_verified`)

## Event flow (implemented)

Bybit WS → **ingestor** → RabbitMQ `ticks` (topic, key = symbol)
→ **evaluator** (matches active alerts, cooldown, writes price cache)
→ RabbitMQ `alerts` → **notifier** → Telegram.

Reliability: durable queues (rabbitmq volume), supervised WS pump with
reconnect, idempotent delivery (redis `SET NX`), dead-letter queue for
undeliverable notifications.

## Realtime (implemented)

`wss://<host>/api/v1/ws` — authenticated WebSocket. Not in Swagger (OpenAPI
has no WebSocket); the frames are pydantic models in
`backend/src/backend/api/ws/messages.py`, and this is the contract:

```
client → {"action": "auth",    "token": "<access_jwt>"}   # first, within 5 s
client → {"action": "watch",   "symbols": ["BTCUSDT"]}
client → {"action": "unwatch", "symbols": ["BTCUSDT"]}
server → {"type": "watching",  "symbols": [...]}          # the authoritative set
server → {"type": "tick",      "symbol", "price", "reference_price", "ts"}
server → {"type": "trigger",   "trigger_id", "alert_id", "symbol", ...}  # owner only
server → {"type": "heartbeat"}                            # after 20 s of silence
server → {"type": "error",     "code": "unknown_symbols" | "invalid_frame", "symbols": [...]}
```

- The token travels in the first frame, never in the URL, where proxy access
  logs and trace spans would record it. Nothing is sent before it verifies,
  by the same rule as HTTP — a token issued before a logout is refused.
- The socket lives no longer than its token: send a fresh `auth` frame after
  every refresh. There is no reply; staying open is the confirmation.
- Ticks are sampled server-side — at most one per Symbol every 250 ms, latest
  wins. Only the socket fan-out is throttled; the evaluator sees every tick.
- Close codes: `1008` — authentication failed or lapsed; `4000` — replaced by
  a newer socket of the same user (five per user). Do not reconnect on `4000`.
- Nothing is buffered for a disconnected client: on reconnect, refetch the
  Trigger history and `GET /api/v1/symbols`.

## Background jobs (implemented)

Taskiq worker + scheduler over RabbitMQ, Redis result backend:

- **verification email** — enqueued on register, one-time token in Redis
- **daily digest** (cron) — email summary of alerts triggered in the last 24h
- **refresh-token cleanup** (cron) — purge tokens expired/revoked > 30 days ago

## Observability (implemented)

Three pillars, each answering a different question:

- **Metrics** — `/metrics` on every service (RED metrics for HTTP plus custom
  counters: ticks, alerts fired, notifications, auth failures, WS connections
  and sampled-away ticks).
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

| Layer              | Backed by                         | Catches                                        |
|--------------------|-----------------------------------|------------------------------------------------|
| unit               | nothing                           | boundaries, security properties, pure logic    |
| services           | postgres container                | SQL, transactions, ownership, schema drift     |
| HTTP               | `ASGITransport` + redis container | status codes, auth, rate limiting, error shape |
| broker (in-memory) | `TestBroker`, `InMemoryBroker`    | our handlers: parsing, publishing, dedup       |
| broker (live)      | RabbitMQ container                | dead-lettering, queue arguments, fan-out       |

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

## Deployment (implemented)

Production is a single 4 GB VPS running this same `compose.yaml` plus `deploy/compose.prod.yaml`,
behind Caddy with automatic TLS. Why one host rather than a PaaS or Kubernetes, and what that costs:
[ADR-0001](docs/adr/0001-one-vps-with-docker-compose.md).

**A deploy is one commit.** CI publishes images tagged `sha-<short>` only after lint, types, tests
and the secret scan pass, then opens a single ssh connection carrying the commit SHA. The server
fetches the repository tarball for that same commit, refreshes the compose, proxy and observability
files, pulls, starts the stack — migrations and demo seeding are one-shot services inside that step,
not commands anyone can forget — and waits for health. The reasoning, and the rejected alternative of
copying files from CI: [ADR-0002](docs/adr/0002-deployments-are-addressed-by-commit-sha.md).

**Rolling back** is the same path: run the `Deploy` workflow by hand with an earlier 40-character
SHA. There is no separate rollback mechanism and no automatic one — rolling images back over an
applied migration is worse than the outage it would be fixing. Pick the target from the repository's
Deployments panel or the published image tags rather than from `PREVIOUS_IMAGE_TAG` on the server:
that field is one step of undo, so after a manual deploy of an old commit it names that old commit.

**Backups.** The database is dumped nightly on the host (custom format, seven-day rotation, in
`/var/backups/alerts`) and the newest dump is copied to private object storage every Sunday. Both are
systemd timers, so their last run has a recorded outcome:

```bash
systemctl list-timers 'alerts-backup*'
journalctl -u alerts-backup.service -n 30
```

**Restoring is rehearsed rather than assumed.** `deploy/restore-check.sh` starts a throwaway
PostgreSQL of the production major version, loads a dump into it, prints the Alembic revision and the
row counts that distinguish real data from an empty schema, and removes itself afterwards:

```bash
bash /opt/alerts/deploy/restore-check.sh                     # the newest local dump
bash /opt/alerts/deploy/restore-check.sh /path/to/one.dump   # a specific one, e.g. fetched from the bucket
```

The off-site copy holds dumps and **no credentials**, deliberately: rebuilding a machine starts by
generating fresh secrets, and since the token signing key is not among them, everyone signs in again.

## License

MIT — see [LICENSE](LICENSE).

## Roadmap

- [x] 0–1. Skeleton fixes, async SQLAlchemy, first migrations
- [x] 
    2. Auth: JWT + rotating refresh, service layer owning transactions
- [x] 
    3. Alerts domain: CRUD, ownership, pagination, RFC 9457 errors
- [x] 
    4. Docker: multi-stage uv image, full compose with one-shot migrate
- [x] 
    5. Redis: price cache, login rate limiting
- [x] 
    6. RabbitMQ + FastStream: ingestor / evaluator / notifier
- [x] 
    7. Taskiq: background & scheduled jobs (email verify, digest, cleanup)
- [x] 
    8. WebSocket realtime feed (frontend entry point)
- [x] 
    9. Observability: Prometheus/Grafana, OpenTelemetry, structured logs
- [x] 
    10. Tests (pytest-asyncio, testcontainers) + mypy + GitHub Actions
- [x] 
    11. Hardening for public access: one service bootstrap, proxy headers, SMTP auth
- [x] 
    12. Deployment: GHCR images, production overlay, Caddy + TLS, delivery by commit SHA,
        backups with a verified restore
- [ ] 
    13. React + Vite UI: alerts, live ticker, Telegram linking, trigger history
- [ ] 
    14. In-app AI agent: reads your data, drafts actions, you confirm them