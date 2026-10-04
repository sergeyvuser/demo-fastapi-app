"""The frontend image: its own Caddyfile, and the Node version pinned thrice.

What the image serves — 404 for a missing asset, the shell for an unknown
route, the cache headers — is proved against the built image by the CI stack
(impl 16). These are the cheap checks that need no build.
"""

import json
import re
import subprocess
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"


def _images() -> list[str]:
    dockerfile = (FRONTEND / "Dockerfile").read_text(encoding="utf-8")
    return re.findall(r"^FROM\s+(\S+)", dockerfile, re.MULTILINE)


def test_node_is_pinned_identically_in_all_three_places() -> None:
    builder = _images()[0]
    image_version = re.fullmatch(r"node:(\d+\.\d+\.\d+)-alpine", builder)
    assert image_version, builder  # an exact tag, never node:24 or node:lts

    nvmrc = (FRONTEND / ".nvmrc").read_text(encoding="utf-8").strip()
    package = json.loads((FRONTEND / "package.json").read_text(encoding="utf-8"))

    assert image_version.group(1) == nvmrc == package["engines"]["node"]


@pytest.mark.integration
def test_the_frontend_caddyfile_parses() -> None:
    """`caddy validate` against the image the Dockerfile ships from.

    Read from the Dockerfile's last FROM, so the check cannot drift from the
    runtime stage. Syntax only, like the edge's own check.
    """
    result = subprocess.run(
        [
            "docker",
            "run",
            "--rm",
            "--mount",
            f"type=bind,source={FRONTEND / 'Caddyfile'}"
            ",target=/etc/caddy/Caddyfile,readonly",
            _images()[-1],
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
