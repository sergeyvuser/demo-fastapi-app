"""The contract the frontend is typed from, rendered without a server.

Two documents, written by `make openapi` into frontend/ and committed there:

  openapi.json     the HTTP API, exactly what /api/openapi.json serves
  ws.openapi.json  the socket's frames and messages

FastAPI publishes no schema for a WebSocket route, so the second document is
assembled here from the same pydantic models the socket validates with. It is
dressed as an OpenAPI document with no paths — only `components.schemas` — so
that the one generator the frontend already runs can read it.

Rendering is an import, not a request: `app.openapi()` walks the routes of
the application object. No port, no database, no lifespan.
"""

import json
import sys
from pathlib import Path
from typing import Any, get_args

from pydantic import BaseModel
from pydantic.json_schema import JsonSchemaMode, models_json_schema

from backend.api.ws import messages
from backend.main import app

_REF = "#/components/schemas/{model}"


def render() -> dict[str, dict[str, Any]]:
    """Every contract document, keyed by its file name under frontend/."""
    return {
        "openapi.json": app.openapi(),
        "ws.openapi.json": _socket_document(),
    }


def _socket_document() -> dict[str, Any]:
    # read off the unions themselves: a sixth message joins this document by
    # joining ServerMessage, with no second list to forget
    frames: tuple[type[BaseModel], ...] = get_args(messages.ClientFrame)
    server: tuple[type[BaseModel], ...] = get_args(messages.ServerMessage)

    # The mode decides what a field looks like on the wire. A frame is what
    # we accept ("validation"); a message is what we emit ("serialization"),
    # where a Decimal is always a string and a defaulted `type` always present.
    inputs: list[tuple[type[BaseModel], JsonSchemaMode]] = [
        *((model, "validation") for model in frames),
        *((model, "serialization") for model in server),
    ]
    _, definitions = models_json_schema(inputs, ref_template=_REF)

    schemas = definitions["$defs"]
    schemas["ClientFrame"] = _one_of(frames)
    schemas["ServerMessage"] = _one_of(server)
    return {
        "openapi": "3.1.0",
        "info": {"title": "Crypto Alerts socket contract", "version": "1"},
        "paths": {},
        "components": {"schemas": schemas},
    }


def _one_of(members: tuple[type[BaseModel], ...]) -> dict[str, Any]:
    # No `discriminator` member, on purpose: without an explicit mapping the
    # TypeScript generator takes the schema NAME for the tag and rewrites
    # `action: "auth"` into `action: "AuthFrame"`. Each member already pins
    # its tag with a `const`, which is all TypeScript needs to narrow.
    return {"oneOf": [{"$ref": _REF.format(model=m.__name__)} for m in members]}


if __name__ == "__main__":
    target = Path(sys.argv[1])
    for name, document in render().items():
        # newline="\n": on Windows text mode would write CRLF, and the
        # repository is LF everywhere (.gitattributes)
        with (target / name).open("w", encoding="utf-8", newline="\n") as file:
            json.dump(document, file, indent=2, ensure_ascii=False)
            file.write("\n")
        print(f"wrote {target / name}")
