"""End-to-end smoke test of the data pipeline — no docker required.

Runs the publish → consume → fan-out loop entirely in-process using fakeredis,
so you can verify everything wires up correctly on a fresh machine without
provisioning Postgres or Redis. Run with::

    python -m backend.pipeline.verify

Exit code 0 = everything wired and round-trips events as expected.

What this does NOT verify:
  * Real Postgres writes (the postgres_writer consumer is stubbed out — its
    handler is checked separately in the integration suite)
  * Network reachability of FotMob / ESPN
  * Real WebSocket handshake (covered by the gateway protocol tests)

Use the integration suite (``pytest backend/tests/pipeline/`` with
``DATABASE_URL`` set) for those.
"""

from __future__ import annotations

import asyncio
import json
import sys
from datetime import datetime, timezone

from backend.pipeline.gateway.fanout import (
    ConnectionRegistry, ManagedConnection, RedisFanout,
)
from backend.pipeline.gateway.protocol import channel_for_match
from backend.pipeline.streams import topics
from backend.pipeline.streams.envelope import EventEnvelope, EventType
from backend.pipeline.workers.live_poller import LivePoller


GREEN = "\033[32m"
RED = "\033[31m"
RESET = "\033[0m"


def _ok(msg: str) -> None:
    print(f"{GREEN}  ✓{RESET} {msg}")


def _fail(msg: str) -> None:
    print(f"{RED}  ✗{RESET} {msg}")


async def _run() -> int:
    try:
        import fakeredis
    except ImportError:
        print("fakeredis required — pip install fakeredis")
        return 2

    failures = 0

    # ------------------------------------------------------------------
    print("\n1. Envelope round-trip")
    env = EventEnvelope(
        event_type=EventType.MATCH_SCORE_CHANGED,
        source="verify",
        source_ts=datetime.now(timezone.utc),
        match_id="v-1",
        payload={"home_score": 1, "away_score": 0},
    )
    restored = EventEnvelope.from_redis(env.to_redis())
    if restored.payload == env.payload and restored.event_type == env.event_type:
        _ok("envelope round-trip")
    else:
        _fail("envelope round-trip"); failures += 1

    # ------------------------------------------------------------------
    print("\n2. Stream producer publishes via fakeredis")
    from backend.pipeline.streams.producer import StreamProducer

    fr = fakeredis.FakeStrictRedis(decode_responses=True)
    producer = StreamProducer("redis://fake", maxlen=100, client=fr)
    msg_id = producer.publish(topics.LIVE_EVENTS, env)
    if msg_id and fr.xlen(topics.LIVE_EVENTS) == 1:
        _ok(f"published 1 message ({msg_id})")
    else:
        _fail("publish did not land in stream"); failures += 1

    # ------------------------------------------------------------------
    print("\n3. Live poller diff/publish (no FotMob)")
    captured: list[tuple[str, EventEnvelope]] = []

    async def cap(stream, env):
        captured.append((stream, env))

    state = {"match_id": "v-1", "home_score": 0, "away_score": 0,
             "status": {"name": "live"}, "events": []}

    async def discover():
        return ["v-1"]

    async def fetch(mid):
        return state

    poller = LivePoller(cap, discover_live_match_ids=discover, fetch_match_details=fetch)
    await poller._refresh_tracked()
    await poller._tick()                                            # MATCH_STARTED
    state["home_score"] = 1
    await poller._tick()                                            # MATCH_SCORE_CHANGED
    state["events"] = [{"event_id": "e1", "type": "goal", "minute": 23}]
    await poller._tick()                                            # MATCH_EVENT_ADDED
    state["status"] = {"name": "finished"}
    await poller._tick()                                            # MATCH_ENDED

    types_seen = {env.event_type for _, env in captured}
    expected = {EventType.MATCH_STARTED, EventType.MATCH_SCORE_CHANGED,
                EventType.MATCH_EVENT_ADDED, EventType.MATCH_ENDED}
    if expected.issubset(types_seen):
        _ok(f"poller emitted {len(captured)} envelopes covering {len(expected)} event types")
    else:
        _fail(f"missing event types: {expected - types_seen}"); failures += 1

    # ------------------------------------------------------------------
    print("\n4. WebSocket gateway fan-out (in-process)")
    afr = fakeredis.aioredis.FakeRedis(decode_responses=True)
    registry = ConnectionRegistry(queue_size=64)

    class _StubWS:
        def __init__(self):
            self.sent: list[str] = []

        async def send_text(self, t: str) -> None:
            self.sent.append(t)

    ws = _StubWS()
    conn = ManagedConnection("c1", ws, None, registry.make_queue())
    await registry.register(conn)
    await registry.subscribe("c1", channel_for_match("v-1"))

    fanout = RedisFanout("redis://fake", registry, async_client=afr)
    await fanout.start()
    # publish via the helper
    await afr.publish(topics.WS_BROADCAST, json.dumps({
        "channel": channel_for_match("v-1"),
        "message": {"type": "event", "event": {"event_type": "match.score.changed"}},
    }))
    # let the pubsub task drain
    await asyncio.sleep(0.1)
    await fanout.stop()

    if conn.queue.qsize() >= 1:
        _ok(f"fan-out delivered {conn.queue.qsize()} message(s) to local subscriber")
    else:
        _fail("fan-out delivered nothing"); failures += 1

    # ------------------------------------------------------------------
    print("\n5. Quotas endpoint returns a report")
    from backend.pipeline.quotas import report

    r = report()
    if set(r) == {"api_football", "postgres", "redis", "r2"}:
        _ok("quota report sections present: " + ", ".join(sorted(r)))
    else:
        _fail(f"quota sections wrong: {set(r)}"); failures += 1

    # ------------------------------------------------------------------
    print()
    if failures:
        print(f"{RED}FAILED{RESET} — {failures} step(s) didn't pass")
    else:
        print(f"{GREEN}OK{RESET} — pipeline scaffold round-trips events end-to-end")
    return failures


def main() -> int:  # pragma: no cover
    return asyncio.run(_run())


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
