"""WebSocket gateway (Phase 4)."""

from backend.pipeline.gateway.app import create_app
from backend.pipeline.gateway.protocol import (
    AuthMessage, SubscribeMessage, UnsubscribeMessage, PingMessage,
    EventMessage, SnapshotMessage, ErrorMessage, ServerMessage,
)

__all__ = [
    "create_app",
    "AuthMessage",
    "SubscribeMessage",
    "UnsubscribeMessage",
    "PingMessage",
    "EventMessage",
    "SnapshotMessage",
    "ErrorMessage",
    "ServerMessage",
]
