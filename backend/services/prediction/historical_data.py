"""
Historical Match Data Collection and Processing.

Fetches and organizes historical match data from ESPN and football-data.co.uk
for training the ML prediction model on past seasons.
Supports scalable ingestion of multi-season data across all leagues.

Data sources:
  - ESPN API: match results, venues, attendance (2003+)
  - football-data.co.uk: match results with betting odds (2005+)
    Betting odds provide the strongest predictive signal available.
"""

import asyncio
import csv
import io
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
    "world_cup": "fifa.world",
    "euro": "uefa.euro",
    "copa_america": "conmebol.america",
}

# Extended season ranges
AVAILABLE_SEASONS = {
    "premier_league": list(range(2003, 2026)),
    "la_liga": list(range(2003, 2026)),
    "bundesliga": list(range(2003, 2026)),
    "serie_a": list(range(2003, 2026)),
    "ligue_1": list(range(2005, 2026)),
    "eredivisie": list(range(2008, 2026)),
    "primeira_liga": list(range(2008, 2026)),
    "mls": list(range(2005, 2026)),
    "champions_league": list(range(2005, 2026)),
    "europa_league": list(range(2009, 2026)),
    # World Cup: all tournament years from 1998 onwards
    "world_cup": [1998, 2002, 2006, 2010, 2014, 2018, 2022],
    # International tournaments use tournament years, except Euro 2020,
    # which was played in 2021 but remains the 2020 edition.
    "euro": [2000, 2004, 2008, 2012, 2016, 2020, 2024],
    "copa_america": [2001, 2004, 2007, 2011, 2015, 2016, 2019, 2021, 2024],
}

# Midweek/sparse tournament schedules are easy to miss with weekly date probes.
# ESPN supports YYYYMMDD-YYYYMMDD range queries, so these competitions fetch
# monthly/window chunks instead of single-day weekly snapshots.
ESPN_RANGE_FETCH_LEAGUES = {
    "champions_league",
    "europa_league",
    "world_cup",
    "euro",
    "copa_america",
}

EURO_WINDOWS = {
    2000: ("20000610", "20000702"),
    2004: ("20040612", "20040704"),
    2008: ("20080607", "20080629"),
    2012: ("20120608", "20120701"),
    2016: ("20160610", "20160710"),
    2020: ("20210611", "20210711"),
    2024: ("20240614", "20240714"),
}

COPA_AMERICA_WINDOWS = {
    2001: ("20010711", "20010729"),
    2004: ("20040706", "20040725"),
    2007: ("20070626", "20070715"),
    2011: ("20110701", "20110724"),
    2015: ("20150611", "20150704"),
    2016: ("20160603", "20160626"),
    2019: ("20190614", "20190707"),
    2021: ("20210613", "20210710"),
    2024: ("20240620", "20240715"),
}

# football-data.co.uk CSV codes
FOOTBALL_DATA_LEAGUES = {
    "premier_league": "E0",
    "la_liga": "SP1",
    "bundesliga": "D1",
    "serie_a": "I1",
    "ligue_1": "F1",
    "eredivisie": "N1",
    "primeira_liga": "P1",
}

FOOTBALL_DATA_SEASONS = {
    "premier_league": list(range(2005, 2026)),
    "la_liga": list(range(2005, 2026)),
    "bundesliga": list(range(2005, 2026)),
    "serie_a": list(range(2005, 2026)),
    "ligue_1": list(range(2005, 2026)),
    "eredivisie": list(range(2008, 2026)),
    "primeira_liga": list(range(2012, 2026)),
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
        "odds_home", "odds_draw", "odds_away",
        "odds_over_2_5", "odds_under_2_5",
        "home_shots", "away_shots",
        "home_shots_on_target", "away_shots_on_target",
        "home_corners", "away_corners",
        "home_fouls", "away_fouls",
        "home_yellows", "away_yellows",
        "home_reds", "away_reds",
        "referee",
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
    Dual-source: ESPN API + football-data.co.uk (adds betting odds & stats).
    """

    def __init__(self, data_dir: Optional[Path] = None):
        self.data_dir = data_dir or HISTORICAL_DATA_DIR
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=30.0,
                headers={"User-Agent": "SoccerPredictor/4.0"},
                follow_redirects=True,
            )
        return self._client

    async def close(self):
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    def _cache_path(self, league: str, season: int) -> Path:
        return self.data_dir / f"{league}_{season}_{season + 1}.json"

    @staticmethod
    def _parse_yyyymmdd(value: str) -> datetime:
        return datetime.strptime(value, "%Y%m%d")

    def _season_windows(self, league: str, season: int) -> List[Tuple[datetime, datetime]]:
        if league == "mls":
            return [(datetime(season, 2, 1), datetime(season, 12, 15))]

        if league == "world_cup":
            # Qatar 2022 was a winter tournament; most World Cups are June-July.
            if season == 2022:
                return [(datetime(season, 11, 20), datetime(season, 12, 20))]
            return [(datetime(season, 6, 1), datetime(season, 7, 20))]

        if league == "euro":
            start, end = EURO_WINDOWS.get(
                season,
                (f"{season}0601", f"{season}0731"),
            )
            return [(self._parse_yyyymmdd(start), self._parse_yyyymmdd(end))]

        if league == "copa_america":
            start, end = COPA_AMERICA_WINDOWS.get(
                season,
                (f"{season}0601", f"{season}0731"),
            )
            return [(self._parse_yyyymmdd(start), self._parse_yyyymmdd(end))]

        return [(datetime(season, 8, 1), datetime(season + 1, 6, 30))]

    @staticmethod
    def _date_chunks(
        start_date: datetime,
        end_date: datetime,
        chunk_days: int = 31,
    ) -> List[Tuple[datetime, datetime]]:
        chunks = []
        current = start_date
        while current <= end_date:
            chunk_end = min(end_date, current + timedelta(days=chunk_days - 1))
            chunks.append((current, chunk_end))
            current = chunk_end + timedelta(days=1)
        return chunks

    def _is_cached(self, league: str, season: int) -> bool:
        path = self._cache_path(league, season)
        if not path.exists():
            return False
        current_year = datetime.now().year
        if season >= current_year - 1:
            mtime = datetime.fromtimestamp(path.stat().st_mtime)
            if (datetime.now() - mtime).days > 1:
                return False
        return True

    # ── football-data.co.uk CSV fetcher ──

    async def fetch_football_data_season(
        self, league: str, season: int, force: bool = False,
    ) -> List[Dict[str, Any]]:
        """Fetch match data with betting odds from football-data.co.uk."""
        fd_code = FOOTBALL_DATA_LEAGUES.get(league)
        if not fd_code:
            return []

        available = FOOTBALL_DATA_SEASONS.get(league, [])
        if season not in available:
            return []

        cache_path = self.data_dir / f"fd_{league}_{season}_{season + 1}.json"
        if not force and cache_path.exists():
            try:
                with open(cache_path) as f:
                    data = json.load(f)
                return data.get("matches", [])
            except Exception:
                pass

        season_str = f"{str(season)[-2:]}{str(season + 1)[-2:]}"
        url = f"https://www.football-data.co.uk/mmz4281/{season_str}/{fd_code}.csv"

        client = await self._get_client()
        matches = []

        try:
            resp = await client.get(url, timeout=20)
            if resp.status_code != 200:
                logger.debug(f"football-data.co.uk {url} returned {resp.status_code}")
                return []

            text = resp.text
            reader = csv.DictReader(io.StringIO(text))

            for row in reader:
                try:
                    date_str = row.get("Date", "")
                    try:
                        match_date = datetime.strptime(date_str, "%d/%m/%Y")
                    except ValueError:
                        try:
                            match_date = datetime.strptime(date_str, "%d/%m/%y")
                        except ValueError:
                            continue

                    home = row.get("HomeTeam", "").strip()
                    away = row.get("AwayTeam", "").strip()
                    if not home or not away:
                        continue

                    fthg = row.get("FTHG", row.get("HG", ""))
                    ftag = row.get("FTAG", row.get("AG", ""))
                    if not fthg or not ftag:
                        continue

                    home_score = int(fthg)
                    away_score = int(ftag)

                    ftr = row.get("FTR", "")
                    if not ftr:
                        if home_score > away_score:
                            ftr = "H"
                        elif away_score > home_score:
                            ftr = "A"
                        else:
                            ftr = "D"

                    def _sf(val, default=None):
                        try:
                            return float(val) if val else default
                        except (ValueError, TypeError):
                            return default

                    odds_h = _sf(row.get("PSH")) or _sf(row.get("B365H"))
                    odds_d = _sf(row.get("PSD")) or _sf(row.get("B365D"))
                    odds_a = _sf(row.get("PSA")) or _sf(row.get("B365A"))
                    odds_o25 = _sf(row.get("BbAv>2.5")) or _sf(row.get("P>2.5"))
                    odds_u25 = _sf(row.get("BbAv<2.5")) or _sf(row.get("P<2.5"))

                    match = {
                        "match_id": f"fd_{league}_{match_date.strftime('%Y%m%d')}_{home}_{away}",
                        "league": league,
                        "season": season,
                        "date": match_date.isoformat(),
                        "home_team": home,
                        "away_team": away,
                        "home_score": home_score,
                        "away_score": away_score,
                        "result": ftr,
                        "referee": row.get("Referee", ""),
                        "odds_home": odds_h,
                        "odds_draw": odds_d,
                        "odds_away": odds_a,
                        "odds_over_2_5": odds_o25,
                        "odds_under_2_5": odds_u25,
                        "home_shots": _sf(row.get("HS")),
                        "away_shots": _sf(row.get("AS")),
                        "home_shots_on_target": _sf(row.get("HST")),
                        "away_shots_on_target": _sf(row.get("AST")),
                        "home_corners": _sf(row.get("HC")),
                        "away_corners": _sf(row.get("AC")),
                        "home_fouls": _sf(row.get("HF")),
                        "away_fouls": _sf(row.get("AF")),
                        "home_yellows": _sf(row.get("HY")),
                        "away_yellows": _sf(row.get("AY")),
                        "home_reds": _sf(row.get("HR")),
                        "away_reds": _sf(row.get("AR")),
                    }
                    matches.append(match)
                except Exception:
                    continue

            if matches:
                with open(cache_path, "w") as f:
                    json.dump({
                        "league": league,
                        "season": f"{season}/{season + 1}",
                        "source": "football-data.co.uk",
                        "fetched_at": datetime.utcnow().isoformat(),
                        "match_count": len(matches),
                        "matches": matches,
                    }, f, indent=2)
                logger.info(f"FD: {len(matches)} matches for {league} {season}/{season+1}")

        except Exception as e:
            logger.warning(f"Error fetching football-data {league} {season}: {e}")

        return matches

    # ── ESPN fetcher ──

    async def fetch_season_matches(
        self, league: str, season: int, force: bool = False
    ) -> List[Dict[str, Any]]:
        """Fetch all matches for a league season from ESPN."""
        if not force and self._is_cached(league, season):
            return self._load_cache(league, season)

        espn_id = ESPN_LEAGUES.get(league)
        if not espn_id:
            return []

        client = await self._get_client()
        all_matches = []

        try:
            windows = self._season_windows(league, season)

            for window_start, window_end in windows:
                if league in ESPN_RANGE_FETCH_LEAGUES:
                    date_ranges = [
                        (
                            start.strftime("%Y%m%d")
                            if start == end
                            else f"{start.strftime('%Y%m%d')}-{end.strftime('%Y%m%d')}"
                        )
                        for start, end in self._date_chunks(window_start, window_end)
                    ]
                else:
                    date_ranges = []
                    current = window_start
                    while current <= window_end:
                        date_ranges.append(current.strftime("%Y%m%d"))
                        current += timedelta(days=7)

                for date_str in date_ranges:
                    url = (
                        f"{ESPN_BASE}/site/v2/sports/soccer/{espn_id}/scoreboard"
                        f"?dates={date_str}&limit=1000"
                    )
                    try:
                        resp = await client.get(url)
                        if resp.status_code == 200:
                            data = resp.json()
                            for event in data.get("events", []):
                                match = self._parse_espn_event(event, league, season)
                                if match:
                                    all_matches.append(match)
                    except Exception as e:
                        logger.debug(f"Error fetching {league} {date_str}: {e}")

                    await asyncio.sleep(0.1 if league in ESPN_RANGE_FETCH_LEAGUES else 0.15)

            seen = set()
            unique_matches = []
            for m in all_matches:
                mid = m.get("match_id")
                if mid and mid not in seen:
                    seen.add(mid)
                    unique_matches.append(m)

            self._save_cache(league, season, unique_matches)
            logger.info(f"Fetched {len(unique_matches)} matches for {league} {season}/{season+1}")
            return unique_matches

        except Exception as e:
            logger.error(f"Error fetching {league} season {season}: {e}")
            return self._load_cache(league, season)

    def _parse_espn_event(self, event: Dict, league: str, season: int) -> Optional[Dict[str, Any]]:
        """Parse an ESPN event into a standardized match dict."""
        try:
            competition = event.get("competitions", [{}])[0]
            status = competition.get("status", {}).get("type", {})
            if not status.get("completed", False):
                return None

            competitors = competition.get("competitors", [])
            if len(competitors) < 2:
                return None

            home = next((c for c in competitors if c.get("homeAway") == "home"), None)
            away = next((c for c in competitors if c.get("homeAway") == "away"), None)
            if not home or not away:
                return None

            home_score = int(home.get("score", "0"))
            away_score = int(away.get("score", "0"))

            if home_score > away_score:
                result = "H"
            elif away_score > home_score:
                result = "A"
            else:
                result = "D"

            venue = competition.get("venue", {})
            home_stats = self._parse_competitor_stats(home)
            away_stats = self._parse_competitor_stats(away)
            home_cards = self._count_cards(competition, home.get("team", {}).get("id", ""))
            away_cards = self._count_cards(competition, away.get("team", {}).get("id", ""))

            return {
                "match_id": str(event.get("id", "")),
                "source": "espn",
                "source_league_id": ESPN_LEAGUES.get(league),
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
                "attendance": competition.get("attendance") or venue.get("capacity"),
                "matchday": event.get("week", {}).get("number"),
                "phase": event.get("season", {}).get("slug"),
                "status_detail": status.get("detail") or status.get("shortDetail"),
                "home_shots": home_stats.get("totalShots"),
                "away_shots": away_stats.get("totalShots"),
                "home_shots_on_target": home_stats.get("shotsOnTarget"),
                "away_shots_on_target": away_stats.get("shotsOnTarget"),
                "home_corners": home_stats.get("wonCorners"),
                "away_corners": away_stats.get("wonCorners"),
                "home_fouls": home_stats.get("foulsCommitted"),
                "away_fouls": away_stats.get("foulsCommitted"),
                "home_yellows": home_cards["yellows"],
                "away_yellows": away_cards["yellows"],
                "home_reds": home_cards["reds"],
                "away_reds": away_cards["reds"],
            }
        except Exception:
            return None

    @staticmethod
    def _parse_stat_value(value: Any) -> Optional[float]:
        try:
            if value is None:
                return None
            if isinstance(value, (int, float)):
                return float(value)
            cleaned = str(value).replace("%", "").replace(",", "").strip()
            return float(cleaned) if cleaned else None
        except (TypeError, ValueError):
            return None

    def _parse_competitor_stats(self, competitor: Dict[str, Any]) -> Dict[str, Optional[float]]:
        stats: Dict[str, Optional[float]] = {}
        for item in competitor.get("statistics", []) or []:
            name = item.get("name")
            if not name:
                continue
            stats[name] = self._parse_stat_value(
                item.get("value")
                if item.get("value") is not None
                else item.get("displayValue")
            )
        return stats

    @staticmethod
    def _count_cards(competition: Dict[str, Any], team_id: str) -> Dict[str, int]:
        yellows = 0
        reds = 0
        for detail in competition.get("details", []) or []:
            if str(detail.get("team", {}).get("id", "")) != str(team_id):
                continue
            if detail.get("yellowCard"):
                yellows += 1
            if detail.get("redCard"):
                reds += 1
        return {"yellows": yellows, "reds": reds}

    def _save_cache(self, league: str, season: int, matches: List[Dict]):
        path = self._cache_path(league, season)
        try:
            with open(path, "w") as f:
                json.dump({
                    "league": league,
                    "season": f"{season}/{season + 1}",
                    "fetched_at": datetime.utcnow().isoformat(),
                    "match_count": len(matches),
                    "matches": matches,
                }, f, indent=2)
        except Exception as e:
            logger.error(f"Error saving cache: {e}")

    def _load_cache(self, league: str, season: int) -> List[Dict]:
        path = self._cache_path(league, season)
        if not path.exists():
            return []
        try:
            with open(path, "r") as f:
                data = json.load(f)
                return data.get("matches", [])
        except Exception:
            return []

    async def fetch_all_historical_data(
        self,
        leagues: Optional[List[str]] = None,
        min_season: int = 2010,
        force: bool = False,
    ) -> Dict[str, List[Dict]]:
        """Fetch and merge historical data from both ESPN and football-data.co.uk."""
        target_leagues = leagues or list(ESPN_LEAGUES.keys())
        all_data: Dict[str, List[Dict]] = {}

        for league in target_leagues:
            available = AVAILABLE_SEASONS.get(league, [])
            seasons = [s for s in available if s >= min_season]
            league_matches = []

            for season in seasons:
                matches = await self.fetch_season_matches(league, season, force)
                league_matches.extend(matches)

            # Add football-data.co.uk data (betting odds)
            fd_seasons = FOOTBALL_DATA_SEASONS.get(league, [])
            fd_all = []
            for season in [s for s in fd_seasons if s >= min_season]:
                fd_matches = await self.fetch_football_data_season(league, season, force)
                fd_all.extend(fd_matches)

            if fd_all:
                league_matches = self._merge_data_sources(league_matches, fd_all)

            all_data[league] = league_matches
            logger.info(f"Collected {len(league_matches)} total matches for {league}")

        return all_data

    def _merge_data_sources(self, espn_matches: List[Dict], fd_matches: List[Dict]) -> List[Dict]:
        """Merge ESPN and football-data.co.uk data by date + team names."""
        fd_lookup: Dict[tuple, Dict] = {}
        for m in fd_matches:
            try:
                d = m.get("date", "")[:10]
                h = self._normalize_team(m.get("home_team", ""))
                a = self._normalize_team(m.get("away_team", ""))
                fd_lookup[(d, h, a)] = m
            except Exception:
                continue

        merged = []
        matched_fd_keys = set()

        for em in espn_matches:
            try:
                d = em.get("date", "")[:10]
                h = self._normalize_team(em.get("home_team", ""))
                a = self._normalize_team(em.get("away_team", ""))
                key = (d, h, a)

                if key in fd_lookup:
                    fm = fd_lookup[key]
                    matched_fd_keys.add(key)
                    for field in [
                        "odds_home", "odds_draw", "odds_away",
                        "odds_over_2_5", "odds_under_2_5",
                        "home_shots", "away_shots",
                        "home_shots_on_target", "away_shots_on_target",
                        "home_corners", "away_corners",
                        "home_fouls", "away_fouls",
                        "home_yellows", "away_yellows",
                        "home_reds", "away_reds",
                        "referee",
                    ]:
                        if fm.get(field) is not None:
                            em[field] = fm[field]

                merged.append(em)
            except Exception:
                merged.append(em)

        for key, fm in fd_lookup.items():
            if key not in matched_fd_keys:
                merged.append(fm)

        return merged

    @staticmethod
    def _normalize_team(name: str) -> str:
        """Normalize team name for fuzzy matching."""
        name = name.lower().strip()
        replacements = {
            "man united": "manchester united",
            "man city": "manchester city",
            "wolves": "wolverhampton",
            "spurs": "tottenham",
            "nott'm forest": "nottingham forest",
            "sheffield utd": "sheffield united",
            "atletico": "atletico madrid",
            "ath madrid": "atletico madrid",
            "ath bilbao": "athletic bilbao",
            "betis": "real betis",
            "sociedad": "real sociedad",
            "hertha": "hertha berlin",
            "gladbach": "m'gladbach",
            "leverkusen": "bayer leverkusen",
            "st etienne": "saint-etienne",
            "paris sg": "paris saint-germain",
        }
        for short, full in replacements.items():
            if name == short:
                return full
        return name

    def get_cached_match_count(self) -> Dict[str, int]:
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

    def load_all_cached_matches(self, leagues: Optional[List[str]] = None) -> List[Dict]:
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


_collector: Optional[HistoricalDataCollector] = None


def get_historical_collector() -> HistoricalDataCollector:
    global _collector
    if _collector is None:
        _collector = HistoricalDataCollector()
    return _collector
