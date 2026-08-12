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
from typing import List, Optional

from backend.services.data import open_warehouse
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


async def _async_main(args: argparse.Namespace) -> int:
    with open_warehouse() as wh:
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
            await load_men_competitions(
                wh,
                min_season=args.min_season,
                max_season=args.max_season,
                competitions=_competitions(args),
                force=args.force,
            )

        if args.full or args.espn_women:
            ran_anything = True
            logger.info("=== ESPN: women's competitions ===")
            await load_women_competitions(
                wh,
                min_season=max(args.min_season, 2003),
                max_season=args.max_season,
                force=args.force,
            )

        if args.full or args.football_data:
            ran_anything = True
            logger.info("=== football-data.co.uk ===")
            await load_football_data(
                wh,
                min_season=max(args.min_season, 2005),
                max_season=args.max_season,
                force=args.force,
            )

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

    return 0


def _competitions(args) -> Optional[List[str]]:
    """`--competitions eng.2,esp.2` -> ['eng.2', 'esp.2']; absent -> everything."""
    if not getattr(args, "competitions", None):
        return None
    return [c.strip() for c in args.competitions.split(",") if c.strip()]


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--full", action="store_true", help="Run every loader.")
    parser.add_argument("--stats", action="store_true", help="Print per-competition counts.")

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
                             "ESPN loaders to, e.g. 'eng.2,esp.2'. Lets a "
                             "targeted backfill run without re-touching every "
                             "league in the warehouse.")
    parser.add_argument("--min-season", type=int, default=1998)
    parser.add_argument("--max-season", type=int, default=None)
    parser.add_argument("--current-season", action="store_true",
                        help="Ingest only the season(s) in progress. Prefer "
                             "this to writing the year into a cron: a literal "
                             "stops being true every August.")
    parser.add_argument("--force", action="store_true", help="Bypass per-source caches.")
    parser.add_argument("-v", "--verbose", action="store_true")

    args = parser.parse_args(argv)
    _setup_logging(args.verbose)

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
        logger.warning("Interrupted by user; partial warehouse retained.")
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
