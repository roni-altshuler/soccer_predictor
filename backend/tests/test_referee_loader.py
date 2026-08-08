"""ESPN referee enrichment.

Context for anyone changing this: football-data.co.uk publishes a
`Referee` column for the Premier League only (all 21 seasons) plus Serie A
2005-06 and 2006-07. It has never published one for La Liga, the
Bundesliga, Ligue 1, the Eredivisie or the Primeira Liga. The 0% referee
coverage in those leagues is a source limitation, not a parsing bug, and
ESPN's per-match summary is the only feed here that carries officials.
"""

from __future__ import annotations

import asyncio
import json

import pytest

from backend.services.data.referee_loader import (
    extract_referee,
    load_referees,
    parse_match_id,
)
from backend.services.data.warehouse import MatchRow, Warehouse


@pytest.fixture()
def wh(tmp_path):
    warehouse = Warehouse(tmp_path / "ref.sqlite")
    warehouse.migrate()
    warehouse.upsert_competition("ger.1", "Bundesliga", "M", country="DE", tier=1)
    yield warehouse
    warehouse.close()


def _match(wh, match_id, home, away, comp="ger.1", season=2023):
    """Defaults to a season ESPN actually publishes officials for."""
    wh.upsert_matches([MatchRow(
        match_id=match_id, source="espn" if match_id.startswith("espn") else "fdcouk",
        competition_id=comp, season=season,
        date_utc=f"{season}-09-05T15:00:00+00:00",
        home_team_id=home, away_team_id=away, home_score=1, away_score=0,
    )])


class TestParseMatchId:
    @pytest.mark.parametrize("match_id,expected", [
        ("espn_ger.1_517847", ("ger.1", "517847")),
        ("espn_eng.1_638001", ("eng.1", "638001")),
        ("fd_serie_a_20200802_Spal_Fiorentina", None),
        ("fdcouk_ger.1_2020-09-05_1_2", None),
        ("", None),
        ("espn_ger.1_notanumber", None),
    ])
    def test_parse(self, match_id, expected):
        assert parse_match_id(match_id) == expected


class TestExtractReferee:
    def test_takes_the_official_with_order_one(self):
        payload = {"gameInfo": {"officials": [
            {"fullName": "Assistant One", "order": 2},
            {"fullName": "Tobias Reichel", "order": 1},
            {"fullName": "Fourth Official", "order": 4},
        ]}}
        assert extract_referee(payload) == "Tobias Reichel"

    def test_falls_back_to_the_first_named_official(self):
        payload = {"gameInfo": {"officials": [{"displayName": "Mario Melero López"}]}}
        assert extract_referee(payload) == "Mario Melero López"

    @pytest.mark.parametrize("payload", [
        {}, {"gameInfo": {}}, {"gameInfo": {"officials": None}},
        {"gameInfo": {"officials": []}}, {"gameInfo": {"officials": [{"fullName": "  "}]}},
    ])
    def test_absent_officials_stay_absent(self, payload):
        """No referee must mean NULL, never a placeholder name."""
        assert extract_referee(payload) is None


class _FakeResponse:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status_code = status

    def json(self):
        return self._payload


class _FakeClient:
    """Serves canned summaries and counts requests."""

    def __init__(self, by_event):
        self.by_event = by_event
        self.requests = 0

    async def get(self, url, **kw):
        self.requests += 1
        event = url.split("event=")[-1]
        if event not in self.by_event:
            return _FakeResponse(None, status=404)
        return _FakeResponse(self.by_event[event])

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


@pytest.fixture()
def patched_client(monkeypatch):
    holder = {}

    def _install(by_event):
        client = _FakeClient(by_event)
        holder["client"] = client
        monkeypatch.setattr(
            "backend.services.data.referee_loader.httpx.AsyncClient",
            lambda **kw: client,
        )
        return client

    return _install


@pytest.fixture(autouse=True)
def isolated_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "backend.services.data.referee_loader.CACHE_DIR", tmp_path / "espn_summary"
    )


class TestLoadReferees:
    def test_sets_referee_and_creates_the_referees_row(self, wh, patched_client):
        a, b = wh.upsert_team(canonical_name="A", gender="M"), wh.upsert_team(canonical_name="B", gender="M")
        _match(wh, "espn_ger.1_517847", a, b)
        patched_client({"517847": {"gameInfo": {"officials": [
            {"fullName": "Tobias Reichel", "order": 1}
        ]}}})

        stats = asyncio.run(load_referees(wh, sleep_between_requests=0))
        assert stats.referees_set == 1
        assert stats.referees_created == 1
        row = wh._conn.execute(
            "SELECT r.name FROM matches m JOIN referees r ON r.referee_id = m.referee_id"
        ).fetchone()
        assert row["name"] == "Tobias Reichel"

    def test_football_data_rows_are_never_requested(self, wh, patched_client):
        """They carry no ESPN event id, so there is nothing to fetch."""
        a, b = wh.upsert_team(canonical_name="A", gender="M"), wh.upsert_team(canonical_name="B", gender="M")
        _match(wh, "fd_bundesliga_20200905_A_B", a, b)
        client = patched_client({})

        stats = asyncio.run(load_referees(wh, sleep_between_requests=0))
        assert stats.considered == 0
        assert client.requests == 0

    def test_match_without_officials_keeps_a_null_referee(self, wh, patched_client):
        a, b = wh.upsert_team(canonical_name="A", gender="M"), wh.upsert_team(canonical_name="B", gender="M")
        _match(wh, "espn_ger.1_517847", a, b)
        patched_client({"517847": {"gameInfo": {"officials": []}}})

        stats = asyncio.run(load_referees(wh, sleep_between_requests=0))
        assert stats.no_officials == 1
        assert stats.referees_set == 0
        assert wh._conn.execute("SELECT referee_id FROM matches").fetchone()[0] is None

    def test_http_failure_is_counted_not_fatal(self, wh, patched_client):
        a, b = wh.upsert_team(canonical_name="A", gender="M"), wh.upsert_team(canonical_name="B", gender="M")
        _match(wh, "espn_ger.1_999999", a, b)
        patched_client({})

        stats = asyncio.run(load_referees(wh, sleep_between_requests=0))
        assert stats.errors == 1
        assert stats.referees_set == 0

    def test_a_match_that_already_has_a_referee_is_skipped(self, wh, patched_client):
        a, b = wh.upsert_team(canonical_name="A", gender="M"), wh.upsert_team(canonical_name="B", gender="M")
        _match(wh, "espn_ger.1_517847", a, b)
        ref = wh.upsert_referee("Existing Ref")
        wh._conn.execute("UPDATE matches SET referee_id = ?", (ref,))
        client = patched_client({"517847": {"gameInfo": {"officials": [{"fullName": "New Ref"}]}}})

        stats = asyncio.run(load_referees(wh, sleep_between_requests=0))
        assert stats.considered == 0
        assert client.requests == 0

    def test_same_referee_across_matches_reuses_one_row(self, wh, patched_client):
        a, b = wh.upsert_team(canonical_name="A", gender="M"), wh.upsert_team(canonical_name="B", gender="M")
        _match(wh, "espn_ger.1_1", a, b)
        _match(wh, "espn_ger.1_2", b, a)
        officials = {"gameInfo": {"officials": [{"fullName": "Felix Brych", "order": 1}]}}
        patched_client({"1": officials, "2": officials})

        stats = asyncio.run(load_referees(wh, sleep_between_requests=0))
        assert stats.referees_set == 2
        assert wh._conn.execute("SELECT COUNT(*) FROM referees").fetchone()[0] == 1

    def test_second_run_serves_from_cache(self, wh, patched_client):
        a, b = wh.upsert_team(canonical_name="A", gender="M"), wh.upsert_team(canonical_name="B", gender="M")
        _match(wh, "espn_ger.1_517847", a, b)
        payload = {"gameInfo": {"officials": [{"fullName": "Tobias Reichel", "order": 1}]}}
        client = patched_client({"517847": payload})
        asyncio.run(load_referees(wh, sleep_between_requests=0))
        first = client.requests

        # Clear the referee so the row is eligible again; the HTTP layer
        # must not be hit a second time.
        wh._conn.execute("UPDATE matches SET referee_id = NULL")
        stats = asyncio.run(load_referees(wh, sleep_between_requests=0))
        assert client.requests == first
        assert stats.from_cache == 1
        assert stats.referees_set == 1

    def test_competition_filter(self, wh, patched_client):
        wh.upsert_competition("esp.1", "La Liga", "M", country="ES", tier=1)
        a, b = wh.upsert_team(canonical_name="A", gender="M"), wh.upsert_team(canonical_name="B", gender="M")
        _match(wh, "espn_ger.1_1", a, b, comp="ger.1")
        _match(wh, "espn_esp.1_2", a, b, comp="esp.1")
        patched_client({
            "1": {"gameInfo": {"officials": [{"fullName": "Ref DE"}]}},
            "2": {"gameInfo": {"officials": [{"fullName": "Ref ES"}]}},
        })

        stats = asyncio.run(load_referees(wh, competitions=["esp.1"], sleep_between_requests=0))
        assert stats.considered == 1
        assert stats.by_competition == {"esp.1": 1}

    def test_seasons_before_espn_published_officials_are_not_requested(self, wh, patched_client):
        """ESPN returns `officials: null` for everything before 2022-23.
        Spending a request per match to rediscover that is pure waste."""
        a, b = wh.upsert_team(canonical_name="A", gender="M"), wh.upsert_team(canonical_name="B", gender="M")
        _match(wh, "espn_ger.1_1", a, b, season=2018)
        client = patched_client({"1": {"gameInfo": {"officials": [{"fullName": "Ref"}]}}})

        stats = asyncio.run(load_referees(wh, sleep_between_requests=0))
        assert stats.considered == 0
        assert client.requests == 0

    def test_min_season_zero_attempts_everything(self, wh, patched_client):
        a, b = wh.upsert_team(canonical_name="A", gender="M"), wh.upsert_team(canonical_name="B", gender="M")
        _match(wh, "espn_ger.1_1", a, b, season=2018)
        patched_client({"1": {"gameInfo": {"officials": [{"fullName": "Ref"}]}}})
        stats = asyncio.run(load_referees(wh, min_season=0, sleep_between_requests=0))
        assert stats.referees_set == 1
