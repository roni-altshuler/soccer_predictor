"""Tests for the event-coverage summary builder
(`backend.scripts.build_event_coverage`).

Everything runs against SYNTHETIC fixture warehouses built in tmp_path —
never against production data. Covered contracts:

* coverage semantics match `Warehouse.events_coverage()`: the
  `match_event_coverage` marker is authoritative; event rows without a
  marker (legacy direct writers) still count as covered; verified-empty
  (marker with zero events) is counted separately from with-events;
* per-(competition, season) cells sum to the per-competition totals and the
  artifact-level totals; incomplete (unscored) matches are excluded;
* deterministic artifact: sorted competitions/seasons, stable generated_at
  override, byte-identical re-runs;
* honesty on absent/empty/pre-v4 warehouses (no fabricated coverage).
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from backend.scripts.build_event_coverage import (
    CoverageRow,
    build_coverage,
    main,
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
    con.execute("INSERT INTO competitions VALUES ('usa.1.w', 'NWSL', 'F')")
    con.commit()
    return con


def _add_match(
    con: sqlite3.Connection,
    match_id: str,
    *,
    competition_id: str = "eng.1",
    season: int | None = 2024,
    home_score: int | None = 1,
    away_score: int | None = 0,
    n_events: int | None = None,
    marker: bool = True,
) -> None:
    """`n_events=None` → uncovered. `n_events=0` + marker → verified-empty.

    `marker=False` with events simulates a legacy direct
    `upsert_match_events` writer that never recorded a coverage row.
    """

    con.execute(
        "INSERT INTO matches VALUES (?, ?, ?, '2024-05-01T15:00:00+00:00', 1, 2, ?, ?)",
        (match_id, competition_id, season, home_score, away_score),
    )
    if n_events is None:
        return
    for seq in range(n_events):
        con.execute(
            "INSERT INTO match_events VALUES (?, ?, 'goal', ?, NULL, 'home', 'P', 'test')",
            (match_id, seq, 10 + seq),
        )
    if marker:
        con.execute(
            "INSERT INTO match_event_coverage VALUES (?, 'test', ?, '2024-05-01T18:00:00+00:00')",
            (match_id, n_events),
        )


# ---------------------------------------------------------------------------
# Aggregation semantics
# ---------------------------------------------------------------------------


def test_counts_covered_verified_empty_and_uncovered(tmp_path: Path) -> None:
    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    _add_match(con, "m1", n_events=3)                     # covered, with events
    _add_match(con, "m2", home_score=0, away_score=0, n_events=0)  # verified-empty
    _add_match(con, "m3")                                 # uncovered
    con.commit()
    con.close()

    result = build_coverage(db)
    assert len(result.competitions) == 1
    comp = result.competitions[0]
    assert comp.competition_id == "eng.1"
    assert comp.name == "Premier League"
    assert comp.gender == "M"
    assert comp.totals.matches == 3
    assert comp.totals.covered == 2
    assert comp.totals.with_events == 1
    assert comp.totals.verified_empty == 1
    assert comp.totals.uncovered == 1
    assert comp.totals.coverage == round(2 / 3, 4)
    assert result.totals.as_dict() == comp.totals.as_dict()


def test_markerless_event_rows_count_as_covered(tmp_path: Path) -> None:
    """Legacy direct writers have events but no marker — still covered."""

    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    _add_match(con, "m1", n_events=2, marker=False)
    con.commit()
    con.close()

    totals = build_coverage(db).totals
    assert totals.covered == 1
    assert totals.with_events == 1
    assert totals.verified_empty == 0


def test_incomplete_matches_are_excluded(tmp_path: Path) -> None:
    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    _add_match(con, "m1", home_score=None, away_score=None)
    _add_match(con, "m2", n_events=1)
    con.commit()
    con.close()

    totals = build_coverage(db).totals
    assert totals.matches == 1
    assert totals.covered == 1


def test_per_season_cells_sum_to_competition_totals(tmp_path: Path) -> None:
    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    _add_match(con, "m1", season=2023, n_events=2)
    _add_match(con, "m2", season=2023)
    _add_match(con, "m3", season=2024, home_score=0, away_score=0, n_events=0)
    _add_match(con, "w1", competition_id="usa.1.w", season=2024, n_events=1)
    con.commit()
    con.close()

    result = build_coverage(db)
    by_id = {c.competition_id: c for c in result.competitions}
    eng = by_id["eng.1"]

    assert sorted(eng.seasons) == [2023, 2024]
    assert eng.seasons[2023].matches == 2
    assert eng.seasons[2023].covered == 1
    assert eng.seasons[2024].verified_empty == 1

    summed = CoverageRow()
    for cell in eng.seasons.values():
        summed.add(cell)
    assert summed.as_dict() == eng.totals.as_dict()

    assert by_id["usa.1.w"].gender == "F"
    assert result.totals.matches == 4
    assert result.totals.covered == 3


def test_null_season_groups_under_minus_one(tmp_path: Path) -> None:
    """No completed match may be silently dropped from the report."""

    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    _add_match(con, "m1", season=None, n_events=1)
    con.commit()
    con.close()

    comp = build_coverage(db).competitions[0]
    assert sorted(comp.seasons) == [-1]
    assert comp.totals.matches == 1


# ---------------------------------------------------------------------------
# Honesty on missing / degenerate inputs
# ---------------------------------------------------------------------------


def test_missing_db_yields_empty_result(tmp_path: Path) -> None:
    result = build_coverage(tmp_path / "nope.sqlite")
    assert result.competitions == []
    assert result.totals.matches == 0
    assert result.totals.coverage == 0.0


def test_pre_v4_warehouse_without_marker_table(tmp_path: Path) -> None:
    """Schema v3 (events, no coverage table): event rows still count."""

    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    con.execute("DROP TABLE match_event_coverage")
    _add_match(con, "m1", n_events=1, marker=False)
    _add_match(con, "m2")
    con.commit()
    con.close()

    totals = build_coverage(db).totals
    assert totals.matches == 2
    assert totals.covered == 1
    assert totals.verified_empty == 0


# ---------------------------------------------------------------------------
# Artifact determinism
# ---------------------------------------------------------------------------


def test_artifact_is_deterministic_and_sorted(tmp_path: Path) -> None:
    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    _add_match(con, "w1", competition_id="usa.1.w", season=2024, n_events=1)
    _add_match(con, "m2", season=2024, n_events=2)
    _add_match(con, "m1", season=2023)
    con.commit()
    con.close()

    out = tmp_path / "coverage.json"
    write_artifact(build_coverage(db), out, generated_at="2026-01-01T00:00:00+00:00")
    first = out.read_text()
    write_artifact(build_coverage(db), out, generated_at="2026-01-01T00:00:00+00:00")
    assert out.read_text() == first  # byte-identical re-run

    payload = json.loads(first)
    assert payload["schema"] == 1
    assert payload["generated_at"] == "2026-01-01T00:00:00+00:00"
    comp_ids = [c["competition_id"] for c in payload["competitions"]]
    assert comp_ids == sorted(comp_ids)
    eng_seasons = [s["season"] for s in payload["competitions"][0]["seasons"]]
    assert eng_seasons == sorted(eng_seasons)
    assert payload["totals"]["matches"] == 3
    assert payload["totals"]["uncovered"] == 1


def test_main_writes_artifact(tmp_path: Path, capsys) -> None:
    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    _add_match(con, "m1", n_events=1)
    con.commit()
    con.close()

    out = tmp_path / "events" / "coverage.json"
    assert main(["--db", str(db), "--out", str(out)]) == 0
    assert out.exists()
    payload = json.loads(out.read_text())
    assert payload["totals"]["covered"] == 1
    captured = capsys.readouterr().out
    assert "coverage=100.0%" in captured
