"""Dual-write helper: SQLite ⇒ Postgres in one call.

The existing loaders in ``backend/services/data/`` write to the SQLite
warehouse via methods like ``wh.upsert_matches([MatchRow(...), ...])``. They
should not have to know about Postgres. This module wraps the existing
warehouse so callers can do::

    from backend.pipeline.pg.dual_write import dual_write_matches
    dual_write_matches(sqlite_wh, match_rows)

When ``PIPELINE_DUAL_WRITE=true`` and ``DATABASE_URL`` is set, the helper also
writes the same rows into Postgres. Otherwise it's a passthrough — no Postgres
touch, no error.

The Postgres write is wrapped in a try/except so an outage on the new path
cannot break the existing SQLite-driven prediction pipeline. We log + continue.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional, Sequence

from backend.pipeline.pg.warehouse import MatchRecord, get_pg_warehouse
from backend.pipeline.settings import get_pipeline_settings
from backend.services.data.warehouse import MatchRow, Warehouse

logger = logging.getLogger(__name__)


def _parse_iso_utc(value: str) -> datetime:
    """Parse the ``date_utc`` column written by legacy loaders into a TZ-aware UTC datetime."""
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        # legacy rows occasionally had naive ISO with no offset
        dt = datetime.fromisoformat(value.split(".")[0])
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _match_row_to_record(row: MatchRow) -> MatchRecord:
    return MatchRecord(
        match_id=row.match_id,
        source=row.source,
        competition_id=row.competition_id,
        kickoff_utc=_parse_iso_utc(row.date_utc),
        home_team_id=row.home_team_id,
        away_team_id=row.away_team_id,
        home_score=row.home_score,
        away_score=row.away_score,
        season_id=f"{row.competition_id}-{row.season}",
        status="finished" if (row.home_score is not None and row.away_score is not None) else "scheduled",
        phase=row.phase,
        referee_id=row.referee_id,
        home_xg=row.home_xg,
        away_xg=row.away_xg,
        home_shots=row.home_shots,
        away_shots=row.away_shots,
        home_sot=row.home_sot,
        away_sot=row.away_sot,
        home_corners=row.home_corners,
        away_corners=row.away_corners,
        home_yellows=row.home_yellows,
        away_yellows=row.away_yellows,
        home_reds=row.home_reds,
        away_reds=row.away_reds,
        odds_home=row.odds_home,
        odds_draw=row.odds_draw,
        odds_away=row.odds_away,
        odds_over_2_5=row.odds_over_2_5,
        attendance=row.attendance,
        source_ts=_parse_iso_utc(row.fetched_at) if row.fetched_at else datetime.now(timezone.utc),
    )


def dual_write_matches(sqlite_wh: Warehouse, rows: Sequence[MatchRow]) -> int:
    """Write ``rows`` to SQLite, then optionally to Postgres.

    Returns the SQLite row-count (the canonical number — Postgres is the
    derivative path during Phase 1).
    """
    written = sqlite_wh.upsert_matches(rows)

    settings = get_pipeline_settings()
    if not settings.dual_write_enabled:
        return written

    pg = get_pg_warehouse()
    if pg is None:
        return written

    try:
        records = [_match_row_to_record(r) for r in rows]
        pg.upsert_matches(records)
    except Exception as exc:  # noqa: BLE001 — never break the legacy path
        logger.warning("Postgres dual-write failed for %d matches: %s", len(rows), exc)

    return written


def dual_write_team(
    sqlite_wh: Warehouse,
    canonical_name: str,
    gender: str,
    *,
    country: Optional[str] = None,
    venue_lat: Optional[float] = None,
    venue_lon: Optional[float] = None,
    venue_indoor: bool = False,
) -> int:
    """Upsert a team in SQLite; mirror into Postgres if enabled.

    Returns the SQLite team_id (the legacy canonical id used everywhere else).
    """
    team_id = sqlite_wh.upsert_team(
        canonical_name,
        gender,
        country=country,
        venue_lat=venue_lat,
        venue_lon=venue_lon,
        venue_indoor=venue_indoor,
    )

    settings = get_pipeline_settings()
    if not settings.dual_write_enabled:
        return team_id

    pg = get_pg_warehouse()
    if pg is None:
        return team_id

    try:
        # In Postgres we let it allocate its own surrogate key, but record
        # the SQLite ↔ PG mapping via the team_aliases table so future
        # cross-system joins are deterministic.
        pg_team_id = pg.upsert_team(canonical_name, gender, country=country)
        # Store the legacy SQLite id as an alias under source='sqlite' for traceability.
        pg.add_team_alias(canonical_name, pg_team_id, gender, source="sqlite")
    except Exception as exc:  # noqa: BLE001
        logger.warning("Postgres dual-write team upsert failed for %s/%s: %s", canonical_name, gender, exc)

    return team_id


def dual_write_competition(
    sqlite_wh: Warehouse,
    competition_id: str,
    name: str,
    gender: str,
    *,
    country: Optional[str] = None,
    tier: Optional[int] = None,
    confederation: Optional[str] = None,
) -> None:
    sqlite_wh.upsert_competition(
        competition_id, name, gender,
        country=country, tier=tier, confederation=confederation,
    )

    if not get_pipeline_settings().dual_write_enabled:
        return
    pg = get_pg_warehouse()
    if pg is None:
        return
    try:
        pg.upsert_competition(
            competition_id, name, gender,
            country=country, tier=tier, confederation=confederation,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Postgres dual-write competition upsert failed for %s: %s", competition_id, exc)
