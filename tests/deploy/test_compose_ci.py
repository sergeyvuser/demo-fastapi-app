"""Invariants of the rendered e2e stack: compose.yaml + deploy/compose.ci.yaml.

The e2e job itself proves that the stack starts and that the edge routes as
it should. What it cannot see is everything a passing run says nothing about:
a port that collides with a development stack, a service quietly built from
source instead of pulled, a public URL that drifted away from the edge, or an
edge image that is no longer the one production runs.

The render is hermetic in the way that matters here: the overlay reads
.env.example for both substitution and containers, so the project directory
is the repository itself, and IMAGE_TAG is pinned rather than inherited from
whoever runs the test.
"""

import json
import os
import re
import subprocess
from pathlib import Path
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
DEPLOY = REPO_ROOT / "deploy"
REGISTRY = "ghcr.io/sergeyvuser/demo-fastapi-app"
IMAGE_TAG = "sha-0000000"
EDGE_ORIGIN = "http://127.0.0.1:8090"

# exactly the stack the testing strategy names; nothing else may start
STACK = frozenset(
    {
        "db",
        "redis",
        "rabbitmq",
        "mailpit",
        "migrate",
        "seed-demo",
        "api",
        "evaluator",
        "notifier",
        "worker",
        "scheduler",
        "frontend",
        "caddy",
    }
)
# services running our own code
OUR_CODE = frozenset(
    {
        "migrate",
        "seed-demo",
        "api",
        "evaluator",
        "notifier",
        "worker",
        "scheduler",
        "frontend",
    }
)
# the ones the overlay configures: the frontend reads no settings at all, and
# `migrate` runs alembic, which neither sends mail nor exports traces — it
# gets the database host and nothing else, as in production
CONFIGURED = OUR_CODE - {"frontend", "migrate"}

pytestmark = pytest.mark.integration


@pytest.fixture(scope="module")
def rendered() -> dict[str, Any]:
    result = subprocess.run(
        [
            "docker",
            "compose",
            "--project-directory",
            str(REPO_ROOT),
            "-f",
            str(REPO_ROOT / "compose.yaml"),
            "-f",
            str(DEPLOY / "compose.ci.yaml"),
            "--env-file",
            str(REPO_ROOT / ".env.example"),
            "config",
            "--format",
            "json",
        ],
        capture_output=True,
        text=True,
        # the Makefile exports COMPOSE_PROFILES=tools, and pytest inherits it
        env={**os.environ, "COMPOSE_PROFILES": "", "IMAGE_TAG": IMAGE_TAG},
        check=False,
    )
    assert result.returncode == 0, result.stderr
    config: dict[str, Any] = json.loads(result.stdout)
    return config


@pytest.fixture(scope="module")
def services(rendered: dict[str, Any]) -> dict[str, Any]:
    found: dict[str, Any] = rendered["services"]
    return found


def test_it_is_a_compose_project_of_its_own(rendered: dict[str, Any]) -> None:
    # the development stack is `crypto-alerts`; sharing the name would mean
    # sharing its containers, its volumes and its database
    assert rendered["name"] == "crypto-alerts-e2e"


def test_exactly_the_stack_starts(services: dict[str, Any]) -> None:
    # no ingestor — the test publishes Ticks — and no observability
    assert set(services) == STACK


def test_three_doors_are_published_on_loopback_only(services: dict[str, Any]) -> None:
    published = {
        (name, port["host_ip"], str(port["published"]), port["target"])
        for name, service in services.items()
        for port in service.get("ports", [])
    }
    assert published == {
        ("caddy", "127.0.0.1", "8090", 80),  # the browser's base URL
        ("rabbitmq", "127.0.0.1", "5673", 5672),  # the tick fixture
        ("mailpit", "127.0.0.1", "8026", 8025),  # the Verification mail
    }


def test_our_code_runs_from_the_images_under_test(services: dict[str, Any]) -> None:
    for name in sorted(OUR_CODE):
        assert "build" not in services[name], name
        image = services[name]["image"]
        assert image.startswith(f"{REGISTRY}/"), name
        assert image.endswith(f":{IMAGE_TAG}"), name


def test_mail_links_open_on_the_edge(services: dict[str, Any]) -> None:
    # every service, not only the worker that sends the mail: the base file
    # pins the worker to the Vite dev server, and that value must not survive
    for name in sorted(CONFIGURED):
        environment = services[name]["environment"]
        assert environment["APP_CONFIG__RUN__PUBLIC_URL"] == EDGE_ORIGIN, name


def test_nothing_exports_to_the_absent_trace_store(services: dict[str, Any]) -> None:
    for name in sorted(CONFIGURED):
        assert services[name]["environment"]["APP_CONFIG__OTEL__ENABLED"] == "0", name


def test_the_demo_account_is_seeded(services: dict[str, Any]) -> None:
    seeder = services["seed-demo"]["environment"]
    # restated in the overlay: the base x-app-env block does not reach it
    assert seeder["APP_CONFIG__DB__HOST"] == "db"
    for name in sorted(CONFIGURED):
        assert services[name]["environment"]["APP_CONFIG__DEMO__ENABLED"] == "1", name


def test_the_edge_waits_for_the_seeder(services: dict[str, Any]) -> None:
    # without a dependent, `up --wait` reports the seeder's exit as a failure
    depends_on = services["caddy"]["depends_on"]
    assert depends_on["seed-demo"]["condition"] == "service_completed_successfully"


def test_the_edge_runs_the_production_caddyfile_and_image(
    services: dict[str, Any],
) -> None:
    caddy = services["caddy"]
    mounts = {m["target"]: m for m in caddy["volumes"]}
    assert Path(mounts["/etc/caddy/Caddyfile"]["source"]) == DEPLOY / "Caddyfile"

    prod = (DEPLOY / "compose.prod.yaml").read_text(encoding="utf-8")
    prod_images = re.findall(r"^\s+image:\s+(caddy:\S+)$", prod, flags=re.MULTILINE)
    assert prod_images == [caddy["image"]]


def test_no_site_asks_for_a_certificate(services: dict[str, Any]) -> None:
    # a port or an http:// scheme in a site address switches ACME off for it
    environment = services["caddy"]["environment"]
    assert environment["ALERTS_SITE"] == ":80"
    assert environment["GRAFANA_SITE"].startswith("http://")
