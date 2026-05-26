"""Live poller — Phase 3 producer side.

Watches the set of "currently live" matches and pushes diffs to
``stream:live.events`` / ``stream:live.scores``. Designed to be the only
process talking to FotMob for live data — every consumer (postgres writer,
prediction recomputer, gateway) reads off Redis.

Design points:

* **Two cadences**: every ``LIVE_TICK_SEC`` we poll each tracked match; every
  ``REFRESH_TRACKED_SEC`` we re-discover what's live (so a kickoff at +0min
  enters the watch list within ~1 minute).
* **Diff-based publishing**: state for each match is kept in-process as a
  small dict; we only emit envelopes when something changed (score, status,
  minute, new event in the events list).
* **Source-agnostic**: the FotMob client is injected so tests can use a stub
  and so a future ESPN poller can share the same shape.
* **Backoff on errors**: per-match consecutive errors trip a 60s skip so one
  broken match endpoint doesn't burn the whole tick budget.
"""

from __future__ import annotations

import asyncio
import logging
import signal
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Optional

from backend.pipeline.streams import topics
from backend.pipeline.streams.envelope import EventEnvelope, EventType

logger = logging.getLogger(__name__)


LIVE_TICK_SEC = 3.0
REFRESH_TRACKED_SEC = 60.0
PER_MATCH_ERROR_BACKOFF_SEC = 60.0


@dataclass
class _MatchState:
    """Last-seen snapshot we diff against."""

    match_id: str
    home_score: Optional[int] = None
    away_score: Optional[int] = None
    status: Optional[str] = None
    minute: Optional[int] = None
    phase: Optional[str] = None
    seen_event_ids: set[str] = field(default_factory=set)
    consecutive_errors: int = 0
    next_attempt_at: float = 0.0


class LivePoller:
    """Asyncio loop that polls the injected client and publishes envelopes.

    The publisher is also injected so tests can capture every envelope without
    a Redis. In production both come from the singletons in
    :mod:`backend.pipeline.streams.producer` and
    :mod:`backend.services.fotmob.client`.
    """

    SOURCE = "fotmob"

    def __init__(
        self,
        publish: Callable[[str, EventEnvelope], Awaitable[Any]],
        *,
        discover_live_match_ids: Callable[[], Awaitable[list[str]]],
        fetch_match_details: Callable[[str], Awaitable[Optional[dict]]],
        clock: Callable[[], float] = None,
    ):
        self._publish = publish
        self._discover = discover_live_match_ids
        self._fetch = fetch_match_details
        self._clock = clock or asyncio.get_event_loop().time
        self._tracked: dict[str, _MatchState] = {}
        self._stopped = asyncio.Event()
        self._last_refresh: float = 0.0

    # ---- lifecycle --------------------------------------------------------

    async def stop(self) -> None:
        self._stopped.set()

    async def run(self) -> None:
        await self._refresh_tracked()
        while not self._stopped.is_set():
            now = self._clock()
            if now - self._last_refresh >= REFRESH_TRACKED_SEC:
                await self._refresh_tracked()
            await self._tick()
            try:
                await asyncio.wait_for(self._stopped.wait(), timeout=LIVE_TICK_SEC)
            except asyncio.TimeoutError:
                pass

    # ---- core -------------------------------------------------------------

    async def _refresh_tracked(self) -> None:
        try:
            ids = await self._discover()
        except Exception as exc:  # noqa: BLE001
            logger.warning("live discover failed: %s", exc)
            return
        self._last_refresh = self._clock()
        # Add new
        for mid in ids:
            if mid not in self._tracked:
                self._tracked[mid] = _MatchState(match_id=mid)
                logger.info("Tracking new live match %s", mid)
        # Drop ones that finished and are no longer in the live list
        finished = [m.match_id for m in self._tracked.values()
                    if m.status in {"finished", "full_time"} and m.match_id not in ids]
        for mid in finished:
            self._tracked.pop(mid, None)

    async def _tick(self) -> None:
        if not self._tracked:
            return
        now = self._clock()
        coros = []
        for state in self._tracked.values():
            if now < state.next_attempt_at:
                continue
            coros.append(self._poll_one(state))
        if coros:
            await asyncio.gather(*coros, return_exceptions=True)

    async def _poll_one(self, state: _MatchState) -> None:
        try:
            data = await self._fetch(state.match_id)
        except Exception as exc:  # noqa: BLE001
            state.consecutive_errors += 1
            state.next_attempt_at = self._clock() + min(PER_MATCH_ERROR_BACKOFF_SEC, 5 * state.consecutive_errors)
            logger.debug("poll failed for %s: %s (backing off)", state.match_id, exc)
            return
        if data is None:
            return
        state.consecutive_errors = 0
        await self._diff_and_publish(state, data)

    async def _diff_and_publish(self, state: _MatchState, data: dict) -> None:
        """Compare ``data`` (latest FotMob payload) with ``state`` and emit envelopes."""
        new_state = _project_state(data)

        # 1. score delta
        if (new_state.home_score, new_state.away_score) != (state.home_score, state.away_score) and \
           (new_state.home_score is not None or new_state.away_score is not None):
            env = self._envelope(
                EventType.MATCH_SCORE_CHANGED,
                state.match_id,
                data,
                {
                    "home_score": new_state.home_score,
                    "away_score": new_state.away_score,
                    "minute": new_state.minute,
                    "status": new_state.status,
                    "phase": new_state.phase,
                },
            )
            await self._safe_publish(topics.LIVE_SCORES, env)

        # 2. status / phase change (kickoff, HT, FT)
        if new_state.status != state.status:
            if new_state.status in {"live", "first_half", "second_half"} and state.status in {None, "not_started"}:
                env_type = EventType.MATCH_STARTED
            elif new_state.status in {"finished", "full_time"}:
                env_type = EventType.MATCH_ENDED
            else:
                env_type = EventType.MATCH_PHASE_CHANGED
            env = self._envelope(env_type, state.match_id, data, {
                "status": new_state.status,
                "phase": new_state.phase,
                "minute": new_state.minute,
            })
            await self._safe_publish(topics.LIVE_EVENTS, env)

        # 3. new per-event rows (goals, cards, subs)
        for raw_event in (data.get("events") or []):
            ev_id = str(raw_event.get("event_id") or raw_event.get("id") or "")
            if not ev_id or ev_id in state.seen_event_ids:
                continue
            state.seen_event_ids.add(ev_id)
            env = self._envelope(EventType.MATCH_EVENT_ADDED, state.match_id, data, {
                "event_id": ev_id,
                "type": raw_event.get("type"),
                "minute": raw_event.get("minute"),
                "added_minute": raw_event.get("added_minute"),
                "period": raw_event.get("period"),
                "player_id": raw_event.get("player_id"),
                "team_id": raw_event.get("team_id"),
                "outcome": raw_event.get("outcome"),
                "xg": raw_event.get("xg"),
            })
            await self._safe_publish(topics.LIVE_EVENTS, env)

        # commit new state
        state.home_score = new_state.home_score
        state.away_score = new_state.away_score
        state.status = new_state.status
        state.minute = new_state.minute
        state.phase = new_state.phase

    # ---- helpers ----------------------------------------------------------

    def _envelope(
        self,
        ev_type: EventType,
        match_id: str,
        data: dict,
        payload: dict,
    ) -> EventEnvelope:
        return EventEnvelope(
            event_id=str(uuid.uuid4()),
            event_type=ev_type,
            source=self.SOURCE,
            source_ts=datetime.now(timezone.utc),
            match_id=match_id,
            competition_id=data.get("competition_id"),
            gender=data.get("gender"),
            payload={
                **payload,
                # carry team ids + kickoff so the postgres_writer doesn't need
                # an extra lookup
                "home_team_id": data.get("home_team_id"),
                "away_team_id": data.get("away_team_id"),
                "home_team_name": data.get("home_team_name"),
                "away_team_name": data.get("away_team_name"),
                "competition_id": data.get("competition_id"),
                "kickoff_utc": data.get("kickoff_utc"),
            },
        )

    async def _safe_publish(self, stream: str, env: EventEnvelope) -> None:
        try:
            await self._publish(stream, env)
        except Exception as exc:  # noqa: BLE001
            logger.warning("publish to %s failed: %s", stream, exc)


# ---------------------------------------------------------------------------
# projection — turn a raw FotMob match payload into a uniform shape
# ---------------------------------------------------------------------------


def _project_state(data: dict) -> _MatchState:
    """Best-effort projection of various source shapes into _MatchState."""
    status_raw = ((data.get("status") or {}).get("name") or data.get("status_text") or "").lower() or None
    minute = (data.get("status") or {}).get("minute") or data.get("minute")
    phase = (data.get("status") or {}).get("phase") or data.get("phase")
    home_score = data.get("home_score")
    away_score = data.get("away_score")
    # FotMob sometimes nests under home/away
    if home_score is None and "home" in data:
        home_score = (data.get("home") or {}).get("score")
    if away_score is None and "away" in data:
        away_score = (data.get("away") or {}).get("score")
    return _MatchState(
        match_id=str(data.get("match_id") or data.get("id") or ""),
        home_score=int(home_score) if home_score is not None else None,
        away_score=int(away_score) if away_score is not None else None,
        status=status_raw,
        minute=int(minute) if isinstance(minute, (int, float, str)) and str(minute).isdigit() else None,
        phase=phase,
    )


# ---------------------------------------------------------------------------
# CLI entry: production path using FotMob client + Redis publisher
# ---------------------------------------------------------------------------


async def _production_factory() -> LivePoller:
    """Wire LivePoller to the existing FotMob client + Redis producer."""
    from backend.pipeline.streams.producer import get_producer
    from backend.services.fotmob import get_fotmob_client

    producer = get_producer()
    if producer is None:
        raise RuntimeError("REDIS_URL not configured")
    client = get_fotmob_client()

    async def publish(stream: str, env: EventEnvelope) -> None:
        await producer.apublish(stream, env)

    async def discover() -> list[str]:
        # FotMob's live endpoint returns a list of match dicts; we just need ids.
        raw = await client.get_live_matches()
        ids: list[str] = []
        for m in raw or []:
            mid = m.get("id") or m.get("match_id")
            if mid is not None:
                ids.append(str(mid))
        return ids

    async def fetch(match_id: str) -> Optional[dict]:
        try:
            raw = await client.get_match_details(int(match_id))
        except (ValueError, TypeError):
            return None
        if not raw:
            return None
        # Normalize to the shape _project_state expects.
        home = raw.get("home") or raw.get("homeTeam") or {}
        away = raw.get("away") or raw.get("awayTeam") or {}
        status = raw.get("status") or {}
        return {
            "match_id": match_id,
            "home_team_id": home.get("id"),
            "away_team_id": away.get("id"),
            "home_team_name": home.get("name"),
            "away_team_name": away.get("name"),
            "home_score": home.get("score"),
            "away_score": away.get("score"),
            "competition_id": (raw.get("league") or {}).get("primary_id") or raw.get("league_id"),
            "kickoff_utc": status.get("utcTime"),
            "status": status,
            "events": raw.get("events") or [],
        }

    return LivePoller(publish, discover_live_match_ids=discover, fetch_match_details=fetch)


async def _main_async() -> int:
    poller = await _production_factory()
    loop = asyncio.get_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, lambda: asyncio.ensure_future(poller.stop()))
        except NotImplementedError:
            pass
    await poller.run()
    return 0


def main() -> int:  # pragma: no cover
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    return asyncio.run(_main_async())


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
