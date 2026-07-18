# Crypto Alerts

Async price-alert service for crypto markets. Users register, create alerts
("BTCUSDT above 120k"), an ingestor streams Bybit tickers into RabbitMQ, an
evaluator matches ticks against active alerts, and a notifier delivers
Telegram/email notifications. A realtime dashboard (WebSocket) is planned.

> Learning project: built stage by stage to practice a modern async Python
> stack. See [Roadmap](#roadmap) for what is real today vs planned.

## Stack

| Layer                     | Choice                                                                   |
|---------------------------|--------------------------------------------------------------------------|
| Runtime                   | Python 3.14, [uv](https://docs.astral.sh/uv/) workspace monorepo         |
| API                       | FastAPI on [Granian](https://github.com/emmett-framework/granian) (ASGI) |
| Database                  | PostgreSQL 18, SQLAlchemy 2.0 (async) + asyncpg, Alembic migrations      |
| Auth                      | JWT access + rotating opaque refresh tokens, argon2 (pwdlib)             |
| Messaging *(planned)*     | RabbitMQ + FastStream (events), Taskiq (background jobs)                 |
| Cache *(planned)*         | Redis                                                                    |
| Observability *(planned)* | Prometheus + Grafana, OpenTelemetry                                      |

## Repository layout

```
├── backend/          # FastAPI application (API, auth, alerts domain)
│   └── src/backend/
│       ├── api/          # HTTP layer: routers, deps — thin by rule
│       ├── core/         # settings, db engine, security, errors
│       ├── models/       # SQLAlchemy ORM (registered for Alembic here)
│       ├── repositories/ # data access; flush only, no commit
│       ├── schemas/      # pydantic request/response boundary
│       ├── services/     # business rules; owns transactions
│       └── alembic/      # async migration environment
├── compose.yaml      # postgres, redis, rabbitmq, migrate (one-shot), api
├── Makefile          # dev entrypoints (see `make`)
└── .env.template     # copy to .env and fill in
```

Planned workspace members: `ingestor/` (Bybit WS → RabbitMQ), `notifier/`
(events → Telegram), `shared/` (event schemas).

## Quickstart

Prerequisites: `uv`, `docker compose`, `make` (Git Bash on Windows).

```bash
cp .env.template .env
# generate a real secret:
python -c "import secrets; print(secrets.token_hex(32))"   # -> APP_CONFIG__AUTH__SECRET_KEY
# edit DB credentials to taste

make up          # build + start the full stack (migrations run automatically)
```

- API & Swagger: http://localhost:8000/docs
- RabbitMQ UI: http://localhost:15672
- pgAdmin (optional): `docker compose --profile tools up -d` → http://localhost:5050

Local development without containerizing the app:

```bash
make db-up       # infrastructure only (postgres, redis, rabbitmq)
make migrate
make run         # API on http://localhost:8080
```

## Development

| Command                              | Purpose                                                 |
|--------------------------------------|---------------------------------------------------------|
| `make`                               | list all targets                                        |
| `make dev`                           | full stack with live-reload (`compose watch`)           |
| `make lint` / `make format`          | ruff                                                    |
| `make migration m="msg"`             | new autogenerate migration (review it before applying!) |
| `make migrate` / `make migrate-down` | apply / roll back one                                   |
| `make migrate-check`                 | downgrade→upgrade round-trip + model/schema drift check |

Conventions:

- **Conventional Commits**, scope = workspace package: `feat(backend): ...`,
  `feat(infra): ...`, `chore(ci): ...`.
- Layering: `api → services → repositories → models`; imports point down only.
- Schema changes go through Alembic only; `make migrate-check` must stay green.
- Code comments and docstrings in English.

## Auth model (implemented)

- `POST /api/v1/auth/register` → user with argon2-hashed password
- `POST /api/v1/auth/login` (OAuth2 form) → short-lived JWT access +
  long-lived opaque refresh (sha256 stored server-side)
- `POST /api/v1/auth/refresh` → rotation; reuse of a revoked token revokes
  the whole session family (theft detection)
- Protected routes via `Authorization: Bearer` (`GET /users/me`)

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
- [ ] 
    6. RabbitMQ + FastStream: ingestor / evaluator / notifier
- [ ] 
    7. Taskiq: background & scheduled jobs
- [ ] 
    8. WebSocket realtime feed (frontend entry point)
- [ ] 
    9. Observability: Prometheus/Grafana, OpenTelemetry, structured logs
- [ ] 
    10. Tests (pytest-asyncio, testcontainers) + CI