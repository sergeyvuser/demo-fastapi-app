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

ENV_MARKER = "MARKER_FROM_ENV"
SECRETS_MARKER = "MARKER_FROM_SECRETS"

pytestmark = pytest.mark.integration


def _render(project_dir: Path) -> dict[str, Any]:
    """Render the production stack from `project_dir`, return its services."""
    result = subprocess.run(
        [
            "docker",
            "compose",
            "--project-directory",
            str(project_dir),
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


@pytest.fixture(scope="module")
def rendered_services(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Any]:
    # an empty project directory: neither env file exists, which is what CI
    # sees and what keeps the developer's real .env out of the render
    return _render(tmp_path_factory.mktemp("prod"))


@pytest.fixture(scope="module")
def services_reading_env_files(
    tmp_path_factory: pytest.TempPathFactory,
) -> dict[str, Any]:
    # the same render with both env files present, each carrying one marker
    project_dir = tmp_path_factory.mktemp("prod-env")
    (project_dir / ".env").write_text(f"{ENV_MARKER}=1\n", encoding="utf-8")
    (project_dir / ".env.secrets").write_text(f"{SECRETS_MARKER}=1\n", encoding="utf-8")
    return _render(project_dir)


@pytest.fixture(scope="module")
def caddy_mounts(rendered_services: dict[str, Any]) -> dict[str, Any]:
    """The proxy's mounts keyed by their path inside the container."""
    return {v["target"]: v for v in rendered_services["caddy"]["volumes"]}


def test_application_services_run_from_pinned_published_images(
    rendered_services: dict[str, Any],
) -> None:
    for name in sorted(APP_SERVICES):
        image = rendered_services[name]["image"]
        assert image.startswith(f"{REGISTRY}/"), name
        assert image.endswith(f":{IMAGE_TAG}"), name


def test_nothing_is_built_on_the_server(rendered_services: dict[str, Any]) -> None:
    assert sorted(n for n, s in rendered_services.items() if "build" in s) == []


def test_only_the_proxy_is_published(rendered_services: dict[str, Any]) -> None:
    published = sorted(n for n, s in rendered_services.items() if s.get("ports"))
    assert published == ["caddy"]


def test_the_proxy_serves_http_https_and_quic(
    rendered_services: dict[str, Any],
) -> None:
    ports = {
        (str(p["published"]), p["protocol"])
        for p in rendered_services["caddy"]["ports"]
    }
    # 80 is not decoration: the ACME HTTP challenge and the redirect to HTTPS
    # both live there, and dropping it makes issuance fail in a way that looks
    # like a DNS problem
    assert ports == {("80", "tcp"), ("443", "tcp"), ("443", "udp")}


def test_the_proxy_keeps_its_state_on_named_volumes(
    caddy_mounts: dict[str, Any],
) -> None:
    # /data holds the certificates and the ACME account key: on a bind mount
    # that a redeploy wipes, every recreation asks for new certificates and
    # walks into the duplicate-certificate rate limit
    assert caddy_mounts["/data"]["type"] == "volume"
    assert caddy_mounts["/config"]["type"] == "volume"


def test_the_proxy_configuration_is_read_only(caddy_mounts: dict[str, Any]) -> None:
    assert caddy_mounts["/etc/caddy/Caddyfile"]["read_only"] is True


def test_the_proxy_holds_no_application_secrets(
    rendered_services: dict[str, Any],
) -> None:
    # it reads neither env file, so this set is the whole of what it knows
    assert set(rendered_services["caddy"]["environment"]) == {"ACME_EMAIL", "ACME_CA"}


def test_certificates_come_from_the_production_ca(
    rendered_services: dict[str, Any],
) -> None:
    # the staging directory is a temporary override made on the server
    acme_ca = rendered_services["caddy"]["environment"]["ACME_CA"]
    assert acme_ca == "https://acme-v02.api.letsencrypt.org/directory"


def test_the_caddyfile_parses(rendered_services: dict[str, Any]) -> None:
    """`caddy validate` against the very image the server will run.

    Not a test of the routing — of the syntax. A typo here is otherwise found
    on the server, where the edit-and-check cycle costs a deploy.
    """
    result = subprocess.run(
        [
            "docker",
            "run",
            "--rm",
            "--mount",
            f"type=bind,source={DEPLOY / 'Caddyfile'}"
            ",target=/etc/caddy/Caddyfile,readonly",
            # both placeholders must expand to something: `email` and `acme_ca`
            # with an empty argument are parse errors
            "-e",
            "ACME_EMAIL=nobody@example.com",
            "-e",
            "ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory",
            rendered_services["caddy"]["image"],  # never drifts from the deploy
            "caddy",
            "validate",
            "--adapter",
            "caddyfile",
            "--config",
            "/etc/caddy/Caddyfile",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr


def test_application_services_wait_for_migrations(
    rendered_services: dict[str, Any],
) -> None:
    for name in sorted(LONG_RUNNING):
        migrate = rendered_services[name].get("depends_on", {}).get("migrate", {})
        assert migrate.get("condition") == "service_completed_successfully", name


def test_migrations_run_once(rendered_services: dict[str, Any]) -> None:
    assert "restart" not in rendered_services["migrate"]


def test_services_restart_and_are_memory_capped(
    rendered_services: dict[str, Any],
) -> None:
    for name, service in sorted(rendered_services.items()):
        limits = service.get("deploy", {}).get("resources", {}).get("limits", {})
        assert limits.get("memory"), name
        if name != "migrate":
            assert service.get("restart") == "unless-stopped", name


def test_configuration_comes_from_both_env_files(
    services_reading_env_files: dict[str, Any],
) -> None:
    # `config` inlines env_file contents into `environment` and drops the key,
    # so the two-file split can only be asserted through its effect: a marker
    # from each file has to reach every application service
    for name in sorted(APP_SERVICES):
        environment = services_reading_env_files[name]["environment"]
        assert environment.get(ENV_MARKER) == "1", name
        assert environment.get(SECRETS_MARKER) == "1", name


def test_development_tooling_does_not_start(rendered_services: dict[str, Any]) -> None:
    assert "mailpit" not in rendered_services
    assert "pgadmin" not in rendered_services


def test_mail_does_not_go_to_the_local_catcher(
    rendered_services: dict[str, Any],
) -> None:
    # migrate is excluded: it inherits no app env block and sends nothing
    for name in sorted(LONG_RUNNING):
        host = rendered_services[name]["environment"]["APP_CONFIG__SMTP__HOST"]
        assert host == "smtp.resend.com", name


def test_grafana_is_public_read_only(rendered_services: dict[str, Any]) -> None:
    env = rendered_services["grafana"]["environment"]
    assert env["GF_AUTH_ANONYMOUS_ENABLED"] == "true"
    assert env["GF_AUTH_ANONYMOUS_ORG_ROLE"] == "Viewer"
    assert env["GF_EXPLORE_ENABLED"] == "false"
    assert env["GF_SECURITY_ADMIN_PASSWORD"]


def test_telemetry_storage_is_bounded(rendered_services: dict[str, Any]) -> None:
    """Neither telemetry store may grow without a ceiling.

    The ceilings themselves are tuned against measurements — Jaeger was
    OOM-killed once because its buffer was sized by guesswork — so this asserts
    that a bound exists, not what it currently is. Both Prometheus caps matter:
    time alone stops bounding the disk as soon as the ingest rate changes.
    """
    prometheus = rendered_services["prometheus"]["command"]
    assert any(a.startswith("--storage.tsdb.retention.time=") for a in prometheus)
    assert any(a.startswith("--storage.tsdb.retention.size=") for a in prometheus)

    max_traces = rendered_services["jaeger"]["environment"]["MEMORY_MAX_TRACES"]
    assert int(max_traces) > 0


def test_telemetry_cannot_starve_the_product_of_cpu(
    rendered_services: dict[str, Any],
) -> None:
    """The anonymously reachable telemetry path needs a CPU ceiling, not just RAM.

    Grafana is public and its Viewer can run arbitrary PromQL, so the cost of a
    query is attacker-controlled. Prometheus caps how much memory one query may
    touch and how many run at once, but two concurrent queries on a two-vCPU
    host are the whole host — a limit on memory alone leaves the product to be
    starved by something cheap.
    """
    for name in ("prometheus", "grafana", "jaeger"):
        limits = rendered_services[name]["deploy"]["resources"]["limits"]
        assert float(limits["cpus"]) > 0, name
