"""uv is pinned once, in the root pyproject.toml, and the images obey it.

The laptop and CI read `required-version` themselves: uv refuses to run under
another version, and setup-uv installs that one. The Dockerfiles cannot read
it, because the version is baked into the image they copy uv from, so this
test holds the three of them to it.
"""

import re
import tomllib
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
UV_COPY = re.compile(
    r"^COPY --from=ghcr\.io/astral-sh/uv:(\S+) /uv /uvx /bin/$", re.MULTILINE
)


def _required_version() -> str:
    with (ROOT / "pyproject.toml").open("rb") as f:
        pin = tomllib.load(f)["tool"]["uv"]["required-version"]
    exact = re.fullmatch(r"==(\d+\.\d+\.\d+)", pin)
    assert exact, pin  # an exact version, never a range
    return exact.group(1)


@pytest.mark.parametrize("service", ["backend", "ingestor", "notifier"])
def test_the_image_copies_the_pinned_uv(service: str) -> None:
    dockerfile = (ROOT / service / "Dockerfile").read_text(encoding="utf-8")
    assert UV_COPY.findall(dockerfile) == [_required_version()]
    # uv comes only from that COPY: a uv base image's tag names Python, not uv,
    # and that is how the images sat on 0.9.30 unnoticed
    assert "FROM ghcr.io/astral-sh/uv" not in dockerfile
