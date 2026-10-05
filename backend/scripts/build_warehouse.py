"""Build / refresh the unified soccer match warehouse.

Usage
-----
    # First-time full build (slow — fetches everything):
    python -m backend.scripts.build_warehouse --full

    # Just ESPN refresh for the current season:
    python -m backend.scripts.build_warehouse --espn --min-season 2025

    # Pull missing women's competitions:
    python -m backend.scripts.build_warehouse --espn-women

    # Skip slow scrapers (FBref / Understat / ClubElo) for a quick rebuild:
    python -m backend.scripts.build_warehouse --espn --football-data

    # Print warehouse stats and exit:
    python -m backend.scripts.build_warehouse --stats

The order matters: ESPN/football-data first (they create the matches and,
through the resolver, the teams those matches reference), then
ClubElo / OpenFootball / FBref / Understat which
enrich the existing rows, then **venues** (attaches lat/lon to teams from
the committed `backend/data/venues.yml`), then weather — which selects
matches by joining `teams` on venue lat/lon and so does nothing at all
until venues have been loaded.

After any build, run the integrity guard:

    python -m backend.scripts.validate_warehouse_integrity

A warehouse built before 2026-08-08 also needs a one-off repair pass
(`python -m backend.scripts.repair_warehouse`) — the loaders now prevent
the defects it fixes, but rows already on disk cannot heal themselves.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
import os
import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path
from datetime import datetime, timezone
from typing import List, Optional

from backend.services.data import WAREHOUSE_PATH, open_warehouse
from backend.services.data.provider_status import ProviderUnavailable
from backend.services.data.clubelo_loader import load_clubelo
from backend.services.data.espn_loader import (
    load_men_competitions,
    load_women_competitions,
    register_competitions,
)
from backend.services.data.fbref_loader import load_fbref_xg
from backend.services.data.footballdata_loader import load_football_data
from backend.services.data.openfootball_loader import load_openfootball
from backend.services.data.referee_loader import load_referees
from backend.services.data.understat_loader import load_understat_xg
from backend.services.data.venue_loader import load_venues
from backend.services.data.weather_loader import load_weather

logger = logging.getLogger(__name__)


def _setup_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stderr,
    )


def _require_complete(source: str, stats) -> None:
    if not stats:
        raise ProviderUnavailable(f"{source}: no league-seasons selected")
    for stat in stats:
        if stat.error or getattr(stat, "phantom_rows_skipped", 0):
            raise ProviderUnavailable(
                f"{source} {stat.competition_id}/{stat.season}: "
                f"{stat.error or 'unresolved club rows refused'}"
            )


def _validate_candidate(wh, args) -> None:
    from backend.scripts.validate_warehouse_integrity import (
        IntegrityValidator, LEAGUE_SIZE, TRUNCATED_SEASONS, WAVE_A,
    )
    if not wh._conn.execute("SELECT 1 FROM matches LIMIT 1").fetchone():
        raise ProviderUnavailable("warehouse has no results; publication refused")
    validator = IntegrityValidator(wh, min_season=args.min_season, leagues=WAVE_A)
    failures = [result.detail for result in validator.run_all() if not result.passed]
    # The existing integrity guard judges an old snapshot by its own latest
    # date. A cold partial refresh must also be judged against today's clock.
    today = datetime.now(timezone.utc).date()
    for row in wh._conn.execute(
        "SELECT competition_id, season, COUNT(*) AS n FROM matches "
        "WHERE season >= ? GROUP BY competition_id, season", (args.min_season,)
    ):
        competition, season, count = row
        if (competition not in WAVE_A or (competition, season) in TRUNCATED_SEASONS
                or today <= datetime(season + 1, 7, 31).date()):
            continue
        sizes = LEAGUE_SIZE[competition]
        size = sizes.get(str(season), sizes["default"])
        expected = size * (size - 1)
        if abs(count - expected) > max(2, expected * .02):
            failures.append(f"{competition}/{season}: {count} results, expected ~{expected}")
    if failures:
        raise ProviderUnavailable("candidate integrity/coverage failed: " + "; ".join(failures))


def _quoted_identifier(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _copy_candidate_contents(live: sqlite3.Connection) -> None:
    """Restore schema and rows inside the caller's SQLite writer transaction.

    Do not use executescript: it would implicitly commit the publication lock.
    No file replacement means already-open writers still address this database.
    """
    schema = live.execute(
        "SELECT type, name, sql FROM candidate.sqlite_schema "
        "WHERE name NOT GLOB 'sqlite_*' AND sql IS NOT NULL"
    ).fetchall()
    if any("CREATE VIRTUAL TABLE" in sql.upper() for _, _, sql in schema):
        raise ProviderUnavailable("virtual tables require a separate reviewed warehouse migration")
    old = live.execute(
        "SELECT type, name FROM main.sqlite_schema "
        "WHERE name NOT GLOB 'sqlite_*' AND sql IS NOT NULL"
    ).fetchall()
    for kind in ("view", "trigger", "table"):
        for object_type, name in old:
            if object_type == kind:
                live.execute(f"DROP {kind.upper()} main.{_quoted_identifier(name)}")
    for kind, _, sql in schema:
        if kind == "table":
            live.execute(sql)
    for kind, name, _ in schema:
        if kind != "table":
            continue
        table = _quoted_identifier(name)
        columns = ", ".join(
            _quoted_identifier(row[1])
            for row in live.execute(f"PRAGMA candidate.table_xinfo({table})")
            if row[6] == 0  # Generated columns are recomputed by SQLite.
        )
        live.execute(f"INSERT INTO main.{table} ({columns}) SELECT {columns} FROM candidate.{table}")
    if live.execute("SELECT 1 FROM candidate.sqlite_schema WHERE name = 'sqlite_sequence'").fetchone():
        live.execute("DELETE FROM main.sqlite_sequence")
        live.execute("INSERT INTO main.sqlite_sequence SELECT * FROM candidate.sqlite_sequence")
    for kind in ("index", "view", "trigger"):
        for object_type, _, sql in schema:
            if object_type == kind:
                live.execute(sql)
    if live.execute("PRAGMA main.foreign_key_check").fetchone():
        raise ProviderUnavailable("candidate foreign keys failed during publication")


def _publish_existing(live: sqlite3.Connection, candidate: Path, version: int) -> None:
    # The same connection tracks data_version from before backup until commit.
    # BEGIN IMMEDIATE excludes *all* SQLite writers through the final check,
    # data/schema copy and COMMIT, including callers that do not use Warehouse.
    live.execute("ATTACH DATABASE ? AS candidate", (candidate.as_uri() + "?mode=ro",))
    try:
        live.execute("PRAGMA foreign_keys = OFF")
        live.execute("BEGIN IMMEDIATE")
        try:
            if live.execute("PRAGMA data_version").fetchone()[0] != version:
                raise ProviderUnavailable("warehouse changed during refresh; publication refused")
            _copy_candidate_contents(live)
            live.execute("COMMIT")
        except BaseException:
            if live.in_transaction:
                live.execute("ROLLBACK")
            raise
    finally:
        live.execute("DETACH DATABASE candidate")


async def _build(args: argparse.Namespace) -> int:
    with open_warehouse(args.db) as wh:
        # Competitions must exist before any match can reference one.
        # Alias overrides are NOT seeded here any more: each loader builds
        # its own TeamResolver, which reads team_aliases.yml into memory and
        # materialises a team only when a real match resolves to it. Seeding
        # them eagerly created one zero-match `teams` row per pinned club.
        register_competitions(wh)

        ran_anything = False

        if args.full or args.espn:
            ran_anything = True
            logger.info("=== ESPN: men's competitions ===")
            if getattr(args, "resume_current", False):
                from backend.services.data.espn_loader import load_current_competitions
                stats = await load_current_competitions(
                    wh, competitions=_competitions(args), receipts_path=args.receipts_db)
            else:
                stats = await load_men_competitions(
                    wh,
                    min_season=args.min_season,
                    max_season=args.max_season,
                    competitions=_competitions(args),
                    force=args.force,
                    persist_cache=False,
                )
            _require_complete("ESPN/M", stats)

        if args.full or args.espn_women:
            ran_anything = True
            logger.info("=== ESPN: women's competitions ===")
            stats = await load_women_competitions(
                wh,
                min_season=max(args.min_season, 2003),
                max_season=args.max_season,
                force=args.force,
                competitions=_competitions(args),
                persist_cache=False,
            )
            _require_complete("ESPN/F", stats)

        if args.full or args.football_data:
            ran_anything = True
            logger.info("=== football-data.co.uk ===")
            stats = await load_football_data(
                wh,
                min_season=max(args.min_season, 2005),
                max_season=args.max_season,
                force=args.force,
                leagues=_competitions(args),
                persist_cache=False,
            )
            _require_complete("football-data", stats)

        if args.full or args.openfootball:
            ran_anything = True
            logger.info("=== OpenFootball ===")
            await load_openfootball(
                wh,
                min_season=args.min_season,
                max_season=args.max_season or 2025,
            )

        if args.full or args.clubelo:
            ran_anything = True
            logger.info("=== ClubElo ===")
            await load_clubelo(wh)

        if args.full or args.fbref:
            ran_anything = True
            logger.info("=== FBref xG ===")
            await load_fbref_xg(
                wh,
                min_season=max(args.min_season, 2017),
                max_season=args.max_season or 2025,
            )

        if args.full or args.understat:
            ran_anything = True
            logger.info("=== Understat xG ===")
            await load_understat_xg(
                wh,
                min_season=max(args.min_season, 2014),
                max_season=args.max_season or 2025,
            )

        # Not part of --full: one HTTP request per match, and it can only
        # reach ESPN-sourced rows (~10% of Wave A). See referee_loader's
        # docstring for why football-data cannot supply the rest.
        if args.referees:
            ran_anything = True
            logger.info("=== ESPN referees (slow; one request per match) ===")
            referee_stats = await load_referees(wh)
            logger.info(
                "Referees: %d set, %d matches had no officials, %d errors, "
                "%d new referee rows",
                referee_stats.referees_set, referee_stats.no_officials,
                referee_stats.errors, referee_stats.referees_created,
            )

        # Venues must precede weather: the weather loader picks matches by
        # joining teams on venue_lat/venue_lon, so with no coordinates it
        # silently selects nothing and writes zero rows.
        if args.full or args.venues or args.weather:
            ran_anything = True
            logger.info("=== Venue coordinates (static, offline) ===")
            venue_stats = load_venues(wh)
            logger.info(
                "Venues: %d applied, %d unresolved, %d not in warehouse",
                venue_stats.applied, venue_stats.unresolved, venue_stats.team_not_found,
            )

        if args.full or args.weather:
            ran_anything = True
            logger.info("=== Open-Meteo weather ===")
            weather_stats = await load_weather(wh)
            logger.info(
                "Weather: %d rows written from %d requests (%d indoor, "
                "%d without a kickoff time, %d without a venue)",
                weather_stats.weather_written, weather_stats.requests,
                weather_stats.skipped_indoor, weather_stats.skipped_no_kickoff,
                weather_stats.skipped_no_venue,
            )

        if args.stats or ran_anything:
            print()
            print(f"{'competition':<30}  {'gender':<3}  {'matches':>8}  {'first':<10}  {'last':<10}")
            print("-" * 80)
            for row in wh.stats_by_competition():
                first = (row.get("first_match") or "")[:10]
                last = (row.get("last_match") or "")[:10]
                gender = row.get("gender") or "?"
                print(
                    f"{row['competition_id']:<30}  {gender:<3}  {row['matches']:>8d}  "
                    f"{first:<10}  {last:<10}"
                )

        if not ran_anything and not args.stats:
            logger.warning("No loader selected; pass --full or one of --espn/--football-data/etc.")
            return 2

        if args.full or args.espn or args.espn_women or args.football_data:
            _validate_candidate(wh, args)

    return 0


async def _async_main(args: argparse.Namespace) -> int:
    selected = any(getattr(args, name, False) for name in (
        "full", "espn", "espn_women", "football_data", "openfootball",
        "clubelo", "fbref", "understat", "referees", "venues", "weather",
    ))
    target = args.db
    if not selected:
        if not args.stats or not target.exists():
            logger.error("No loader selected or warehouse missing: %s", target)
            return 2
        # A stats query must not create or migrate a missing/old database.
        with closing(sqlite3.connect(target.as_uri() + "?mode=ro", uri=True)) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT m.competition_id, c.name, c.gender, COUNT(*) AS matches, "
                "MIN(m.date_utc) AS first_match, MAX(m.date_utc) AS last_match "
                "FROM matches m LEFT JOIN competitions c "
                "ON c.competition_id = m.competition_id "
                "GROUP BY m.competition_id, c.name, c.gender ORDER BY matches DESC"
            )
            for row in rows:
                print(dict(row))
        return 0

    target.parent.mkdir(parents=True, exist_ok=True)
    original = target.stat().st_ino if target.exists() else None
    fd, name = tempfile.mkstemp(prefix=".warehouse-", suffix=".sqlite", dir=target.parent)
    os.close(fd)
    candidate = Path(name)
    live = None
    try:
        if original is not None:
            # Preserve the existing conservative refusal of an active WAL.
            wal = Path(str(target) + "-wal")
            if wal.exists() and wal.stat().st_size:
                raise ProviderUnavailable("warehouse has an active WAL; retry after its writer closes")
            live = sqlite3.connect(target.as_uri() + "?mode=rw", uri=True, isolation_level=None)
            version = live.execute("PRAGMA data_version").fetchone()[0]
            with closing(sqlite3.connect(candidate)) as dest:
                live.backup(dest)
        args.db = candidate
        result = await _build(args)
        if result:
            return result
        with candidate.open("rb") as handle:
            os.fsync(handle.fileno())
        if live is None:
            # Atomic create-if-absent: a concurrent creator's file is never
            # replaced, even if it appears between a check and publication.
            os.link(candidate, target)
        else:
            if not target.exists() or target.stat().st_ino != original:
                raise ProviderUnavailable("warehouse file identity changed during refresh")
            _publish_existing(live, candidate, version)
        return 0
    finally:
        args.db = target
        if live is not None:
            live.close()
        for suffix in ("", "-wal", "-shm"):
            Path(str(candidate) + suffix).unlink(missing_ok=True)


def _competitions(args) -> Optional[List[str]]:
    """`--competitions eng.2,esp.2` -> ['eng.2', 'esp.2']; absent -> everything."""
    if not getattr(args, "competitions", None):
        return None
    return [c.strip() for c in args.competitions.split(",") if c.strip()]


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--full", action="store_true", help="Run every loader.")
    parser.add_argument("--stats", action="store_true", help="Print per-competition counts.")
    parser.add_argument("--db", type=Path, default=WAREHOUSE_PATH,
                        help="Warehouse to refresh atomically (or inspect with --stats).")

    parser.add_argument("--espn", action="store_true", help="Run ESPN men's loader.")
    parser.add_argument("--espn-women", action="store_true", help="Run ESPN women's loader.")
    parser.add_argument("--football-data", action="store_true", help="Run football-data.co.uk loader.")
    parser.add_argument("--openfootball", action="store_true", help="Run OpenFootball loader.")
    parser.add_argument("--clubelo", action="store_true", help="Run ClubElo loader.")
    parser.add_argument("--fbref", action="store_true", help="Run FBref xG loader.")
    parser.add_argument("--understat", action="store_true", help="Run Understat xG loader.")
    parser.add_argument("--referees", action="store_true",
                        help="Fetch referees from ESPN match summaries (slow; not in --full).")
    parser.add_argument("--venues", action="store_true",
                        help="Apply backend/data/venues.yml to teams (offline; implied by --weather).")
    parser.add_argument("--weather", action="store_true", help="Run Open-Meteo weather loader.")

    parser.add_argument("--competitions",
                        help="comma-separated competition ids to restrict the "
                             "core loaders to, e.g. 'eng.2,esp.2'. Lets a "
                             "targeted backfill run without re-touching every "
                             "league in the warehouse.")
    parser.add_argument("--min-season", type=int, default=1998)
    parser.add_argument("--max-season", type=int, default=None)
    parser.add_argument("--current-season", action="store_true",
                        help="Ingest only the season(s) in progress. Prefer "
                             "this to writing the year into a cron: a literal "
                             "stops being true every August.")
    parser.add_argument("--force", action="store_true", help="Bypass per-source caches.")
    parser.add_argument("--resume-current", action="store_true",
                        help="Bounded current-season refresh using ESPN's validated calendar "
                             "and durable daily receipts; requires explicit --competitions.")
    parser.add_argument("--receipts-db", type=Path, default=None,
                        help="Separate resumable ESPN receipt store; never the live warehouse.")
    parser.add_argument("-v", "--verbose", action="store_true")

    args = parser.parse_args(argv)
    args.db = args.db.resolve()
    _setup_logging(args.verbose)

    if args.resume_current:
        from backend.services.data.espn_refresh import ROUTINE_COMPETITIONS, RECEIPTS_PATH
        scope = _competitions(args)
        if (not args.espn or not args.current_season or not scope or args.force
                or any(getattr(args, name) for name in ("full", "espn_women", "football_data",
                           "openfootball", "clubelo", "fbref", "understat", "referees", "venues", "weather"))
                or len(scope) != len(set(scope)) or not set(scope).issubset(ROUTINE_COMPETITIONS)):
            parser.error("--resume-current requires --espn --current-season and an explicit "
                         "supported scope; cannot combine with --force or other loaders")
        args.receipts_db = (args.receipts_db or RECEIPTS_PATH).resolve()
        if args.receipts_db == args.db or args.receipts_db.is_relative_to(args.db):
            parser.error("receipt store must be separate from the warehouse")
    elif args.receipts_db:
        parser.error("--receipts-db requires --resume-current")

    if args.current_season:
        # Two answers, not one: a European season in February is last
        # summer's, while MLS and the Brasileirão are already in this year's.
        # Spanning both is what makes "the current season" mean the same
        # thing in August and in February.
        from backend.services.prediction.historical_data import (
            CALENDAR_YEAR_LEAGUES,
            current_season,
        )

        labels = {current_season("premier_league")} | {
            current_season(league) for league in CALENDAR_YEAR_LEAGUES}
        args.min_season, args.max_season = min(labels), max(labels)
        logger.info("current season(s): %d..%d", args.min_season, args.max_season)

    try:
        return asyncio.run(_async_main(args))
    except KeyboardInterrupt:
        logger.warning("Interrupted; last-good warehouse retained.")
        return 130
    except Exception:
        logger.exception("Warehouse refresh failed; last-good warehouse and core caches retained.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
