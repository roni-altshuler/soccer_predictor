"""Tests for the match2vec retrieval index builder
(`backend.scripts.build_match2vec`).

Everything runs against SYNTHETIC fixture warehouses built in tmp_path —
never against production data. Covered contracts:

* timeline facts (lead changes, equalizers, comeback depth, decisive
  minute, first/last goal, red cards) are exact counts;
* the feature vector is unit-normalised, has the declared dimension, and
  is a function of timeline + final score + gender ONLY — two matches with
  identical timelines but different teams/competitions/dates get
  byte-identical encoded vectors (no team-identity leakage);
* gender shares one space but shifts the vector (same-universe ranking);
* coverage honesty (``match_event_coverage`` membership is the only gate;
  covered zero-event matches are verified 0-0s and are indexed; matches
  whose events do not reproduce the final score are skipped);
* int8 quantisation + base64 encoding round-trips deterministically;
* byte-identical artifacts across re-runs on unchanged data (including
  the data-derived ``generated_at``);
* the empty/absent-warehouse case.
"""

from __future__ import annotations

import base64
import json
import math
import sqlite3
import struct
from pathlib import Path

from backend.scripts.build_match2vec import (
    COLUMNS,
    DIM,
    FACTS_COLUMNS,
    build_feature_vector,
    build_index,
    compute_facts,
    encode_vector,
    main,
    quantize_int8,
    write_artifact,
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
    con.execute("INSERT INTO competitions VALUES ('eng.1.w', 'WSL', 'F')")
    con.execute("INSERT INTO teams VALUES (1, 'Alpha FC')")
    con.execute("INSERT INTO teams VALUES (2, 'Beta United')")
    con.execute("INSERT INTO teams VALUES (3, 'Gamma City')")
    con.execute("INSERT INTO teams VALUES (4, 'Delta Rovers')")
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
    teams: tuple[int, int] = (1, 2),
    covered: bool = True,
    verified_at: str = "2024-06-01T00:00:00+00:00",
) -> None:
    """events: list of (event_type, minute, added_time, team_side)."""

    con.execute(
        "INSERT INTO matches VALUES (?, ?, 2024, ?, ?, ?, ?, ?)",
        (match_id, competition_id, date, teams[0], teams[1], home_score, away_score),
    )
    for seq, (event_type, minute, added_time, team_side) in enumerate(events):
        con.execute(
            "INSERT INTO match_events VALUES (?, ?, ?, ?, ?, ?, 'Player', 'test')",
            (match_id, seq, event_type, minute, added_time, team_side),
        )
    if covered:
        con.execute(
            "INSERT INTO match_event_coverage VALUES (?, 'test', ?, ?)",
            (match_id, len(events), verified_at),
        )
    con.commit()


def _row_by_id(result, match_id: str):
    for row in result.rows:
        if row[0] == match_id:
            return row
    raise AssertionError(f"{match_id} not in index")


def _decode(b64: str) -> list[float]:
    raw = base64.b64decode(b64)
    ints = struct.unpack(f"{len(raw)}b", raw)
    return [i / 127.0 for i in ints]


# ---------------------------------------------------------------------------
# Timeline facts — exact counts
# ---------------------------------------------------------------------------


def test_facts_comeback_with_lead_changes():
    # 0-1 (10'), 1-1 (30'), 2-1 (50'), 2-2 (70'), 3-2 (88'): home trailed by
    # one and recovered; the lead changed once (away -> home); two equalizers;
    # the 88' goal decided it.
    goals = [(10, "away"), (30, "home"), (50, "home"), (70, "away"), (88, "home")]
    facts = compute_facts(goals, [], 3, 2)
    assert facts.lead_changes == 1
    assert facts.equalizers == 2
    assert facts.comeback_depth == 1
    assert facts.decider_minute == 88
    assert facts.first_goal_minute == 10
    assert facts.last_goal_minute == 88
    assert facts.reds_home == 0 and facts.reds_away == 0


def test_facts_decider_is_first_goal_when_winner_never_relinquishes():
    goals = [(23, "home"), (67, "home")]
    facts = compute_facts(goals, [], 2, 0)
    assert facts.decider_minute == 23
    assert facts.lead_changes == 0
    assert facts.equalizers == 0
    assert facts.comeback_depth == 0


def test_facts_two_goal_comeback_to_draw():
    # 0-2 down at 40', back to 2-2: comeback depth 2, no decider (draw).
    goals = [(20, "away"), (40, "away"), (60, "home"), (85, "home")]
    facts = compute_facts(goals, [], 2, 2)
    assert facts.comeback_depth == 2
    assert facts.decider_minute == -1
    assert facts.equalizers == 1
    assert facts.last_goal_minute == 85


def test_facts_goalless_with_red_cards():
    facts = compute_facts([], [(55, "home"), (79, "away")], 0, 0)
    assert facts.first_goal_minute == -1
    assert facts.last_goal_minute == -1
    assert facts.decider_minute == -1
    assert facts.reds_home == 1 and facts.reds_away == 1
    assert facts.as_list() == [0, 0, 0, -1, -1, -1, 1, 1]


def test_facts_level_spell_does_not_reset_leader():
    # 1-0, 1-1, 1-2: one lead change even though the score passed level.
    goals = [(10, "home"), (40, "away"), (70, "away")]
    facts = compute_facts(goals, [], 1, 2)
    assert facts.lead_changes == 1
    assert facts.decider_minute == 70


# ---------------------------------------------------------------------------
# Feature vector — shape, normalisation, quantisation
# ---------------------------------------------------------------------------


def test_vector_is_unit_norm_with_declared_dim():
    goals = [(10, "away"), (30, "home"), (88, "home")]
    facts = compute_facts(goals, [], 2, 1)
    vec = build_feature_vector(goals, facts, 2, 1, "M")
    assert len(vec) == DIM
    assert math.isclose(sum(f * f for f in vec), 1.0, rel_tol=1e-9)


def test_goalless_vector_is_well_defined_for_both_genders():
    facts = compute_facts([], [], 0, 0)
    for gender in ("M", "F"):
        vec = build_feature_vector([], facts, 0, 0, gender)
        assert math.isclose(sum(f * f for f in vec), 1.0, rel_tol=1e-9)
    assert build_feature_vector([], facts, 0, 0, "M") != build_feature_vector(
        [], facts, 0, 0, "F"
    )


def test_gender_shares_space_but_shifts_vector():
    goals = [(40, "home")]
    facts = compute_facts(goals, [], 1, 0)
    vec_m = build_feature_vector(goals, facts, 1, 0, "M")
    vec_f = build_feature_vector(goals, facts, 1, 0, "F")
    assert vec_m != vec_f
    # Same timeline across genders stays highly similar — shared space.
    cosine = sum(a * b for a, b in zip(vec_m, vec_f))
    assert cosine > 0.85


def test_red_cards_shift_the_vector_without_touching_score_curves():
    goals = [(40, "home")]
    facts_clean = compute_facts(goals, [], 1, 0)
    facts_red = compute_facts(goals, [(20, "away")], 1, 0)
    vec_clean = build_feature_vector(goals, facts_clean, 1, 0, "M")
    vec_red = build_feature_vector(goals, facts_red, 1, 0, "M")
    assert vec_clean != vec_red


def test_quantize_int8_bounds_and_determinism():
    goals = [(5, "home"), (6, "home"), (7, "home"), (80, "away")]
    facts = compute_facts(goals, [], 3, 1)
    vec = build_feature_vector(goals, facts, 3, 1, "F")
    q = quantize_int8(vec)
    assert len(q) == DIM
    assert all(-127 <= v <= 127 for v in q)
    assert q == quantize_int8(vec)
    # Round-trip: dequantised values stay within half a quantisation step.
    decoded = _decode(encode_vector(vec))
    assert max(abs(a - b) for a, b in zip(decoded, vec)) <= 0.5 / 127.0 + 1e-9


# ---------------------------------------------------------------------------
# No team-identity leakage
# ---------------------------------------------------------------------------


def test_identical_timelines_yield_identical_vectors_across_teams(tmp_path):
    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    events = [
        ("goal", 12, None, "away"),
        ("own_goal", 47, None, "home"),
        ("penalty_goal", 78, None, "home"),
        ("red_card", 85, None, "away"),
    ]
    # own_goal is credited to the SCORING side (`team_side`), so home has 2.
    _add_match(con, "m_alpha", 2, 1, events, teams=(1, 2), date="2019-03-03T12:00:00+00:00")
    _add_match(con, "m_gamma", 2, 1, events, teams=(3, 4), date="2024-11-11T20:00:00+00:00")
    con.close()

    result = build_index(db)
    assert result.matches_indexed == 2
    vec_alpha = _row_by_id(result, "m_alpha")[8]
    vec_gamma = _row_by_id(result, "m_gamma")[8]
    assert vec_alpha == vec_gamma  # byte-identical encoded vectors
    # Team names appear ONLY as display metadata.
    assert _row_by_id(result, "m_alpha")[4:6] == ["Alpha FC", "Beta United"]
    assert _row_by_id(result, "m_gamma")[4:6] == ["Gamma City", "Delta Rovers"]


# ---------------------------------------------------------------------------
# Coverage honesty
# ---------------------------------------------------------------------------


def test_uncovered_matches_are_excluded_even_with_event_rows(tmp_path):
    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    _add_match(con, "covered", 1, 0, [("goal", 40, None, "home")])
    _add_match(con, "stray", 1, 0, [("goal", 40, None, "home")], covered=False)
    con.close()

    result = build_index(db)
    assert result.matches_indexed == 1
    assert result.rows[0][0] == "covered"


def test_integrity_mismatch_is_skipped_and_counted(tmp_path):
    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    _add_match(con, "broken", 2, 0, [("goal", 10, None, "home")])
    con.close()

    result = build_index(db)
    assert result.matches_indexed == 0
    assert result.matches_skipped_integrity == 1


def test_verified_goalless_match_is_indexed(tmp_path):
    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    _add_match(con, "goalless", 0, 0, [])
    con.close()

    result = build_index(db)
    assert result.matches_indexed == 1
    row = result.rows[0]
    assert row[6] == "0-0"
    assert row[9] == [0, 0, 0, -1, -1, -1, 0, 0]


def test_gender_comes_from_the_competition(tmp_path):
    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    _add_match(con, "w1", 1, 0, [("goal", 40, None, "home")], competition_id="eng.1.w")
    con.close()

    result = build_index(db)
    assert _row_by_id(result, "w1")[7] == "F"


def test_missing_db_yields_empty_result(tmp_path):
    result = build_index(tmp_path / "nope.sqlite")
    assert result.matches_indexed == 0
    assert result.rows == []


def test_pre_coverage_warehouse_yields_empty_result(tmp_path):
    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    _add_match(con, "m1", 1, 0, [("goal", 12, None, "home")])
    con.execute("DROP TABLE match_event_coverage")
    con.commit()
    con.close()

    result = build_index(db)
    assert result.matches_indexed == 0


# ---------------------------------------------------------------------------
# Artifact determinism
# ---------------------------------------------------------------------------


def test_artifact_is_byte_identical_across_runs(tmp_path):
    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    _add_match(con, "m1", 3, 2, [
        ("goal", 20, None, "away"),
        ("goal", 55, None, "away"),
        ("goal", 70, None, "home"),
        ("goal", 80, None, "home"),
        ("goal", 88, 2, "home"),
    ])
    _add_match(con, "m2", 0, 0, [], date="2024-05-03T15:00:00+00:00")
    con.close()

    path_a = write_artifact(build_index(db), tmp_path / "a" / "index.json")
    path_b = write_artifact(build_index(db), tmp_path / "b" / "index.json")
    assert path_a.read_bytes() == path_b.read_bytes()

    payload = json.loads(path_a.read_text())
    assert payload["meta"]["schema"] == 1
    assert payload["meta"]["dim"] == DIM
    assert payload["meta"]["count"] == 2
    assert payload["meta"]["columns"] == list(COLUMNS)
    assert payload["meta"]["facts_columns"] == list(FACTS_COLUMNS)
    # generated_at derives from the warehouse's own coverage stamps.
    assert payload["meta"]["generated_at"] == "2024-06-01T00:00:00+00:00"
    # Rows sorted by match_id.
    assert [row[0] for row in payload["rows"]] == ["m1", "m2"]


def test_added_time_uses_effective_minutes(tmp_path):
    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    # A 90+4 winner: decisive/last minute must be 94, not 90.
    _add_match(con, "late", 1, 0, [("goal", 90, 4, "home")])
    con.close()

    result = build_index(db)
    facts = _row_by_id(result, "late")[9]
    assert facts[3] == 94  # decider_minute
    assert facts[5] == 94  # last_goal_minute


def test_cli_writes_artifact(tmp_path, capsys):
    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    _add_match(con, "m1", 1, 0, [("goal", 12, None, "home")])
    con.close()

    out = tmp_path / "artifacts" / "index.json"
    assert main(["--db", str(db), "--out", str(out)]) == 0
    payload = json.loads(out.read_text())
    assert payload["meta"]["count"] == 1
    assert "matches_indexed=1" in capsys.readouterr().out
