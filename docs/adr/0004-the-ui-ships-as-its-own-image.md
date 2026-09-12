# The UI ships as its own image behind the edge proxy

The built frontend is a fourth published image running its own Caddy over a `file_server`
configuration baked into it, and the edge Caddy — the single public door — reaches it with
`reverse_proxy frontend:8080`. So the stack runs two Caddy containers, which is the thing a reader
will stop on: the door already speaks the exact protocol needed to serve a directory of static files,
and it is not the one serving them.

## Considered options

**Baking the bundle into the edge image** (`FROM caddy:… ` plus `COPY dist /srv`) is the obvious
shape: one container, no in-network hop, and routing, headers and files described in one place.
Rejected on the deployment's own terms. `deploy/compose.prod.yaml` gives `caddy` no `depends_on`
deliberately — if the application is broken the door still has to open, because ACME validation and a
renewal during an outage must not depend on it — and `deploy/deploy.sh` recreates that container only
when the Caddyfile's content hash changes. Baking the bundle in couples the container holding the
ACME account key and every certificate to the release cadence of the user interface: a corrected
margin would recreate the front door.

**A shared named volume**, filled by a one-shot container and served by the edge's own `file_server`,
was rejected as mutable state living outside any image. Old releases accumulate in it, and a rollback
would have to un-copy files rather than merely name an older tag — which is exactly the promise
[ADR 0002](0002-deployments-are-addressed-by-commit-sha.md) makes.

**Serving the bundle from the API** through FastAPI's `StaticFiles` was rejected for putting a Python
process on the static path and merging two release lifecycles into one image.

## Consequences

The separation is what makes three existing mechanisms apply to the UI unchanged rather than being
extended for it: the door stays a pinned third-party tag, the frontend joins the CI build matrix
beside `backend`, `ingestor` and `notifier` and rolls back through the same `IMAGE_TAG`, and
`deploy.sh`'s pull phase — narrowed to `ghcr.io/sergeyvuser/demo-fastapi-app/*` to stay under Docker
Hub's anonymous rate limit — already matches the new image by prefix. `CONFIG_PATHS` is untouched:
the frontend's own Caddyfile travels inside its image, not to the server.

The price is one more container to run and cap, one hop inside the compose network, and a Caddyfile
whose catch-all now points at the frontend — which means every API path has to be named explicitly at
the door, and **the API may add no route outside `/api`**. A root-level endpoint added later would not
404; it would quietly serve the application shell.
