"""Ingest-side guards in the football-data.co.uk loader.

These cover the two things that made a rebuild reproduce the damage rather
than fix it: resolving a club to a brand-new team id, and then inserting a
duplicate fixture because the lookup keys on that id.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import pytest

from backend.services.data.footballdata_loader import (
    FD_VENUE_TIMEZONE_OVERRIDES,
    _find_fixture_in_season,
    _load_one,
    _season_code,
    _venue_timezone,
    fetch_kickoff_times,
)
from backend.services.data.team_resolver import TeamResolver
from backend.services.data.warehouse import MatchRow, Warehouse


@pytest.fixture()
def wh(tmp_path):
    warehouse = Warehouse(tmp_path / "fd.sqlite")
    warehouse.migrate()
    warehouse.upsert_competition("eng.1", "Premier League", "M", country="GB", tier=1)
    yield warehouse
    warehouse.close()


class _FakeCollector:
    """Stands in for HistoricalDataCollector — no network, no cache."""

    def __init__(self, rows):
        self.rows = rows

    async def fetch_football_data_season(self, league, season, force=False):
        return self.rows

    async def close(self):
        return None


def _fd_row(home, away, date="2020-09-05T00:00:00", **kw):
    row = {
        "date": date, "home_team": home, "away_team": away,
        "home_score": 2, "away_score": 1, "season": 2020,
        "match_id": f"fd_{home}_{away}",
    }
    row.update(kw)
    return row


class TestSeasonCode:
    @pytest.mark.parametrize("season,expected", [
        (2005, "0506"), (2019, "1920"), (2024, "2425"), (2025, "2526"), (1999, "9900"),
    ])
    def test_season_code(self, season, expected):
        assert _season_code(season) == expected


class TestVenueTimezone:
    def test_league_default(self):
        assert str(_venue_timezone("premier_league", "Arsenal")) == "Europe/London"
        assert str(_venue_timezone("bundesliga", "Bayern Munich")) == "Europe/Berlin"

    def test_island_clubs_override_the_league_default(self):
        """Las Palmas is an hour behind mainland Spain; using Europe/Madrid
        would put every home kickoff 60 minutes out."""
        assert str(_venue_timezone("la_liga", "Las Palmas")) == "Atlantic/Canary"
        assert str(_venue_timezone("la_liga", "Sevilla")) == "Europe/Madrid"

    def test_every_override_names_a_real_zone(self):
        from zoneinfo import ZoneInfo
        for (_league, _team), tz in FD_VENUE_TIMEZONE_OVERRIDES.items():
            assert ZoneInfo(tz) is not None


class TestKickoffTimes:
    def test_missing_time_column_yields_no_kickoffs(self):
        """Pre-2019-20 files have no Time column; that is genuine
        missingness and must not raise or invent one."""
        class _Resp:
            status_code = 200
            text = "Date,HomeTeam,AwayTeam,FTHG,FTAG\n05/09/2020,Arsenal,Chelsea,2,1\n"

        class _Client:
            async def get(self, *a, **k):
                return _Resp()

        assert asyncio.run(fetch_kickoff_times(_Client(), "premier_league", 2015)) == {}

    def test_time_column_is_parsed(self):
        class _Resp:
            status_code = 200
            text = (
                "Date,Time,HomeTeam,AwayTeam,FTHG,FTAG\n"
                "05/09/2020,15:00,Arsenal,Chelsea,2,1\n"
                "06/09/2020,17:30,Everton,Fulham,1,1\n"
            )

        class _Client:
            async def get(self, *a, **k):
                return _Resp()

        out = asyncio.run(fetch_kickoff_times(_Client(), "premier_league", 2020))
        assert out[("2020-09-05", "Arsenal", "Chelsea")] == "15:00"
        assert out[("2020-09-06", "Everton", "Fulham")] == "17:30"

    def test_network_failure_is_not_fatal(self):
        class _Client:
            async def get(self, *a, **k):
                raise RuntimeError("connection reset")

        assert asyncio.run(fetch_kickoff_times(_Client(), "premier_league", 2020)) == {}

    def test_kickoff_is_applied_to_the_stored_row(self, wh):
        resolver = TeamResolver(wh, gender_default="M")
        collector = _FakeCollector([_fd_row("Arsenal", "Chelsea")])
        stats = asyncio.run(_load_one(
            collector, wh, resolver, league="premier_league", season=2020, force=False,
            kickoffs={("2020-09-05", "Arsenal", "Chelsea"): "15:00"},
        ))
        assert stats.kickoffs_applied == 1
        stored = wh._conn.execute("SELECT date_utc FROM matches").fetchone()[0]
        # 15:00 BST in September is 14:00 UTC.
        assert stored.startswith("2020-09-05T14:00:00")

    def test_without_a_kickoff_the_row_stays_at_midnight_utc(self, wh):
        """Midnight means 'date known, kickoff unknown' — never a guess."""
        resolver = TeamResolver(wh, gender_default="M")
        collector = _FakeCollector([_fd_row("Arsenal", "Chelsea")])
        stats = asyncio.run(_load_one(
            collector, wh, resolver, league="premier_league", season=2020, force=False,
        ))
        assert stats.kickoffs_applied == 0
        stored = wh._conn.execute("SELECT date_utc FROM matches").fetchone()[0]
        assert stored.startswith("2020-09-05T00:00:00")


class TestDuplicateGuard:
    def test_fd_row_enriches_the_existing_espn_row(self, wh):
        """The whole point of the alias fix: 'Man United' must land on the
        ESPN 'Manchester United' row and add its odds, not create a second
        fixture."""
        resolver = TeamResolver(wh, gender_default="M")
        home = resolver.resolve("Manchester United", gender="M").team_id
        away = resolver.resolve("Chelsea", gender="M").team_id
        wh.upsert_matches([MatchRow(
            match_id="espn_1", source="espn", competition_id="eng.1", season=2020,
            date_utc="2020-09-05T15:00:00+00:00", home_team_id=home, away_team_id=away,
            home_score=2, away_score=1, venue="Old Trafford",
        )])

        collector = _FakeCollector([
            _fd_row("Man United", "Chelsea", odds_home=2.1, odds_draw=3.3, odds_away=3.6)
        ])
        stats = asyncio.run(_load_one(
            collector, wh, resolver, league="premier_league", season=2020, force=False,
        ))
        assert stats.enriched == 1
        assert stats.inserted == 0
        assert wh._conn.execute("SELECT COUNT(*) FROM matches").fetchone()[0] == 1
        row = wh._conn.execute("SELECT * FROM matches").fetchone()
        assert row["odds_home"] == 2.1
        assert row["venue"] == "Old Trafford"

    def test_wide_date_disagreement_still_enriches_instead_of_inserting(self, wh):
        """A postponement moved beyond the ±2-day window used to create a
        duplicate; the season-scoped fallback catches it."""
        resolver = TeamResolver(wh, gender_default="M")
        home = resolver.resolve("Arsenal", gender="M").team_id
        away = resolver.resolve("Chelsea", gender="M").team_id
        wh.upsert_matches([MatchRow(
            match_id="espn_1", source="espn", competition_id="eng.1", season=2020,
            date_utc="2020-11-20T15:00:00+00:00", home_team_id=home, away_team_id=away,
            home_score=2, away_score=1,
        )])

        collector = _FakeCollector([_fd_row("Arsenal", "Chelsea", date="2020-09-05T00:00:00")])
        stats = asyncio.run(_load_one(
            collector, wh, resolver, league="premier_league", season=2020, force=False,
        ))
        assert stats.inserted == 0
        assert stats.duplicates_skipped == 1
        assert wh._conn.execute("SELECT COUNT(*) FROM matches").fetchone()[0] == 1

    def test_source_file_listing_a_fixture_twice_inserts_once(self, wh):
        resolver = TeamResolver(wh, gender_default="M")
        collector = _FakeCollector([
            _fd_row("Arsenal", "Chelsea"),
            _fd_row("Arsenal", "Chelsea", date="2020-09-06T00:00:00"),
        ])
        stats = asyncio.run(_load_one(
            collector, wh, resolver, league="premier_league", season=2020, force=False,
        ))
        assert stats.duplicates_skipped == 1
        assert wh._conn.execute("SELECT COUNT(*) FROM matches").fetchone()[0] == 1

    def test_reverse_fixture_is_not_treated_as_a_duplicate(self, wh):
        """Home and away legs are different fixtures."""
        resolver = TeamResolver(wh, gender_default="M")
        collector = _FakeCollector([
            _fd_row("Arsenal", "Chelsea"),
            _fd_row("Chelsea", "Arsenal", date="2021-02-06T00:00:00"),
        ])
        stats = asyncio.run(_load_one(
            collector, wh, resolver, league="premier_league", season=2020, force=False,
        ))
        assert stats.inserted == 2
        assert stats.duplicates_skipped == 0

    def test_find_fixture_in_season_is_season_scoped(self, wh):
        resolver = TeamResolver(wh, gender_default="M")
        home = resolver.resolve("Arsenal", gender="M").team_id
        away = resolver.resolve("Chelsea", gender="M").team_id
        wh.upsert_matches([MatchRow(
            match_id="m2019", source="espn", competition_id="eng.1", season=2019,
            date_utc="2019-09-05T15:00:00+00:00", home_team_id=home, away_team_id=away,
            home_score=1, away_score=1,
        )])
        assert _find_fixture_in_season(
            wh, competition_id="eng.1", season=2019, home_team_id=home, away_team_id=away
        ) == "m2019"
        assert _find_fixture_in_season(
            wh, competition_id="eng.1", season=2020, home_team_id=home, away_team_id=away
        ) is None

    def test_rerunning_the_loader_is_idempotent(self, wh):
        resolver = TeamResolver(wh, gender_default="M")
        rows = [_fd_row("Arsenal", "Chelsea"), _fd_row("Everton", "Fulham")]
        for _ in range(3):
            asyncio.run(_load_one(
                _FakeCollector(rows), wh, resolver,
                league="premier_league", season=2020, force=False,
            ))
        assert wh._conn.execute("SELECT COUNT(*) FROM matches").fetchone()[0] == 2
        assert wh.find_duplicate_fixtures() == []


class TestResolverPinning:
    def test_pinned_spelling_beats_a_closer_fuzzy_match(self, wh):
        """'Heidenheim' scores 0.70 against 'Hoffenheim'. Without the pin
        the fuzzy pass is the only thing standing between them."""
        resolver = TeamResolver(wh, gender_default="M")
        hoffenheim = resolver.resolve("Hoffenheim", gender="M").team_id
        heidenheim = resolver.resolve("Heidenheim", gender="M").team_id
        assert heidenheim != hoffenheim
        assert resolver.resolve("1. FC Heidenheim", gender="M").team_id == heidenheim

    def test_football_data_and_espn_spellings_converge(self, wh):
        resolver = TeamResolver(wh, gender_default="M")
        for fd_name, espn_name in (
            ("Swansea", "Swansea City"),
            ("Ath Madrid", "Atletico Madrid"),
            ("FC Koln", "FC Cologne"),
            ("Sp Lisbon", "Sporting CP"),
            ("Verona", "Hellas Verona"),
            ("St Etienne", "Saint-Étienne"),
        ):
            assert resolver.resolve(fd_name, gender="M").team_id == \
                   resolver.resolve(espn_name, gender="M").team_id, fd_name

    def test_two_ajaccio_clubs_stay_apart(self, wh):
        resolver = TeamResolver(wh, gender_default="M")
        ac = resolver.resolve("Ajaccio", gender="M").team_id
        gfc = resolver.resolve("Ajaccio GFCO", gender="M").team_id
        assert ac != gfc

    def test_understat_spellings_resolve(self, wh):
        resolver = TeamResolver(wh, gender_default="M")
        for understat, canonical in (
            ("Borussia M.Gladbach", "Borussia Monchengladbach"),
            ("RasenBallsport Leipzig", "RB Leipzig"),
            ("Mainz 05", "Mainz"),
            ("Hamburger SV", "Hamburg SV"),
            ("Parma Calcio 1913", "Parma"),
        ):
            assert resolver.resolve(understat, gender="M").team_id == \
                   resolver.resolve(canonical, gender="M").team_id, understat

    def test_near_duplicates_are_recorded_for_review(self, wh):
        """A 0.85-0.92 near-miss creates a separate team (correctly — it may
        be two real clubs) but must be surfaced, because an unpinned split
        identity is exactly what halved six clubs' history."""
        from backend.services.data.team_resolver import _similarity

        first, second = "Rapid Wien", "Rapid Wein"
        assert 0.85 <= _similarity(first, second) < 0.92, "test pair left the review band"

        resolver = TeamResolver(wh, gender_default="M")
        a = resolver.resolve(first, gender="M").team_id
        b = resolver.resolve(second, gender="M").team_id
        assert a != b
        assert [(n, e) for n, e, _s in resolver.near_duplicates] == [(second, first)]

    def test_a_confident_fuzzy_match_is_merged_silently(self, wh):
        from backend.services.data.team_resolver import _similarity

        assert _similarity("Sturm Graz", "Sturm Grazz") >= 0.92
        resolver = TeamResolver(wh, gender_default="M")
        a = resolver.resolve("Sturm Graz", gender="M").team_id
        b = resolver.resolve("Sturm Grazz", gender="M").team_id
        assert a == b
        assert resolver.near_duplicates == []
