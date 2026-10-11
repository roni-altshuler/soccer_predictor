"""Bounded historical/current ESPN receipts for the existing men's training scope.

A proven complete calendar may exclude dates. Otherwise every past date in the
legacy season window is required. Neither branch certifies partial coverage.
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import timedelta
from pathlib import Path

from backend.services.data.espn_refresh import REQUEST_BUDGET, CurrentSeasonRefresh
from backend.services.data.provider_status import ProviderUnavailable, observation_time
from backend.services.prediction.historical_data import (
    CURATED_STATIC_ARCHIVES,
    ESPN_BASE,
    ESPN_LEAGUES,
)

TRAINING_RECEIPTS_PATH = (
    Path(__file__).resolve().parents[2] / "data/ingestion/espn_training_receipts.sqlite"
)
logger = logging.getLogger(__name__)


class TrainingSeasonRefresh(CurrentSeasonRefresh):
    competition_keys = {slug: key for key, slug in ESPN_LEAGUES.items()}
    scoreboard_url = ESPN_BASE + "/site/v2/sports/soccer/{competition}/scoreboard"
    local_day_competitions = {"usa.1", "bra.1"}

    def __init__(self, path=TRAINING_RECEIPTS_PATH, **kwargs):
        super().__init__(path, **kwargs)
        self.db.execute("""CREATE TABLE IF NOT EXISTS calendars (
            competition TEXT, season INTEGER, fetched_at TEXT NOT NULL,
            body TEXT NOT NULL, digest TEXT NOT NULL,
            PRIMARY KEY(competition, season))""")
        self.db.commit()

    def _windows(self, competition, season):
        return self.parser._season_windows(self.competition_keys[competition], season)

    def _ended(self, competition, season):
        return (
            max(end.date() for _, end in self._windows(competition, season))
            < self.now.date()
        )

    def _calendar(self, body, competition, season):
        # Metadata for a historical date can describe today's season. It cannot
        # exclude historical dates. A foreign competition remains an error.
        if "leagues" in body:
            leagues = body["leagues"]
            if (
                not isinstance(leagues, list)
                or len(leagues) != 1
                or not isinstance(leagues[0], dict)
                or leagues[0].get("slug") != competition
            ):
                raise ProviderUnavailable("ESPN training competition identity mismatch")
        try:
            return super()._calendar(body, competition, season)
        except ProviderUnavailable:
            days = set()
            for start, end in self._windows(competition, season):
                day, through = start.date(), min(end.date(), self.now.date())
                while day <= through:
                    days.add(day.strftime("%Y%m%d"))
                    day += timedelta(days=1)
            return tuple(sorted(days))

    def _expired(self, competition, season, day, body, pending, fetched):
        # Valid empty dates of a finished season are durable coverage receipts.
        # Re-fetching them weekly would spend the cap on the same empty prefix.
        if self._ended(competition, season) and not body["events"]:
            return False
        return super()._expired(competition, season, day, body, pending, fetched)

    def _saved_calendar(self, competition, season):
        row = self.db.execute(
            "SELECT fetched_at,body,digest FROM calendars "
            "WHERE competition=? AND season=?",
            (competition, season),
        ).fetchone()
        if not row:
            return None
        if observation_time(row[0]) > self.now:
            raise ProviderUnavailable(
                "calendar store has newer observations; retry with a fresh clock"
            )
        if not self._ended(competition, season):
            return None  # Current coverage always gets a new discovery request.
        try:
            if hashlib.sha256(row[1].encode()).hexdigest() != row[2]:
                return None
            body = json.loads(row[1])
            days = self._calendar(body, competition, season)
            start = min(start for start, _ in self._windows(competition, season))
            self._events(body, competition, season, start.strftime("%Y%m%d"))
            return days
        except (ValueError, TypeError, AttributeError, ProviderUnavailable):
            return None

    def _save_calendar(self, competition, season, body):
        encoded = json.dumps(body, sort_keys=True, separators=(",", ":"))
        self.db.execute("BEGIN IMMEDIATE")
        try:
            previous = self.db.execute(
                "SELECT fetched_at,body FROM calendars "
                "WHERE competition=? AND season=?",
                (competition, season),
            ).fetchone()
            if previous:
                stamp = observation_time(previous[0])
                if self.now < stamp or (self.now == stamp and encoded != previous[1]):
                    raise ProviderUnavailable(
                        "calendar observation regressed or equal-time conflict"
                    )
            self.db.execute(
                "INSERT OR REPLACE INTO calendars VALUES(?,?,?,?,?)",
                (
                    competition,
                    season,
                    self.now.isoformat(),
                    encoded,
                    hashlib.sha256(encoded.encode()).hexdigest(),
                ),
            )
            self.db.commit()
        except BaseException:
            self.db.rollback()
            raise

    async def fetch_seasons(self, scope):
        if (
            not scope
            or len(scope) != len(set(scope))
            or any(
                comp not in self.competition_keys
                or type(season) is not int
                or not 1 <= season < 9999
                for comp, season in scope
            )
        ):
            raise ProviderUnavailable(
                "training refresh requires valid distinct competition-seasons"
            )
        selected: dict[tuple[str, int], list[dict]] = {}
        # Finish historical progress before current results; the latter always
        # require fresh calendars and recent/pending dated observations.
        scope = sorted(scope, key=lambda item: (not self._ended(*item), item))
        for comp, season in scope:
            if (self.competition_keys[comp], season) in CURATED_STATIC_ARCHIVES:
                raise ProviderUnavailable(
                    "curated static archives require the existing offline loader"
                )
            start = min(start for start, _ in self._windows(comp, season))
            if start.date() > self.now.date():
                # No past dates yet; not historical coverage.
                selected[comp, season] = []
                continue
            days = self._saved_calendar(comp, season)
            if days is None:
                # A dated season-start response avoids an ambiguous off-season
                # default calendar. Its events must belong to the requested day.
                body = await self._request(comp, start.strftime("%Y%m%d"))
                days = self._calendar(body, comp, season)
                self._events(body, comp, season, start.strftime("%Y%m%d"))
                self._save_calendar(comp, season, body)
                if start.strftime("%Y%m%d") in days:
                    self._save(comp, season, start.strftime("%Y%m%d"), body)
            rows = (await self._fetch_selected({(comp, season): days}))[comp, season]
            if self._ended(comp, season) and not rows:
                raise ProviderUnavailable(
                    f"ESPN {comp}/{season}: completed season returned no results"
                )
            selected[comp, season] = rows
        logger.info(
            "Training selected coverage complete: %s competition-seasons, "
            "%s HTTP attempts (cap %s)",
            len(selected),
            self.requests,
            REQUEST_BUDGET,
        )
        return selected
