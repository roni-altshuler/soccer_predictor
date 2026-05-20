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

The order matters: ESPN/football-data first (they create matches and seed
team aliases), then ClubElo / OpenFootball / FBref / Understat which
enrich the existing rows, then weather (uses venue lat/lon already
attached to teams).
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
from backend.services.data.team_resolver import TeamResolver
from backend.services.data.understat_loader import load_understat_xg
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
        # Always seed competitions + alias overrides before any loader runs.
        register_competitions(wh)
        TeamResolver(wh, gender_default="M")
        TeamResolver(wh, gender_default="F")

        ran_anything = False

        if args.full or args.espn:
            ran_anything = True
            logger.info("=== ESPN: men's competitions ===")
            await load_men_competitions(
                wh,
                min_season=args.min_season,
                max_season=args.max_season,
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

        if args.full or args.weather:
            ran_anything = True
            logger.info("=== Open-Meteo weather ===")
            await load_weather(wh)

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
    parser.add_argument("--weather", action="store_true", help="Run Open-Meteo weather loader.")

    parser.add_argument("--min-season", type=int, default=1998)
    parser.add_argument("--max-season", type=int, default=None)
    parser.add_argument("--force", action="store_true", help="Bypass per-source caches.")
    parser.add_argument("-v", "--verbose", action="store_true")

    args = parser.parse_args(argv)
    _setup_logging(args.verbose)

    try:
        return asyncio.run(_async_main(args))
    except KeyboardInterrupt:
        logger.warning("Interrupted by user; partial warehouse retained.")
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
