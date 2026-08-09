"""
ESPN API Client for live scores, match statistics, and team data.

The ESPN API provides real-time soccer data including:
- Live match scores and events
- Team and player statistics
- League standings
- Match schedules
"""

import asyncio
import time
from typing import Any, Dict, List, Optional
from datetime import datetime, timedelta
import httpx
import logging

from backend.config import get_settings, LEAGUE_IDS

logger = logging.getLogger(__name__)


# ESPN League ID mappings (different from FotMob)
ESPN_LEAGUE_IDS = {
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
    "conference_league": "uefa.europa.conf",
    "world_cup": "fifa.world",
    "euro": "uefa.euro",
    "copa_america": "conmebol.america",
}


class RateLimiter:
    """Token bucket rate limiter for API requests."""
    
    def __init__(self, requests_per_minute: int = 30):
        self.rate = requests_per_minute / 60.0
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
        if key in self._cache:
            value, expiry = self._cache[key]
            if time.time() < expiry:
                return value
            del self._cache[key]
        return None
    
    def set(self, key: str, value: Any, ttl: int = 300):
        self._cache[key] = (value, time.time() + ttl)
    
    def clear(self):
        self._cache.clear()


class ESPNClient:
    """
    ESPN API client for soccer data.
    
    Provides access to:
    - Live scores and match events
    - Match statistics and details
    - Team information and standings
    - League schedules and news
    """
    
    # `site.web.api`, NOT `site.api`. The two hosts serve byte-identical
    # payloads, but Akamai answers `site.api.espn.com` with 403 Access Denied
    # from datacentre IPs (Vercel, GitHub Actions) and its error page carries
    # no CORS headers. Measured 2026-08-08: every `site.api` request from this
    # machine returned 403 while the identical path on `site.web.api` returned
    # 200 with `access-control-allow-origin: *`. Mirrored in src/lib/espnHost.ts.
    BASE_URL = "https://site.web.api.espn.com/apis/site/v2/sports/soccer"

    HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
        "Accept-Language": "en-US,en;q=0.9",
    }
    
    def __init__(self):
        self.rate_limiter = RateLimiter(30)  # 30 requests per minute
        self.cache = SimpleCache()
        self.default_ttl = 300  # 5 minutes
        self.live_ttl = 30  # 30 seconds for live data
        self._client: Optional[httpx.AsyncClient] = None
    
    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client.

        Recreated when the running event loop changes: sync entry points
        (simulators, CLI scripts) each spin up their own short-lived loop,
        and an AsyncClient bound to a closed loop fails every request with
        "Event loop is closed" without ever reporting itself as closed.
        """
        loop = asyncio.get_running_loop()
        if (
            self._client is None
            or self._client.is_closed
            or getattr(self, "_client_loop", None) is not loop
        ):
            self._client = httpx.AsyncClient(
                headers=self.HEADERS,
                timeout=30.0,
                follow_redirects=True
            )
            self._client_loop = loop
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
        if cache_key:
            cached = self.cache.get(cache_key)
            if cached is not None:
                logger.debug(f"ESPN cache hit for {cache_key}")
                return cached
        
        await self.rate_limiter.acquire()
        
        try:
            client = await self._get_client()
            # Absolute URLs pass through unchanged so callers can reach ESPN's
            # other hosts (sports.core.api / site.web.api) via the same
            # rate-limited, cached layer.
            url = endpoint if endpoint.startswith("http") else f"{self.BASE_URL}/{endpoint}"
            response = await client.get(url, params=params)
            response.raise_for_status()
            data = response.json()
            
            if cache_key:
                ttl = cache_ttl or self.default_ttl
                self.cache.set(cache_key, data, ttl)
            
            return data
            
        except httpx.HTTPStatusError as e:
            logger.error(f"ESPN HTTP error {e.response.status_code} for {endpoint}: {e}")
            return None
        except httpx.RequestError as e:
            logger.error(f"ESPN request error for {endpoint}: {e}")
            return None
        except Exception as e:
            logger.error(f"ESPN unexpected error for {endpoint}: {e}")
            return None
    
    def _get_espn_league_id(self, league_key: str) -> Optional[str]:
        """Convert internal league key to ESPN league ID."""
        return ESPN_LEAGUE_IDS.get(league_key)
    
    # ==================== SCOREBOARD/MATCHES ====================
    
    async def get_scoreboard(
        self,
        league_key: str,
        date: Optional[str] = None
    ) -> Optional[Dict]:
        """
        Get scoreboard (live scores) for a league.
        
        Args:
            league_key: Internal league key (e.g., 'premier_league')
            date: Date in YYYYMMDD format (optional, defaults to today)
        
        Returns:
            Dict with events (matches) data
        """
        espn_id = self._get_espn_league_id(league_key)
        if not espn_id:
            logger.warning(f"Unknown league key for ESPN: {league_key}")
            return None
        
        endpoint = f"{espn_id}/scoreboard"
        params = {}
        if date:
            params["dates"] = date
        
        cache_key = f"espn_scoreboard_{league_key}_{date or 'today'}"
        return await self._request(endpoint, params, cache_key, self.live_ttl)
    
    async def get_live_matches(self, league_key: Optional[str] = None) -> List[Dict]:
        """
        Get currently live matches.
        
        Args:
            league_key: Optional league filter
        
        Returns:
            List of live match data
        """
        leagues = [league_key] if league_key else list(ESPN_LEAGUE_IDS.keys())
        live_matches = []
        
        for league in leagues:
            data = await self.get_scoreboard(league)
            if not data or "events" not in data:
                continue
            
            for event in data["events"]:
                status = event.get("status", {})
                status_type = status.get("type", {})
                
                # Check if match is live (in progress)
                if status_type.get("state") == "in":
                    live_matches.append(self._transform_match(event, league))
        
        return live_matches
    
    async def get_todays_matches(self, league_key: Optional[str] = None) -> List[Dict]:
        """Get all matches for today."""
        today = datetime.now().strftime("%Y%m%d")
        leagues = [league_key] if league_key else list(ESPN_LEAGUE_IDS.keys())
        matches = []
        
        for league in leagues:
            data = await self.get_scoreboard(league, today)
            if not data or "events" not in data:
                continue
            
            for event in data["events"]:
                matches.append(self._transform_match(event, league))
        
        return matches
    
    async def get_match_details(
        self,
        league_key: str,
        match_id: str
    ) -> Optional[Dict]:
        """
        Get detailed match information.
        
        Args:
            league_key: Internal league key
            match_id: ESPN event ID
        
        Returns:
            Detailed match data including statistics
        """
        espn_id = self._get_espn_league_id(league_key)
        if not espn_id:
            return None
        
        endpoint = f"{espn_id}/summary"
        params = {"event": match_id}
        cache_key = f"espn_match_{match_id}"
        
        return await self._request(endpoint, params, cache_key, self.live_ttl)
    
    # ==================== STANDINGS ====================
    
    # ESPN quietly emptied the site/v2 standings endpoint (returns "{}");
    # the apis/v2 host serves the same children/entries/stats structure.
    V2_STANDINGS_URL = "https://site.web.api.espn.com/apis/v2/sports/soccer/{espn_id}/standings"

    async def get_standings_raw(self, league_key: str) -> Optional[Dict]:
        """Raw standings payload with `children` groups (keeps group names)."""
        espn_id = self._get_espn_league_id(league_key)
        if not espn_id:
            return None

        data = await self._request(
            f"{espn_id}/standings", cache_key=f"espn_standings_{league_key}"
        )
        if data and data.get("children"):
            return data
        return await self._request(
            self.V2_STANDINGS_URL.format(espn_id=espn_id),
            cache_key=f"espn_standings_v2_{league_key}",
        )

    async def get_standings(self, league_key: str) -> Optional[List[Dict]]:
        """
        Get league standings.

        Args:
            league_key: Internal league key

        Returns:
            List of team standings
        """
        data = await self.get_standings_raw(league_key)
        if not data:
            return None

        standings = []
        children = data.get("children", [])
        
        for group in children:
            for standing in group.get("standings", {}).get("entries", []):
                team = standing.get("team", {})
                stats = {s.get("name"): s.get("value") for s in standing.get("stats", [])}
                
                logo = team.get("logo") or ((team.get("logos") or [{}])[0] or {}).get("href")
                standings.append({
                    "position": int(stats.get("rank", 0)),
                    "team_id": team.get("id"),
                    "team_name": team.get("displayName"),
                    "team_short_name": team.get("abbreviation"),
                    "logo": logo,
                    "played": int(stats.get("gamesPlayed", 0)),
                    "won": int(stats.get("wins", 0)),
                    "drawn": int(stats.get("ties", 0)),
                    "lost": int(stats.get("losses", 0)),
                    "goals_for": int(stats.get("pointsFor", 0)),
                    "goals_against": int(stats.get("pointsAgainst", 0)),
                    "goal_diff": int(stats.get("pointDifferential", 0)),
                    "points": int(stats.get("points", 0)),
                })
        
        return sorted(standings, key=lambda x: x["position"])
    
    # ==================== TEAMS ====================
    
    async def get_team(self, league_key: str, team_id: str) -> Optional[Dict]:
        """Get team information."""
        espn_id = self._get_espn_league_id(league_key)
        if not espn_id:
            return None
        
        endpoint = f"{espn_id}/teams/{team_id}"
        cache_key = f"espn_team_{team_id}"
        
        return await self._request(endpoint, cache_key=cache_key)
    
    async def get_team_statistics(
        self,
        league_key: str,
        team_id: str
    ) -> Optional[Dict]:
        """Get team statistics for the current season."""
        espn_id = self._get_espn_league_id(league_key)
        if not espn_id:
            return None
        
        endpoint = f"{espn_id}/teams/{team_id}/statistics"
        cache_key = f"espn_team_stats_{team_id}"
        
        return await self._request(endpoint, cache_key=cache_key)
    
    async def get_team_schedule(
        self,
        league_key: str,
        team_id: str
    ) -> Optional[List[Dict]]:
        """Get team's schedule/fixtures."""
        espn_id = self._get_espn_league_id(league_key)
        if not espn_id:
            return None
        
        endpoint = f"{espn_id}/teams/{team_id}/schedule"
        cache_key = f"espn_team_schedule_{team_id}"
        
        data = await self._request(endpoint, cache_key=cache_key)
        if not data:
            return None

        return data.get("events", [])

    # ==================== ATHLETES ====================

    # Athlete endpoints live on ESPN's core/web hosts rather than BASE_URL.
    # The league slug in the URL is non-binding — any valid slug resolves
    # any athlete id — so a default of eng.1 works globally.
    CORE_ATHLETE_URL = (
        "https://sports.core.api.espn.com/v2/sports/soccer/leagues/{slug}/athletes/{athlete_id}"
    )
    ATHLETE_OVERVIEW_URL = (
        "https://site.web.api.espn.com/apis/common/v3/sports/soccer/{slug}/athletes/{athlete_id}/overview"
    )

    async def get_athlete(self, athlete_id: str, league_slug: str = "eng.1") -> Optional[Dict]:
        """Get an athlete's profile (name, position, jersey, headshot, team ref)."""
        url = self.CORE_ATHLETE_URL.format(slug=league_slug, athlete_id=athlete_id)
        return await self._request(url, cache_key=f"espn_athlete_{athlete_id}")

    async def get_athlete_overview(self, athlete_id: str, league_slug: str = "eng.1") -> Optional[Dict]:
        """Get an athlete's season stat splits and recent game log."""
        url = self.ATHLETE_OVERVIEW_URL.format(slug=league_slug, athlete_id=athlete_id)
        return await self._request(url, cache_key=f"espn_athlete_overview_{athlete_id}")

    async def resolve_ref(self, ref_url: str, cache_key: Optional[str] = None) -> Optional[Dict]:
        """Follow an ESPN `$ref` URL (e.g. an athlete's defaultTeam)."""
        if not ref_url.startswith("http"):
            return None
        return await self._request(ref_url, cache_key=cache_key)

    # ==================== NEWS ====================
    
    async def get_league_news(self, league_key: str, limit: int = 10) -> List[Dict]:
        """
        Get latest news articles for a league.
        
        Args:
            league_key: Internal league key
            limit: Maximum number of articles to return
        
        Returns:
            List of news articles
        """
        espn_id = self._get_espn_league_id(league_key)
        if not espn_id:
            return []
        
        endpoint = f"{espn_id}/news"
        params = {"limit": limit}
        cache_key = f"espn_news_{league_key}_{limit}"
        
        data = await self._request(endpoint, params, cache_key)
        if not data:
            return []
        
        articles = []
        for article in data.get("articles", []):
            articles.append({
                "id": article.get("dataSourceIdentifier"),
                "headline": article.get("headline"),
                "description": article.get("description"),
                "published": article.get("published"),
                "link": article.get("links", {}).get("web", {}).get("href"),
                "type": article.get("type"),
                "categories": [cat.get("description") for cat in article.get("categories", [])],
            })
        
        return articles
    
    async def get_team_news(self, league_key: str, team_id: str, limit: int = 5) -> List[Dict]:
        """Get latest news for a specific team."""
        espn_id = self._get_espn_league_id(league_key)
        if not espn_id:
            return []
        
        endpoint = f"{espn_id}/teams/{team_id}/news"
        params = {"limit": limit}
        cache_key = f"espn_team_news_{team_id}_{limit}"
        
        data = await self._request(endpoint, params, cache_key)
        if not data:
            return []
        
        articles = []
        for article in data.get("articles", []):
            articles.append({
                "id": article.get("dataSourceIdentifier"),
                "headline": article.get("headline"),
                "description": article.get("description"),
                "published": article.get("published"),
                "type": article.get("type"),
            })
        
        return articles
    
    # ==================== HELPER METHODS ====================
    
    def _transform_match(self, event: Dict, league_key: str) -> Dict:
        """Transform ESPN event data to unified match format."""
        competitions = event.get("competitions", [{}])
        competition = competitions[0] if competitions else {}
        
        competitors = competition.get("competitors", [])
        home_team = next((c for c in competitors if c.get("homeAway") == "home"), {})
        away_team = next((c for c in competitors if c.get("homeAway") == "away"), {})
        
        status = event.get("status", {})
        status_type = status.get("type", {})
        
        # Determine match status
        state = status_type.get("state", "pre")
        if state == "in":
            match_status = "live"
        elif state == "post":
            match_status = "finished"
        else:
            match_status = "upcoming"
        
        return {
            "espn_id": event.get("id"),
            "league_key": league_key,
            "league_name": event.get("league", {}).get("name"),
            "home_team": {
                "id": home_team.get("team", {}).get("id"),
                "name": home_team.get("team", {}).get("displayName"),
                "short_name": home_team.get("team", {}).get("abbreviation"),
                "logo": home_team.get("team", {}).get("logo"),
                "score": home_team.get("score"),
            },
            "away_team": {
                "id": away_team.get("team", {}).get("id"),
                "name": away_team.get("team", {}).get("displayName"),
                "short_name": away_team.get("team", {}).get("abbreviation"),
                "logo": away_team.get("team", {}).get("logo"),
                "score": away_team.get("score"),
            },
            "status": match_status,
            "status_detail": status_type.get("detail"),
            "clock": status.get("displayClock"),
            "start_time": event.get("date"),
            "venue": competition.get("venue", {}).get("fullName"),
        }


# Singleton instance
_client: Optional[ESPNClient] = None


def get_espn_client() -> ESPNClient:
    """Get or create ESPN client singleton."""
    global _client
    if _client is None:
        _client = ESPNClient()
    return _client


async def cleanup_espn_client():
    """Cleanup the ESPN client."""
    global _client
    if _client:
        await _client.close()
        _client = None
