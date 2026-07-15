"""Tests for the Justice Ledger builder (`backend.scripts.build_justice`).

Everything runs against SYNTHETIC fixture warehouses built in tmp_path —
never against production data. Covered contracts:

* xPts math on hand-checkable fixtures (independent-Poisson scoreline grid:
  probabilities sum to 1, symmetry, degenerate zero-xG cases, the reference
  2.0-vs-0.5 values);
* actual points and xPts are summed over the SAME xG-backed match basis;
* fixture deduplication across sources (xG-bearing row wins);
* the 90% per-team and 90%-of-teams honesty gates;
* team names resolved via the teams table;
* deterministic artifacts;
* the warehouse is opened strictly read-only (a chmod-444 file works and is
  never modified);
* the empty/absent-warehouse case and the CLI.
"""

from __future__ import annotations

import json
import math
import os
import sqlite3
import stat
from pathlib import Path

import pytest

from backend.scripts.build_justice import (
    COMPETITION_TEAMS_PASS_MIN,
    TEAM_COVERAGE_MIN,
    XPTS_GOAL_CAP,
    TeamAgg,
    _season_block,
    actual_points,
    build_justice,
    expected_points,
    main,
    poisson_pmf,
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
            source TEXT NOT NULL,
            competition_id TEXT NOT NULL,
            season INTEGER NOT NULL,
            date_utc TEXT,
            home_team_id INTEGER,
            away_team_id INTEGER,
            home_score INTEGER,
            away_score INTEGER,
            home_xg REAL,
            away_xg REAL
        );
        """
    )
    con.execute("INSERT INTO competitions VALUES ('eng.1', 'Premier League', 'M')")
    con.execute("INSERT INTO teams VALUES (1, 'Alpha FC')")
    con.execute("INSERT INTO teams VALUES (2, 'Beta United')")
    con.execute("INSERT INTO teams VALUES (3, 'Gamma City')")
    con.execute("INSERT INTO teams VALUES (4, 'Delta Rovers')")
    con.commit()
    return con


_MATCH_SEQ = {"n": 0}


def _add_match(
    con: sqlite3.Connection,
    home: int,
    away: int,
    home_score: int,
    away_score: int,
    home_xg: float | None,
    away_xg: float | None,
    *,
    match_id: str | None = None,
    source: str = "fdcouk",
    competition_id: str = "eng.1",
    season: int = 2024,
) -> str:
    _MATCH_SEQ["n"] += 1
    mid = match_id or f"m{_MATCH_SEQ['n']:04d}"
    con.execute(
        "INSERT INTO matches VALUES (?, ?, ?, ?, '2024-09-01T15:00:00+00:00', ?, ?, ?, ?, ?, ?)",
        (mid, source, competition_id, season, home, away, home_score, away_score, home_xg, away_xg),
    )
    con.commit()
    return mid


def _round_robin_with_xg(con: sqlite3.Connection, team_ids: list[int]) -> None:
    """Every ordered pair plays once: 1-0 home wins with equal xG 1.0-1.0."""

    for h in team_ids:
        for a in team_ids:
            if h != a:
                _add_match(con, h, a, 1, 0, 1.0, 1.0)


# ---------------------------------------------------------------------------
# xPts math (pure, hand-checkable)
# ---------------------------------------------------------------------------


def test_poisson_pmf_basics():
    assert poisson_pmf(0, 0.0) == 1.0
    assert poisson_pmf(1, 0.0) == 0.0
    assert poisson_pmf(0, 1.0) == pytest.approx(math.exp(-1))
    assert poisson_pmf(2, 2.0) == pytest.approx(math.exp(-2) * 4 / 2)


def test_expected_points_reference_values_2_0_vs_0_5():
    # Hand-checked over the 11x11 grid: P(home win)=0.7310, P(draw)=0.1871,
    # P(away win)=0.0819 → home 3*0.7310+0.1871=2.3801, away 3*0.0819+0.1871=0.4328.
    home_xpts, away_xpts = expected_points(2.0, 0.5)
    assert home_xpts == pytest.approx(2.3801, abs=1e-4)
    assert away_xpts == pytest.approx(0.4328, abs=1e-4)


def test_expected_points_matches_an_independent_grid_derivation():
    # Re-derive P(win/draw/loss) with a hand-rolled scoreline grid and check
    # expected_points reproduces 3*P(win) + P(draw) exactly. Also assert the
    # grid loses almost no mass to the 10-goal cap at realistic xG.
    for hx, ax in [(2.0, 0.5), (1.3, 1.1), (0.0, 0.0), (3.0, 3.0)]:
        pw = pd = pl = 0.0
        for i in range(XPTS_GOAL_CAP + 1):
            for j in range(XPTS_GOAL_CAP + 1):
                p = poisson_pmf(i, hx) * poisson_pmf(j, ax)
                if i > j:
                    pw += p
                elif i == j:
                    pd += p
                else:
                    pl += p
        assert pw + pd + pl == pytest.approx(1.0, abs=1e-3)  # cap loses ~nothing
        h, a = expected_points(hx, ax)
        assert h == pytest.approx(3 * pw + pd)
        assert a == pytest.approx(3 * pl + pd)


def test_expected_points_is_symmetric():
    h1, a1 = expected_points(2.0, 0.5)
    h2, a2 = expected_points(0.5, 2.0)
    assert h1 == pytest.approx(a2)
    assert a1 == pytest.approx(h2)


def test_expected_points_equal_xg_gives_equal_xpts():
    h, a = expected_points(1.5, 1.5)
    assert h == pytest.approx(a)
    # More than a coin flip's worth because draws pay 1 each.
    assert 1.0 < h < 1.5


def test_expected_points_zero_zero_is_a_certain_draw():
    assert expected_points(0.0, 0.0) == (1.0, 1.0)


def test_expected_points_rejects_negative_xg():
    with pytest.raises(ValueError):
        expected_points(-0.1, 1.0)


def test_actual_points():
    assert actual_points(2, 1) == (3, 0)
    assert actual_points(0, 3) == (0, 3)
    assert actual_points(1, 1) == (1, 1)


# ---------------------------------------------------------------------------
# Aggregation over a synthetic warehouse
# ---------------------------------------------------------------------------


def test_two_team_season_pts_xpts_and_names(tmp_path):
    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    # Alpha 2-0 Beta with xG 2.0 vs 0.5, and Beta 1-1 Alpha with xG 0.5 vs 2.0.
    _add_match(con, 1, 2, 2, 0, 2.0, 0.5)
    _add_match(con, 2, 1, 1, 1, 0.5, 2.0)
    con.close()

    result = build_justice(db)
    block = result.seasons["eng.1:2024"]
    assert block["coverage"] == 1.0

    # Alpha carries xG 2.0 (vs 0.5) in BOTH fixtures — home in the first,
    # away in the second — so its xpts is twice the favoured side's share.
    h_ref, a_ref = expected_points(2.0, 0.5)
    by_name = {t["team"]: t for t in block["teams"]}
    alpha, beta = by_name["Alpha FC"], by_name["Beta United"]

    assert alpha["pts"] == 4  # won the first (3), drew the second (1)
    assert alpha["xpts"] == pytest.approx(round(2 * h_ref, 2), abs=0.01)
    assert alpha["matches"] == 2
    assert alpha["delta"] == pytest.approx(round(alpha["pts"] - 2 * h_ref, 2), abs=0.01)

    assert beta["pts"] == 1  # lost + drew
    assert beta["xpts"] == pytest.approx(round(2 * a_ref, 2), abs=0.01)

    # Sorted by xpts desc.
    assert [t["team"] for t in block["teams"]] == ["Alpha FC", "Beta United"]


def test_pts_and_xpts_share_the_same_match_basis(tmp_path):
    # A match WITHOUT xG contributes to neither pts nor xpts nor `matches` —
    # actual and deserved points must stay on an identical denominator.
    # Alpha wins all 10 of its fixtures but one lacks xG (9/10 = 90%, passes
    # the gate): its emitted pts must be 27 (9 wins), never 30.
    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    for tid in range(10, 20):
        con.execute("INSERT INTO teams VALUES (?, ?)", (tid, f"Opponent {tid}"))
    con.commit()
    for i, opp in enumerate(range(10, 20)):
        has_xg = i > 0  # exactly one fixture without xG
        _add_match(con, 1, opp, 1, 0, 1.2 if has_xg else None, 0.8 if has_xg else None)
    con.close()

    result = build_justice(db)
    block = result.seasons["eng.1:2024"]
    alpha = next(t for t in block["teams"] if t["team"] == "Alpha FC")
    assert alpha["matches"] == 9
    assert alpha["pts"] == 27  # only xG-backed wins count toward the ledger
    h_ref, _ = expected_points(1.2, 0.8)
    assert alpha["xpts"] == pytest.approx(round(9 * h_ref, 2), abs=0.01)
    # The one opponent without xG (coverage 0/1) is dropped from the table.
    names = [t["team"] for t in block["teams"]]
    assert "Opponent 10" not in names
    assert len(names) == 10  # Alpha + the nine xG-covered opponents


def test_dedup_prefers_xg_row_and_is_deterministic(tmp_path):
    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    # Same fixture from three sources; only fdcouk carries xG. The openfootball
    # row even disagrees on the score — the xG row must win.
    _add_match(con, 1, 2, 2, 0, None, None, source="openfootball", match_id="of_1")
    _add_match(con, 1, 2, 1, 0, 1.0, 1.0, source="fdcouk", match_id="fd_1")
    _add_match(con, 1, 2, 1, 0, None, None, source="espn", match_id="es_1")
    # Reverse fixture with xG so both teams pass the coverage gate.
    _add_match(con, 2, 1, 0, 1, 1.0, 1.0, source="fdcouk", match_id="fd_2")
    con.close()

    result = build_justice(db)
    block = result.seasons["eng.1:2024"]
    alpha = next(t for t in block["teams"] if t["team"] == "Alpha FC")
    assert alpha["matches"] == 2  # one per ordered pair, not four rows
    assert alpha["pts"] == 6  # from the kept 1-0 / 0-1 rows, not the 2-0 dup
    assert block["coverage"] == 1.0


def test_team_below_90pct_coverage_is_dropped(tmp_path):
    # Gamma is a resolver-split phantom identity (the real-warehouse Ipswich
    # case): it has fixtures but no xG. It must not appear in the emitted
    # table, while the lightly-diluted real teams still pass their gate and
    # the season as a whole still qualifies (>= 90% of teams passing).
    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    real_teams = [1, 2, 4] + list(range(10, 17))
    for tid in range(10, 17):
        con.execute("INSERT INTO teams VALUES (?, ?)", (tid, f"Team {tid}"))
    con.commit()
    # Full double round robin among the ten real teams: 18 xG fixtures each.
    _round_robin_with_xg(con, real_teams)
    # Phantom Gamma (team 3) hosts each real team once, never with xG:
    # real teams end at 18/19 = 94.7% (pass); Gamma at 0/10 (fail).
    for other in real_teams:
        _add_match(con, 3, other, 0, 0, None, None)
    con.close()

    result = build_justice(db)
    block = result.seasons["eng.1:2024"]  # 10 of 11 teams pass = 90.9%
    names = [t["team"] for t in block["teams"]]
    assert "Gamma City" not in names
    assert len(names) == len(real_teams)
    assert all(t["matches"] == 18 for t in block["teams"])
    assert TEAM_COVERAGE_MIN == 0.90


def test_competition_gated_when_too_many_teams_fail(tmp_path):
    # 2 of 4 teams below coverage → 50% pass rate < 90% → season not emitted.
    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    _add_match(con, 1, 2, 1, 0, 1.0, 0.5)
    _add_match(con, 2, 1, 0, 1, 0.5, 1.0)
    for h, a in [(3, 4), (4, 3), (3, 1), (4, 2)]:
        _add_match(con, h, a, 0, 0, None, None)
    con.close()

    result = build_justice(db)
    assert result.seasons == {}
    assert COMPETITION_TEAMS_PASS_MIN == 0.90


def test_team_exactly_at_90pct_coverage_passes_the_gate():
    # The gate is >=, not >: 9 of 10 fixtures with xG is exactly 90% and must
    # pass; 8 of 10 must fail. Exercised on the gating helper directly.
    exactly_90 = TeamAgg(team_id=1, name="Alpha FC", matches_total=10, matches_with_xg=9)
    below_90 = TeamAgg(team_id=2, name="Beta United", matches_total=10, matches_with_xg=8)
    assert exactly_90.coverage >= TEAM_COVERAGE_MIN
    assert below_90.coverage < TEAM_COVERAGE_MIN

    block = _season_block({1: exactly_90, 2: below_90})
    # 1 of 2 teams passing (50%) is under the 90%-of-teams bar → gated out.
    assert block is None

    block = _season_block({1: exactly_90})
    assert block is not None
    assert [t["team"] for t in block["teams"]] == ["Alpha FC"]
    assert block["coverage"] == 0.9


def test_teams_sorted_by_xpts_desc(tmp_path):
    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    # Beta dominates on chance quality but loses; Alpha wins while deserving less.
    _add_match(con, 1, 2, 1, 0, 0.3, 2.5)
    _add_match(con, 2, 1, 0, 1, 2.5, 0.3)
    con.close()

    result = build_justice(db)
    block = result.seasons["eng.1:2024"]
    assert [t["team"] for t in block["teams"]] == ["Beta United", "Alpha FC"]
    beta = block["teams"][0]
    assert beta["pts"] == 0
    assert beta["delta"] < 0  # behind the numbers despite topping xPts


def test_multiple_competition_seasons_are_keyed_separately(tmp_path):
    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    _add_match(con, 1, 2, 1, 0, 1.0, 1.0, season=2023)
    _add_match(con, 2, 1, 0, 1, 1.0, 1.0, season=2023)
    _add_match(con, 1, 2, 0, 2, 0.5, 1.5, season=2024)
    _add_match(con, 2, 1, 2, 0, 1.5, 0.5, season=2024)
    con.close()

    result = build_justice(db)
    assert sorted(result.seasons) == ["eng.1:2023", "eng.1:2024"]
    assert list(result.seasons) == sorted(result.seasons)  # deterministic order


# ---------------------------------------------------------------------------
# Read-only guarantee + artifacts
# ---------------------------------------------------------------------------


def test_build_works_on_a_write_protected_db_and_never_modifies_it(tmp_path):
    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    _add_match(con, 1, 2, 1, 0, 1.0, 1.0)
    _add_match(con, 2, 1, 0, 1, 1.0, 1.0)
    con.close()

    os.chmod(db, stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)  # 0444
    before = db.stat().st_mtime_ns
    try:
        result = build_justice(db)
    finally:
        os.chmod(db, stat.S_IRUSR | stat.S_IWUSR)
    assert "eng.1:2024" in result.seasons
    assert db.stat().st_mtime_ns == before


def test_artifact_is_deterministic_across_runs(tmp_path):
    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    _add_match(con, 1, 2, 2, 0, 2.0, 0.5)
    _add_match(con, 2, 1, 1, 1, 0.5, 2.0)
    _add_match(con, 1, 3, 1, 0, 1.2, 0.8)
    _add_match(con, 3, 1, 0, 0, 0.8, 1.2)
    _add_match(con, 2, 3, 0, 0, 1.0, 1.0)
    _add_match(con, 3, 2, 3, 1, 2.2, 0.4)
    con.close()

    stamp = "2026-07-15T00:00:00+00:00"
    p1 = write_artifact(build_justice(db), tmp_path / "a" / "ledger.json", generated_at=stamp)
    p2 = write_artifact(build_justice(db), tmp_path / "b" / "ledger.json", generated_at=stamp)
    assert p1.read_text() == p2.read_text()

    payload = json.loads(p1.read_text())
    assert payload["schema"] == 1
    assert payload["generated_at"] == stamp
    assert list(payload["seasons"]) == sorted(payload["seasons"])


def test_missing_db_yields_empty_result(tmp_path):
    result = build_justice(tmp_path / "nope.sqlite")
    assert result.seasons == {}


def test_db_without_matches_table_yields_empty_result(tmp_path):
    db = tmp_path / "wh.sqlite"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE something_else (x INTEGER)")
    con.commit()
    con.close()

    result = build_justice(db)
    assert result.seasons == {}


def test_no_xg_anywhere_yields_empty_result(tmp_path):
    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    _add_match(con, 1, 2, 1, 0, None, None)
    con.close()

    result = build_justice(db)
    assert result.seasons == {}


def test_cli_writes_artifact(tmp_path, capsys):
    db = tmp_path / "wh.sqlite"
    con = _make_warehouse(db)
    _add_match(con, 1, 2, 1, 0, 1.0, 1.0)
    _add_match(con, 2, 1, 0, 1, 1.0, 1.0)
    con.close()

    out = tmp_path / "justice" / "ledger.json"
    assert main(["--db", str(db), "--out", str(out)]) == 0

    payload = json.loads(out.read_text())
    assert payload["schema"] == 1
    assert "eng.1:2024" in payload["seasons"]
    stdout = capsys.readouterr().out
    assert "competitions_emitted=1" in stdout
    assert "teams_emitted=2" in stdout
