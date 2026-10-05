"""
FotMob API Client with rate limiting, caching, and comprehensive endpoints.
"""

import asyncio
import time
from typing import Any, Dict, List, Optional
from datetime import datetime, timedelta
import httpx
from functools import lru_cache
import logging

from backend.config import get_settings, LEAGUE_IDS

logger = logging.getLogger(__name__)


class RateLimiter:
    """Token bucket rate limiter for API requests."""
    
    def __init__(self, requests_per_minute: int = 60):
        self.rate = requests_per_minute / 60.0  # requests per second
        self.tokens = requests_per_minute
        self.max_tokens = requests_per_minute
        self.last_update = time.time()
        self._lock = asyncio.Lock()
    
    async def acquire(self):
        """Acquire a token, waiting if necessary."""
        async with self._lock:
            now = time.time()
            elapsed = now - self.last_update
            self.tokens = min(self.max_tokens, self.tokens + elapsed * self.rate)
            self.last_update = now
            
            if self.tokens < 1:
                wait_time = (1 - self.tokens) / self.rate
                await asyncio.sleep(wait_time)
                self.tokens = 0
            else:
                self.tokens -= 1


class SimpleCache:
    """Simple in-memory cache with TTL."""
    
    def __init__(self):
        self._cache: Dict[str, tuple[Any, float]] = {}
    
    def get(self, key: str) -> Optional[Any]:
        """Get item from cache if not expired."""
        if key in self._cache:
            value, expiry = self._cache[key]
            if time.time() < expiry:
                return value
            del self._cache[key]
        return None
    
    def set(self, key: str, value: Any, ttl: int = 300):
        """Set item in cache with TTL in seconds."""
        self._cache[key] = (value, time.time() + ttl)
    
    def clear(self):
        """Clear all cached items."""
        self._cache.clear()
    
    def remove_expired(self):
        """Remove all expired items."""
        now = time.time()
        self._cache = {k: v for k, v in self._cache.items() if v[1] > now}


class FotMobClient:
    """
    Comprehensive FotMob API client.
    
    Provides access to:
    - Live matches and scores
    - Match details (lineups, events, stats)
    - Team data and statistics
    - Player data and statistics
    - League standings and fixtures
    """
    
    BASE_URL = "https://www.fotmob.com/api"
    
    HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.fotmob.com/",
    }
    
    def __init__(self):
        settings = get_settings()
        self.rate_limiter = RateLimiter(settings.FOTMOB_RATE_LIMIT)
        self.cache = SimpleCache()
        self.default_ttl = settings.FOTMOB_CACHE_TTL
        self.live_ttl = settings.FOTMOB_LIVE_CACHE_TTL
        self._client: Optional[httpx.AsyncClient] = None
    
    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                headers=self.HEADERS,
                timeout=30.0,
                follow_redirects=True
            )
        return self._client
    
    async def close(self):
        """Close the HTTP client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
    
    async def _request(
        self,
        endpoint: str,
        params: Optional[Dict] = None,
        cache_key: Optional[str] = None,
        cache_ttl: Optional[int] = None
    ) -> Optional[Dict]:
        """Make a rate-limited, cached API request."""
        # Check cache first
        if cache_key:
            cached = self.cache.get(cache_key)
            if cached is not None:
                logger.debug(f"Cache hit for {cache_key}")
                return cached
        
        # Rate limit
        await self.rate_limiter.acquire()
        
        try:
            client = await self._get_client()
            url = f"{self.BASE_URL}/{endpoint}"
            response = await client.get(url, params=params)
            response.raise_for_status()
            data = response.json()
            
            # Cache the response
            if cache_key:
                ttl = cache_ttl or self.default_ttl
                self.cache.set(cache_key, data, ttl)
            
            return data
            
        except httpx.HTTPStatusError as e:
            logger.error(f"HTTP error {e.response.status_code} for {endpoint}: {e}")
            return None
        except httpx.RequestError as e:
            logger.error(f"Request error for {endpoint}: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error for {endpoint}: {e}")
            return None
    
    # ==================== MATCH ENDPOINTS ====================
    
    async def get_matches_by_date(self, date: str) -> Optional[Dict]:
        """
        Get all matches for a specific date.
        
        Args:
            date: Date in YYYYMMDD format
            
        Returns:
            Dict with leagues and their matches
        """
        cache_key = f"matches_date_{date}"
        # Use shorter TTL for today's matches
        today = datetime.now().strftime("%Y%m%d")
        ttl = self.live_ttl if date == today else self.default_ttl
        
        return await self._request(
            "matches",
            params={"date": date},
            cache_key=cache_key,
            cache_ttl=ttl
        )
    
    async def get_match_details(self, match_id: int) -> Optional[Dict]:
        """
        Get detailed information about a specific match.
        
        Returns:
            - Match header (teams, score, status)
            - Match events (goals, cards, subs)
            - Lineups and formations
            - Match stats
            - Head-to-head history
        """
        cache_key = f"match_{match_id}"
        return await self._request(
            "matchDetails",
            params={"matchId": match_id},
            cache_key=cache_key,
            cache_ttl=self.live_ttl  # Always use short TTL for match details
        )
    
    async def get_live_matches(self) -> List[Dict]:
        """Get all currently live matches."""
        today = datetime.now().strftime("%Y%m%d")
        data = await self.get_matches_by_date(today)
        
        if not data or "leagues" not in data:
            return []
        
        live_matches = []
        for league in data["leagues"]:
            for match in league.get("matches", []):
                status = match.get("status", {})
                if status.get("started") and not status.get("finished"):
                    match["league"] = {
                        "id": league.get("id"),
                        "name": league.get("name"),
                        "country": league.get("ccode")
                    }
                    live_matches.append(match)
        
        return live_matches
    
    async def get_upcoming_matches(self, days: int = 7) -> List[Dict]:
        """Get upcoming matches for the next N days."""
        matches = []
        
        for i in range(days):
            date = (datetime.now() + timedelta(days=i)).strftime("%Y%m%d")
            data = await self.get_matches_by_date(date)
            
            if data and "leagues" in data:
                for league in data["leagues"]:
                    for match in league.get("matches", []):
                        status = match.get("status", {})
                        if not status.get("started"):
                            match["league"] = {
                                "id": league.get("id"),
                                "name": league.get("name"),
                                "country": league.get("ccode")
                            }
                            match["date"] = date
                            matches.append(match)
        
        return matches
    
    # ==================== LEAGUE ENDPOINTS ====================
    
    async def get_league(self, league_id: int) -> Optional[Dict]:
        """
        Get league information including standings and fixtures.
        """
        cache_key = f"league_{league_id}"
        return await self._request(
            "leagues",
            params={"id": league_id},
            cache_key=cache_key
        )
    
    async def get_league_matches(
        self,
        league_id: int,
        season: Optional[str] = None
    ) -> Optional[List[Dict]]:
        """Get all matches for a league in a season."""
        cache_key = f"league_matches_{league_id}_{season or 'current'}"
        params = {"id": league_id}
        if season:
            params["season"] = season
        
        data = await self._request(
            "leagues",
            params=params,
            cache_key=cache_key
        )
        
        if data:
            # Matches are under fixtures.allMatches in FotMob API
            return data.get("fixtures", {}).get("allMatches", [])
        return None
    
    async def get_league_standings(self, league_id: int) -> Optional[List[Dict]]:
        """Get current standings for a league."""
        data = await self.get_league(league_id)
        
        if data and "table" in data:
            tables = data["table"]
            if isinstance(tables, list) and len(tables) > 0:
                return tables[0].get("data", {}).get("table", {}).get("all", [])
        return None
    
    async def get_league_top_scorers(self, league_id: int) -> Optional[List[Dict]]:
        """Get top scorers for a league."""
        cache_key = f"league_scorers_{league_id}"
        data = await self._request(
            "leagueseasondeepstats",
            params={"id": league_id, "type": "scorers"},
            cache_key=cache_key
        )
        
        if data:
            return data.get("data", [])
        return None
    
    # ==================== TEAM ENDPOINTS ====================
    
    async def get_team(self, team_id: int) -> Optional[Dict]:
        """
        Get team information including:
        - Team details
        - Current squad
        - Recent fixtures
        - Team stats
        """
        cache_key = f"team_{team_id}"
        return await self._request(
            "teams",
            params={"id": team_id},
            cache_key=cache_key
        )
    
    async def get_team_fixtures(self, team_id: int) -> Optional[List[Dict]]:
        """Get team's fixtures (past and upcoming)."""
        data = await self.get_team(team_id)
        
        if data and "fixtures" in data:
            return data["fixtures"].get("allFixtures", {}).get("fixtures", [])
        return None
    
    async def get_team_squad(self, team_id: int) -> Optional[List[Dict]]:
        """Get team's current squad."""
        data = await self.get_team(team_id)
        
        if data and "squad" in data:
            return data["squad"]
        return None
    
    async def get_team_form(self, team_id: int, num_matches: int = 5) -> List[str]:
        """
        Get team's recent form (W/D/L).
        
        Returns list like ['W', 'W', 'D', 'L', 'W']
        """
        fixtures = await self.get_team_fixtures(team_id)
        
        if not fixtures:
            return []
        
        form = []
        for fixture in fixtures:
            if fixture.get("notStarted"):
                continue
            
            home_score = fixture.get("home", {}).get("score")
            away_score = fixture.get("away", {}).get("score")
            is_home = fixture.get("home", {}).get("id") == team_id
            
            if home_score is None or away_score is None:
                continue
            
            if is_home:
                if home_score > away_score:
                    form.append("W")
                elif home_score < away_score:
                    form.append("L")
                else:
                    form.append("D")
            else:
                if away_score > home_score:
                    form.append("W")
                elif away_score < home_score:
                    form.append("L")
                else:
                    form.append("D")
            
            if len(form) >= num_matches:
                break
        
        return form[:num_matches]
    
    # ==================== PLAYER ENDPOINTS ====================
    
    async def get_player(self, player_id: int) -> Optional[Dict]:
        """
        Get player information including:
        - Player details
        - Career history
        - Current season stats
        """
        cache_key = f"player_{player_id}"
        return await self._request(
            "playerData",
            params={"id": player_id},
            cache_key=cache_key
        )
    
    async def get_player_season_stats(self, player_id: int) -> Optional[Dict]:
        """Get player's current season statistics."""
        data = await self.get_player(player_id)
        
        if data:
            return data.get("mainLeague", {}).get("stats", {})
        return None
    
    # ==================== SEARCH ENDPOINTS ====================
    
    async def search(self, query: str) -> Optional[Dict]:
        """
        Search for teams, players, and competitions.
        """
        cache_key = f"search_{query.lower().replace(' ', '_')}"
        return await self._request(
            "searchapi/suggest",
            params={"term": query, "lang": "en"},
            cache_key=cache_key
        )
    
    async def search_team(self, query: str) -> Optional[List[Dict]]:
        """Search for teams by name."""
        data = await self.search(query)
        
        if data:
            return [
                r for r in data.get("squadSuggestion", [])
            ]
        return None
    
    # ==================== HEAD-TO-HEAD ====================
    
    async def get_h2h(self, match_id: int) -> Optional[Dict]:
        """Get head-to-head history from match details."""
        data = await self.get_match_details(match_id)
        
        if data and "h2h" in data.get("content", {}):
            return data["content"]["h2h"]
        return None
    
    # ==================== INJURIES ====================
    
    async def get_team_injuries(self, team_id: int) -> Optional[List[Dict]]:
        """Get team's current injuries and suspensions."""
        data = await self.get_team(team_id)
        
        if data and "squad" in data:
            injuries = []
            # Squad structure is nested: squad.squad contains list of position groups
            squad_data = data.get("squad", {})
            if not isinstance(squad_data, dict) or not isinstance(squad_data.get("squad"), list):
                return None
            if isinstance(squad_data, dict):
                squad_list = squad_data.get("squad", [])
                for position_group in squad_list:
                    if not isinstance(position_group, list) or any(not isinstance(p, dict) for p in position_group):
                        return None
                    if isinstance(position_group, list):
                        for player in position_group:
                            if isinstance(player, dict) and player.get("injuryInfo"):
                                injuries.append({
                                    "player_id": player.get("id"),
                                    "player_name": player.get("name"),
                                    "injury": player.get("injuryInfo", {}).get("description"),
                                    "expected_return": player.get("injuryInfo", {}).get("expectedReturn"),
                                })
            return injuries
        return None


# Singleton instance
_client: Optional[FotMobClient] = None


def get_fotmob_client() -> FotMobClient:
    """Get or create FotMob client singleton."""
    global _client
    if _client is None:
        _client = FotMobClient()
    return _client


async def cleanup_fotmob_client():
    """Cleanup the FotMob client."""
    global _client
    if _client:
        await _client.close()
        _client = None
