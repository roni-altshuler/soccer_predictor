"""Tests for the typed event envelope."""

from datetime import datetime, timezone

import pytest

from backend.pipeline.streams.envelope import EventEnvelope, EventType


def test_round_trip_via_to_redis():
    src_ts = datetime(2026, 5, 24, 12, 0, tzinfo=timezone.utc)
    env = EventEnvelope(
        event_type=EventType.MATCH_SCORE_CHANGED,
        source="fotmob",
        source_ts=src_ts,
        match_id="fb-12345",
        competition_id="eng.1",
        gender="M",
        payload={"home_score": 1, "away_score": 0, "minute": 23},
    )
    redis_dict = env.to_redis()
    assert "data" in redis_dict
    restored = EventEnvelope.from_redis(redis_dict)
    assert restored.event_type == EventType.MATCH_SCORE_CHANGED
    assert restored.match_id == "fb-12345"
    assert restored.payload["home_score"] == 1
    assert restored.payload["minute"] == 23
    assert restored.source_ts == src_ts


def test_event_id_is_unique_per_envelope():
    a = EventEnvelope(
        event_type=EventType.MATCH_STARTED,
        source="espn",
        source_ts=datetime.now(timezone.utc),
    )
    b = EventEnvelope(
        event_type=EventType.MATCH_STARTED,
        source="espn",
        source_ts=datetime.now(timezone.utc),
    )
    assert a.event_id != b.event_id


def test_from_redis_accepts_legacy_flat_dict():
    raw = {
        "event_id": "x",
        "event_type": "match.ended",
        "source": "espn",
        "source_ts": "2026-05-24T12:00:00+00:00",
        "ingested_at": "2026-05-24T12:00:01+00:00",
        "match_id": "x",
        "competition_id": None,
        "gender": None,
        "payload": {},
        "confidence": 1.0,
        "version": 1,
    }
    env = EventEnvelope.from_redis(raw)
    assert env.event_type == EventType.MATCH_ENDED


def test_unknown_event_type_rejected():
    with pytest.raises(Exception):
        EventEnvelope(
            event_type="not.a.real.type",
            source="x",
            source_ts=datetime.now(timezone.utc),
        )
