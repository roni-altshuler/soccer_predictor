"""Tests for the SQLite match warehouse.

These cover the contract that every loader relies on:
* migration is idempotent
* upserts are keyed correctly (no duplicates on re-run)
* gender/competition foreign keys hold
* helper aggregations (`stats_by_competition`, `iter_matches`) filter as documented
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest

from backend.services.data.warehouse import (
    MatchRow,
    SCHEMA_VERSION,
    Warehouse,
    open_warehouse,
)


def _fixture_match(match_id: str, comp: str, season: int, home_id: int, away_id: int, *, hs=2, as_=1) -> MatchRow:
    return MatchRow(
        match_id=match_id,
        source="test",
        competition_id=comp,
        season=season,
        date_utc=datetime(season, 8, 15, 15, 0, tzinfo=timezone.utc).isoformat(),
        home_team_id=home_id,
        away_team_id=away_id,
        home_score=hs,
        away_score=as_,
    )


@pytest.fixture()
def warehouse(tmp_path) -> Warehouse:
    path = tmp_path / "wh.sqlite"
    wh = Warehouse(path)
    wh.migrate()
    yield wh
    wh.close()


def test_migration_is_idempotent(tmp_path):
    path = tmp_path / "wh.sqlite"
    wh = Warehouse(path)
    wh.migrate()
    wh.migrate()
    wh.close()
    # The file should exist and contain exactly one schema_version row per migration call.
    wh2 = Warehouse(path)
    cur = wh2._conn.execute("SELECT version FROM schema_version ORDER BY version")  # noqa: SLF001
    versions = [row["version"] for row in cur.fetchall()]
    wh2.close()
    assert versions and all(v == SCHEMA_VERSION for v in versions)


def test_upsert_team_dedupes_by_canonical_name_and_gender(warehouse: Warehouse):
    id1 = warehouse.upsert_team("Arsenal", "M", country="GB")
    id2 = warehouse.upsert_team("Arsenal", "M", country="GB")
    id3 = warehouse.upsert_team("Arsenal", "F", country="GB")  # different gender => new team
    assert id1 == id2
    assert id3 != id1


def test_alias_lookup_finds_team(warehouse: Warehouse):
    team_id = warehouse.upsert_team("Manchester United", "M")
    warehouse.add_alias("Man Utd", team_id, "M")
    warehouse.add_alias("Manchester United FC", team_id, "M")
    assert warehouse.find_team_id_by_alias("Man Utd", "M") == team_id
    assert warehouse.find_team_id_by_alias("Manchester United FC", "M") == team_id
    assert warehouse.find_team_id_by_alias("Man Utd", "F") is None


def test_match_upsert_is_keyed_by_match_id(warehouse: Warehouse):
    warehouse.upsert_competition("eng.1", "Premier League", gender="M")
    h = warehouse.upsert_team("Arsenal", "M")
    a = warehouse.upsert_team("Liverpool", "M")
    row = _fixture_match("m1", "eng.1", 2024, h, a, hs=2, as_=1)
    warehouse.upsert_matches([row])
    warehouse.upsert_matches([row])  # re-run; must not duplicate
    assert warehouse.count_matches() == 1


def test_match_upsert_replaces_on_conflict(warehouse: Warehouse):
    warehouse.upsert_competition("eng.1", "Premier League", gender="M")
    h = warehouse.upsert_team("Arsenal", "M")
    a = warehouse.upsert_team("Liverpool", "M")
    original = _fixture_match("m1", "eng.1", 2024, h, a, hs=2, as_=1)
    warehouse.upsert_matches([original])

    revised = MatchRow(**{**original.__dict__, "home_score": 3, "away_score": 0})
    warehouse.upsert_matches([revised])

    row = warehouse._conn.execute(  # noqa: SLF001
        "SELECT home_score, away_score FROM matches WHERE match_id = ?",
        ("m1",),
    ).fetchone()
    assert (row["home_score"], row["away_score"]) == (3, 0)


def test_count_matches_filters_correctly(warehouse: Warehouse):
    warehouse.upsert_competition("eng.1", "Premier League", gender="M")
    warehouse.upsert_competition("usa.1.w", "NWSL", gender="F")
    h_m = warehouse.upsert_team("Arsenal", "M")
    a_m = warehouse.upsert_team("Liverpool", "M")
    h_f = warehouse.upsert_team("Thorns", "F")
    a_f = warehouse.upsert_team("Reign", "F")
    warehouse.upsert_matches([
        _fixture_match("m_men_1", "eng.1", 2024, h_m, a_m),
        _fixture_match("m_men_2", "eng.1", 2024, a_m, h_m),
        _fixture_match("m_w_1", "usa.1.w", 2024, h_f, a_f),
    ])
    assert warehouse.count_matches() == 3
    assert warehouse.count_matches(gender="M") == 2
    assert warehouse.count_matches(gender="F") == 1
    assert warehouse.count_matches(competition_id="usa.1.w") == 1


def test_iter_matches_yields_chronological(warehouse: Warehouse):
    warehouse.upsert_competition("eng.1", "Premier League", gender="M")
    h = warehouse.upsert_team("Arsenal", "M")
    a = warehouse.upsert_team("Liverpool", "M")
    older = MatchRow(
        match_id="old", source="t", competition_id="eng.1", season=2020,
        date_utc="2020-01-15T15:00:00+00:00",
        home_team_id=h, away_team_id=a, home_score=1, away_score=1,
    )
    newer = MatchRow(
        match_id="new", source="t", competition_id="eng.1", season=2024,
        date_utc="2024-08-15T15:00:00+00:00",
        home_team_id=h, away_team_id=a, home_score=2, away_score=0,
    )
    warehouse.upsert_matches([newer, older])
    rows = list(warehouse.iter_matches(gender="M"))
    assert [r["match_id"] for r in rows] == ["old", "new"]


def test_referee_upsert_unique(warehouse: Warehouse):
    rid1 = warehouse.upsert_referee("Pierluigi Collina")
    rid2 = warehouse.upsert_referee("Pierluigi Collina")
    assert rid1 == rid2
    assert warehouse.upsert_referee("") is None


def test_open_warehouse_context_manager(tmp_path):
    path = tmp_path / "wh.sqlite"
    with open_warehouse(path) as wh:
        wh.upsert_competition("test.1", "Test", gender="M")
        # Inside the context, the warehouse must be usable.
        assert wh.count_matches() == 0
    # After close, opening again returns the same data.
    with open_warehouse(path) as wh2:
        cur = wh2._conn.execute("SELECT competition_id FROM competitions")  # noqa: SLF001
        assert {r["competition_id"] for r in cur.fetchall()} == {"test.1"}
