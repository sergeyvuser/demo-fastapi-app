"""The socket's message union is a contract, closed at five members."""

from typing import get_args

from backend.api.ws.messages import ErrorMessage, ServerMessage


def test_the_server_union_is_closed_at_five_members() -> None:
    types = {member.model_fields["type"].default for member in get_args(ServerMessage)}
    assert types == {"tick", "trigger", "watching", "heartbeat", "error"}


def test_an_error_carries_a_code_and_data_never_prose() -> None:
    # a "message" or "detail" field would be English text the client shows
    # around its translation catalogues
    assert set(ErrorMessage.model_fields) == {"type", "code", "symbols"}
