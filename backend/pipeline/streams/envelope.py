"""Typed event envelope for the stream bus.

Every event flowing through Redis Streams uses this shape. Downstream
consumers parse via :meth:`EventEnvelope.from_redis` and never touch raw dicts.

We use Pydantic v2 (already in requirements) so JSON serialization, schema
validation, and the wire format are one decision.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, Optional

from pydantic import BaseModel, Field


class EventType(str, Enum):
    # Match lifecycle
    MATCH_SCHEDULED = "match.scheduled"
    MATCH_STARTED = "match.started"
    MATCH_SCORE_CHANGED = "match.score.changed"
    MATCH_EVENT_ADDED = "match.event.added"
    MATCH_PHASE_CHANGED = "match.phase.changed"        # HT / 90 / extra time
    MATCH_ENDED = "match.ended"

    # Pre-match metadata
    LINEUP_PUBLISHED = "lineup.published"
    LINEUP_CONFIRMED = "lineup.confirmed"

    # Standings & competition
    STANDINGS_UPDATED = "standings.updated"

    # Player movement
    TRANSFER_CONFIRMED = "transfer.confirmed"
    INJURY_REPORTED = "injury.reported"
    INJURY_RECOVERED = "injury.recovered"

    # Model outputs
    PREDICTION_UPDATED = "prediction.updated"

    # Ops
    ENTITY_UNRESOLVED = "entity.unresolved"


class EventEnvelope(BaseModel):
    """Wire format for everything in Redis Streams.

    Keep this stable. Adding optional fields is fine; changing types or removing
    fields requires a version bump.
    """

    event_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    event_type: EventType
    source: str
    source_ts: datetime           # when the source observed the event
    ingested_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    match_id: Optional[str] = None
    competition_id: Optional[str] = None
    gender: Optional[str] = None      # 'M' / 'F'
    payload: Dict[str, Any] = Field(default_factory=dict)
    confidence: float = 1.0
    version: int = 1                  # envelope schema version

    @classmethod
    def from_redis(cls, raw: Dict[str, Any]) -> "EventEnvelope":
        """Parse a Redis Stream message body (always strings) into typed form."""
        # Redis Streams stores everything as bytes/str. We support both raw-string
        # dicts (decode_responses=True) and the legacy single-field "data" envelope.
        if "data" in raw and len(raw) == 1:
            import json
            return cls.model_validate_json(raw["data"])
        return cls.model_validate(raw)

    def to_redis(self) -> Dict[str, str]:
        """Serialize as a single ``{"data": "<json>"}`` field for XADD.

        Storing one field per envelope avoids inconsistent partial decoding
        when fields contain complex types (datetimes, nested dicts).
        """
        return {"data": self.model_dump_json()}
