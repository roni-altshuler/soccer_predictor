"""Stream → Postgres writer.

Listens on the live-event streams and writes matches / match events / lineups
into ``core.*``. Idempotent: late-arriving events with older ``source_ts``
won't stomp newer state.

Run with::

    python -m backend.pipeline.workers.postgres_writer

Requires ``DATABASE_URL`` and ``REDIS_URL`` in the environment.
"""

from __future__ import annotations

import asyncio
import logging
import signal
import uuid
from datetime import datetime, timezone
from typing import Optional

from backend.pipeline.pg.warehouse import MatchRecord, PgWarehouse, get_pg_warehouse
from backend.pipeline.settings import get_pipeline_settings
from backend.pipeline.streams import topics
from backend.pipeline.streams.consumer import StreamConsumer
from backend.pipeline.streams.envelope import EventEnvelope, EventType

logger = logging.getLogger(__name__)


class PostgresWriter(StreamConsumer):
    """Persist live events to Postgres core tables."""

    STREAMS = (topics.LIVE_EVENTS, topics.LIVE_SCORES)
    GROUP = "postgres_writer"

    def __init__(self, url: str, pg: PgWarehouse, *, async_client=None):
        super().__init__(url, async_client=async_client)
        self._pg = pg

    async def on_event(self, stream: str, envelope: EventEnvelope) -> None:
        # Cheap dispatch table — no per-event meta dance.
        handler = _DISPATCH.get(envelope.event_type)
        if handler is None:
            logger.debug("No handler for %s; ignoring", envelope.event_type)
            return
        # Run blocking psycopg work in a thread to keep the event loop free
        await asyncio.to_thread(handler, self._pg, envelope)


# ---------------------------------------------------------------------------
# event handlers (sync; called via to_thread)
# ---------------------------------------------------------------------------

def _handle_match_lifecycle(pg: PgWarehouse, env: EventEnvelope) -> None:
    p = env.payload or {}
    if not env.match_id or not p.get("competition_id") or not p.get("kickoff_utc"):
        logger.debug("Skipping match lifecycle: missing fields (%s)", env.event_id)
        return

    home_id = p.get("home_team_id")
    away_id = p.get("away_team_id")
    if home_id is None or away_id is None:
        logger.debug("Skipping match lifecycle %s: missing team ids", env.match_id)
        return

    status_map = {
        EventType.MATCH_SCHEDULED: "scheduled",
        EventType.MATCH_STARTED: "live",
        EventType.MATCH_SCORE_CHANGED: "live",
        EventType.MATCH_PHASE_CHANGED: "live",
        EventType.MATCH_ENDED: "finished",
    }
    status = status_map.get(env.event_type, "live")

    record = MatchRecord(
        match_id=env.match_id,
        source=env.source,
        competition_id=str(p["competition_id"]),
        kickoff_utc=_to_dt(p["kickoff_utc"]),
        status=status,
        phase=p.get("phase"),
        home_team_id=int(home_id),
        away_team_id=int(away_id),
        venue_id=p.get("venue_id"),
        referee_id=p.get("referee_id"),
        home_score=p.get("home_score"),
        away_score=p.get("away_score"),
        home_xg=p.get("home_xg"),
        away_xg=p.get("away_xg"),
        source_ts=env.source_ts,
    )
    pg.upsert_matches([record])


def _handle_match_event_added(pg: PgWarehouse, env: EventEnvelope) -> None:
    """Insert a single ``core.fact_match_events`` row."""
    p = env.payload or {}
    if not env.match_id:
        return
    event_id = p.get("event_id") or env.event_id
    try:
        event_uuid = uuid.UUID(event_id) if not isinstance(event_id, uuid.UUID) else event_id
    except (ValueError, AttributeError):
        event_uuid = uuid.uuid4()

    with pg.connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO core.fact_match_events
                (event_id, match_id, period, minute, added_minute, event_type,
                 team_id, player_id, related_player_id, x, y, body_part, outcome, xg,
                 source, source_ts)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (event_id, source_ts) DO NOTHING
            """,
            (
                str(event_uuid),
                env.match_id,
                p.get("period"),
                p.get("minute"),
                p.get("added_minute"),
                p.get("type") or "unknown",
                p.get("team_id"),
                p.get("player_id"),
                p.get("related_player_id"),
                p.get("x"),
                p.get("y"),
                p.get("body_part"),
                p.get("outcome"),
                p.get("xg"),
                env.source,
                env.source_ts,
            ),
        )
        conn.commit()


def _handle_lineup_published(pg: PgWarehouse, env: EventEnvelope) -> None:
    p = env.payload or {}
    match_id = env.match_id
    lineups = p.get("lineups") or []
    if not match_id or not lineups:
        return
    with pg.connection() as conn, conn.cursor() as cur:
        for line in lineups:
            cur.execute(
                """
                INSERT INTO core.fact_lineups
                    (match_id, team_id, player_id, role, position, shirt_number,
                     is_starter, captain, sub_minute_in, sub_minute_out, source)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (match_id, team_id, player_id) DO UPDATE SET
                    role = COALESCE(EXCLUDED.role, core.fact_lineups.role),
                    position = COALESCE(EXCLUDED.position, core.fact_lineups.position),
                    shirt_number = COALESCE(EXCLUDED.shirt_number, core.fact_lineups.shirt_number),
                    is_starter = EXCLUDED.is_starter,
                    captain = EXCLUDED.captain,
                    sub_minute_in = COALESCE(EXCLUDED.sub_minute_in, core.fact_lineups.sub_minute_in),
                    sub_minute_out = COALESCE(EXCLUDED.sub_minute_out, core.fact_lineups.sub_minute_out)
                """,
                (
                    match_id,
                    line.get("team_id"),
                    line.get("player_id"),
                    line.get("role"),
                    line.get("position"),
                    line.get("shirt_number"),
                    bool(line.get("is_starter")),
                    bool(line.get("captain")),
                    line.get("sub_minute_in"),
                    line.get("sub_minute_out"),
                    env.source,
                ),
            )
        conn.commit()


def _handle_standings_updated(pg: PgWarehouse, env: EventEnvelope) -> None:
    p = env.payload or {}
    rows = p.get("rows") or []
    competition_id = p.get("competition_id") or env.competition_id
    season_id = p.get("season_id")
    snapshot_date = p.get("snapshot_date") or datetime.now(timezone.utc).date()
    if not (competition_id and season_id and rows):
        return
    with pg.connection() as conn, conn.cursor() as cur:
        for r in rows:
            cur.execute(
                """
                INSERT INTO core.fact_standings_snapshot
                    (competition_id, season_id, snapshot_date, team_id,
                     rank, played, won, drawn, lost, gf, ga, gd, points)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (competition_id, season_id, snapshot_date, team_id)
                DO UPDATE SET
                    rank = EXCLUDED.rank,
                    played = EXCLUDED.played,
                    won = EXCLUDED.won,
                    drawn = EXCLUDED.drawn,
                    lost = EXCLUDED.lost,
                    gf = EXCLUDED.gf,
                    ga = EXCLUDED.ga,
                    gd = EXCLUDED.gd,
                    points = EXCLUDED.points
                """,
                (
                    competition_id, season_id, snapshot_date, r.get("team_id"),
                    r.get("rank"), r.get("played"), r.get("won"), r.get("drawn"),
                    r.get("lost"), r.get("gf"), r.get("ga"), r.get("gd"), r.get("points"),
                ),
            )
        conn.commit()


_DISPATCH = {
    EventType.MATCH_SCHEDULED: _handle_match_lifecycle,
    EventType.MATCH_STARTED: _handle_match_lifecycle,
    EventType.MATCH_SCORE_CHANGED: _handle_match_lifecycle,
    EventType.MATCH_PHASE_CHANGED: _handle_match_lifecycle,
    EventType.MATCH_ENDED: _handle_match_lifecycle,
    EventType.MATCH_EVENT_ADDED: _handle_match_event_added,
    EventType.LINEUP_PUBLISHED: _handle_lineup_published,
    EventType.LINEUP_CONFIRMED: _handle_lineup_published,
    EventType.STANDINGS_UPDATED: _handle_standings_updated,
}


def _to_dt(value) -> datetime:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc) if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        if value.endswith("Z"):
            value = value[:-1] + "+00:00"
        dt = datetime.fromisoformat(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    raise ValueError(f"Cannot parse kickoff_utc: {value!r}")


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

async def _main_async() -> int:
    settings = get_pipeline_settings()
    if not settings.redis_url:
        logger.error("REDIS_URL not set")
        return 1
    pg = get_pg_warehouse()
    if pg is None:
        logger.error("DATABASE_URL not set")
        return 1
    pg.migrate()
    worker = PostgresWriter(settings.redis_url, pg)

    loop = asyncio.get_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, lambda: asyncio.ensure_future(worker.stop()))
        except NotImplementedError:
            pass

    await worker.run()
    return 0


def main() -> int:  # pragma: no cover
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    return asyncio.run(_main_async())


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
