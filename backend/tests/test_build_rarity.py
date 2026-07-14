"""Tests for the Rarity Engine v1 aggregation (`backend.scripts.build_rarity`).

Everything runs against SYNTHETIC fixture warehouses built in tmp_path —
never against production data. Covered contracts:

* score-timeline reconstruction, including own goals credited to the
  scoring side and added-time/extra-time clamping past the 90' boundary;
* 5-minute bucket math and diff clamping to [-3, +3];
* coverage honesty (``match_event_coverage`` membership is the only gate:
  uncovered matches are excluded even when event rows exist; covered
  zero-event matches are verified 0-0s counted in full; matches whose
  events do not reproduce the final score are skipped);
* dramatic-key example collection (cap, most-recent-first ordering);
* deterministic artifacts;
* the empty/absent-warehouse case.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from backend.scripts.build_rarity import (
    BOUNDARIES,
    EXAMPLES_CAP,
    build_rarity,
    clamp_diff,
    effective_minute,
    main,
    score_at_boundaries,
    state_key,
    write_artifacts,
)

# ---------------------------------------------------------------------------
# Synthetic fixture warehouse
# ---------------------------------------------------------------------------


def _make_warehouse(path: Path) -> sqlite3.Connection:
    con = sqlite3.connect(path)
    con.executescript(
        """
        CREATE TABLE competitions (
            competition_id TEXT PRIMARY KEY,
            name TEXT,
            gender TEXT NOT NULL
        );
        CREATE TABLE teams (
            team_id INTEGER PRIMARY KEY,
            canonical_name TEXT NOT NULL
        );
        CREATE TABLE matches (
            match_id TEXT PRIMARY KEY,
            competition_id TEXT NOT NULL,
            season INTEGER,
            date_utc TEXT,
            home_team_id INTEGER,
            away_team_id INTEGER,
            home_score INTEGER,
            away_score INTEGER
        );
        CREATE TABLE match_events (
            match_id TEXT NOT NULL,
            seq INTEGER NOT NULL,
            event_type TEXT NOT NULL,
            minute INTEGER NOT NULL,
            added_time INTEGER,
            team_side TEXT NOT NULL,
            player TEXT,
            source TEXT
        );
        CREATE TABLE match_event_coverage (
            match_id    TEXT PRIMARY KEY,
            source      TEXT NOT NULL,
            events      INTEGER NOT NULL,
            verified_at TEXT NOT NULL
        );
        """
    )
    con.execute("INSERT INTO competitions VALUES ('eng.1', 'Premier League', 'M')")
    con.execute("INSERT INTO competitions VALUES ('eng.w.1', 'WSL', 'F')")
    con.execute("INSERT INTO teams VALUES (1, 'Alpha FC')")
    con.execute("INSERT INTO teams VALUES (2, 'Beta United')")
    con.commit()
    return con


def _add_match(
    con: sqlite3.Connection,
    match_id: str,
    home_score: int,
    away_score: int,
    events: list[tuple[str, int, int | None, str]],
    *,
    competition_id: str = "eng.1",
    date: str = "2024-05-01T15:00:00+00:00",
    covered: bool = True,
) -> None:
    """events: list of (event_type, minute, added_time, team_side).

    ``covered=True`` (the default) also writes the ``match_event_coverage``
    row — the authoritative signal that this match's timeline is fully known.
    """

    con.execute(
        "INSERT INTO matches VALUES (?, ?, 2024, ?, 1, 2, ?, ?)",
        (match_id, competition_id, date, home_score, away_score),
    )
    for seq, (event_type, minute, added_time, team_side) in enumerate(events):
        con.execute(
            "INSERT INTO match_events VALUES (?, ?, ?, ?, ?, ?, 'Player', 'test')",
            (match_id, seq, event_type, minute, added_time, team_side),
        )
    if covered:
        con.execute(
            "INSERT INTO match_event_coverage VALUES (?, 'test', ?, ?)",
            (match_id, len(events), date),
        )
    con.commit()


# ---------------------------------------------------------------------------
# Pure timeline / bucket math
# ---------------------------------------------------------------------------


def test_boundaries_are_5_minute_grid_ending_at_90():
    assert BOUNDARIES == tuple(range(0, 91, 5))


def test_effective_minute_adds_stoppage_time():
    assert effective_minute(45, 3) == 48
    assert effective_minute(90, 4) == 94
    assert effective_minute(30, None) == 30


def test_score_at_boundaries_inclusive_of_boundary_minute():
    # A goal in the 55th minute has happened by the 55:00 mark.
    states = dict(zip(BOUNDARIES, score_at_boundaries([(55, "home")])))
    assert states[50] == (0, 0)
    assert states[55] == (1, 0)
    assert states[90] == (1, 0)


def test_score_at_boundaries_stoppage_and_extra_time_clamp():
    # 45+3 counts from the 50' boundary; 90+2 and ET goals never enter a bucket.
    events = [(effective_minute(45, 3), "away"), (effective_minute(90, 2), "home"), (105, "home")]
    states = dict(zip(BOUNDARIES, score_at_boundaries(events)))
    assert states[45] == (0, 0)
    assert states[50] == (0, 1)
    assert states[90] == (0, 1)  # the 90+ bucket state predates stoppage goals


def test_clamp_diff():
    assert clamp_diff(-5) == -3
    assert clamp_diff(5) == 3
    assert clamp_diff(-2) == -2
    assert clamp_diff(0) == 0


# ---------------------------------------------------------------------------
# Aggregation over a synthetic warehouse
# ---------------------------------------------------------------------------


def test_timeline_reconstruction_with_own_goal_credited_to_scoring_side(tmp_path):
    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    # Away lead 0-2 by 30' (one own goal credited to AWAY, the scoring side);
    # home come back and win 3-2 with the winner in the 89th minute.
    _add_match(
        con,
        "m1",
        3,
        2,
        [
            ("goal", 10, None, "away"),
            ("own_goal", 30, None, "away"),
            ("goal", 60, None, "home"),
            ("penalty_goal", 75, None, "home"),
            ("goal", 89, None, "home"),
        ],
    )
    con.close()

    result = build_rarity(db)
    assert result.matches_covered == 1
    assert result.matches_skipped_integrity == 0

    # Home trailed 0-2 at the 30' boundary and won.
    assert result.states[state_key("M", -2, 30)] == {"n": 1, "w": 1, "d": 0, "l": 0}
    # Away led +2 at the same boundary and lost.
    assert result.states[state_key("M", 2, 30)] == {"n": 1, "w": 0, "d": 0, "l": 1}
    # Level 2-2 from 75' until the 89th-minute winner: diff 0 at 75/80/85.
    assert result.states[state_key("M", 0, 85)]["n"] == 2
    # Home +1 at the 90' boundary (winner scored in the 89th minute).
    assert result.states[state_key("M", 1, 90)] == {"n": 1, "w": 1, "d": 0, "l": 0}
    # Kickoff bucket: both sides level at 0.
    assert result.states[state_key("M", 0, 0)]["n"] == 2


def test_diff_clamped_to_plus_minus_three(tmp_path):
    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    _add_match(
        con,
        "blowout",
        5,
        0,
        [("goal", m, None, "home") for m in (5, 10, 15, 20, 25)],
    )
    con.close()

    result = build_rarity(db)
    # From 20' on home lead by 4+ — clamped to +3 / -3.
    assert result.states[state_key("M", 3, 25)]["n"] == 1
    assert result.states[state_key("M", -3, 25)]["n"] == 1
    assert state_key("M", 4, 25) not in result.states
    assert state_key("M", -4, 25) not in result.states


def test_gender_partitions_keys(tmp_path):
    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    _add_match(con, "w1", 1, 0, [("goal", 40, None, "home")], competition_id="eng.w.1")
    con.close()

    result = build_rarity(db)
    assert result.states[state_key("F", 1, 40)] == {"n": 1, "w": 1, "d": 0, "l": 0}
    assert not any(key.startswith("M:") for key in result.states)


def test_uncovered_matches_are_excluded(tmp_path):
    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    _add_match(con, "covered", 1, 0, [("goal", 40, None, "home")])
    # 2-1 final with no coverage row and no events — must not be counted.
    con.execute(
        "INSERT INTO matches VALUES ('no_coverage', 'eng.1', 2024, '2024-05-02T15:00:00+00:00', 1, 2, 2, 1)"
    )
    con.commit()
    con.close()

    result = build_rarity(db)
    assert result.matches_covered == 1
    assert result.states[state_key("M", 0, 0)]["n"] == 2  # one match, two sides


def test_uncovered_match_with_event_rows_is_still_excluded(tmp_path):
    # Coverage membership is the ONLY gate: stray event rows without a
    # coverage row (e.g. a partial ingest) must not leak into the counts.
    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    _add_match(
        con,
        "stray_events",
        2,
        0,
        [("goal", 10, None, "home"), ("goal", 50, None, "home")],
        covered=False,
    )
    con.close()

    result = build_rarity(db)
    assert result.matches_covered == 0
    assert result.matches_skipped_integrity == 0
    assert result.states == {}


def test_covered_zero_event_match_contributes_full_level_timeline(tmp_path):
    # A coverage row with events=0 is a VERIFIED 0-0 without cards: it was
    # exactly what the old EXISTS(match_events) gate undercounted. Both
    # sides sit at diff 0 in every bucket and the outcome is a draw.
    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    _add_match(con, "goalless", 0, 0, [])
    con.close()

    result = build_rarity(db)
    assert result.matches_covered == 1
    assert result.matches_verified_empty == 1
    assert result.matches_skipped_integrity == 0
    for bucket in BOUNDARIES:
        assert result.states[state_key("M", 0, bucket)] == {"n": 2, "w": 0, "d": 2, "l": 0}
    # Nothing but level states exists.
    assert len(result.states) == len(BOUNDARIES)


def test_verified_empty_with_nonzero_score_fails_integrity(tmp_path):
    # Defensive: a coverage row claiming "verified empty" for a 1-0 match
    # contradicts the final score — skip it rather than fabricate a timeline.
    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    _add_match(con, "bad_empty", 1, 0, [])
    con.close()

    result = build_rarity(db)
    assert result.matches_covered == 0
    assert result.matches_verified_empty == 0
    assert result.matches_skipped_integrity == 1


def test_integrity_mismatch_skips_match(tmp_path):
    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    # Final says 2-0 but only one goal event exists — exact counting forbids it.
    _add_match(con, "broken", 2, 0, [("goal", 10, None, "home")])
    con.close()

    result = build_rarity(db)
    assert result.matches_covered == 0
    assert result.matches_skipped_integrity == 1
    assert result.states == {}


def test_red_cards_do_not_move_the_score(tmp_path):
    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    _add_match(
        con,
        "m_red",
        1,
        0,
        [("red_card", 20, None, "away"), ("goal", 70, None, "home")],
    )
    con.close()

    result = build_rarity(db)
    assert result.matches_covered == 1
    assert result.states[state_key("M", 0, 65)]["n"] == 2
    assert result.states[state_key("M", 1, 70)]["n"] == 1


# ---------------------------------------------------------------------------
# Dramatic examples
# ---------------------------------------------------------------------------


def test_dramatic_examples_collected_capped_and_most_recent_first(tmp_path):
    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    # 15 comeback matches: 0-2 down at 60', win 3-2. Cap is 12.
    for i in range(15):
        _add_match(
            con,
            f"cb{i:02d}",
            3,
            2,
            [
                ("goal", 20, None, "away"),
                ("goal", 55, None, "away"),
                ("goal", 70, None, "home"),
                ("goal", 80, None, "home"),
                ("goal", 88, None, "home"),
            ],
            date=f"2024-01-{i + 1:02d}T15:00:00+00:00",
        )
    con.close()

    result = build_rarity(db)
    key = state_key("M", -2, 60)
    assert result.states[key] == {"n": 15, "w": 15, "d": 0, "l": 0}

    wins = result.examples[key]["w"]
    assert len(wins) == EXAMPLES_CAP
    assert wins[0]["date"] == "2024-01-15T15:00:00+00:00"  # most recent first
    assert wins[0] == {
        "match_id": "cb14",
        "home": "Alpha FC",
        "away": "Beta United",
        "final_score": "3-2",
        "date": "2024-01-15T15:00:00+00:00",
        "competition_id": "eng.1",
        "side": "home",
    }
    # The leading (winning-from-ahead... actually losing) side is never dramatic,
    # and non-dramatic keys collect no examples at all.
    assert state_key("M", 2, 60) not in result.examples
    assert state_key("M", 0, 0) not in result.examples


def test_early_or_shallow_deficits_are_not_dramatic(tmp_path):
    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    # Down 0-2 at 30' but level by 55': deficit of 2 never survives past 60'.
    _add_match(
        con,
        "early",
        2,
        2,
        [
            ("goal", 10, None, "away"),
            ("goal", 25, None, "away"),
            ("goal", 40, None, "home"),
            ("goal", 55, None, "home"),
        ],
    )
    con.close()

    result = build_rarity(db)
    assert result.examples == {}


# ---------------------------------------------------------------------------
# Artifacts: determinism + empty warehouse
# ---------------------------------------------------------------------------


def test_artifacts_are_deterministic_across_runs(tmp_path):
    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    _add_match(
        con,
        "m1",
        3,
        2,
        [
            ("goal", 20, None, "away"),
            ("goal", 55, None, "away"),
            ("goal", 70, None, "home"),
            ("goal", 80, None, "home"),
            ("goal", 88, None, "home"),
        ],
    )
    _add_match(con, "m2", 0, 1, [("goal", 77, None, "away")], date="2024-05-03T15:00:00+00:00")
    con.close()

    out_a = tmp_path / "out_a"
    out_b = tmp_path / "out_b"
    stamp = "2026-07-14T00:00:00+00:00"
    paths_a = write_artifacts(build_rarity(db), out_a, generated_at=stamp)
    paths_b = write_artifacts(build_rarity(db), out_b, generated_at=stamp)

    for pa, pb in zip(paths_a, paths_b):
        assert pa.read_text() == pb.read_text()

    payload = json.loads(paths_a[0].read_text())
    assert payload["schema"] == 1
    assert payload["matches_covered"] == 2
    assert list(payload["states"]) == sorted(payload["states"])


def test_pre_v4_warehouse_yields_empty_artifact(tmp_path):
    db = tmp_path / "wh.sqlite"
    con = sqlite3.connect(db)
    # A warehouse from before the backfill: no match_events, no coverage.
    con.executescript(
        """
        CREATE TABLE competitions (competition_id TEXT PRIMARY KEY, name TEXT, gender TEXT);
        CREATE TABLE teams (team_id INTEGER PRIMARY KEY, canonical_name TEXT);
        CREATE TABLE matches (
            match_id TEXT PRIMARY KEY, competition_id TEXT, season INTEGER,
            date_utc TEXT, home_team_id INTEGER, away_team_id INTEGER,
            home_score INTEGER, away_score INTEGER
        );
        """
    )
    con.commit()
    con.close()

    result = build_rarity(db)
    assert result.matches_covered == 0
    assert result.states == {}
    assert result.examples == {}


def test_missing_coverage_table_yields_empty_artifact(tmp_path):
    # match_events exists (schema v3) but coverage does not — without the
    # authoritative gate nothing may be counted.
    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    _add_match(con, "m1", 1, 0, [("goal", 12, None, "home")])
    con.execute("DROP TABLE match_event_coverage")
    con.commit()
    con.close()

    result = build_rarity(db)
    assert result.matches_covered == 0
    assert result.states == {}


def test_missing_db_file_yields_empty_artifact(tmp_path):
    result = build_rarity(tmp_path / "nope.sqlite")
    assert result.matches_covered == 0
    assert result.states == {}


def test_cli_writes_both_artifacts(tmp_path, capsys):
    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    _add_match(con, "m1", 1, 0, [("goal", 12, None, "home")])
    con.close()

    out = tmp_path / "artifacts"
    assert main(["--db", str(db), "--out", str(out)]) == 0

    states = json.loads((out / "state_outcomes.json").read_text())
    examples = json.loads((out / "examples.json").read_text())
    assert states["matches_covered"] == 1
    assert states["matches_verified_empty"] == 0
    assert states["schema"] == 1
    assert examples["schema"] == 1
    assert "matches_covered=1" in capsys.readouterr().out
