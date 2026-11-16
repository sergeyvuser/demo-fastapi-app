"""The three backend images build and run on one and the same base image.

The builder resolves wheels for its own glibc; a runtime on an older Debian
can then fail to load them. Moving the distribution means moving both FROM
lines together, and this holds every Dockerfile to that.
"""

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize("service", ["backend", "ingestor", "notifier"])
def test_builder_and_runtime_share_the_base_image(service: str) -> None:
    dockerfile = (ROOT / service / "Dockerfile").read_text(encoding="utf-8")
    stages = dict(
        (name, image)
        for image, name in re.findall(
            r"^FROM\s+(\S+)\s+AS\s+(\w+)$", dockerfile, re.MULTILINE
        )
    )
    assert stages.keys() == {"builder", "runtime"}, stages
    assert stages["builder"] == stages["runtime"]
