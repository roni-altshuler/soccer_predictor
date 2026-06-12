"""
Injury Tracker - free-source team injury report scraping.

Sources (free/public only):
  - ESPN team injuries endpoint (via existing ESPNClient HTTP layer)
  - FotMob team injuries (already exposed as FotMobClient.get_team_injuries)

Cache: backend/data/injuries/<team_id>.json with a 6-hour TTL.
Conservative behaviour: on missing/ambiguous data, return empty lists
rather than fabricating injury flags.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import time
from datetime import datetime, timezone
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

INJURIES_DATA_DIR = Path(__file__).parent.parent.parent / "data" / "injuries"
INJURY_TTL_SECONDS = 6 * 60 * 60  # 6 hours

# Map ESPN injury status to our normalized vocabulary.
_STATUS_MAP = {
    "Out": "out",
    "Day-To-Day": "doubtful",
    "Day To Day": "doubtful",
    "Questionable": "questionable",
    "Doubtful": "doubtful",
    "Suspended": "out",
}


class InjuryTracker:
    """Per-team injury list scraper with on-disk cache."""

    MIN_INTERVAL_SECONDS = 1.0

    def __init__(self, data_dir: Optional[Path] = None):
        self.data_dir = data_dir or INJURIES_DATA_DIR
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.espn = get_espn_client()
        self.fotmob = get_fotmob_client()
        self._last_request_ts: float = 0.0
        self._pace_lock = asyncio.Lock()

    async def _pace(self) -> None:
        async with self._pace_lock:
            now = time.monotonic()
            wait = self.MIN_INTERVAL_SECONDS - (now - self._last_request_ts)
            if wait > 0:
                await asyncio.sleep(wait)
            self._last_request_ts = time.monotonic()

    # ---------------------------------------------------------------- cache
    def _cache_path(self, team_id: str) -> Path:
        return self.data_dir / f"{team_id}.json"

    def _read_cache(self, team_id: str) -> Optional[Dict]:
        path = self._cache_path(team_id)
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            logger.warning(f"Injury cache read fail {path}: {e}")
            return None

    def _write_cache(self, team_id: str, payload: Dict) -> None:
        try:
            self._cache_path(team_id).write_text(
                json.dumps(payload, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
        except OSError as e:
            logger.warning(f"Injury cache write fail {team_id}: {e}")

    @staticmethod
    def _is_fresh(payload: Dict) -> bool:
        ts_str = payload.get("fetched_at")
        if not ts_str:
            return False
        try:
            ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        except ValueError:
            return False
        return (datetime.now(timezone.utc) - ts).total_seconds() < INJURY_TTL_SECONDS

    # ---------------------------------------------------------------- ESPN
    async def _fetch_espn_injuries(
        self, team_id: str, league_key: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Hit ESPN's public team-injuries endpoint via the shared client."""
        # ESPN exposes /<league>/teams/<id>/injuries on the same site API base.
        # We try every plausible league_key if none is supplied.
        league_keys = [league_key] if league_key else list(ESPN_LEAGUE_IDS.keys())
        for lk in league_keys:
            espn_id = ESPN_LEAGUE_IDS.get(lk) if lk else None
            if not espn_id:
                continue
            endpoint = f"{espn_id}/teams/{team_id}/injuries"
            cache_key = f"espn_injuries_{team_id}_{lk}"
            await self._pace()
            try:
                data = await self._with_retry(
                    lambda: self.espn._request(  # noqa: SLF001 (intentional reuse)
                        endpoint, cache_key=cache_key, cache_ttl=INJURY_TTL_SECONDS
                    )
                )
            except Exception as e:
                logger.debug(f"ESPN injuries {lk}/{team_id} failed: {e}")
                data = None
            if not data:
                continue
            parsed = self._parse_espn_injuries(data)
            if parsed:
                return parsed
        return []

    @staticmethod
    def _parse_espn_injuries(data: Dict) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        now = datetime.now(timezone.utc).isoformat()
        for item in data.get("injuries", []) or []:
            athlete = item.get("athlete") or {}
            raw_status = item.get("status") or item.get("type", {}).get("description") or ""
            reason = (item.get("details") or {}).get("type") or item.get("shortComment") or ""
            out.append({
                "player_id": athlete.get("id"),
                "name": athlete.get("displayName") or athlete.get("fullName"),
                "status": _STATUS_MAP.get(raw_status, raw_status.lower() if raw_status else "questionable"),
                "reason": reason,
                "fetched_at": now,
            })
        return out

    # -------------------------------------------------------------- FotMob
    async def _fetch_fotmob_injuries(self, team_id: str) -> List[Dict[str, Any]]:
        try:
            tid = int(team_id)
        except (TypeError, ValueError):
            return []
        await self._pace()
        try:
            raw = await self._with_retry(lambda: self.fotmob.get_team_injuries(tid))
        except Exception as e:
            logger.debug(f"FotMob injuries {team_id} failed: {e}")
            return []
        if not raw:
            return []
        now = datetime.now(timezone.utc).isoformat()
        return [
            {
                "player_id": r.get("player_id"),
                "name": r.get("player_name"),
                "status": "out",  # FotMob injuryInfo block only surfaces hard injuries.
                "reason": r.get("injury") or "",
                "fetched_at": now,
            }
            for r in raw
        ]

    async def _with_retry(self, call):
        try:
            return await call()
        except httpx.HTTPStatusError as e:
            status = e.response.status_code if e.response is not None else 0
            if 500 <= status < 600:
                await asyncio.sleep(2.0)
                return await call()
            raise

    # --------------------------------------------------------------- public
    async def fetch_team_injuries(
        self,
        team_id: str,
        source: str = "espn",
        league_key: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        cached = self._read_cache(str(team_id))
        if cached and self._is_fresh(cached):
            return cached.get("injuries", [])

        # No cross-source fallback: ESPN and FotMob team ids are different
        # namespaces, so retrying the other provider with the same id can
        # attach another club's injury list (data-provenance violation).
        injuries: List[Dict[str, Any]] = []
        if source == "fotmob":
            injuries = await self._fetch_fotmob_injuries(str(team_id))
        else:
            if source != "espn":
                logger.warning(f"Unknown injury source {source}; defaulting to espn")
            injuries = await self._fetch_espn_injuries(str(team_id), league_key)

        payload = {
            "team_id": str(team_id),
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "source": source,
            "injuries": injuries,
        }
        self._write_cache(str(team_id), payload)
        return injuries

    # ----------------------------------------------- top-scorer cross-ref --
    async def _top_scorers_for_league(self, league_key: str) -> List[Dict]:
        league_id = LEAGUE_IDS.get(league_key)
        if not league_id:
            return []
        try:
            await self._pace()
            data = await self._with_retry(
                lambda: self.fotmob.get_league_top_scorers(league_id)
            )
        except Exception as e:
            logger.debug(f"top scorers fail {league_key}: {e}")
            return []
        return data or []

    @staticmethod
    def _player_in_list(player: Dict, players: List[Dict]) -> bool:
        pid = player.get("player_id") or player.get("id")
        if pid:
            for p in players:
                ppid = p.get("player_id") or p.get("id")
                if ppid and str(ppid) == str(pid):
                    return True
        # Name-fallback (case-insensitive).
        name = (player.get("name") or "").strip().lower()
        if not name:
            return False
        for p in players:
            other = (p.get("name") or "").strip().lower()
            if other and other == name:
                return True
        return False

    async def annotate_lineup(self, lineup: Dict) -> Dict:
        """Populate home/away_missing_top3_scorers using per-team injury data."""
        if not lineup:
            return lineup
        league = lineup.get("league")
        if not league:
            return lineup

        # Fetch top scorers in this league; pick top 3 per team.
        scorers = await self._top_scorers_for_league(league)
        # Group by team_id.
        per_team: Dict[str, List[Dict]] = {}
        for entry in scorers:
            team = entry.get("teamId") or (entry.get("team") or {}).get("id")
            if team is None:
                continue
            per_team.setdefault(str(team), []).append({
                "player_id": entry.get("id") or entry.get("playerId"),
                "name": entry.get("name") or entry.get("playerName"),
                "goals": entry.get("goals") or entry.get("statValue"),
            })

        def _top3(team_id: Optional[str]) -> List[Dict]:
            if not team_id:
                return []
            lst = per_team.get(str(team_id), [])
            # Sort descending by goals if present.
            try:
                lst = sorted(lst, key=lambda p: -(p.get("goals") or 0))
            except Exception:
                pass
            return lst[:3]

        home_team_id = lineup.get("home_team_id")
        away_team_id = lineup.get("away_team_id")

        home_top3 = _top3(home_team_id)
        away_top3 = _top3(away_team_id)

        home_injuries = (
            await self.fetch_team_injuries(str(home_team_id), league_key=league)
            if home_team_id else []
        )
        away_injuries = (
            await self.fetch_team_injuries(str(away_team_id), league_key=league)
            if away_team_id else []
        )

        # A top scorer "is missing" if they are in the team's injury list AND
        # NOT in the starting XI nor bench.
        def _missing(top3: List[Dict], injuries: List[Dict], xi: List[Dict], bench: List[Dict]) -> List[Dict]:
            in_squad = list(xi) + list(bench)
            missing: List[Dict] = []
            for scorer in top3:
                if self._player_in_list(scorer, in_squad):
                    continue
                if self._player_in_list(scorer, injuries):
                    missing.append({
                        "player_id": scorer.get("player_id"),
                        "name": scorer.get("name"),
                        "reason": "injury",
                    })
            return missing

        lineup["home_missing_top3_scorers"] = _missing(
            home_top3, home_injuries,
            lineup.get("home_xi", []), lineup.get("home_bench", []),
        )
        lineup["away_missing_top3_scorers"] = _missing(
            away_top3, away_injuries,
            lineup.get("away_xi", []), lineup.get("away_bench", []),
        )
        return lineup

    # ------------------------------------------------------ stale refresh --
    async def refresh_stale(self) -> int:
        """Re-fetch every cached team whose payload is older than the TTL."""
        if not self.data_dir.exists():
            return 0
        count = 0
        for path in self.data_dir.glob("*.json"):
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if self._is_fresh(payload):
                continue
            team_id = payload.get("team_id") or path.stem
            try:
                await self.fetch_team_injuries(str(team_id))
                count += 1
            except Exception as e:
                logger.warning(f"refresh fail {team_id}: {e}")
        return count

    async def close(self) -> None:
        await cleanup_espn_client()
        await cleanup_fotmob_client()


# Singleton -------------------------------------------------------------------
_tracker: Optional[InjuryTracker] = None


def get_injury_tracker() -> InjuryTracker:
    global _tracker
    if _tracker is None:
        _tracker = InjuryTracker()
    return _tracker


# CLI -------------------------------------------------------------------------
async def _run_cli(args: argparse.Namespace) -> int:
    tracker = get_injury_tracker()
    if args.refresh_stale:
        n = await tracker.refresh_stale()
        logger.info(f"Refreshed {n} stale injury cache file(s)")
    elif args.team_id:
        injuries = await tracker.fetch_team_injuries(
            args.team_id, source=args.source, league_key=args.league
        )
        logger.info(f"Team {args.team_id}: {len(injuries)} injury record(s)")
    else:
        logger.info("Nothing to do; pass --refresh-stale or --team-id <id>")
    await tracker.close()
    return 0


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    parser = argparse.ArgumentParser(description="Free-source injury tracker")
    parser.add_argument("--refresh-stale", action="store_true")
    parser.add_argument("--team-id", type=str)
    parser.add_argument("--source", type=str, default="espn", choices=["espn", "fotmob"])
    parser.add_argument("--league", type=str, default=None)
    args = parser.parse_args()
    asyncio.run(_run_cli(args))


if __name__ == "__main__":
    main()
