"""Unit tests for the live poller (no Redis, no FotMob)."""

from __future__ import annotations

import asyncio

import pytest

from backend.pipeline.streams.envelope import EventEnvelope, EventType
from backend.pipeline.workers.live_poller import LivePoller


class _Capture:
    def __init__(self):
        self.published: list[tuple[str, EventEnvelope]] = []

    async def publish(self, stream: str, env: EventEnvelope) -> None:
        self.published.append((stream, env))


@pytest.mark.asyncio
async def test_first_poll_does_not_emit_score_change_when_no_score():
    cap = _Capture()
    state = {"match_id": "1", "home_score": None, "away_score": None,
             "home": {"id": 1, "name": "A"}, "away": {"id": 2, "name": "B"},
             "status": {"name": "not_started"}, "events": []}

    async def discover():
        return ["1"]

    async def fetch(mid):
        return state

    poller = LivePoller(cap.publish, discover_live_match_ids=discover, fetch_match_details=fetch)
    await poller._refresh_tracked()
    await poller._tick()
    score_events = [e for s, e in cap.published if e.event_type == EventType.MATCH_SCORE_CHANGED]
    assert score_events == []


@pytest.mark.asyncio
async def test_score_change_emits_one_envelope():
    cap = _Capture()
    state = {"match_id": "1", "home_score": 0, "away_score": 0,
             "status": {"name": "live"}, "events": []}

    async def discover():
        return ["1"]

    async def fetch(mid):
        return state

    poller = LivePoller(cap.publish, discover_live_match_ids=discover, fetch_match_details=fetch)
    await poller._refresh_tracked()
    await poller._tick()
    # No envelopes yet for 0-0 transition from None — but a status change to "live" should fire
    started = [e for _, e in cap.published if e.event_type == EventType.MATCH_STARTED]
    assert len(started) == 1

    # Now the score changes
    cap.published.clear()
    state["home_score"] = 1
    await poller._tick()
    score_events = [e for _, e in cap.published if e.event_type == EventType.MATCH_SCORE_CHANGED]
    assert len(score_events) == 1
    assert score_events[0].payload["home_score"] == 1
    assert score_events[0].payload["away_score"] == 0


@pytest.mark.asyncio
async def test_no_publish_when_state_unchanged():
    cap = _Capture()
    state = {"match_id": "1", "home_score": 0, "away_score": 0,
             "status": {"name": "live"}, "events": []}

    async def discover():
        return ["1"]

    async def fetch(mid):
        return state

    poller = LivePoller(cap.publish, discover_live_match_ids=discover, fetch_match_details=fetch)
    await poller._refresh_tracked()
    await poller._tick()
    n_before = len(cap.published)
    # Tick again with same state — nothing new emitted
    await poller._tick()
    assert len(cap.published) == n_before


@pytest.mark.asyncio
async def test_new_event_in_events_list_emits_match_event_added():
    cap = _Capture()
    state = {"match_id": "1", "home_score": 0, "away_score": 0,
             "status": {"name": "live"}, "events": []}

    async def discover():
        return ["1"]

    async def fetch(mid):
        return state

    poller = LivePoller(cap.publish, discover_live_match_ids=discover, fetch_match_details=fetch)
    await poller._refresh_tracked()
    await poller._tick()
    cap.published.clear()

    state["events"] = [{"event_id": "e1", "type": "goal", "minute": 23, "player_id": 99, "team_id": 1}]
    await poller._tick()
    match_events = [e for _, e in cap.published if e.event_type == EventType.MATCH_EVENT_ADDED]
    assert len(match_events) == 1
    assert match_events[0].payload["event_id"] == "e1"
    assert match_events[0].payload["minute"] == 23

    # Same event again on next poll — not re-emitted
    cap.published.clear()
    await poller._tick()
    assert not [e for _, e in cap.published if e.event_type == EventType.MATCH_EVENT_ADDED]


@pytest.mark.asyncio
async def test_match_ended_status_emits_match_ended():
    cap = _Capture()
    state = {"match_id": "1", "home_score": 2, "away_score": 1,
             "status": {"name": "live"}, "events": []}

    async def discover():
        return ["1"]

    async def fetch(mid):
        return state

    poller = LivePoller(cap.publish, discover_live_match_ids=discover, fetch_match_details=fetch)
    await poller._refresh_tracked()
    await poller._tick()
    cap.published.clear()

    state["status"] = {"name": "finished"}
    await poller._tick()
    ended = [e for _, e in cap.published if e.event_type == EventType.MATCH_ENDED]
    assert len(ended) == 1


@pytest.mark.asyncio
async def test_fetch_error_triggers_backoff(monkeypatch):
    cap = _Capture()
    calls = {"n": 0}

    async def discover():
        return ["1"]

    async def fetch(mid):
        calls["n"] += 1
        raise RuntimeError("boom")

    # Use a controllable clock
    fake_now = [1000.0]

    def clock():
        return fake_now[0]

    poller = LivePoller(cap.publish, discover_live_match_ids=discover,
                        fetch_match_details=fetch, clock=clock)
    await poller._refresh_tracked()
    await poller._tick()
    assert calls["n"] == 1
    # next tick within backoff window — fetch must not be called
    await poller._tick()
    assert calls["n"] == 1
    # advance time past the backoff
    fake_now[0] += 120
    await poller._tick()
    assert calls["n"] == 2
