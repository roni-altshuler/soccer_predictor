"""
Historical Match Data Collection and Processing.

Fetches and organizes historical match data from ESPN and FotMob
for training the ML prediction model on past seasons.
Supports scalable ingestion of multi-season data across all leagues.
"""

import asyncio
import json
import os
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime, timedelta
from pathlib import Path
import logging
import httpx

logger = logging.getLogger(__name__)

# Directory for cached historical data
HISTORICAL_DATA_DIR = Path(__file__).parent.parent.parent / "data" / "historical"


# ESPN season archive endpoints (publicly available)
ESPN_BASE = "https://site.api.espn.com/apis"
ESPN_LEAGUES = {
    "premier_league": "eng.1",
    "la_liga": "esp.1",
    "bundesliga": "ger.1",
    "serie_a": "ita.1",
    "ligue_1": "fra.1",
    "eredivisie": "ned.1",
    "primeira_liga": "por.1",
    "mls": "usa.1",
    "champions_league": "uefa.champions",
    "europa_league": "uefa.europa",
}

# Available seasons per league (ESPN archive depth varies)
AVAILABLE_SEASONS = {
    "premier_league": list(range(2015, 2026)),   # 2015-16 through 2025-26
    "la_liga": list(range(2015, 2026)),
    "bundesliga": list(range(2015, 2026)),
    "serie_a": list(range(2015, 2026)),
    "ligue_1": list(range(2015, 2026)),
    "eredivisie": list(range(2017, 2026)),
    "primeira_liga": list(range(2017, 2026)),
    "mls": list(range(2018, 2026)),
    "champions_league": list(range(2016, 2026)),
    "europa_league": list(range(2016, 2026)),
}


class HistoricalMatch:
    """Represents a single historical match with all features."""

    __slots__ = [
        "match_id", "league", "season", "date",
        "home_team", "away_team",
        "home_score", "away_score",
        "home_elo_pre", "away_elo_pre",
        "home_form", "away_form",
        "home_goals_avg", "away_goals_avg",
        "home_conceded_avg", "away_conceded_avg",
        "home_home_win_pct", "away_away_win_pct",
        "venue", "attendance",
        "matchday", "total_matchdays",
        "home_position", "away_position",
        "is_derby",
    ]

    def __init__(self, **kwargs):
        for slot in self.__slots__:
            setattr(self, slot, kwargs.get(slot))

    def to_dict(self) -> Dict[str, Any]:
        return {s: getattr(self, s) for s in self.__slots__}

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "HistoricalMatch":
        return cls(**{k: v for k, v in data.items() if k in cls.__slots__})


class HistoricalDataCollector:
    """
    Collects and caches historical match data across multiple seasons.
    
    Data is persisted to disk as JSON so it only needs to be fetched once.
    Supports incremental updates for the current season.
    """

    def __init__(self, data_dir: Optional[Path] = None):
        self.data_dir = data_dir or HISTORICAL_DATA_DIR
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=30.0,
                headers={"User-Agent": "SoccerPredictor/3.0"},
                follow_redirects=True,
            )
        return self._client

    async def close(self):
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    def _cache_path(self, league: str, season: int) -> Path:
        return self.data_dir / f"{league}_{season}_{season + 1}.json"

    def _is_cached(self, league: str, season: int) -> bool:
        path = self._cache_path(league, season)
        if not path.exists():
            return False
        # For current season, re-fetch if older than 1 day
        current_year = datetime.now().year
        if season >= current_year - 1:
            mtime = datetime.fromtimestamp(path.stat().st_mtime)
            if (datetime.now() - mtime).days > 1:
                return False
        return True

    async def fetch_season_matches(
        self, league: str, season: int, force: bool = False
    ) -> List[Dict[str, Any]]:
        """
        Fetch all matches for a league season from ESPN.
        
        Args:
            league: League key (e.g., 'premier_league')
            season: Start year of season (e.g., 2023 for 2023-24)
            force: Force re-fetch even if cached
        
        Returns:
            List of match dictionaries
        """
        if not force and self._is_cached(league, season):
            return self._load_cache(league, season)

        espn_id = ESPN_LEAGUES.get(league)
        if not espn_id:
            logger.warning(f"Unknown league: {league}")
            return []

        client = await self._get_client()
        all_matches = []

        try:
            # ESPN scoreboard with season filter — paginate by date range
            # Each season roughly spans Aug-May (or Feb-Nov for MLS)
            if league == "mls":
                start_date = datetime(season, 2, 1)
                end_date = datetime(season, 12, 15)
            else:
                start_date = datetime(season, 8, 1)
                end_date = datetime(season + 1, 6, 30)

            current = start_date
            while current <= end_date:
                date_str = current.strftime("%Y%m%d")
                url = (
                    f"{ESPN_BASE}/site/v2/sports/soccer/{espn_id}/scoreboard"
                    f"?dates={date_str}&limit=100"
                )

                try:
                    resp = await client.get(url)
                    if resp.status_code == 200:
                        data = resp.json()
                        events = data.get("events", [])
                        for event in events:
                            match = self._parse_espn_event(event, league, season)
                            if match:
                                all_matches.append(match)
                except Exception as e:
                    logger.debug(f"Error fetching {league} {date_str}: {e}")

                # Move forward by 7 days to reduce API calls
                current += timedelta(days=7)
                # Small delay to respect rate limits
                await asyncio.sleep(0.15)

            # Deduplicate by match_id
            seen = set()
            unique_matches = []
            for m in all_matches:
                mid = m.get("match_id")
                if mid and mid not in seen:
                    seen.add(mid)
                    unique_matches.append(m)

            # Cache results
            self._save_cache(league, season, unique_matches)
            logger.info(
                f"Fetched {len(unique_matches)} matches for {league} {season}/{season+1}"
            )
            return unique_matches

        except Exception as e:
            logger.error(f"Error fetching {league} season {season}: {e}")
            # Return cached data if available
            return self._load_cache(league, season)

    def _parse_espn_event(
        self, event: Dict, league: str, season: int
    ) -> Optional[Dict[str, Any]]:
        """Parse an ESPN event into a standardized match dict."""
        try:
            competition = event.get("competitions", [{}])[0]
            status = competition.get("status", {}).get("type", {})

            # Only include completed matches
            if not status.get("completed", False):
                return None

            competitors = competition.get("competitors", [])
            if len(competitors) < 2:
                return None

            home = next(
                (c for c in competitors if c.get("homeAway") == "home"), None
            )
            away = next(
                (c for c in competitors if c.get("homeAway") == "away"), None
            )
            if not home or not away:
                return None

            home_score = int(home.get("score", "0"))
            away_score = int(away.get("score", "0"))

            # Determine result
            if home_score > away_score:
                result = "H"
            elif away_score > home_score:
                result = "A"
            else:
                result = "D"

            venue = competition.get("venue", {})

            return {
                "match_id": str(event.get("id", "")),
                "league": league,
                "season": season,
                "date": event.get("date", ""),
                "home_team": home.get("team", {}).get("displayName", ""),
                "away_team": away.get("team", {}).get("displayName", ""),
                "home_team_id": home.get("team", {}).get("id", ""),
                "away_team_id": away.get("team", {}).get("id", ""),
                "home_score": home_score,
                "away_score": away_score,
                "result": result,
                "venue": venue.get("fullName", ""),
                "attendance": venue.get("capacity"),
                "matchday": event.get("week", {}).get("number"),
            }
        except Exception as e:
            logger.debug(f"Error parsing ESPN event: {e}")
            return None

    def _save_cache(
        self, league: str, season: int, matches: List[Dict]
    ):
        """Save matches to cache file."""
        path = self._cache_path(league, season)
        try:
            with open(path, "w") as f:
                json.dump(
                    {
                        "league": league,
                        "season": f"{season}/{season + 1}",
                        "fetched_at": datetime.utcnow().isoformat(),
                        "match_count": len(matches),
                        "matches": matches,
                    },
                    f,
                    indent=2,
                )
        except Exception as e:
            logger.error(f"Error saving cache: {e}")

    def _load_cache(self, league: str, season: int) -> List[Dict]:
        """Load matches from cache file."""
        path = self._cache_path(league, season)
        if not path.exists():
            return []
        try:
            with open(path, "r") as f:
                data = json.load(f)
                return data.get("matches", [])
        except Exception as e:
            logger.error(f"Error loading cache: {e}")
            return []

    async def fetch_all_historical_data(
        self,
        leagues: Optional[List[str]] = None,
        min_season: int = 2018,
        force: bool = False,
    ) -> Dict[str, List[Dict]]:
        """
        Fetch historical data across all leagues and seasons.
        
        Args:
            leagues: List of league keys (None = all)
            min_season: Earliest season to fetch
            force: Force re-fetch
        
        Returns:
            Dict mapping league -> list of all matches
        """
        target_leagues = leagues or list(ESPN_LEAGUES.keys())
        all_data: Dict[str, List[Dict]] = {}

        for league in target_leagues:
            available = AVAILABLE_SEASONS.get(league, [])
            seasons = [s for s in available if s >= min_season]
            league_matches = []

            for season in seasons:
                matches = await self.fetch_season_matches(league, season, force)
                league_matches.extend(matches)

            all_data[league] = league_matches
            logger.info(
                f"Collected {len(league_matches)} total matches for {league}"
            )

        return all_data

    def get_cached_match_count(self) -> Dict[str, int]:
        """Get count of cached matches per league."""
        counts: Dict[str, int] = {}
        for path in self.data_dir.glob("*.json"):
            try:
                with open(path) as f:
                    data = json.load(f)
                    league = data.get("league", "unknown")
                    count = data.get("match_count", 0)
                    counts[league] = counts.get(league, 0) + count
            except Exception:
                continue
        return counts

    def load_all_cached_matches(
        self, leagues: Optional[List[str]] = None
    ) -> List[Dict]:
        """Load all cached historical matches into a flat list."""
        target = leagues or list(ESPN_LEAGUES.keys())
        all_matches = []

        for path in sorted(self.data_dir.glob("*.json")):
            try:
                with open(path) as f:
                    data = json.load(f)
                    league = data.get("league", "")
                    if league in target:
                        all_matches.extend(data.get("matches", []))
            except Exception:
                continue

        return all_matches


# Singleton
_collector: Optional[HistoricalDataCollector] = None


def get_historical_collector() -> HistoricalDataCollector:
    """Get or create historical data collector singleton."""
    global _collector
    if _collector is None:
        _collector = HistoricalDataCollector()
    return _collector
