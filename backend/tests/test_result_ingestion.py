"""The live path: results have to reach the warehouse, or nothing re-syncs.

Every forecast on `/season` is republished as results land. That promise has
one dependency — ESPN ingestion actually collecting the matches that were
played — and two bugs had quietly broken it in different ways:

  A HARD-CODED SEASON RANGE.  `AVAILABLE_SEASONS` ended at 2025, so from the
  first kickoff of 2026/27 the ingester was asked for a season it did not
  believe existed and fetched nothing. The Eredivisie and the Primeira Liga
  had both started with zero results stored; MLS was 270 matches into a
  season that the warehouse thought had not begun.

  A WEEKLY SINGLE-DAY PROBE.  The collector queried one date every seven,
  which samples one weekday out of the week. Measured against the same
  endpoint's range query, that returned 26 of 56 Premier League matches for
  December 2025, and 0 of 37 Bundesliga matches for September 2016 — a whole
  season empty whenever the probe weekday was one that league does not play.
  Twenty-five of 375 cached seasons were empty for this reason.

Both were invisible from the outside: the seven leagues with a
football-data.co.uk CSV were backfilled from there, and those are the seven
whose numbers anyone was looking at.

These tests are offline. They pin the shape of what is requested, not what
comes back.
"""
from __future__ import annotations

from datetime import datetime

import pytest

from backend.services.prediction import historical_data as H


# ── the season a hard-coded range stops being true ──────────────────────

def test_the_current_season_is_computed_not_written_down():
    """August is when a hard-coded end year turns into a silent outage."""
    assert H.current_season("premier_league", datetime(2026, 8, 12)) == 2026
    assert H.current_season("premier_league", datetime(2026, 7, 1)) == 2026
    # Before July, the season in progress is the one that started last year.
    assert H.current_season("premier_league", datetime(2026, 6, 30)) == 2025
    assert H.current_season("premier_league", datetime(2027, 2, 1)) == 2026


def test_a_calendar_year_league_turns_over_in_january():
    """MLS and the Brasileirão label a season by its year, not by two."""
    assert H.current_season("mls", datetime(2026, 2, 1)) == 2026
    assert H.current_season("brasileirao", datetime(2026, 2, 1)) == 2026
    # ...which is a different answer from the European one on the same day.
    assert H.current_season("premier_league", datetime(2026, 2, 1)) == 2025


def test_every_league_can_be_fetched_for_the_season_in_progress():
    """The regression that stopped the Eredivisie and MLS being ingested."""
    for league in H.SEASON_STARTS:
        seasons = H.seasons_for(league)
        assert seasons[-1] == H.current_season(league), (
            f"{league} can only be fetched up to {seasons[-1]}, but the season "
            f"in progress is {H.current_season(league)} — its results would "
            f"never reach the warehouse")


def test_the_odds_source_covers_the_season_in_progress_too():
    """Otherwise this season's matches arrive without the odds every prior
    season has, which is a train/serve skew rather than a gap."""
    for league, seasons in H.FOOTBALL_DATA_SEASONS.items():
        assert seasons[-1] == H.current_season(league), league


def test_season_ranges_extend_rather_than_expire():
    """A range built from a start year cannot go stale; a literal end can."""
    far_future = datetime(2031, 9, 1)
    assert H.seasons_for("premier_league", far_future)[-1] == 2031
    assert H.seasons_for("championship", far_future)[-1] == 2031


# ── the sampler that dropped six days in seven ──────────────────────────

class _Recorder:
    """Stands in for the HTTP client and writes down what was asked for."""

    def __init__(self):
        self.urls = []

    async def get(self, url, **kwargs):
        self.urls.append(url)

        class _Empty:
            status_code = 200

            @staticmethod
            def json():
                return {"events": []}

        return _Empty()


def _requested_days(league: str, season: int, tmp_path) -> set:
    """Every calendar day the collector actually asks ESPN about.

    Drives `fetch_season_matches` itself rather than re-deriving the date
    maths, because the bug WAS in that function: the chunking helper was
    always correct, and domestic leagues simply did not use it.
    """
    import asyncio
    import re
    from datetime import date, timedelta

    collector = H.HistoricalDataCollector()
    collector.data_dir = tmp_path
    recorder = _Recorder()

    async def _client():
        return recorder

    collector._get_client = _client

    async def _no_wait(_seconds):  # the courtesy delay has nothing to be
        return None                # courteous to here

    real_sleep, H.asyncio.sleep = H.asyncio.sleep, _no_wait
    try:
        asyncio.run(collector.fetch_season_matches(league, season, force=True))
    finally:
        H.asyncio.sleep = real_sleep

    days = set()
    for url in recorder.urls:
        raw = re.search(r"dates=([0-9-]+)", url).group(1)
        parts = raw.split("-")
        start = datetime.strptime(parts[0], "%Y%m%d").date()
        end = datetime.strptime(parts[-1], "%Y%m%d").date()
        day = start
        while day <= end:
            days.add(day)
            day += timedelta(days=1)
    assert days, "no request was made at all"
    return days


def _window_days(league: str, season: int) -> set:
    collector = H.HistoricalDataCollector()
    days = set()
    for start, end in collector._season_windows(league, season):
        day = start
        while day <= end:
            days.add(day.date())
            day += H.timedelta(days=1)
    return days


@pytest.mark.parametrize("league", ["premier_league", "bundesliga",
                                    "championship", "mls", "brasileirao"])
def test_no_day_of_the_season_goes_unqueried(league, tmp_path):
    """A Sunday fixture is not less real than a Saturday one.

    The old weekly probe asked about one day in seven; this asserts the
    covering property against the requests actually issued, so any future
    scheme is held to the same bar.
    """
    assert _requested_days(league, 2026, tmp_path) == _window_days(league, 2026)


def test_a_calendar_year_season_is_fetched_from_january():
    """The Brasileirão starts in April and was being fetched on the European
    August-to-June window, which missed the first four months outright and
    labelled the rest as the previous season."""
    days = _window_days("brasileirao", 2026)
    assert min(days).isoformat() == "2026-01-01"
    assert max(days).isoformat() == "2026-12-31"


def test_a_european_season_covers_a_july_finish():
    """2019/20 ended on 26 July 2020. A June cutoff dropped its last month."""
    days = _window_days("premier_league", 2019)
    assert datetime(2020, 7, 26).date() in days


def test_the_requested_ranges_are_ranges_not_single_days():
    """One request per month, not one per week — the same endpoint, asked a
    question that can return every match instead of one weekday's."""
    collector = H.HistoricalDataCollector()
    start, end = collector._season_windows("premier_league", 2026)[0]
    chunks = collector._date_chunks(start, end)
    assert len(chunks) <= 13, "a season is being probed date by date again"
    assert all(a != b for a, b in chunks)


# ── an empty cache is a failure, not a fact ─────────────────────────────

def test_a_season_cached_as_empty_is_refetched(tmp_path):
    """25 seasons were permanently empty because the miss got written down
    and every later run read it back."""
    collector = H.HistoricalDataCollector()
    collector.data_dir = tmp_path
    collector._save_cache("bundesliga", 2016, [])
    assert not collector._is_cached("bundesliga", 2016)

    collector._save_cache("bundesliga", 2016, [{"match_id": "1"}])
    assert collector._is_cached("bundesliga", 2016)


# ── the corpus guard ────────────────────────────────────────────────────

def test_the_corpus_guard_covers_every_league_the_site_serves():
    from backend.scripts.forecast_season import LEAGUES
    from backend.scripts.verify_corpus import served_leagues

    assert set(served_leagues()) == set(LEAGUES)


def test_the_corpus_guard_fails_on_a_league_that_vanished():
    from backend.scripts.verify_corpus import check

    leagues = {"eng.1": "Premier League", "eng.2": "EFL Championship"}
    baseline = {"eng.1": 9880, "eng.2": 6679}

    assert not check({"eng.1": 9880, "eng.2": 6679}, baseline, leagues)

    gone = check({"eng.1": 9880}, baseline, leagues)
    assert gone and "eng.2" in gone[0]

    shrunk = check({"eng.1": 9880, "eng.2": 4000}, baseline, leagues)
    assert shrunk and "2679" in shrunk[0]

    # A correction of one or two is not damage.
    assert not check({"eng.1": 9879, "eng.2": 6679}, baseline, leagues)


def test_the_corpus_guard_notices_a_league_it_has_never_measured():
    """Silence would let a new league ship with no floor under it at all."""
    from backend.scripts.verify_corpus import check

    problems = check({"eng.1": 9880, "new.1": 500},
                     {"eng.1": 9880},
                     {"eng.1": "Premier League", "new.1": "Somewhere"})
    assert problems and problems[0].startswith("NOTE")
