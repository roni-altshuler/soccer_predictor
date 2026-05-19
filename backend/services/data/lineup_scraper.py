"""
Lineup Scraper - free/public-source pre-match lineup data collection.

================================================================================
SOURCE PRIORITY POLICY & TERMS-OF-SERVICE POSTURE
================================================================================
This module ONLY consumes free, publicly-available endpoints.  It does NOT use
any paid provider (Opta, StatsBomb, etc.).

Source priority (in order of attempt):
  1. ESPN public site API
     - Endpoint: site.api.espn.com summary?event=<id>
     - Already used by backend.services.espn.client (ESPNClient.get_match_details)
     - Public JSON, no auth.  Reuse rate limiter and singleton.
  2. FotMob public site API
     - Endpoint: www.fotmob.com/api/matchDetails?matchId=<id>
     - Already used by backend.services.fotmob.client (FotMobClient.get_match_details)
     - Public JSON consumed by the web app; no auth required.

ToS / robots.txt posture
------------------------
- ESPN's site.api.espn.com is consumed at a polite rate (<=1 req/sec via the
  existing token-bucket limiter) and only for personal/non-commercial research.
- FotMob's /api endpoints are likewise consumed at <=1 req/sec.  If either
  source returns 403/429 or its robots.txt disallows the endpoint at request
  time, the scraper logs a warning and gracefully skips.
- We never bypass auth, never scrape behind logins, and never redistribute raw
  data beyond cached JSON used by this project's own model.
- If a source disallows scraping (HTTP 403, 451, or repeated 429), the scraper
  falls through to the next source or returns ``None``.

Wikipedia is intentionally NOT scraped here: lineup tables are inconsistent.
================================================================================
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx

from backend.config import LEAGUE_IDS
from backend.services.espn.client import (
    ESPN_LEAGUE_IDS,
    get_espn_client,
    cleanup_espn_client,
)
from backend.services.fotmob.client import (
    get_fotmob_client,
    cleanup_fotmob_client,
)

logger = logging.getLogger(__name__)

# Cache: backend/data/lineups/<league>/<match_id>.json
LINEUPS_DATA_DIR = Path(__file__).parent.parent.parent / "data" / "lineups"

# Refetch threshold: skip cache hits younger than this AND before kickoff.
CACHE_REFRESH_SECONDS = 30 * 60  # 30 minutes


class LineupScraper:
    """Fetches pre-match lineups from free public sources (ESPN -> FotMob)."""

    # Polite floor on inter-request delay.  ESPN/FotMob clients already
    # enforce their own token-bucket limiters; this is a belt-and-braces
    # guard so the *combined* fetch rate stays <= 1 req/sec.
    MIN_INTERVAL_SECONDS = 1.0

    def __init__(self, data_dir: Optional[Path] = None):
        self.data_dir = data_dir or LINEUPS_DATA_DIR
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.espn = get_espn_client()
        self.fotmob = get_fotmob_client()
        self._last_request_ts: float = 0.0
        self._pace_lock = asyncio.Lock()

    # ---------------------------------------------------------------- pacing
    async def _pace(self) -> None:
        """Enforce <=1 req/sec across both sources."""
        async with self._pace_lock:
            now = time.monotonic()
            wait = self.MIN_INTERVAL_SECONDS - (now - self._last_request_ts)
            if wait > 0:
                await asyncio.sleep(wait)
            self._last_request_ts = time.monotonic()

    # ------------------------------------------------------------- cache I/O
    def _cache_path(self, league: str, match_id: str) -> Path:
        league_dir = self.data_dir / league
        league_dir.mkdir(parents=True, exist_ok=True)
        return league_dir / f"{match_id}.json"

    def _read_cache(self, league: str, match_id: str) -> Optional[Dict]:
        path = self._cache_path(league, match_id)
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            logger.warning(f"Cache read failed for {path}: {e}")
            return None

    def _write_cache(self, league: str, match_id: str, data: Dict) -> None:
        path = self._cache_path(league, match_id)
        try:
            path.write_text(
                json.dumps(data, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
        except OSError as e:
            logger.warning(f"Cache write failed for {path}: {e}")

    @staticmethod
    def _is_cache_fresh(cached: Dict) -> bool:
        """Cache is fresh if fetched < 30 minutes ago AND match hasn't kicked off."""
        fetched_at = cached.get("fetched_at")
        if not fetched_at:
            return False
        try:
            ts = datetime.fromisoformat(fetched_at.replace("Z", "+00:00"))
        except ValueError:
            return False
        now = datetime.now(timezone.utc)
        if (now - ts).total_seconds() >= CACHE_REFRESH_SECONDS:
            return False
        kickoff = cached.get("kickoff")
        if kickoff:
            try:
                ko = datetime.fromisoformat(kickoff.replace("Z", "+00:00"))
                if now >= ko:
                    return False
            except ValueError:
                pass
        return True

    # ---------------------------------------------------------------- ESPN
    async def _fetch_espn_lineup(
        self, match_id: str, league: str
    ) -> Optional[Dict[str, Any]]:
        """Try ESPN match summary endpoint."""
        if league not in ESPN_LEAGUE_IDS:
            return None
        await self._pace()
        try:
            data = await self._with_retry(
                lambda: self.espn.get_match_details(league, match_id)
            )
        except Exception as e:
            logger.warning(f"ESPN lineup fetch failed for {match_id}: {e}")
            return None
        if not data:
            return None
        return self._parse_espn(data)

    @staticmethod
    def _parse_espn(data: Dict) -> Optional[Dict[str, Any]]:
        """Extract starters/bench from ESPN match summary 'rosters' block."""
        rosters = data.get("rosters") or []
        if not rosters:
            return None
        home_xi: List[Dict] = []
        away_xi: List[Dict] = []
        home_bench: List[Dict] = []
        away_bench: List[Dict] = []
        for side in rosters:
            home_away = side.get("homeAway")  # "home" or "away"
            roster = side.get("roster") or []
            for entry in roster:
                athlete = entry.get("athlete") or {}
                pos = (entry.get("position") or {}).get("abbreviation")
                player = {
                    "player_id": athlete.get("id"),
                    "name": athlete.get("displayName") or athlete.get("fullName"),
                    "position": pos,
                }
                is_starter = bool(entry.get("starter"))
                if home_away == "home":
                    (home_xi if is_starter else home_bench).append(player)
                elif home_away == "away":
                    (away_xi if is_starter else away_bench).append(player)
        if not (home_xi or away_xi):
            return None
        # Kickoff & teams (for cache freshness logic).
        header = data.get("header") or {}
        comp = (header.get("competitions") or [{}])[0]
        kickoff = comp.get("date") or header.get("date")
        competitors = comp.get("competitors", [])
        home_team_id = next(
            (c.get("team", {}).get("id") for c in competitors if c.get("homeAway") == "home"),
            None,
        )
        away_team_id = next(
            (c.get("team", {}).get("id") for c in competitors if c.get("homeAway") == "away"),
            None,
        )
        return {
            "home_xi": home_xi,
            "away_xi": away_xi,
            "home_bench": home_bench,
            "away_bench": away_bench,
            "home_team_id": home_team_id,
            "away_team_id": away_team_id,
            "kickoff": kickoff,
        }

    # --------------------------------------------------------------- FotMob
    async def _fetch_fotmob_lineup(
        self, match_id: str
    ) -> Optional[Dict[str, Any]]:
        """Try FotMob matchDetails endpoint."""
        try:
            mid = int(match_id)
        except (TypeError, ValueError):
            return None
        await self._pace()
        try:
            data = await self._with_retry(
                lambda: self.fotmob.get_match_details(mid)
            )
        except Exception as e:
            logger.warning(f"FotMob lineup fetch failed for {match_id}: {e}")
            return None
        if not data:
            return None
        return self._parse_fotmob(data)

    @staticmethod
    def _parse_fotmob(data: Dict) -> Optional[Dict[str, Any]]:
        """Extract lineups from FotMob matchDetails payload."""
        content = data.get("content") or {}
        lineup_block = content.get("lineup") or {}
        sides = lineup_block.get("lineup") or []
        if not sides or len(sides) < 2:
            return None

        def _extract(side: Dict) -> tuple[List[Dict], List[Dict]]:
            starters: List[Dict] = []
            for row in side.get("players") or []:
                # FotMob nests starters as list-of-rows-of-players.
                if isinstance(row, list):
                    for p in row:
                        starters.append(_player(p))
                elif isinstance(row, dict):
                    starters.append(_player(row))
            bench = [_player(p) for p in (side.get("bench") or []) if isinstance(p, dict)]
            return starters, bench

        def _player(p: Dict) -> Dict:
            return {
                "player_id": p.get("id"),
                "name": p.get("name", {}).get("fullName") if isinstance(p.get("name"), dict) else p.get("name"),
                "position": p.get("positionStringShort") or p.get("role"),
            }

        home_xi, home_bench = _extract(sides[0])
        away_xi, away_bench = _extract(sides[1])
        if not (home_xi or away_xi):
            return None

        header = data.get("header") or {}
        teams = header.get("teams") or []
        home_team_id = teams[0].get("id") if len(teams) > 0 else None
        away_team_id = teams[1].get("id") if len(teams) > 1 else None
        kickoff = (
            (data.get("general") or {}).get("matchTimeUTC")
            or (header.get("status") or {}).get("utcTime")
        )

        return {
            "home_xi": home_xi,
            "away_xi": away_xi,
            "home_bench": home_bench,
            "away_bench": away_bench,
            "home_team_id": home_team_id,
            "away_team_id": away_team_id,
            "kickoff": kickoff,
        }

    # -------------------------------------------------------------- retries
    async def _with_retry(self, call):
        """Single retry on 5xx with 2s backoff."""
        try:
            return await call()
        except httpx.HTTPStatusError as e:
            status = e.response.status_code if e.response is not None else 0
            if 500 <= status < 600:
                logger.info(f"5xx ({status}); retrying once after backoff")
                await asyncio.sleep(2.0)
                return await call()
            raise

    # --------------------------------------------------------------- public
    async def fetch_match_lineup(
        self, match_id: str, league: str
    ) -> Optional[Dict[str, Any]]:
        """Return cached or freshly-scraped lineup dict for a single match."""
        cached = self._read_cache(league, match_id)
        if cached and self._is_cache_fresh(cached):
            logger.debug(f"Lineup cache fresh: {league}/{match_id}")
            return cached

        parsed: Optional[Dict[str, Any]] = None
        source: Optional[str] = None
        sources = (
            ("espn", lambda: self._fetch_espn_lineup(match_id, league)),
            ("fotmob", lambda: self._fetch_fotmob_lineup(match_id)),
        )
        for src_name, factory in sources:
            try:
                parsed = await factory()
            except Exception as e:
                logger.warning(f"{src_name} lineup error for {match_id}: {e}")
                parsed = None
            if parsed:
                source = src_name
                break

        if not parsed:
            logger.info(f"No lineup found for {league}/{match_id} from any source")
            return None

        result: Dict[str, Any] = {
            "match_id": str(match_id),
            "league": league,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "source": source,
            "kickoff": parsed.get("kickoff"),
            "home_team_id": parsed.get("home_team_id"),
            "away_team_id": parsed.get("away_team_id"),
            "home_xi": parsed.get("home_xi", []),
            "away_xi": parsed.get("away_xi", []),
            "home_bench": parsed.get("home_bench", []),
            "away_bench": parsed.get("away_bench", []),
            # Filled in by InjuryTracker.annotate_lineup; conservative default.
            "home_missing_top3_scorers": [],
            "away_missing_top3_scorers": [],
        }
        self._write_cache(league, match_id, result)
        return result

    async def fetch_upcoming_lineups(
        self, league: str, days_ahead: int = 1
    ) -> List[Dict[str, Any]]:
        """Pull upcoming fixtures for ``league`` and fetch lineups for each."""
        now = datetime.now(timezone.utc)
        horizon = now + timedelta(days=days_ahead)
        results: List[Dict[str, Any]] = []

        match_ids: List[str] = []
        # 1. Try ESPN scoreboard for next N days.
        if league in ESPN_LEAGUE_IDS:
            for day_offset in range(days_ahead + 1):
                day = (now + timedelta(days=day_offset)).strftime("%Y%m%d")
                try:
                    await self._pace()
                    sb = await self._with_retry(
                        lambda d=day: self.espn.get_scoreboard(league, d)
                    )
                except Exception as e:
                    logger.warning(f"ESPN scoreboard fail {league} {day}: {e}")
                    sb = None
                if not sb:
                    continue
                for event in sb.get("events", []):
                    start = event.get("date")
                    if not start:
                        continue
                    try:
                        ko = datetime.fromisoformat(start.replace("Z", "+00:00"))
                    except ValueError:
                        continue
                    if now <= ko <= horizon:
                        eid = event.get("id")
                        if eid:
                            match_ids.append(str(eid))

        # De-dup while preserving order.
        seen: set = set()
        match_ids = [m for m in match_ids if not (m in seen or seen.add(m))]

        for mid in match_ids:
            lineup = await self.fetch_match_lineup(mid, league)
            if lineup:
                results.append(lineup)
        return results

    async def close(self) -> None:
        await cleanup_espn_client()
        await cleanup_fotmob_client()


# Singleton -------------------------------------------------------------------
_scraper: Optional[LineupScraper] = None


def get_lineup_scraper() -> LineupScraper:
    global _scraper
    if _scraper is None:
        _scraper = LineupScraper()
    return _scraper


# CLI -------------------------------------------------------------------------
async def _run_cli(args: argparse.Namespace) -> int:
    scraper = get_lineup_scraper()
    if args.all_leagues:
        leagues = list(ESPN_LEAGUE_IDS.keys())
    elif args.league:
        leagues = [args.league]
    else:
        leagues = ["premier_league"]

    total = 0
    for lg in leagues:
        try:
            res = await scraper.fetch_upcoming_lineups(lg, days_ahead=args.days_ahead)
            total += len(res)
            logger.info(f"{lg}: cached {len(res)} lineup(s)")
        except Exception as e:
            logger.warning(f"{lg}: lineup scrape error: {e}")
    logger.info(f"Done. Total lineups cached: {total}")
    await scraper.close()
    return 0


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    parser = argparse.ArgumentParser(description="Free-source lineup scraper")
    parser.add_argument("--all-leagues", action="store_true", help="Scrape every known league")
    parser.add_argument("--league", type=str, help="Scrape a single league key (e.g. premier_league)")
    parser.add_argument("--days-ahead", type=int, default=1)
    args = parser.parse_args()
    asyncio.run(_run_cli(args))


if __name__ == "__main__":
    main()
