"""One-shot backfill: copy the legacy SQLite warehouse into Postgres.

Usage::

    python -m backend.pipeline.pg.backfill                  # uses DATABASE_URL
    python -m backend.pipeline.pg.backfill --dry-run        # counts only
    python -m backend.pipeline.pg.backfill --source backend/data/warehouse.sqlite

Strategy:

1. Open both warehouses.
2. Copy competitions → teams → team_aliases → referees → matches → clubelo → weather.
3. The teams table uses canonical_name + gender as a natural key, so we can
   upsert without needing the legacy integer team_id. We build a
   ``legacy_team_id -> pg_team_id`` map in memory and rewrite fact rows on the fly.
4. ``season_id`` in Postgres is synthesized as ``"{competition_id}-{season}"``
   from the legacy ``matches.season`` column.

The backfill is idempotent: re-running just upserts again. Safe to retry on
network failure.
"""

from __future__ import annotations

import argparse
import logging
import sqlite3
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Dict, Optional

from backend.pipeline.pg.warehouse import MatchRecord, open_pg_warehouse
from backend.services.data.warehouse import WAREHOUSE_PATH as DEFAULT_SQLITE_PATH

logger = logging.getLogger(__name__)


def _parse_iso(value: str) -> datetime:
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        dt = datetime.fromisoformat(value.split(".")[0])
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _open_sqlite_ro(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def backfill(sqlite_path: Path, *, dry_run: bool = False) -> Dict[str, int]:
    """Run the backfill. Returns counts per table."""
    counts: Dict[str, int] = {}

    sl = _open_sqlite_ro(sqlite_path)
    try:
        with open_pg_warehouse() as pg:
            # --- competitions
            comp_rows = sl.execute(
                "SELECT competition_id, name, country, gender, tier, confederation FROM competitions"
            ).fetchall()
            counts["competitions"] = len(comp_rows)
            if not dry_run:
                for r in comp_rows:
                    pg.upsert_competition(
                        r["competition_id"], r["name"], r["gender"],
                        country=r["country"], tier=r["tier"], confederation=r["confederation"],
                    )

            # --- teams (build legacy_id -> pg_id map)
            team_rows = sl.execute(
                "SELECT team_id, canonical_name, country, gender, venue_lat, venue_lon, venue_indoor FROM teams"
            ).fetchall()
            counts["teams"] = len(team_rows)
            id_map: Dict[int, int] = {}
            if not dry_run:
                for r in team_rows:
                    pg_id = pg.upsert_team(
                        r["canonical_name"], r["gender"], country=r["country"],
                    )
                    id_map[int(r["team_id"])] = pg_id

            # --- team_aliases
            alias_rows = sl.execute(
                "SELECT alias, gender, team_id FROM team_aliases"
            ).fetchall()
            counts["team_aliases"] = len(alias_rows)
            if not dry_run:
                for r in alias_rows:
                    pg_tid = id_map.get(int(r["team_id"]))
                    if pg_tid is None:
                        continue
                    pg.add_team_alias(r["alias"], pg_tid, r["gender"], source="sqlite_backfill")

            # --- referees
            ref_rows = sl.execute(
                "SELECT referee_id, name, country FROM referees"
            ).fetchall()
            counts["referees"] = len(ref_rows)
            ref_map: Dict[int, int] = {}
            if not dry_run:
                for r in ref_rows:
                    pg_rid = pg.upsert_referee(r["name"], country=r["country"])
                    if pg_rid is not None:
                        ref_map[int(r["referee_id"])] = pg_rid

            # --- seasons (synthesized from matches)
            season_keys = sl.execute(
                "SELECT DISTINCT competition_id, season FROM matches WHERE season IS NOT NULL"
            ).fetchall()
            counts["seasons"] = len(season_keys)
            if not dry_run:
                for r in season_keys:
                    season_id = f"{r['competition_id']}-{r['season']}"
                    pg.upsert_season(season_id, r["competition_id"], str(r["season"]))

            # --- matches (rewrite team / referee ids)
            match_rows = sl.execute(
                """
                SELECT match_id, source, competition_id, season, date_utc,
                       home_team_id, away_team_id, home_score, away_score,
                       phase, referee_id,
                       home_shots, away_shots, home_sot, away_sot,
                       home_corners, away_corners,
                       home_yellows, away_yellows, home_reds, away_reds,
                       home_xg, away_xg, attendance,
                       odds_home, odds_draw, odds_away, odds_over_2_5,
                       venue, fetched_at
                FROM matches
                """
            ).fetchall()
            counts["matches_input"] = len(match_rows)

            if not dry_run:
                batch: list[MatchRecord] = []
                skipped = 0
                for r in match_rows:
                    h = id_map.get(int(r["home_team_id"]))
                    a = id_map.get(int(r["away_team_id"]))
                    if h is None or a is None:
                        skipped += 1
                        continue
                    rid = ref_map.get(int(r["referee_id"])) if r["referee_id"] else None
                    batch.append(MatchRecord(
                        match_id=str(r["match_id"]),
                        source=r["source"] or "sqlite_backfill",
                        competition_id=r["competition_id"],
                        season_id=f"{r['competition_id']}-{r['season']}" if r["season"] else None,
                        kickoff_utc=_parse_iso(r["date_utc"]),
                        status="finished" if r["home_score"] is not None and r["away_score"] is not None else "scheduled",
                        phase=r["phase"],
                        home_team_id=h,
                        away_team_id=a,
                        referee_id=rid,
                        home_score=r["home_score"],
                        away_score=r["away_score"],
                        home_xg=r["home_xg"],
                        away_xg=r["away_xg"],
                        home_shots=r["home_shots"],
                        away_shots=r["away_shots"],
                        home_sot=r["home_sot"],
                        away_sot=r["away_sot"],
                        home_corners=r["home_corners"],
                        away_corners=r["away_corners"],
                        home_yellows=r["home_yellows"],
                        away_yellows=r["away_yellows"],
                        home_reds=r["home_reds"],
                        away_reds=r["away_reds"],
                        odds_home=r["odds_home"],
                        odds_draw=r["odds_draw"],
                        odds_away=r["odds_away"],
                        odds_over_2_5=r["odds_over_2_5"],
                        attendance=r["attendance"],
                        source_ts=_parse_iso(r["fetched_at"]) if r["fetched_at"] else datetime.now(timezone.utc),
                    ))
                    # Flush in chunks of 1000 to keep memory bounded
                    if len(batch) >= 1000:
                        pg.upsert_matches(batch)
                        batch.clear()
                if batch:
                    pg.upsert_matches(batch)
                counts["matches_written"] = counts["matches_input"] - skipped
                counts["matches_skipped"] = skipped

            # --- clubelo
            elo_rows = sl.execute(
                "SELECT team_id, date, elo FROM clubelo_ratings"
            ).fetchall()
            counts["clubelo_input"] = len(elo_rows)
            if not dry_run:
                payload = []
                skipped = 0
                for r in elo_rows:
                    pg_tid = id_map.get(int(r["team_id"]))
                    if pg_tid is None:
                        skipped += 1
                        continue
                    payload.append((pg_tid, _to_date(r["date"]), float(r["elo"])))
                pg.upsert_clubelo(payload)
                counts["clubelo_written"] = len(payload)
                counts["clubelo_skipped"] = skipped

            # --- weather
            w_rows = sl.execute(
                "SELECT match_id, temp_c, precip_mm, wind_kmh, humidity, wind_dir_deg, is_outdoor FROM weather"
            ).fetchall()
            counts["weather_input"] = len(w_rows)
            if not dry_run:
                for r in w_rows:
                    pg.upsert_weather(
                        r["match_id"],
                        temp_c=r["temp_c"], precip_mm=r["precip_mm"],
                        wind_kmh=r["wind_kmh"], humidity=r["humidity"],
                        wind_dir_deg=r["wind_dir_deg"],
                        is_outdoor=bool(r["is_outdoor"]),
                    )

    finally:
        sl.close()

    return counts


def _to_date(value: str) -> date:
    """SQLite stores dates as ISO strings; Postgres wants ``date``."""
    if isinstance(value, date):
        return value
    return datetime.fromisoformat(value[:10]).date()


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Backfill SQLite warehouse → Postgres")
    parser.add_argument(
        "--source", type=Path, default=DEFAULT_SQLITE_PATH,
        help="Path to legacy SQLite warehouse",
    )
    parser.add_argument("--dry-run", action="store_true", help="Count rows only, don't write")
    parser.add_argument("--log-level", default="INFO")
    args = parser.parse_args(argv)

    logging.basicConfig(level=args.log_level, format="%(levelname)s %(name)s: %(message)s")

    if not args.source.exists():
        logger.error("SQLite source not found: %s", args.source)
        return 1

    logger.info("Backfilling from %s (dry_run=%s)", args.source, args.dry_run)
    counts = backfill(args.source, dry_run=args.dry_run)
    for k, v in counts.items():
        logger.info("  %-22s %d", k, v)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
