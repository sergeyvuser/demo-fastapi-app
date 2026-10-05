"""Where the API's routes may live.

The edge proxy sends /api/* to the API and every other path to the frontend
(ADR 0004). A route added at the root would therefore never answer: the door
would serve the application shell in its place, with a 200 and no error
anywhere. This pins the root-level surface to the paths that exist for callers
inside the compose network — the ones the door answers 404.

Read from the application object rather than from the router modules: FastAPI
registers the docs routes itself, and the stage-12 incident was a library
publishing a path nobody wrote.
"""

from fastapi.routing import iter_route_contexts

from backend.main import app

# Reached only from inside the compose network: the healthcheck, the scraper,
# the operator. The door answers all of them 404.
INTERNAL = {"/metrics", "/healthz", "/readyz", "/internal/ws-stats"}


def _paths() -> set[str]:
    # Since FastAPI 0.137 an included router is stored whole rather than
    # copied, so app.routes is a tree, not the list of paths — read flat it
    # sees only what was registered on the app itself.
    # iter_route_contexts walks the tree; for WebSocket and plain Starlette
    # routes inside an included router its .path is "" (0.139), and the real
    # path is on the route it rebuilt with the router's prefix applied.
    paths = set()
    for context in iter_route_contexts(app.routes):
        route = getattr(context, "starlette_route", None) or context
        paths.add(route.path)
    return paths


def test_nothing_outside_api_but_the_internal_paths() -> None:
    outside = {p for p in _paths() if not p.startswith("/api/")}
    assert outside == INTERNAL


def test_the_docs_are_served_under_api_and_only_once() -> None:
    paths = _paths()
    assert {"/api/docs", "/api/openapi.json"} <= paths
    assert not any("redoc" in p for p in paths)


def test_the_socket_lives_under_the_versioned_api() -> None:
    # the socket inherits REST's versioning instead of a version field of its own
    assert "/api/v1/ws" in _paths()
