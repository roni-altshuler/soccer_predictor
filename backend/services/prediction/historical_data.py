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
import math
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime, timedelta, timezone
from pathlib import Path
import logging
import httpx

from backend.services.data.provider_status import ProviderUnavailable, write_json_atomic

logger = logging.getLogger(__name__)

# Directory for cached historical data
HISTORICAL_DATA_DIR = Path(__file__).parent.parent.parent / "data" / "historical"

ESPN_BASE = "https://site.web.api.espn.com/apis"
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
    "championship": "eng.2",
    "laliga_2": "esp.2",
    "bundesliga_2": "ger.2",
    "serie_b": "ita.2",
    "ligue_2": "fra.2",
    "super_lig": "tur.1",
    "brasileirao": "bra.1",
}

# Leagues played inside one calendar year rather than across two. Their season
# label IS the year, so "the current season" for them turns over in January,
# not in July.
CALENDAR_YEAR_LEAGUES = {"mls", "brasileirao"}

# The month a European season is taken to start in. July rather than August
# because qualifying rounds and an early Eredivisie kickoff both land in it.
SEASON_START_MONTH = 7


def current_season(league: str = "premier_league",
                   today: Optional[datetime] = None) -> int:
    """The season label for the campaign in progress, for this league.

    Hard-coding the end of a season range is a bug with a one-year fuse: it
    works until August, and then the league everyone is watching quietly stops
    being fetched. This is computed instead, so the ingestion follows the
    calendar without anyone remembering to bump a literal.
    """
    now = today or datetime.now()
    if league in CALENDAR_YEAR_LEAGUES:
        return now.year
    return now.year if now.month >= SEASON_START_MONTH else now.year - 1


def seasons_for(league: str, today: Optional[datetime] = None) -> List[int]:
    """Every season this league can be fetched for, up to the current one."""
    fixed = FIXED_SEASONS.get(league)
    if fixed is not None:
        return list(fixed)
    start = SEASON_STARTS.get(league)
    if start is None:
        return []
    return list(range(start, current_season(league, today) + 1))


# First season each league can be fetched for. The last is computed.
SEASON_STARTS = {
    "premier_league": 2003,
    "la_liga": 2003,
    "bundesliga": 2003,
    "serie_a": 2003,
    "ligue_1": 2005,
    "eredivisie": 2008,
    "primeira_liga": 2008,
    "mls": 2005,
    "champions_league": 2005,
    "europa_league": 2009,
    "championship": 2010,
    "laliga_2": 2010,
    "bundesliga_2": 2010,
    "serie_b": 2010,
    "ligue_2": 2010,
    "super_lig": 2010,
    "brasileirao": 2010,
}

# Tournaments happen in named years rather than every season, so they are
# listed rather than computed.
FIXED_SEASONS = {
    # World Cup: all tournament years from 1998 onwards
    "world_cup": [1998, 2002, 2006, 2010, 2014, 2018, 2022, 2026],
    # International tournaments use tournament years, except Euro 2020,
    # which was played in 2021 but remains the 2020 edition.
    "euro": [2000, 2004, 2008, 2012, 2016, 2020, 2024],
    "copa_america": [2001, 2004, 2007, 2011, 2015, 2016, 2019, 2021, 2024],
}

# Evaluated at import: every process that ingests is short-lived, and the
# callers that want a live answer can call `seasons_for` directly.
AVAILABLE_SEASONS: Dict[str, List[int]] = {
    league: seasons_for(league)
    for league in list(SEASON_STARTS) + list(FIXED_SEASONS)
}

# Some older international tournaments are no longer exposed by ESPN's
# current scoreboard range endpoint. Keep curated cache rows from being
# replaced with an empty response when force-refreshing historical data.
CURATED_STATIC_ARCHIVES = {
    ("euro", 2000): "UEFA Euro 2000 archive rows",
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

# Same rule as `SEASON_STARTS`: first season listed, last one computed, so the
# odds source does not silently stop a month into every new campaign.
FOOTBALL_DATA_STARTS = {
    "premier_league": 2005,
    "la_liga": 2005,
    "bundesliga": 2005,
    "serie_a": 2005,
    "ligue_1": 2005,
    "eredivisie": 2008,
    "primeira_liga": 2012,
}

FOOTBALL_DATA_SEASONS: Dict[str, List[int]] = {
    league: list(range(start, current_season(league) + 1))
    for league, start in FOOTBALL_DATA_STARTS.items()
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

    def __init__(self, data_dir: Optional[Path] = None, *,
                 daily_fallback_budget: int = 93, persist_cache: bool = True):
        self.data_dir = data_dir or HISTORICAL_DATA_DIR
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self._client: Optional[httpx.AsyncClient] = None
        self.daily_fallback_budget = daily_fallback_budget
        self.persist_cache = persist_cache

    @staticmethod
    def _today() -> datetime:
        return datetime.now(timezone.utc).replace(tzinfo=None, hour=0, minute=0,
                                                 second=0, microsecond=0)

    def _read_cache(self, path: Path) -> Dict:
        try:
            data = json.loads(path.read_text())
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    @staticmethod
    def _validate_matches(matches: Any) -> None:
        if not isinstance(matches, list):
            raise ProviderUnavailable("matches must be a list")
        seen = set()
        for row in matches:
            if not isinstance(row, dict):
                raise ProviderUnavailable("invalid match record")
            for key in ("match_id", "date", "home_team", "away_team"):
                if not isinstance(row.get(key), str) or not row[key].strip():
                    raise ProviderUnavailable(f"missing match {key}")
            try:
                datetime.fromisoformat(row["date"].replace("Z", "+00:00"))
            except ValueError as exc:
                raise ProviderUnavailable("invalid match date") from exc
            for key in ("home_score", "away_score"):
                if type(row.get(key)) is not int or row[key] < 0:
                    raise ProviderUnavailable(f"invalid final {key}")
            if row["match_id"] in seen:
                raise ProviderUnavailable("duplicate match ID")
            seen.add(row["match_id"])

    def _check_refresh(self, path: Path, matches: List[Dict], *, ended: bool) -> None:
        self._validate_matches(matches)
        if ended and not matches:
            raise ProviderUnavailable("completed season returned no results")
        previous = self._read_cache(path).get("matches", [])
        try:
            self._validate_matches(previous)
        except ProviderUnavailable:
            previous = []
        old_ids = {row["match_id"] for row in previous}
        if not old_ids.issubset({row["match_id"] for row in matches}):
            raise ProviderUnavailable("season refresh lost previously observed results")

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
        # A calendar-year league's season is its year, end to end. Bounding it
        # at February and mid-December, as this did for MLS, drops any fixture
        # outside those months — the Brasileirão runs from April but its
        # season label is still the year, and it was being fetched on the
        # European August-to-June window, which missed everything before
        # August and mislabelled the rest.
        if league in CALENDAR_YEAR_LEAGUES:
            return [(datetime(season, 1, 1), datetime(season, 12, 31))]

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

        # Ends in July, not June: the 2019/20 season finished on 26 July 2020
        # and a June cutoff dropped its last five weeks. The overlap month is
        # assigned to the season that is ending, which is the one that plays
        # in it — no European league starts in July.
        return [(datetime(season, 8, 1), datetime(season + 1, 7, 31))]

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
        data = self._read_cache(path)
        # Older caches were written even after failed or partial requests.
        # A timestamp alone is not evidence that all requested windows worked.
        if data.get("coverage_version") != 1 or not data.get("matches"):
            return False
        try:
            self._validate_matches(data["matches"])
        except ProviderUnavailable:
            return False
        end = max(end for _, end in self._season_windows(league, season))
        required = min(end, self._today()).strftime("%Y%m%d")
        return data.get("through") == required

    # ── football-data.co.uk CSV fetcher ──

    async def fetch_football_data_season(
        self, league: str, season: int, force: bool = False,
    ) -> List[Dict[str, Any]]:
        """Fetch match data with betting odds from football-data.co.uk."""
        fd_code = FOOTBALL_DATA_LEAGUES.get(league)
        if not fd_code:
            raise ProviderUnavailable(f"unknown football-data league: {league}")

        available = FOOTBALL_DATA_SEASONS.get(league, [])
        if season not in available:
            raise ProviderUnavailable(f"football-data season unavailable: {league}/{season}")

        cache_path = self.data_dir / f"fd_{league}_{season}_{season + 1}.json"
        cached = self._read_cache(cache_path)
        if not force and cached.get("coverage_version") == 1:
            through = min(datetime(season + 1, 7, 31), self._today()).strftime("%Y%m%d")
            if cached.get("through") == through and cached.get("matches"):
                self._validate_matches(cached["matches"])
                return cached["matches"]

        season_str = f"{str(season)[-2:]}{str(season + 1)[-2:]}"
        url = f"https://www.football-data.co.uk/mmz4281/{season_str}/{fd_code}.csv"

        client = await self._get_client()
        matches = []

        try:
            resp = await client.get(url, timeout=20)
            if resp.status_code != 200:
                raise ProviderUnavailable(f"football-data {league}/{season}: HTTP {resp.status_code}")

            text = resp.text
            reader = csv.DictReader(io.StringIO(text.lstrip("\ufeff")))
            fields = set(reader.fieldnames or [])
            if (not {"Date", "HomeTeam", "AwayTeam"}.issubset(fields)
                    or not ({"FTHG", "FTAG"}.issubset(fields) or {"HG", "AG"}.issubset(fields))):
                raise ProviderUnavailable("football-data CSV missing required headers")

            for row in reader:
                if not any(value for value in row.values()):
                    continue  # Only genuinely blank CSV lines can be ignored.
                try:
                    date_str = row.get("Date", "")
                    try:
                        match_date = datetime.strptime(date_str, "%d/%m/%Y")
                    except ValueError:
                        try:
                            match_date = datetime.strptime(date_str, "%d/%m/%y")
                        except ValueError as exc:
                            raise ProviderUnavailable("football-data invalid match date") from exc

                    home = row.get("HomeTeam", "").strip()
                    away = row.get("AwayTeam", "").strip()
                    if not home or not away:
                        raise ProviderUnavailable("football-data missing team")

                    fthg = row.get("FTHG", row.get("HG", ""))
                    ftag = row.get("FTAG", row.get("AG", ""))
                    if not fthg and not ftag:
                        if row.get("FTR"):
                            raise ProviderUnavailable("football-data final result missing scores")
                        continue  # Explicit future/unplayed fixture, no result yet.
                    if not str(fthg).isdigit() or not str(ftag).isdigit():
                        raise ProviderUnavailable("football-data invalid final score")
                    home_score = int(fthg)
                    away_score = int(ftag)
                    if not (datetime(season, 8, 1) <= match_date
                            <= min(datetime(season + 1, 7, 31), self._today())):
                        raise ProviderUnavailable("football-data final outside requested season")

                    ftr = row.get("FTR", "")
                    if not ftr:
                        if home_score > away_score:
                            ftr = "H"
                        elif away_score > home_score:
                            ftr = "A"
                        else:
                            ftr = "D"

                    expected_result = "H" if home_score > away_score else "A" if away_score > home_score else "D"
                    if ftr != expected_result:
                        raise ProviderUnavailable("football-data result disagrees with score")

                    def _sf(val, default=None):
                        try:
                            number = float(val) if val else default
                            return number if number is None or math.isfinite(number) else default
                        except (ValueError, TypeError):
                            return default

                    # PSH/B365H are the prices football-data collects BEFORE
                    # kickoff. The closing prices are the C-prefixed columns.
                    # Until 2026-08-11 this loader read only the first set and
                    # the whole codebase called the result "the closing line" —
                    # every published gap to the market was a gap to a softer
                    # number than advertised. Both are now captured, and they
                    # are not interchangeable: the pre-kickoff price is known
                    # at serve time, the closing price never is.
                    odds_h = _sf(row.get("PSH")) or _sf(row.get("B365H"))
                    odds_d = _sf(row.get("PSD")) or _sf(row.get("B365D"))
                    odds_a = _sf(row.get("PSA")) or _sf(row.get("B365A"))
                    close_h = _sf(row.get("PSCH")) or _sf(row.get("B365CH"))
                    close_d = _sf(row.get("PSCD")) or _sf(row.get("B365CD"))
                    close_a = _sf(row.get("PSCA")) or _sf(row.get("B365CA"))
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
                        "odds_close_home": close_h,
                        "odds_close_draw": close_d,
                        "odds_close_away": close_a,
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
                except ProviderUnavailable:
                    raise
                except (ValueError, TypeError, AttributeError) as exc:
                    raise ProviderUnavailable("malformed football-data CSV row") from exc

            self._check_refresh(cache_path, matches,
                                ended=datetime(season + 1, 7, 31) < self._today())
            if self.persist_cache:
                write_json_atomic(cache_path, {
                    "league": league,
                    "season": f"{season}/{season + 1}",
                    "source": "football-data.co.uk",
                    "fetched_at": datetime.now(timezone.utc).isoformat(),
                    "coverage_version": 1,
                    "through": min(datetime(season + 1, 7, 31), self._today()).strftime("%Y%m%d"),
                    "match_count": len(matches),
                    "matches": matches,
                })
                logger.info(f"FD: {len(matches)} matches for {league} {season}/{season+1}")

        except ProviderUnavailable:
            raise
        except (httpx.HTTPError, OSError, ValueError, TypeError) as exc:
            raise ProviderUnavailable(f"football-data {league}/{season}: {exc}") from exc

        return matches

    # ── ESPN fetcher ──

    async def _fetch_espn_windows(
        self, espn_id: str, league: str, season: int,
        windows: List[Tuple[datetime, datetime]],
    ) -> List[Dict[str, Any]]:
        """Fetch every past date; only HTTP 400 permits bounded daily fallback."""
        client = await self._get_client()
        today = self._today()
        chunks = [chunk for start, end in windows if start <= today
                  for chunk in self._date_chunks(start, min(end, today))]
        daily = False
        seen: Dict[str, Dict] = {}

        async def request(start, end):
            dates = start.strftime("%Y%m%d")
            if start != end:
                dates += "-" + end.strftime("%Y%m%d")
            url = (f"{ESPN_BASE}/site/v2/sports/soccer/{espn_id}/scoreboard"
                   f"?dates={dates}&limit=1000")
            response = await client.get(url)
            if response.status_code == 400 and start != end:
                return None
            if response.status_code != 200:
                raise ProviderUnavailable(f"ESPN {league} {dates}: HTTP {response.status_code}")
            try:
                payload = response.json()
            except ValueError as exc:
                raise ProviderUnavailable("ESPN returned invalid JSON") from exc
            if not isinstance(payload, dict) or not isinstance(payload.get("events"), list):
                raise ProviderUnavailable("ESPN response missing events list")
            if len(payload["events"]) >= 1000:
                raise ProviderUnavailable("ESPN event limit reached; coverage unverified")
            for event in payload["events"]:
                match = self._parse_espn_event(event, league, season)
                if match is None:  # Valid unplayed event, not an absent score.
                    continue
                played = datetime.fromisoformat(match["date"].replace("Z", "+00:00"))
                if played.tzinfo is not None:
                    played = played.astimezone(timezone.utc).replace(tzinfo=None)
                day = played.replace(hour=0, minute=0, second=0, microsecond=0)
                if not any(start <= day <= min(end, today) for start, end in windows):
                    raise ProviderUnavailable("ESPN final outside requested season")
                if match["match_id"] in seen and seen[match["match_id"]] != match:
                    raise ProviderUnavailable("conflicting ESPN event ID")
                seen[match["match_id"]] = match
            await asyncio.sleep(0.15)
            return True

        for index, (start, end) in enumerate(chunks):
            if not daily and await request(start, end) is not None:
                continue
            if not daily:
                # Reserve the entire remaining season before any daily probes.
                # A cold multi-year build must not explode into thousands of calls.
                required = sum((b - a).days + 1 for a, b in chunks[index:])
                if required > self.daily_fallback_budget:
                    raise ProviderUnavailable(
                        f"ESPN range rejected for {league}/{season}; daily fallback "
                        f"needs {required} requests, budget {self.daily_fallback_budget}. "
                        "Use a narrower season selection; no partial season accepted."
                    )
                self.daily_fallback_budget -= required
                daily = True
            day = start
            while day <= end:
                await request(day, day)
                day += timedelta(days=1)
        return list(seen.values())

    async def fetch_season_matches(
        self, league: str, season: int, force: bool = False
    ) -> List[Dict[str, Any]]:
        """Return a validated season or raise; failures never refresh cache metadata."""
        if (league, season) in CURATED_STATIC_ARCHIVES:
            # This explicitly registered offline archive has independent provenance.
            matches = self._load_cache(league, season)
            self._validate_matches(matches)
            if not matches:
                raise ProviderUnavailable("registered curated archive is unavailable")
            return matches
        if not force and self._is_cached(league, season):
            return self._load_cache(league, season)
        espn_id = ESPN_LEAGUES.get(league)
        if not espn_id:
            raise ProviderUnavailable(f"unknown ESPN league: {league}")
        windows = self._season_windows(league, season)
        try:
            matches = await self._fetch_espn_windows(espn_id, league, season, windows)
            self._check_refresh(self._cache_path(league, season), matches,
                                ended=max(end for _, end in windows) < self._today())
            if self.persist_cache:
                self._save_cache(league, season, matches)
            logger.info("Fetched %d matches for %s/%s", len(matches), league, season)
            return matches
        except ProviderUnavailable:
            raise
        except (httpx.HTTPError, OSError, ValueError, TypeError) as exc:
            raise ProviderUnavailable(f"ESPN {league}/{season}: {exc}") from exc

    def _parse_espn_event(self, event: Dict, league: str, season: int) -> Optional[Dict[str, Any]]:
        """Parse an ESPN event into a standardized match dict."""
        try:
            if not isinstance(event, dict) or not str(event.get("id") or "").strip():
                raise ProviderUnavailable("ESPN event missing ID")
            competition = event["competitions"][0]
            status = competition["status"]["type"]
            if type(status.get("completed")) is not bool:
                raise ProviderUnavailable("ESPN event missing completion status")
            if not status["completed"]:
                return None

            competitors = competition.get("competitors", [])
            if len(competitors) != 2:
                raise ProviderUnavailable("ESPN final missing competitors")

            home = next((c for c in competitors if c.get("homeAway") == "home"), None)
            away = next((c for c in competitors if c.get("homeAway") == "away"), None)
            if not home or not away:
                raise ProviderUnavailable("ESPN final missing home/away")
            for side in (home, away):
                if not str(side.get("team", {}).get("id") or "").strip():
                    raise ProviderUnavailable("ESPN final missing team ID")
                if (not isinstance(side.get("score"), (str, int))
                        or isinstance(side["score"], bool)
                        or not str(side["score"]).isdigit()):
                    raise ProviderUnavailable("ESPN final missing valid score")
            home_score = int(home["score"])
            away_score = int(away["score"])

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

            match = {
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
            self._validate_matches([match])
            return match
        except ProviderUnavailable:
            raise
        except (KeyError, IndexError, TypeError, ValueError, AttributeError) as exc:
            raise ProviderUnavailable("malformed ESPN event") from exc

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
        self._validate_matches(matches)
        end = max(end for _, end in self._season_windows(league, season))
        write_json_atomic(self._cache_path(league, season), {
            "league": league,
            "season": f"{season}/{season + 1}",
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "coverage_version": 1,
            "through": min(end, self._today()).strftime("%Y%m%d"),
            "match_count": len(matches),
            "matches": matches,
        })

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
