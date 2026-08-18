"""Invariants of the rendered production configuration.

The unit under test is the pair compose.yaml + deploy/compose.prod.yaml as
docker compose merges them — not the text of either file. What this catches is
drift between the two: a service that gains a published port, loses its
migration dependency, or keeps a `build:` section that would make the server
compile code it must never compile.

The render is hermetic on purpose. `--project-directory` points at an empty
directory so a developer's real .env — which sits next to compose.yaml — cannot
leak in and satisfy an assertion that would fail in CI. For the same reason
nothing here asserts on a whole service dict: the render carries the entire
environment of the stack, secrets included.
"""

import json
import os
import subprocess
from pathlib import Path
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
DEPLOY = REPO_ROOT / "deploy"
REGISTRY = "ghcr.io/sergeyvuser/demo-fastapi-app"
IMAGE_TAG = "sha-0000000"  # must match deploy/.env.example

# services running our own code: they come from published images
APP_SERVICES = frozenset(
    {"api", "evaluator", "ingestor", "notifier", "worker", "scheduler", "migrate"}
)
# `migrate` is one-shot — it must not restart and cannot depend on itself
LONG_RUNNING = APP_SERVICES - {"migrate"}

pytestmark = pytest.mark.integration


@pytest.fixture(scope="module")
def rendered(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Any]:
    result = subprocess.run(
        [
            "docker",
            "compose",
            "--project-directory",
            str(tmp_path_factory.mktemp("prod")),
            "-f",
            str(REPO_ROOT / "compose.yaml"),
            "-f",
            str(DEPLOY / "compose.prod.yaml"),
            "--env-file",
            str(DEPLOY / ".env.example"),
            "--env-file",
            str(DEPLOY / ".env.secrets.example"),
            "config",
            "--format",
            "json",
        ],
        capture_output=True,
        text=True,
        # the Makefile exports COMPOSE_PROFILES=tools and pytest inherits it;
        # left alone, the development tooling would appear in the render
        env={**os.environ, "COMPOSE_PROFILES": ""},
        check=False,
    )
    assert result.returncode == 0, result.stderr
    services: dict[str, Any] = json.loads(result.stdout)["services"]
    return services


def test_application_services_run_from_pinned_published_images(rendered):
    for name in sorted(APP_SERVICES):
        image = rendered[name]["image"]
        assert image.startswith(f"{REGISTRY}/"), name
        assert image.endswith(f":{IMAGE_TAG}"), name


def test_nothing_is_built_on_the_server(rendered):
    assert sorted(n for n, s in rendered.items() if "build" in s) == []


def test_nothing_is_published_to_the_host(rendered):
    # ticket 06 adds Caddy — the only service ever allowed to publish ports
    assert sorted(n for n, s in rendered.items() if s.get("ports")) == []


def test_application_services_wait_for_migrations(rendered):
    for name in sorted(LONG_RUNNING):
        migrate = rendered[name].get("depends_on", {}).get("migrate", {})
        assert migrate.get("condition") == "service_completed_successfully", name


def test_migrations_run_once(rendered):
    assert "restart" not in rendered["migrate"]


def test_services_restart_and_are_memory_capped(rendered):
    for name, service in sorted(rendered.items()):
        limits = service.get("deploy", {}).get("resources", {}).get("limits", {})
        assert limits.get("memory"), name
        if name != "migrate":
            assert service.get("restart") == "unless-stopped", name


def test_development_tooling_does_not_start(rendered):
    assert "mailpit" not in rendered
    assert "pgadmin" not in rendered


def test_mail_does_not_go_to_the_local_catcher(rendered):
    # migrate is excluded: it inherits no app env block and sends nothing
    for name in sorted(LONG_RUNNING):
        host = rendered[name]["environment"]["APP_CONFIG__SMTP__HOST"]
        assert host == "smtp.resend.com", name


def test_grafana_is_public_read_only(rendered):
    env = rendered["grafana"]["environment"]
    assert env["GF_AUTH_ANONYMOUS_ENABLED"] == "true"
    assert env["GF_AUTH_ANONYMOUS_ORG_ROLE"] == "Viewer"
    assert env["GF_EXPLORE_ENABLED"] == "false"
    assert env["GF_SECURITY_ADMIN_PASSWORD"]


def test_telemetry_storage_is_bounded(rendered):
    assert "--storage.tsdb.retention.time=7d" in rendered["prometheus"]["command"]
    assert rendered["jaeger"]["environment"]["MEMORY_MAX_TRACES"] == "10000"
