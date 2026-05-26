"""WebSocket wire protocol — typed messages in both directions.

The frontend hook (`useMatchSubscription`) and the gateway both validate
through these models. Anything off-shape gets an immediate ``ErrorMessage`` and
the connection stays open (recoverable) — except for auth failures, where the
gateway disconnects.
"""

from __future__ import annotations

from typing import Any, Dict, Literal, Optional, Union

from pydantic import BaseModel, Field


# ---- client → server -------------------------------------------------------


class AuthMessage(BaseModel):
    type: Literal["auth"] = "auth"
    token: Optional[str] = None      # JWT; optional for anonymous public channels


class SubscribeMessage(BaseModel):
    type: Literal["subscribe"] = "subscribe"
    channel: str                     # e.g. "match.12345", "competition.eng.1"
    since: Optional[str] = None      # last-seen Redis stream id for replay


class UnsubscribeMessage(BaseModel):
    type: Literal["unsubscribe"] = "unsubscribe"
    channel: str


class PingMessage(BaseModel):
    type: Literal["ping"] = "ping"


ClientMessage = Union[AuthMessage, SubscribeMessage, UnsubscribeMessage, PingMessage]


# ---- server → client -------------------------------------------------------


class SnapshotMessage(BaseModel):
    type: Literal["snapshot"] = "snapshot"
    channel: str
    state: Dict[str, Any]


class EventMessage(BaseModel):
    type: Literal["event"] = "event"
    channel: str
    event: Dict[str, Any]            # EventEnvelope dict


class PredictionMessage(BaseModel):
    type: Literal["prediction"] = "prediction"
    channel: str
    probabilities: Dict[str, float]
    model_version: Optional[str] = None
    confidence: Optional[float] = None


class PongMessage(BaseModel):
    type: Literal["pong"] = "pong"


class ErrorMessage(BaseModel):
    type: Literal["error"] = "error"
    code: str
    message: str


ServerMessage = Union[SnapshotMessage, EventMessage, PredictionMessage, PongMessage, ErrorMessage]


def parse_client_message(raw: str) -> ClientMessage:
    """Decode a raw text frame into the right model based on the ``type`` field."""
    import json
    data = json.loads(raw)
    t = (data or {}).get("type")
    if t == "auth":
        return AuthMessage.model_validate(data)
    if t == "subscribe":
        return SubscribeMessage.model_validate(data)
    if t == "unsubscribe":
        return UnsubscribeMessage.model_validate(data)
    if t == "ping":
        return PingMessage.model_validate(data)
    raise ValueError(f"unknown client message type: {t!r}")


# ---- channel naming --------------------------------------------------------


def channel_for_match(match_id: str) -> str:
    return f"match.{match_id}"


def channel_for_competition(competition_id: str) -> str:
    return f"competition.{competition_id}"


def channel_for_user(user_id: str) -> str:
    return f"user.{user_id}"


def is_user_channel(channel: str) -> bool:
    return channel.startswith("user.")
