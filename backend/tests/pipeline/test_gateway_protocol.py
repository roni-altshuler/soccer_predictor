"""Tests for the WebSocket wire protocol + auth helpers."""

from __future__ import annotations

import asyncio
import json

import pytest

from backend.pipeline.gateway.auth import ANONYMOUS, verify_token
from backend.pipeline.gateway.protocol import (
    AuthMessage, ErrorMessage, PingMessage, SubscribeMessage,
    UnsubscribeMessage, channel_for_match, channel_for_user, is_user_channel,
    parse_client_message,
)


def test_parse_client_message_dispatch():
    assert isinstance(parse_client_message(json.dumps({"type": "ping"})), PingMessage)
    assert isinstance(parse_client_message(json.dumps({"type": "auth"})), AuthMessage)
    assert isinstance(
        parse_client_message(json.dumps({"type": "subscribe", "channel": "match.1"})),
        SubscribeMessage,
    )
    assert isinstance(
        parse_client_message(json.dumps({"type": "unsubscribe", "channel": "match.1"})),
        UnsubscribeMessage,
    )


def test_parse_client_message_unknown_type():
    with pytest.raises(ValueError):
        parse_client_message(json.dumps({"type": "garbage"}))


def test_channel_helpers():
    assert channel_for_match("12345") == "match.12345"
    assert channel_for_user("u-1") == "user.u-1"
    assert is_user_channel("user.u-1") is True
    assert is_user_channel("match.12345") is False


def test_verify_token_returns_anonymous_when_no_token():
    assert verify_token(None, secret="abc") is ANONYMOUS


def test_verify_token_requires_secret_when_token_supplied():
    with pytest.raises(ValueError):
        verify_token("eyJhbGciOiJIUzI1NiJ9", secret=None)


def test_verify_token_roundtrip():
    jwt = pytest.importorskip("jwt")
    secret = "dev-only"
    token = jwt.encode({"sub": "user-42", "scopes": "read:matches"}, secret, algorithm="HS256")
    principal = verify_token(token, secret=secret)
    assert principal.user_id == "user-42"
    assert principal.scopes == ("read:matches",)
    assert principal.is_anonymous is False


@pytest.mark.asyncio
async def test_connection_registry_broadcast_drops_on_overflow():
    """Broadcast should not block the publisher when a slow client overflows."""
    from backend.pipeline.gateway.fanout import ConnectionRegistry, ManagedConnection

    registry = ConnectionRegistry(queue_size=3)

    class _WS:
        def __init__(self):
            self.sent: list[str] = []
        async def send_text(self, t: str) -> None:
            self.sent.append(t)

    ws = _WS()
    conn = ManagedConnection("c1", ws, None, registry.make_queue())
    await registry.register(conn)
    await registry.subscribe("c1", "match.1")

    # 5 messages into a queue of 3 → should drop, not block
    for i in range(5):
        await registry.broadcast("match.1", {"i": i})

    # publisher returned promptly, queue is at capacity (3 retained)
    assert conn.queue.qsize() == 3
    assert conn.dropped >= 2
