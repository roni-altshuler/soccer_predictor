"""Bounded, resumable current-season observations, separate from live data.

Only a fresh ESPN calendar with an explicit day whitelist can exclude days.
Receipts certify a successful dated response, never a partially fetched season.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx

from backend.services.data.provider_status import ProviderUnavailable, observation_time
from backend.services.prediction.historical_data import HistoricalDataCollector, current_season

logger = logging.getLogger(__name__)
RECEIPTS_PATH = Path(__file__).resolve().parents[2] / "data/ingestion/espn_receipts.sqlite"
ROUTINE_COMPETITIONS = {
    "eng.1": "premier_league", "esp.1": "la_liga", "ger.1": "bundesliga",
    "ita.1": "serie_a", "fra.1": "ligue_1", "usa.1": "mls",
}
REQUEST_BUDGET = 93


class CurrentSeasonRefresh:
    def __init__(self, path: Path = RECEIPTS_PATH, *, budget: int = REQUEST_BUDGET,
                 now: datetime | None = None, client: httpx.AsyncClient | None = None):
        if not 0 <= budget <= REQUEST_BUDGET:
            raise ValueError(f"request budget must be between 0 and {REQUEST_BUDGET}")
        self.now = now or datetime.now(timezone.utc)
        self.now = self.now.astimezone(timezone.utc)
        self.remaining = budget
        self.requests = 0
        self.client = client or httpx.AsyncClient(timeout=30)
        self.parser = HistoricalDataCollector(persist_cache=False)
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.execute("""CREATE TABLE IF NOT EXISTS receipts (
            competition TEXT, season INTEGER, day TEXT, fetched_at TEXT NOT NULL,
            body TEXT NOT NULL, digest TEXT NOT NULL,
            PRIMARY KEY(competition, season, day))""")
        self.db.execute("""CREATE TABLE IF NOT EXISTS invalidated (
            competition TEXT, season INTEGER, day TEXT,
            PRIMARY KEY(competition, season, day))""")
        self.db.commit()

    async def close(self):
        self.db.close()
        await self.client.aclose()
        await self.parser.close()

    async def _request(self, competition: str, day: str) -> dict:
        url = f"https://site.api.espn.com/apis/site/v2/sports/soccer/{competition}/scoreboard"
        for attempt in range(3):
            if self.remaining <= 0:
                raise ProviderUnavailable(
                    f"ESPN request budget exhausted after {self.requests} attempts; "
                    "validated receipts retained, selected coverage incomplete")
            self.remaining -= 1
            self.requests += 1
            await asyncio.sleep(0.25)
            try:
                response = await self.client.get(url, params={"dates": day, "limit": 1000})
            except httpx.HTTPError as exc:
                if attempt == 2:
                    raise ProviderUnavailable(f"ESPN {competition}/{day}: transport failure") from exc
                await asyncio.sleep(2 ** attempt)
                continue
            if response.status_code == 429 or 500 <= response.status_code < 600:
                if attempt == 2:
                    raise ProviderUnavailable(f"ESPN {competition}/{day}: HTTP {response.status_code}")
                delay = float(2 ** attempt)
                retry_after = response.headers.get("Retry-After")
                if retry_after:
                    try:
                        seconds = float(retry_after)
                        if not math.isfinite(seconds) or seconds < 0:
                            raise ProviderUnavailable("ESPN invalid Retry-After")
                        delay = max(delay, seconds)
                    except ValueError:
                        from email.utils import parsedate_to_datetime
                        try:
                            delay = max(delay, (parsedate_to_datetime(retry_after) - self.now).total_seconds())
                        except (ValueError, TypeError):
                            raise ProviderUnavailable("ESPN invalid Retry-After")
                    if delay > 10:
                        raise ProviderUnavailable("ESPN Retry-After exceeds bounded retry window; retry later")
                await asyncio.sleep(delay)
                continue
            if response.status_code != 200:
                raise ProviderUnavailable(f"ESPN {competition}/{day}: HTTP {response.status_code}")
            try:
                data = response.json()
            except ValueError as exc:
                raise ProviderUnavailable("ESPN invalid JSON") from exc
            if not isinstance(data, dict):
                raise ProviderUnavailable("ESPN invalid scoreboard object")
            return data
        raise AssertionError("unreachable")

    @staticmethod
    def _date(value: Any) -> datetime:
        if not isinstance(value, str):
            raise ProviderUnavailable("ESPN calendar/event date missing")
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                raise ValueError("timezone missing")
            return parsed.astimezone(timezone.utc)
        except ValueError as exc:
            raise ProviderUnavailable("ESPN invalid calendar/event date") from exc

    def _calendar(self, body: dict, competition: str, season: int) -> tuple[str, ...]:
        try:
            leagues = body["leagues"]
            if not isinstance(leagues, list) or len(leagues) != 1:
                raise ValueError("ambiguous league")
            league = leagues[0]
            if (league["slug"] != competition or type(league["season"]["year"]) is not int
                    or league["season"]["year"] != season
                    or league["calendarType"] != "day" or league["calendarIsWhitelist"] is not True):
                raise ValueError("calendar identity/whitelist mismatch")
            key = ROUTINE_COMPETITIONS[competition]
            start, end = self.parser._season_windows(key, season)[0]
            through = min(end.date(), self.now.date())
            if (self._date(league["calendarStartDate"]).date() > start.date()
                    or self._date(league["calendarEndDate"]).date() < through):
                raise ValueError("calendar does not cover season window")
            values = league["calendar"]
            if not isinstance(values, list):
                raise ValueError("invalid calendar list")
            days = [self._date(value).strftime("%Y%m%d") for value in values]
            if len(days) != len(set(days)):
                raise ValueError("duplicate calendar dates")
            # Future fixtures are schedule evidence, never final results.
            return tuple(sorted(day for day in days
                                if start.strftime("%Y%m%d") <= day <= through.strftime("%Y%m%d")))
        except (KeyError, TypeError, ValueError, IndexError) as exc:
            raise ProviderUnavailable(f"ESPN {competition}: invalid complete calendar") from exc

    def _events(self, body: dict, competition: str, season: int, day: str):
        events = body.get("events")
        if not isinstance(events, list) or len(events) >= 1000:
            raise ProviderUnavailable("ESPN invalid/saturated event list")
        key = ROUTINE_COMPETITIONS[competition]
        start, end = self.parser._season_windows(key, season)[0]
        matches = {}
        pending = not events  # A listed but empty day may later acquire a result.
        for event in events:
            try:
                valid_id = lambda value: (isinstance(value, (str, int))
                                           and not isinstance(value, bool) and bool(str(value).strip()))
                if not valid_id(event["id"]) or len(event["competitions"]) != 1:
                    raise ValueError("event identity")
                competitors = event["competitions"][0]["competitors"]
                if (not isinstance(competitors, list) or len(competitors) != 2
                        or {c["homeAway"] for c in competitors} != {"home", "away"}
                        or any(not valid_id(c["team"]["id"])
                               or not isinstance(c["team"]["displayName"], str)
                               or not c["team"]["displayName"].strip() for c in competitors)
                        or len({str(c["team"]["id"]) for c in competitors}) != 2):
                    raise ValueError("competitor identity")
            except (KeyError, TypeError, AttributeError, ValueError) as exc:
                raise ProviderUnavailable("ESPN malformed event identity/competitors") from exc
            match = self.parser._parse_espn_event(event, key, season)
            date = self._date(event.get("date"))
            query_date = datetime.strptime(day, "%Y%m%d").date()
            # ESPN labels MLS fixture days locally; UTC kickoffs can be next day.
            if abs((date.date() - query_date).days) > (1 if competition == "usa.1" else 0):
                raise ProviderUnavailable("ESPN event outside queried fixture day")
            if match is None:
                pending = True
                continue
            if not start.date() <= date.date() <= min(end.date(), self.now.date()):
                raise ProviderUnavailable("ESPN final outside requested past season")
            mid = match["match_id"]
            competition_body = event["competitions"][0]
            # The legacy collector substitutes stadium capacity for absent
            # attendance and zero cards for absent details. Routine recovery
            # keeps unobserved enrichment missing instead.
            attendance = competition_body.get("attendance")
            match["attendance"] = attendance if type(attendance) is int and attendance >= 0 else None
            if "details" not in competition_body:
                for field in ("home_yellows", "away_yellows", "home_reds", "away_reds"):
                    match[field] = None
            match["venue"] = match["venue"] or None
            if mid in matches and matches[mid] != match:
                raise ProviderUnavailable("ESPN conflicting event ID")
            matches[mid] = match
        return list(matches.values()), pending

    def _receipt(self, competition: str, season: int, day: str):
        if self.db.execute("SELECT 1 FROM invalidated WHERE competition=? AND season=? AND day=?",
                           (competition, season, day)).fetchone():
            return None
        row = self.db.execute("SELECT fetched_at, body, digest FROM receipts "
                              "WHERE competition=? AND season=? AND day=?",
                              (competition, season, day)).fetchone()
        if not row:
            return None
        try:
            fetched = self._date(row[0])
            if fetched > self.now or hashlib.sha256(row[1].encode()).hexdigest() != row[2]:
                raise ValueError("receipt digest/clock mismatch")
            body = json.loads(row[1])
            self._calendar(body, competition, season)
            matches, pending = self._events(body, competition, season, day)
        except (ValueError, TypeError, AttributeError, ProviderUnavailable):
            # Corrupt receipts can only cause a refetch, never false coverage.
            return None
        recent = datetime.strptime(day, "%Y%m%d").date() >= self.now.date() - timedelta(days=7)
        if (pending or recent) and self.now - fetched >= timedelta(hours=1):
            return None
        return matches, row[0]

    def _save(self, competition: str, season: int, day: str, body: dict):
        encoded = json.dumps(body, sort_keys=True, separators=(",", ":"))
        new_matches, _ = self._events(body, competition, season, day)
        self.db.execute("BEGIN IMMEDIATE")
        try:
            previous = self.db.execute("SELECT fetched_at, body, digest FROM receipts "
                                       "WHERE competition=? AND season=? AND day=?",
                                       (competition, season, day)).fetchone()
            if previous:
                previous_time = observation_time(previous[0])
                if self.now < previous_time:
                    raise ProviderUnavailable("older receipt cannot replace newer observation")
                # Corrupt bytes cannot be reused as evidence; a valid source
                # response may repair them, but not regress their timestamp.
                old_matches = None
                if hashlib.sha256(previous[1].encode()).hexdigest() == previous[2]:
                    try:
                        old_matches, _ = self._events(json.loads(previous[1]), competition, season, day)
                    except (ValueError, TypeError, AttributeError, ProviderUnavailable):
                        pass
                if old_matches is not None:
                    old_ids = {match["match_id"] for match in old_matches}
                    new_ids = {match["match_id"] for match in new_matches}
                    if not old_ids.issubset(new_ids):
                        raise ProviderUnavailable("refreshed receipt lost previously validated finals")
                    newer = {match["match_id"]: match for match in new_matches}
                    for match in old_matches:
                        if any(str(match[field]) != str(newer[match["match_id"]][field])
                               for field in ("home_team_id", "away_team_id", "season")):
                            raise ProviderUnavailable("refreshed receipt changed final event identity")
                    if self.now == previous_time and encoded != previous[1]:
                        raise ProviderUnavailable("equal-time receipt conflict")
            self.db.execute("INSERT OR REPLACE INTO receipts VALUES(?,?,?,?,?,?)",
                            (competition, season, day, self.now.isoformat(), encoded,
                             hashlib.sha256(encoded.encode()).hexdigest()))
            self.db.execute("DELETE FROM invalidated WHERE competition=? AND season=? AND day=?",
                            (competition, season, day))
            self.db.commit()
        except BaseException:
            self.db.rollback()
            raise

    def _invalidate(self, competition: str, season: int, days: list[str]):
        # Retain response bytes/timestamps as evidence, but do not reuse known
        # conflicting observations. A later run can revalidate both days.
        with self.db:
            self.db.executemany("INSERT OR IGNORE INTO invalidated VALUES(?,?,?)",
                                [(competition, season, day) for day in days])

    def _known_final_ids(self, competition: str, season: int) -> set[str]:
        """Also protect validated progress for days removed from a new calendar."""
        ids = set()
        for day, stamp, body, digest in self.db.execute(
                "SELECT day,fetched_at,body,digest FROM receipts WHERE competition=? AND season=?",
                (competition, season)):
            if observation_time(stamp) > self.now:
                raise ProviderUnavailable("receipt store has newer observations; retry with a fresh clock")
            if hashlib.sha256(body.encode()).hexdigest() != digest:
                continue  # Required dates will be revalidated, never reused.
            try:
                matches, _ = self._events(json.loads(body), competition, season, day)
            except (ValueError, TypeError, AttributeError, ProviderUnavailable):
                continue
            ids.update(match["match_id"] for match in matches)
        return ids

    async def fetch(self, competitions: list[str]) -> dict[str, tuple[int, list[dict]]]:
        if not competitions or len(competitions) != len(set(competitions)) or any(
                comp not in ROUTINE_COMPETITIONS for comp in competitions):
            raise ProviderUnavailable("routine refresh requires an explicit supported competition scope")
        calendars = {}
        # Reserve discovery by doing it first; every invocation gets fresh scope.
        for comp in competitions:
            season = current_season(ROUTINE_COMPETITIONS[comp], self.now)
            body = await self._request(comp, self.now.strftime("%Y%m%d"))
            days = self._calendar(body, comp, season)
            self._events(body, comp, season, self.now.strftime("%Y%m%d"))
            calendars[comp] = (season, days)
        selected = {}
        for comp, (season, days) in calendars.items():
            previous_ids = self._known_final_ids(comp, season)
            matches = {}
            origins = {}
            observations = {}
            for index, day in enumerate(days):
                receipt = self._receipt(comp, season, day)
                if receipt is None:
                    if self.remaining == 0:
                        logger.error("%s/%s has %s required dates remaining; scope incomplete",
                                     comp, season, len(days) - index)
                    body = await self._request(comp, day)
                    if self._calendar(body, comp, season) != days:
                        raise ProviderUnavailable("ESPN calendar changed during refresh; retry from fresh scope")
                    daily, _ = self._events(body, comp, season, day)
                    self._save(comp, season, day, body)
                    observed_at = self.now.isoformat()
                else:
                    daily, observed_at = receipt
                for match in daily:
                    mid = match["match_id"]
                    if mid in matches and matches[mid] != match:
                        self._invalidate(comp, season, [day, origins[mid]])
                        raise ProviderUnavailable("ESPN conflicting event across date receipts")
                    matches[mid] = match
                    origins[mid] = day
                    if mid not in observations or observation_time(observed_at) > observation_time(observations[mid]):
                        observations[mid] = observed_at
            previous_ids.update(self._known_final_ids(comp, season))
            if not previous_ids.issubset(matches):
                raise ProviderUnavailable("selected calendar lost previously validated receipt finals")
            selected[comp] = (season, [dict(match, _observed_at=observations[mid])
                                     for mid, match in matches.items()])
            logger.info("Validated %s/%s: %s fixture dates, %s final events", comp, season,
                        len(days), len(matches))
        logger.info("Selected coverage complete: %s competitions, %s HTTP attempts (cap %s)",
                    len(selected), self.requests, REQUEST_BUDGET)
        return selected
