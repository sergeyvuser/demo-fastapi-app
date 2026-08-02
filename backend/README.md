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

## Tests

```
tests/
├── conftest.py     # postgres container, migrations, session, api_client, factories
├── unit/           # no Docker: security, alert conditions
└── integration/    # services, HTTP, the evaluator consumer, schema drift
```

Fixtures worth knowing before writing a test here:

- **`session`** — an `AsyncSession` bound to a connection that is already in a
  transaction, joined with `create_savepoint`. Services may `commit()` as usual;
  everything is rolled back afterwards. Because it comes from the application's
  own `AsyncSessionLocal`, it carries `expire_on_commit=False` — which in async
  code is a correctness requirement, not tuning: an expired instance does lazy
  IO on attribute access and raises `MissingGreenlet`.
- **`api_client`** — httpx over `ASGITransport`. That transport does **not** run
  the lifespan, so the fixture supplies by hand what lifespan would: redis on
  `app.state`, the request session overridden to the test transaction.
- **`taskiq_broker`** — the real broker, which under `settings.testing` is an
  `InMemoryBroker(await_inplace=True)`: `.kiq()` runs the task inline, no worker
  and no waiting. The swap happens in `tasks/broker.py` rather than in a fixture
  because tasks are registered in the registry of *their* broker — a test cannot
  borrow them into another one.
- **`enqueued_emails`** — for HTTP tests, `.kiq` is captured instead. At that
  layer the contract is "the API hands the task over with the right arguments";
  whether it then runs is the job of the task tests.
- **`user` / `verified_user` / `other_user` / `auth_headers`** — rows plus a
  ready bearer header, no login round-trip needed.

`test_schema_drift.py` is the reason there is no "alembic autogenerate is empty"
job in CI: it asserts the same thing against a real migrated database.

See the [root README](../README.md) for the full picture, quickstart and conventions.
