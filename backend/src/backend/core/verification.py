"""Where a Verification link's token lives, and what that key holds.

The token is the Redis KEY; the value is one of the records below. Both sides
of the operation import from here — `tasks.email` writes the record and
`services.auth` reads it — so the `verify:` prefix is spelled once instead of
once per caller. `core` is the only home that both a task and a service may
depend on without inverting the layering.
"""

import uuid
from typing import Annotated, Literal

from pydantic import BaseModel, Field, TypeAdapter

# Entropy handed to `secrets.token_urlsafe`, which returns 43 characters for
# this many bytes — the length `VerificationRequest` pins.
TOKEN_BYTES = 32
TOKEN_TTL_SECONDS = 24 * 3600

_KEY_PREFIX = "verify:"


def verification_key(token: str) -> str:
    return f"{_KEY_PREFIX}{token}"


class PendingVerification(BaseModel):
    """A link that has not been followed yet."""

    status: Literal["pending"] = "pending"
    user_id: uuid.UUID


class SpentVerification(BaseModel):
    """A link that has been followed.

    It carries no `user_id`, and that absence is the point: the question this
    record answers is "was this link used?", not "by whom?". Keeping the User
    here would also force the write to depend on what the read found, which is
    exactly what a tombstone must not do.
    """

    status: Literal["used"] = "used"


# A tagged union: pydantic reads `status` first and then validates against the
# one member it selects. The alternative — one model with an optional
# `user_id` — would make "pending with nobody attached" a representable state,
# and nothing would ever reject it.
VerificationRecord = Annotated[
    PendingVerification | SpentVerification,
    Field(discriminator="status"),
]

# A TypeAdapter is how pydantic validates something that is not a BaseModel
# subclass — here, the union. The annotation is explicit because mypy cannot
# infer a type parameter from an `Annotated` alias.
RECORD_ADAPTER: TypeAdapter[PendingVerification | SpentVerification] = TypeAdapter(
    VerificationRecord
)

SPENT_RECORD_JSON = SpentVerification().model_dump_json()
