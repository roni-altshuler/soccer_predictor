"""Tests for the stream producer."""

from datetime import datetime, timezone

from backend.pipeline.streams.envelope import EventEnvelope, EventType
from backend.pipeline.streams.producer import StreamProducer


def test_publish_calls_xadd_with_envelope(fake_redis):
    p = StreamProducer("redis://injected", maxlen=100, client=fake_redis)
    env = EventEnvelope(
        event_type=EventType.MATCH_SCORE_CHANGED,
        source="fotmob",
        source_ts=datetime(2026, 5, 24, 12, 0, tzinfo=timezone.utc),
        match_id="fb-12345",
        payload={"home_score": 1, "away_score": 0},
    )
    msg_id = p.publish("stream:test", env)
    assert msg_id is not None
    # Read back the message via XREAD
    entries = fake_redis.xread({"stream:test": "0"})
    assert len(entries) == 1
    stream, msgs = entries[0]
    assert stream == "stream:test"
    assert len(msgs) == 1
    fields = msgs[0][1]
    restored = EventEnvelope.from_redis(fields)
    assert restored.event_type == EventType.MATCH_SCORE_CHANGED
    assert restored.match_id == "fb-12345"
    assert restored.payload["home_score"] == 1


def test_publish_trims_via_maxlen(fake_redis):
    p = StreamProducer("redis://injected", maxlen=2, client=fake_redis)
    for i in range(10):
        env = EventEnvelope(
            event_type=EventType.MATCH_SCORE_CHANGED,
            source="fotmob",
            source_ts=datetime.now(timezone.utc),
            match_id=f"fb-{i}",
        )
        p.publish("stream:trimmed", env)
    length = fake_redis.xlen("stream:trimmed")
    # approximate maxlen allows a small overshoot; bound it conservatively
    assert length <= 5
