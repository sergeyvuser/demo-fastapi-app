# backend

Three processes from one codebase (and one Docker image), each with its own
entry point:

| Process | Entry point | Role |
|---|---|---|
| API | `backend.main:app` (granian, `make run`) | HTTP + WebSocket, auth, alerts CRUD |
| evaluator | `backend.consumers.app:app` (`make evaluator`) | consumes ticks, fires alerts, writes price cache |
| worker / scheduler | `backend.tasks.worker:broker` / `:scheduler` | taskiq jobs: verification email, digest, token cleanup |

## Layers

```
api/ → services/ → repositories/ → models/
```

Imports point down only. Each layer has one job:

- `api/` — HTTP: status codes, request/response schemas, dependencies. Thin by rule.
- `services/` — business rules and **transactions**: exactly one commit per public method.
- `repositories/` — queries; `flush()` only, never `commit()`. Ownership is
  enforced in the query itself (filter by `user_id`), not after fetching.
- `models/` — SQLAlchemy ORM. Every model must be imported in `models/__init__.py`,
  or Alembic autogenerate will not see its table.

`consumers/` and `tasks/` sit beside `api/` as alternative entry surfaces: they
reuse the same services and repositories, which is why the service layer knows
nothing about HTTP.

## Migrations

```bash
make migration m="add something"   # autogenerate — always read the file before applying
make migrate                       # upgrade head
make migrate-check                 # downgrade→upgrade round-trip + drift check
```

Schema changes go through Alembic only; `make migrate-check` must stay green.

See the [root README](../README.md) for the full picture, quickstart and conventions.
