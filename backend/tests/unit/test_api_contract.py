"""The committed contract is the contract the application actually has.

frontend/openapi.json and frontend/ws.openapi.json are what the TypeScript
types are generated from. If a route or a schema changes and the files do
not, the frontend type-checks against an API that no longer exists — so this
fails first, and names the fix.

Compared as objects, not as text: indentation, key order inside the file and
line endings are not the contract.
"""

import json
from pathlib import Path

import pytest

from backend.contract import render

FRONTEND = Path(__file__).resolve().parents[3] / "frontend"


@pytest.mark.parametrize("name", sorted(render()))
def test_the_committed_document_is_what_the_application_renders(name: str) -> None:
    committed = json.loads((FRONTEND / name).read_text(encoding="utf-8"))
    # through JSON and back, so both sides are plain dicts, lists and strings
    rendered = json.loads(json.dumps(render()[name]))

    assert committed == rendered, f"{name} is stale: run `make openapi` and commit"
