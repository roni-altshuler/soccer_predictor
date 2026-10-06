"""
Injury Tracker - free-source team injury report scraping.

Sources (free/public only):
  - ESPN team injuries endpoint (via existing ESPNClient HTTP layer)
  - FotMob team injuries (already exposed as FotMobClient.get_team_injuries)

Cache: backend/data/injuries/<team_id>.json with a 6-hour TTL.
Provider failures raise ProviderUnavailable and leave last-good cache bytes
and timestamps intact. An explicit, validated empty report is a successful [];
availability is recorded separately in <team_id>.status.json.
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
from backend.services.data.provider_status import ProviderUnavailable, observation_time, valid_player_identity, write_json_atomic
from backend.services.data.injury_diagnostics import (
    InjuryDiagnostics, InjuryReportFailure, failure_metadata,
)
from backend.services.data.injury_routing import DEFAULT_ROUTES_PATH, resolve_injury_league

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

    def __init__(self, data_dir: Optional[Path] = None, routes_path: Optional[Path] = None):
        self.data_dir = data_dir or INJURIES_DATA_DIR
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.espn = get_espn_client()
        self.fotmob = get_fotmob_client()
        self._last_request_ts: float = 0.0
        self._pace_lock = asyncio.Lock()
        self.diagnostics = InjuryDiagnostics()
        self.routes_path = routes_path if routes_path is not None else DEFAULT_ROUTES_PATH

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
            payload = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(payload, dict) or not isinstance(payload.get("injuries"), list):
                raise ValueError("Injury cache must contain an injuries list")
            return payload
        except (OSError, ValueError) as e:
            logger.warning(f"Injury cache read fail {path}: {e}")
            return None

    def _write_cache(self, team_id: str, payload: Dict) -> None:
        write_json_atomic(self._cache_path(team_id), payload)

    def _write_status(self, team_id: str, source: str, availability: str,
                      cached: Optional[Dict], error: Optional[str] = None,
                      diagnostics: Optional[List[Dict]] = None) -> None:
        try:
            last_good_time = observation_time((cached or {}).get("fetched_at")).isoformat()
        except ProviderUnavailable:
            last_good_time = None
        write_json_atomic(self.data_dir / f"{team_id}.status.json", {
            "team_id": team_id, "source": source, "availability": availability,
            "checked_at": datetime.now(timezone.utc).isoformat(),
            "last_good_fetched_at": last_good_time, "error": error,
            "diagnostics": diagnostics or [],
        })

    def _record(self, source, team_id, league_key, reason, detail=None, http_status=None, records=None):
        record = self.diagnostics.record(source, team_id, league_key, reason, detail, http_status)
        if records is not None:
            records.append(record)

    @staticmethod
    def _is_fresh(payload: Dict) -> bool:
        ts_str = payload.get("fetched_at")
        if not ts_str:
            return False
        try:
            ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        except (ValueError, TypeError, AttributeError):
            return False
        if ts.tzinfo is None:
            return False
        return (datetime.now(timezone.utc) - ts).total_seconds() < INJURY_TTL_SECONDS

    # ---------------------------------------------------------------- ESPN
    async def _fetch_espn_injuries(
        self, team_id: str, league_key: Optional[str] = None, diagnostics=None,
    ) -> List[Dict[str, Any]]:
        """Hit ESPN's public team-injuries endpoint via the shared client."""
        # The caller supplies validated explicit or repository-backed context.
        # Missing context must never expand into an all-league search.
        if not isinstance(league_key, str) or league_key not in ESPN_LEAGUE_IDS:
            self._record("espn", team_id, league_key, "invalid_context", "unknown_league", records=diagnostics)
            raise InjuryReportFailure("invalid_context", "unknown_league")
        endpoint = f"{ESPN_LEAGUE_IDS[league_key]}/teams/{team_id}/injuries"
        cache_key = f"espn_injuries_{team_id}_{league_key}"
        await self._pace()
        try:
            data = await self._with_retry(
                lambda: self.espn._request(  # noqa: SLF001 (intentional reuse)
                    endpoint, cache_key=cache_key, cache_ttl=INJURY_TTL_SECONDS, raise_errors=True,
                )
            )
        except Exception as exc:
            reason, detail, status = failure_metadata(exc)
            self._record("espn", team_id, league_key, reason, detail, status, diagnostics)
            raise
        # Preserve the report contract: absent content is unavailable, never
        # a fresh empty observation. Parsing and endpoints are unchanged.
        try:
            injuries = self._parse_espn_injuries(data)
        except InjuryReportFailure as exc:
            self._record("espn", team_id, league_key, exc.reason, exc.detail, records=diagnostics)
            raise
        self._record("espn", team_id, league_key, "available", records=diagnostics)
        return injuries

    @staticmethod
    def _parse_espn_injuries(data: Dict) -> List[Dict[str, Any]]:
        if not isinstance(data, dict):
            raise InjuryReportFailure("invalid_schema", "root_non_object")
        if "injuries" not in data:
            raise InjuryReportFailure("missing_injury_content")
        if data["injuries"] is None:
            raise InjuryReportFailure("invalid_schema", "injuries_null")
        if not isinstance(data["injuries"], list):
            raise InjuryReportFailure("invalid_schema", "injuries_non_list")
        out: List[Dict[str, Any]] = []
        now = datetime.now(timezone.utc).isoformat()
        for item in data["injuries"]:
            if not isinstance(item, dict):
                raise InjuryReportFailure("malformed_entries", "entry_non_object")
            if not isinstance(item.get("athlete"), dict):
                raise InjuryReportFailure("malformed_entries", "athlete_missing")
            athlete = item.get("athlete") or {}
            if not valid_player_identity(athlete, "id", "displayName", "fullName"):
                raise InjuryReportFailure("malformed_entries", "athlete_identity")
            type_info = item.get("type")
            details = item.get("details")
            if type_info is not None and not isinstance(type_info, dict):
                raise InjuryReportFailure("malformed_entries", "invalid_type")
            if details is not None and not isinstance(details, dict):
                raise InjuryReportFailure("malformed_entries", "invalid_details")
            for value in (item.get("status"), (type_info or {}).get("description")):
                if value is not None and not isinstance(value, str):
                    raise InjuryReportFailure("malformed_entries", "invalid_status")
            for value in ((details or {}).get("type"), item.get("shortComment")):
                if value is not None and not isinstance(value, str):
                    raise InjuryReportFailure("malformed_entries", "invalid_reason")
            raw_status = item.get("status") or (type_info or {}).get("description") or ""
            reason = (details or {}).get("type") or item.get("shortComment") or ""
            out.append({
                "player_id": athlete.get("id"),
                "name": athlete.get("displayName") or athlete.get("fullName"),
                "status": _STATUS_MAP.get(raw_status, raw_status.lower() if raw_status else "questionable"),
                "reason": reason,
                "fetched_at": now,
            })
        return out

    # -------------------------------------------------------------- FotMob
    async def _fetch_fotmob_injuries(self, team_id: str, diagnostics=None) -> List[Dict[str, Any]]:
        try:
            tid = int(team_id)
        except (TypeError, ValueError):
            self._record("fotmob", team_id, None, "invalid_context", records=diagnostics)
            raise ProviderUnavailable(f"Invalid FotMob team id: {team_id}")
        await self._pace()
        try:
            raw = await self._with_retry(lambda: self.fotmob.get_team_injuries(tid))
        except Exception as exc:
            reason, detail, status = failure_metadata(exc)
            self._record("fotmob", team_id, None, reason, detail, status, diagnostics)
            raise InjuryReportFailure(reason, detail) from exc
        if not isinstance(raw, list) or any(
            not isinstance(r, dict) or not valid_player_identity(r, "player_id", "player_name") for r in raw
        ):
            reason = "unavailable" if raw is None else "invalid_schema" if not isinstance(raw, list) else "malformed_entries"
            self._record("fotmob", team_id, None, reason, records=diagnostics)
            raise InjuryReportFailure(reason)
        self._record("fotmob", team_id, None, "available", records=diagnostics)
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
        if not isinstance(source, str) or source not in {"espn", "fotmob"}:
            self._record(source, team_id, league_key, "invalid_context", "unknown_provider")
            raise ValueError("Unknown injury source")
        if cached and cached.get("source") == source and self._is_fresh(cached):
            return cached.get("injuries", [])

        # No cross-source fallback: ESPN and FotMob team ids are different
        # namespaces, so retrying the other provider with the same id can
        # attach another club's injury list (data-provenance violation).
        diagnostics = []
        try:
            if source == "fotmob":
                injuries = await self._fetch_fotmob_injuries(str(team_id), diagnostics)
            else:
                if league_key is None and cached and cached.get("source") == source:
                    league_key = cached.get("league_key")
                league_key = resolve_injury_league(source, str(team_id), league_key, self.routes_path)
                injuries = await self._fetch_espn_injuries(str(team_id), league_key, diagnostics)
        except Exception as exc:
            reason, detail, status = failure_metadata(exc)
            if not diagnostics:
                self._record(source, team_id, league_key, reason, detail, status, diagnostics)
            try:
                self._write_status(str(team_id), source, "unavailable", cached, reason, diagnostics)
            except OSError:
                self._record(source, team_id, league_key, "status_write_error")
                logger.warning("Could not record injury provider availability")
            raise ProviderUnavailable(f"{source} injuries unavailable for team {team_id}") from exc

        payload = {
            "team_id": str(team_id),
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "source": source,
            "league_key": league_key,
            "injuries": injuries,
        }
        try:
            self._write_cache(str(team_id), payload)
        except OSError:
            self._record(source, team_id, league_key, "cache_write_error")
            raise
        try:
            self._write_status(str(team_id), source, "available", payload, diagnostics=diagnostics)
        except OSError:
            self._record(source, team_id, league_key, "status_write_error")
            raise
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
        failures = []
        for path in self.data_dir.glob("*.json"):
            if path.name.endswith(".status.json"):
                continue
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
                if not isinstance(payload, dict):
                    raise ValueError("Injury cache must be an object")
            except (OSError, ValueError):
                self._record("unknown", path.stem, None, "invalid_cache")
                failures.append(path.stem)
                logger.warning("Invalid injury cache")
                continue
            if self._is_fresh(payload):
                continue
            team_id = payload.get("team_id", path.stem)
            if not isinstance(team_id, str) or team_id != path.stem:
                self._record(payload.get("source"), path.stem, None, "invalid_context", "invalid_team_identity")
                failures.append(path.stem)
                continue
            try:
                await self.fetch_team_injuries(team_id, source=payload.get("source"),
                                               league_key=payload.get("league_key"))
                count += 1
            except Exception as exc:
                logger.warning("Injury cache refresh unavailable (%s)", failure_metadata(exc)[0])
                failures.append(str(team_id))
        if failures:
            raise ProviderUnavailable(f"Failed to refresh {len(failures)} injury cache(s): {', '.join(failures)}")
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
    tracker = None
    diagnostics = InjuryDiagnostics()
    diagnostic_path = getattr(args, "diagnostics_path", None)
    result = 1
    try:
        tracker = get_injury_tracker()
        # CLI artifacts describe this invocation, not earlier use of a
        # singleton in the same process. This does not alter the data cache.
        tracker.diagnostics = diagnostics
        if diagnostic_path:
            diagnostics.set_output(Path(diagnostic_path))
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
        result = 0
    except Exception as exc:
        if tracker is None:
            diagnostics.record(args.source, args.team_id, args.league, "initialization_error")
        logger.error("Injury refresh failed (%s)", failure_metadata(exc)[0])
    finally:
        if tracker is not None:
            try:
                await tracker.close()
            except Exception:
                diagnostics.record(args.source, args.team_id, args.league, "cleanup_error")
                result = 1
                logger.warning("Injury client cleanup failed")
        if diagnostic_path:
            try:
                diagnostics.write(Path(diagnostic_path))
            except (OSError, ValueError):
                # Delivery of diagnostics must not mask a failed refresh or
                # make unavailable provider data eligible for publication.
                logger.warning("Could not retain injury diagnostics")
    return result


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    parser = argparse.ArgumentParser(description="Free-source injury tracker")
    parser.add_argument("--refresh-stale", action="store_true")
    parser.add_argument("--team-id", type=str)
    parser.add_argument("--source", type=str, default="espn", choices=["espn", "fotmob"])
    parser.add_argument("--league", type=str, default=None)
    parser.add_argument("--diagnostics-path", type=Path, help="Write sanitized current-run metadata outside the data cache")
    args = parser.parse_args()
    return asyncio.run(_run_cli(args))


if __name__ == "__main__":
    raise SystemExit(main())
