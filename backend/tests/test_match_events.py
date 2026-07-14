"""Tests for the match_events table (schema v3) and the events backfill.

Covers the Phase-0 Rarity-Engine substrate contract:
* migration to v3 is idempotent (match_events exists, version rows sane)
* upsert_match_events uses replace-all-per-match semantics
* the integrity guard stores NOTHING when goal events don't sum to the score
* events_coverage / iter_matches_missing_events report and filter correctly
* the ESPN and Understat parsers map real payload shapes honestly
  (own goals credited to the benefiting side, stoppage/extra time minutes)
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from backend.scripts.backfill_events import (
    events_match_score,
    replaceable_sources,
    store_events_checked,
)
from backend.services.data.espn_loader import (
    SummaryParseError,
    espn_event_id_from_match_id,
    parse_clock,
    parse_summary_events,
)
from backend.services.data.understat_loader import parse_match_shot_events
from backend.services.data.warehouse import (
    SCHEMA_VERSION,
    MatchEvent,
    MatchRow,
    Warehouse,
)


def _fixture_match(match_id: str, comp: str, season: int, home_id: int, away_id: int, *, hs=2, as_=1, source="espn") -> MatchRow:
    return MatchRow(
        match_id=match_id,
        source=source,
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


@pytest.fixture()
def seeded(warehouse: Warehouse):
    """Warehouse with one competition, two teams and one 2-1 match."""
    warehouse.upsert_competition("eng.1", "Premier League", gender="M")
    h = warehouse.upsert_team("Arsenal", "M")
    a = warehouse.upsert_team("Liverpool", "M")
    warehouse.upsert_matches([_fixture_match("m1", "eng.1", 2024, h, a, hs=2, as_=1)])
    return warehouse


def _events_2_1():
    return [
        MatchEvent(event_type="goal", minute=12, team_side="home", player="Saka"),
        MatchEvent(event_type="penalty_goal", minute=45, added_time=2, team_side="away", player="Salah"),
        MatchEvent(event_type="own_goal", minute=88, team_side="home", player="Van Dijk"),
        MatchEvent(event_type="red_card", minute=90, added_time=4, team_side="away", player="Mac Allister"),
    ]


# ---- migration ----


def test_migration_creates_match_events_and_is_idempotent(tmp_path):
    path = tmp_path / "wh.sqlite"
    wh = Warehouse(path)
    wh.migrate()
    wh.migrate()
    wh.close()
    # Re-open: table must exist, version rows must all be the current version.
    wh2 = Warehouse(path)
    wh2.migrate()
    tables = {
        r["name"]
        for r in wh2._conn.execute(  # noqa: SLF001
            "SELECT name FROM sqlite_master WHERE type='table'"
        )
    }
    assert "match_events" in tables
    versions = [
        r["version"]
        for r in wh2._conn.execute("SELECT version FROM schema_version")  # noqa: SLF001
    ]
    wh2.close()
    assert versions and all(v == SCHEMA_VERSION for v in versions)
    assert len(versions) == 1  # one row total, not one per migrate() call


def test_migration_upgrades_older_version_row(tmp_path):
    """A warehouse stamped with an older version gains a new version row."""
    path = tmp_path / "wh.sqlite"
    wh = Warehouse(path)
    wh.migrate()
    wh._conn.execute("DELETE FROM schema_version")  # noqa: SLF001
    wh._conn.execute(  # noqa: SLF001
        "INSERT INTO schema_version(version, applied_at) VALUES (2, '2026-05-24T00:00:00+00:00')"
    )
    wh.migrate()
    versions = [
        r["version"]
        for r in wh._conn.execute("SELECT version FROM schema_version ORDER BY version")  # noqa: SLF001
    ]
    wh.close()
    assert versions == [2, SCHEMA_VERSION]


def test_migration_v3_to_v4_backfills_coverage(tmp_path):
    """Events stored under v3 (pre-coverage) gain derived coverage rows."""
    path = tmp_path / "wh.sqlite"
    wh = Warehouse(path)
    wh.migrate()
    wh.upsert_competition("eng.1", "Premier League", gender="M")
    h = wh.upsert_team("Arsenal", "M")
    a = wh.upsert_team("Liverpool", "M")
    wh.upsert_matches([_fixture_match("m1", "eng.1", 2024, h, a)])
    wh.upsert_match_events("m1", _events_2_1(), "espn")
    # Simulate a v3-era warehouse: no coverage rows, stamped at version 3.
    wh._conn.execute("DELETE FROM match_event_coverage")  # noqa: SLF001
    wh._conn.execute("DELETE FROM schema_version")  # noqa: SLF001
    wh._conn.execute(  # noqa: SLF001
        "INSERT INTO schema_version(version, applied_at) VALUES (3, '2026-07-14T00:00:00+00:00')"
    )
    wh.migrate()
    row = wh._conn.execute(  # noqa: SLF001
        "SELECT source, events FROM match_event_coverage WHERE match_id = 'm1'"
    ).fetchone()
    versions = [
        r["version"]
        for r in wh._conn.execute("SELECT version FROM schema_version ORDER BY version")  # noqa: SLF001
    ]
    # Re-running migrate() must not duplicate or clobber the derived row.
    wh.migrate()
    n_rows = wh._conn.execute(  # noqa: SLF001
        "SELECT COUNT(*) AS n FROM match_event_coverage"
    ).fetchone()["n"]
    wh.close()
    assert (row["source"], row["events"]) == ("espn", 4)
    assert versions == [3, SCHEMA_VERSION]
    assert n_rows == 1


# ---- upsert semantics ----


def test_upsert_match_events_replaces_all(seeded: Warehouse):
    seeded.upsert_match_events("m1", _events_2_1(), "espn")
    assert len(seeded.get_match_events("m1")) == 4

    replacement = [MatchEvent(event_type="goal", minute=55, team_side="home")]
    n = seeded.upsert_match_events("m1", replacement, "understat")
    assert n == 1
    rows = seeded.get_match_events("m1")
    assert len(rows) == 1
    assert rows[0]["minute"] == 55
    assert rows[0]["source"] == "understat"
    assert rows[0]["seq"] == 0

    # Empty replacement clears the timeline.
    seeded.upsert_match_events("m1", [], "espn")
    assert seeded.get_match_events("m1") == []


def test_upsert_match_events_orders_by_minute(seeded: Warehouse):
    shuffled = [
        MatchEvent(event_type="goal", minute=88, team_side="home"),
        MatchEvent(event_type="goal", minute=12, team_side="home"),
        MatchEvent(event_type="goal", minute=90, added_time=3, team_side="away"),
        MatchEvent(event_type="goal", minute=90, team_side="away"),
    ]
    seeded.upsert_match_events("m1", shuffled, "espn")
    rows = seeded.get_match_events("m1")
    assert [r["seq"] for r in rows] == [0, 1, 2, 3]
    assert [(r["minute"], r["added_time"]) for r in rows] == [
        (12, None), (88, None), (90, None), (90, 3),
    ]


def test_upsert_match_events_validates(seeded: Warehouse):
    with pytest.raises(ValueError):
        seeded.upsert_match_events(
            "m1", [MatchEvent(event_type="throw_in", minute=5, team_side="home")], "espn"
        )
    with pytest.raises(ValueError):
        seeded.upsert_match_events(
            "m1", [MatchEvent(event_type="goal", minute=121, team_side="home")], "espn"
        )
    with pytest.raises(ValueError):
        seeded.upsert_match_events(
            "m1", [MatchEvent(event_type="goal", minute=10, team_side="right")], "espn"
        )
    assert seeded.get_match_events("m1") == []  # nothing partially written


# ---- integrity guard ----


def test_integrity_guard_accepts_reconciling_events(seeded: Warehouse):
    ok = store_events_checked(seeded, "m1", _events_2_1(), "espn", 2, 1)
    assert ok is True
    assert len(seeded.get_match_events("m1")) == 4


def test_integrity_guard_rejects_mismatch_and_stores_nothing(seeded: Warehouse):
    short = _events_2_1()[:1]  # only 1 home goal for a 2-1 match
    ok = store_events_checked(seeded, "m1", short, "espn", 2, 1)
    assert ok is False
    assert seeded.get_match_events("m1") == []


def test_integrity_guard_own_goal_credits_scoring_side():
    # 1-0 home win via an own goal credited to home: reconciles.
    events = [MatchEvent(event_type="own_goal", minute=30, team_side="home")]
    assert events_match_score(events, 1, 0) is True
    # Crediting the defender's side would not reconcile.
    assert events_match_score(events, 0, 1) is False
    # Red cards never count toward the score.
    events.append(MatchEvent(event_type="red_card", minute=60, team_side="home"))
    assert events_match_score(events, 1, 0) is True
    # NULL scores can never be verified.
    assert events_match_score(events, None, 0) is False


# ---- coverage + missing-events iteration ----


def test_events_coverage_counts(seeded: Warehouse):
    h = seeded.find_team_id_by_alias("Arsenal", "M")
    a = seeded.find_team_id_by_alias("Liverpool", "M")
    seeded.upsert_matches([
        _fixture_match("m2", "eng.1", 2024, a, h, hs=0, as_=0),
        _fixture_match("m3", "eng.1", 2023, h, a, hs=1, as_=1),
    ])
    # m1: stored via the guarded path (events + coverage marker).
    assert store_events_checked(seeded, "m1", _events_2_1(), "espn", 2, 1)
    # m2: verified empty (0-0, no cards) — coverage marker with events = 0.
    assert store_events_checked(seeded, "m2", [], "espn", 0, 0)

    cov = seeded.events_coverage()
    eng = next(r for r in cov if r["competition_id"] == "eng.1")
    assert eng["matches"] == 3
    assert eng["covered"] == 2
    assert eng["with_events"] == 1
    assert eng["verified_empty"] == 1
    assert eng["without_events"] == 1  # only m3 is still uncovered
    assert eng["events"] == 4
    assert eng["coverage"] == pytest.approx(2 / 3, abs=1e-4)


def test_events_coverage_counts_legacy_events_without_marker(seeded: Warehouse):
    """Events stored directly (no coverage row) still count as covered."""
    seeded.upsert_match_events("m1", _events_2_1(), "espn")
    eng = next(r for r in seeded.events_coverage() if r["competition_id"] == "eng.1")
    assert eng["covered"] == 1
    assert eng["with_events"] == 1
    assert eng["verified_empty"] == 0
    assert eng["events"] == 4


def test_iter_matches_missing_events_respects_precedence(seeded: Warehouse):
    h = seeded.find_team_id_by_alias("Arsenal", "M")
    a = seeded.find_team_id_by_alias("Liverpool", "M")
    seeded.upsert_matches([
        _fixture_match("m2", "eng.1", 2024, a, h),
        _fixture_match("m_pending", "eng.1", 2024, h, a, hs=None, as_=None),
    ])
    seeded.upsert_match_events(
        "m2", [MatchEvent(event_type="goal", minute=10, team_side="home"),
               MatchEvent(event_type="goal", minute=20, team_side="home"),
               MatchEvent(event_type="goal", minute=30, team_side="away")],
        "understat",
    )

    # Without replaceable sources: only the eventless completed match shows.
    missing = list(seeded.iter_matches_missing_events(source="espn"))
    assert [r["match_id"] for r in missing] == ["m1"]

    # An ESPN pass may replace understat-sourced events → m2 reappears.
    missing = list(
        seeded.iter_matches_missing_events(
            source="espn", replaceable_sources=replaceable_sources("espn")
        )
    )
    assert {r["match_id"] for r in missing} == {"m1", "m2"}
    m2 = next(r for r in missing if r["match_id"] == "m2")
    assert m2["events_source"] == "understat"

    # An understat pass must NOT touch understat/espn-sourced events.
    missing = list(
        seeded.iter_matches_missing_events(
            replaceable_sources=replaceable_sources("understat")
        )
    )
    assert {r["match_id"] for r in missing} == {"m1"}

    # Season / competition filters hold.
    assert list(seeded.iter_matches_missing_events(season=1999)) == []
    assert list(seeded.iter_matches_missing_events(competition="esp.1")) == []


def test_event_sources_maps_match_to_source(seeded: Warehouse):
    seeded.upsert_match_events("m1", _events_2_1(), "espn")
    assert seeded.event_sources() == {"m1": "espn"}


def test_event_sources_includes_verified_empty(seeded: Warehouse):
    seeded.record_event_coverage("m1", "understat", 0)
    assert seeded.event_sources() == {"m1": "understat"}


# ---- verified-empty coverage (schema v4) ----


def test_verified_empty_match_is_covered_and_not_reattempted(seeded: Warehouse):
    h = seeded.find_team_id_by_alias("Arsenal", "M")
    a = seeded.find_team_id_by_alias("Liverpool", "M")
    seeded.upsert_matches([_fixture_match("m2", "eng.1", 2024, a, h, hs=0, as_=0)])

    assert store_events_checked(seeded, "m2", [], "espn", 0, 0) is True
    assert seeded.get_match_events("m2") == []  # no event rows...
    cov = seeded._conn.execute(  # noqa: SLF001
        "SELECT source, events FROM match_event_coverage WHERE match_id = 'm2'"
    ).fetchone()
    assert (cov["source"], cov["events"]) == ("espn", 0)  # ...but a marker

    # Covered → not yielded again, even under same-source re-runs.
    missing = {r["match_id"] for r in seeded.iter_matches_missing_events(
        replaceable_sources=replaceable_sources("espn")
    )}
    assert "m2" not in missing
    assert "m1" in missing  # untouched match still a candidate


def test_verified_empty_upgradeable_by_better_source(seeded: Warehouse):
    h = seeded.find_team_id_by_alias("Arsenal", "M")
    a = seeded.find_team_id_by_alias("Liverpool", "M")
    seeded.upsert_matches([_fixture_match("m2", "eng.1", 2024, a, h, hs=0, as_=0)])
    # Understat verified it empty (it cannot see red cards)...
    assert store_events_checked(seeded, "m2", [], "understat", 0, 0) is True

    # ...an understat re-run must skip it...
    missing = {r["match_id"] for r in seeded.iter_matches_missing_events(
        replaceable_sources=replaceable_sources("understat")
    )}
    assert "m2" not in missing

    # ...but an ESPN pass may upgrade it (and could add e.g. a red card).
    missing = {r["match_id"] for r in seeded.iter_matches_missing_events(
        replaceable_sources=replaceable_sources("espn")
    )}
    assert "m2" in missing
    red = [MatchEvent(event_type="red_card", minute=88, team_side="away")]
    assert store_events_checked(seeded, "m2", red, "espn", 0, 0) is True
    cov = seeded._conn.execute(  # noqa: SLF001
        "SELECT source, events FROM match_event_coverage WHERE match_id = 'm2'"
    ).fetchone()
    assert (cov["source"], cov["events"]) == ("espn", 1)
    assert seeded.event_sources()["m2"] == "espn"


def test_mismatch_gets_no_coverage_row(seeded: Warehouse):
    short = _events_2_1()[:1]  # 1 home goal for a 2-1 match → mismatch
    assert store_events_checked(seeded, "m1", short, "espn", 2, 1) is False
    n = seeded._conn.execute(  # noqa: SLF001
        "SELECT COUNT(*) AS n FROM match_event_coverage WHERE match_id = 'm1'"
    ).fetchone()["n"]
    assert n == 0
    # Still honestly uncovered → still a candidate.
    missing = {r["match_id"] for r in seeded.iter_matches_missing_events()}
    assert "m1" in missing


def test_stored_match_gets_coverage_row(seeded: Warehouse):
    assert store_events_checked(seeded, "m1", _events_2_1(), "espn", 2, 1) is True
    cov = seeded._conn.execute(  # noqa: SLF001
        "SELECT source, events FROM match_event_coverage WHERE match_id = 'm1'"
    ).fetchone()
    assert (cov["source"], cov["events"]) == ("espn", 4)


# ---- ESPN parser ----


def _espn_payload(key_events, home_id="362", away_id="364"):
    return {
        "header": {
            "competitions": [
                {
                    "competitors": [
                        {"homeAway": "home", "team": {"id": home_id}},
                        {"homeAway": "away", "team": {"id": away_id}},
                    ]
                }
            ]
        },
        "keyEvents": key_events,
    }


def _key_event(type_str, clock, team_id, *, scoring=True, shootout=False, player="Player"):
    return {
        "type": {"type": type_str},
        "clock": {"displayValue": clock},
        "team": {"id": team_id},
        "scoringPlay": scoring,
        "shootout": shootout,
        "participants": [{"athlete": {"displayName": player}}],
    }


def test_parse_clock_formats():
    assert parse_clock("42'") == (42, None)
    assert parse_clock("45'+3'") == (45, 3)
    assert parse_clock("90'+12'") == (90, 12)
    assert parse_clock("108'") == (108, None)  # extra time is a plain minute
    with pytest.raises(SummaryParseError):
        parse_clock("")
    with pytest.raises(SummaryParseError):
        parse_clock("HT")


def test_parse_summary_events_maps_types_and_sides():
    payload = _espn_payload([
        _key_event("kickoff", "", "362", scoring=False),
        _key_event("goal", "42'", "362", player="Rogers"),
        _key_event("goal---header", "52'", "364", player="Van Dijk"),
        _key_event("penalty---scored", "45'+5'", "362", player="Dembele"),
        # ESPN already credits own goals to the benefiting team:
        _key_event("own-goal", "71'", "364", player="Hill"),
        _key_event("red-card", "78'", "362", scoring=False, player="Maguire"),
        _key_event("yellow-card", "80'", "362", scoring=False),
        _key_event("substitution", "81'", "362", scoring=False),
        # Shootout kicks are never match-minute events:
        _key_event("penalty---scored", "120'", "362", shootout=True),
    ])
    events = parse_summary_events(payload)
    assert [(e.event_type, e.minute, e.added_time, e.team_side) for e in events] == [
        ("goal", 42, None, "home"),
        ("goal", 52, None, "away"),
        ("penalty_goal", 45, 5, "home"),
        ("own_goal", 71, None, "away"),
        ("red_card", 78, None, "home"),
    ]
    assert events[0].player == "Rogers"


def test_parse_summary_events_no_key_events_is_empty():
    assert parse_summary_events(_espn_payload([])) == []


def test_parse_summary_events_unknown_team_raises():
    payload = _espn_payload([_key_event("goal", "10'", "999")])
    with pytest.raises(SummaryParseError):
        parse_summary_events(payload)


def test_parse_summary_events_bad_clock_raises():
    payload = _espn_payload([_key_event("goal", "", "362")])
    with pytest.raises(SummaryParseError):
        parse_summary_events(payload)


def test_espn_event_id_from_match_id():
    assert espn_event_id_from_match_id("espn_eng.1_740957") == "740957"
    assert espn_event_id_from_match_id("espn_uefa.champions_401862893") == "401862893"
    assert espn_event_id_from_match_id("of_eng.1_2010-11_x") is None


# ---- Understat parser ----


def test_parse_match_shot_events_flips_own_goal_side():
    shots = {
        "h": [
            {"result": "Goal", "minute": "41", "situation": "OpenPlay", "player": "Kvaratskhelia"},
            {"result": "MissedShots", "minute": "50", "situation": "OpenPlay", "player": "X"},
            # Own goal by a home player → credited to AWAY:
            {"result": "OwnGoal", "minute": "55", "situation": "OpenPlay", "player": "Pinnock"},
        ],
        "a": [
            {"result": "Goal", "minute": "16", "situation": "Penalty", "player": "Kane"},
            # Understat stoppage: raw 92 → display 93' → (90, +3):
            {"result": "Goal", "minute": "92", "situation": "OpenPlay", "player": "Late"},
        ],
    }
    events = parse_match_shot_events(shots)
    got = sorted(
        [(e.event_type, e.minute, e.added_time, e.team_side) for e in events]
    )
    assert got == sorted([
        ("goal", 42, None, "home"),          # 0-based 41 → display 42'
        ("own_goal", 56, None, "away"),      # flipped side
        ("penalty_goal", 17, None, "away"),
        ("goal", 90, 3, "away"),             # >90 folded into stoppage
    ])


def test_parse_match_shot_events_bad_minute_returns_none():
    shots = {"h": [{"result": "Goal", "minute": "??", "situation": "OpenPlay"}], "a": []}
    assert parse_match_shot_events(shots) is None
