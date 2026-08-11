"""The live-evaluation pipeline, proven before there is anything live to score.

The season starts in days and the live sample is zero. That is the correct
state, but it means the scoring path is completely unexercised at exactly the
moment it matters — the first real results land into code nobody has run.

So these tests drive the pipeline with BACKFILLED historical fixtures. The
distinction the production code draws between retrospective and prospective
evidence is a distinction about what a number MEANS, not about which function
computes it, so exercising the arithmetic on known results is legitimate and
is the only way to know it works before it is needed.
"""
from __future__ import annotations

import math

import pytest

from backend.services.forecast.evaluate import baselines, score


def rows(specs):
    """(p_home, p_draw, p_away, result) -> scoreable rows."""
    out = []
    for i, (ph, pd_, pa, res) in enumerate(specs):
        hs, as_ = {"H": (2, 0), "D": (1, 1), "A": (0, 2)}[res]
        out.append({
            "fixture_uid": f"f{i}", "competition_id": "eng.1",
            "model_version": "2026.08.1+test",
            "kickoff_at": f"2026-08-{15 + (i % 10):02d}T15:00:00+00:00",
            "home_team": f"H{i}", "away_team": f"A{i}",
            "p_home": ph, "p_draw": pd_, "p_away": pa,
            "lambda_home": 1.5, "lambda_away": 1.2,
            "top_scoreline": "1-1",
            "home_score": hs, "away_score": as_, "result": res,
        })
    return out


def test_an_empty_sample_says_so_rather_than_scoring_nothing():
    got = score([], basis="live_published")
    assert got["n"] == 0
    assert got["basis"] == "live_published"
    assert "no scored fixtures" in got["note"]
    assert "brier" not in got, (
        "an empty sample must not carry a metric — a 0.0 Brier on the "
        "dashboard reads as perfect, not as absent")


def test_a_perfect_forecaster_scores_zero():
    got = score(rows([(1 - 2e-9, 1e-9, 1e-9, "H")] * 20), basis="live_published")
    assert got["brier"] == pytest.approx(0.0, abs=1e-6)
    assert got["log_loss"] == pytest.approx(0.0, abs=1e-6)
    assert got["accuracy"] == 1.0


def test_a_uniform_forecaster_hits_the_analytic_floor():
    got = score(rows([(1 / 3, 1 / 3, 1 / 3, "H")] * 30), basis="live_published")
    assert got["brier"] == pytest.approx(2 / 3, abs=1e-5)
    assert got["log_loss"] == pytest.approx(math.log(3), abs=1e-5)


def test_a_confident_wrong_forecaster_is_punished_hardest():
    right = score(rows([(0.9, 0.05, 0.05, "H")] * 20), basis="live")
    wrong = score(rows([(0.9, 0.05, 0.05, "A")] * 20), basis="live")
    assert wrong["brier"] > right["brier"]
    assert wrong["log_loss"] > 2.0


def test_calibration_is_measured_over_every_outcome_not_just_the_pick():
    """A forecaster that says 50/25/25 and is right half the time is
    calibrated; one that says 90/5/5 and is right half the time is not."""
    honest = score(rows([(0.5, 0.25, 0.25, "H")] * 50
                        + [(0.5, 0.25, 0.25, "A")] * 50), basis="live")
    cocky = score(rows([(0.9, 0.05, 0.05, "H")] * 50
                       + [(0.9, 0.05, 0.05, "A")] * 50), basis="live")
    assert honest["ece"] < cocky["ece"]


def test_basis_is_carried_into_the_output():
    """Every consumer has to know which sample it is looking at."""
    assert score(rows([(0.5, 0.3, 0.2, "H")] * 12),
                 basis="live_published")["basis"] == "live_published"
    assert score(rows([(0.5, 0.3, 0.2, "H")] * 12),
                 basis="historical_walkforward")["basis"] == "historical_walkforward"


def test_a_thin_league_reports_its_size_instead_of_a_metric():
    sample = rows([(0.5, 0.3, 0.2, "H")] * 15)
    for r in sample[:5]:
        r["competition_id"] = "esp.1"
    got = score(sample, basis="live")
    assert got["by_league"]["esp.1"]["n"] == 5
    assert got["by_league"]["esp.1"]["brier"] is None
    assert "fewer than 10" in got["by_league"]["esp.1"]["note"]


def test_model_versions_are_reported_separately():
    sample = rows([(0.5, 0.3, 0.2, "H")] * 24)
    for r in sample[12:]:
        r["model_version"] = "2026.09.1+other"
    got = score(sample, basis="live")
    assert set(got["by_model_version"]) == {"2026.08.1+test", "2026.09.1+other"}
    assert all(v["n"] == 12 for v in got["by_model_version"].values())


def test_xg_error_and_scoreline_hit_rate_are_reported():
    got = score(rows([(0.5, 0.3, 0.2, "D")] * 12), basis="live")
    # Every fixture is 1-1 and every stored top scoreline is "1-1".
    assert got["top_scoreline_hit_rate"] == pytest.approx(1.0)
    # lambda 1.5/1.2 against an actual 1-1.
    assert got["xg_mae"] == pytest.approx((0.5 + 0.2) / 2, abs=1e-6)


def test_baselines_are_computed_on_the_same_fixtures():
    sample = rows([(0.6, 0.25, 0.15, "H")] * 40)
    b = baselines(sample)
    assert b["uniform"] == pytest.approx(2 / 3, abs=1e-5)
    assert "optimistic" in b["note"]


def test_join_refuses_to_score_a_fixture_that_has_not_happened(tmp_path):
    """The fabrication guard. A forecast with no result contributes nothing."""
    from backend.services.forecast.evaluate import join_results

    import sqlite3

    db = tmp_path / "w.sqlite"
    conn = sqlite3.connect(db)
    conn.executescript("""
        CREATE TABLE teams (team_id INTEGER PRIMARY KEY, canonical_name TEXT);
        CREATE TABLE matches (
            match_id TEXT PRIMARY KEY, competition_id TEXT, date_utc TEXT,
            home_team_id INTEGER, away_team_id INTEGER,
            home_score INTEGER, away_score INTEGER);
        INSERT INTO teams VALUES (1,'Liverpool'),(2,'Arsenal'),(3,'Chelsea');
        INSERT INTO matches VALUES
            ('m1','eng.1','2026-08-21T19:00:00+00:00',1,2,2,1);
    """)
    conn.commit()
    conn.close()

    snaps = [
        {"competition_id": "eng.1", "kickoff_at": "2026-08-21T19:00:00+00:00",
         "home_team": "Liverpool", "away_team": "Arsenal",
         "p_home": 0.5, "p_draw": 0.3, "p_away": 0.2, "lambda_home": 1.5,
         "lambda_away": 1.2},
        # Not played. Must be dropped, not defaulted to anything.
        {"competition_id": "eng.1", "kickoff_at": "2027-01-01T19:00:00+00:00",
         "home_team": "Chelsea", "away_team": "Arsenal",
         "p_home": 0.5, "p_draw": 0.3, "p_away": 0.2, "lambda_home": 1.5,
         "lambda_away": 1.2},
    ]
    got = join_results(snaps, db=db)
    assert len(got) == 1
    assert got[0]["home_team"] == "Liverpool"
    assert got[0]["result"] == "H"


# ------------------------------------------------------------ the name join
#
# A snapshot's club name comes from FBref and a result's from the warehouse.
# On a full rehearsal against last season those two vocabularies agreed on only
# 68.9% of fixtures — 41% of the Premier League, 23% of the Bundesliga — and
# every miss was dropped silently, so the live sample would simply have been
# small rather than obviously broken. These pin the resolution that fixed it.


def _warehouse(tmp_path, *, teams, aliases=(), matches=()):
    """A minimal warehouse with the two vocabularies the join has to bridge."""
    import sqlite3

    db = tmp_path / "w.sqlite"
    conn = sqlite3.connect(db)
    conn.executescript("""
        CREATE TABLE teams (team_id INTEGER PRIMARY KEY, canonical_name TEXT);
        CREATE TABLE team_aliases (alias TEXT, gender TEXT, team_id INTEGER);
        CREATE TABLE matches (
            match_id INTEGER PRIMARY KEY, competition_id TEXT, date_utc TEXT,
            home_team_id INTEGER, away_team_id INTEGER,
            home_score INTEGER, away_score INTEGER);
    """)
    conn.executemany("INSERT INTO teams VALUES (?,?)", teams)
    conn.executemany("INSERT INTO team_aliases VALUES (?,'M',?)", aliases)
    conn.executemany(
        "INSERT INTO matches (competition_id, date_utc, home_team_id, "
        "away_team_id, home_score, away_score) VALUES (?,?,?,?,?,?)", matches)
    conn.commit()
    conn.close()
    return db


def _snap(home, away, day="2026-08-21", comp="eng.1"):
    return {
        "fixture_uid": f"{home}-{away}", "competition_id": comp, "season": 2026,
        "kickoff_at": f"{day}T19:00:00+00:00", "model_version": "v1",
        "home_team": home, "away_team": away,
        "p_home": 0.5, "p_draw": 0.25, "p_away": 0.25,
    }


def test_a_club_the_two_sources_name_differently_is_still_scored(tmp_path):
    """The exact failure: FBref says 'Wolves', the warehouse says the long name."""
    from backend.services.forecast.evaluate import join_results

    db = _warehouse(
        tmp_path,
        teams=[(1, "Wolverhampton Wanderers"), (2, "Manchester United")],
        aliases=[("Wolves", 1), ("Man Utd", 2), ("Manchester Utd", 2)],
        matches=[("eng.1", "2026-08-21T19:00:00Z", 1, 2, 2, 1)],
    )
    report = {}
    got = join_results([_snap("Wolves", "Manchester Utd")], db=db, report=report)
    assert len(got) == 1
    assert got[0]["result"] == "H"
    assert report["unresolved_count"] == 0


def test_a_result_a_day_either_side_is_the_same_fixture(tmp_path):
    from backend.services.forecast.evaluate import join_results

    db = _warehouse(
        tmp_path, teams=[(1, "Liverpool"), (2, "Arsenal")],
        matches=[("eng.1", "2026-08-22T01:00:00Z", 1, 2, 1, 1)])
    got = join_results([_snap("Liverpool", "Arsenal", day="2026-08-21")], db=db)
    assert len(got) == 1 and got[0]["result"] == "D"


def test_a_fixture_not_played_yet_is_dropped_not_defaulted(tmp_path):
    from backend.services.forecast.evaluate import join_results

    db = _warehouse(tmp_path, teams=[(1, "Liverpool"), (2, "Arsenal")])
    report = {}
    got = join_results([_snap("Liverpool", "Arsenal")], db=db, report=report)
    assert got == []
    assert report["awaiting_result"] == 1
    assert report["unresolved_count"] == 0, (
        "a match that has not happened is not a broken join, and conflating "
        "the two hides the one that needs fixing")


def test_an_unrecognised_club_is_counted_rather_than_silently_dropped(tmp_path):
    from backend.services.forecast.evaluate import join_results

    db = _warehouse(tmp_path, teams=[(1, "Liverpool"), (2, "Arsenal")],
                    matches=[("eng.1", "2026-08-21T19:00:00Z", 1, 2, 1, 0)])
    report = {}
    got = join_results([_snap("Liverpool", "Some New Club")], db=db,
                       report=report)
    assert got == []
    assert report["unresolved_count"] == 1
    assert "eng.1:Some New Club" in report["unresolved_clubs"]


def test_an_alias_meaning_two_clubs_is_refused_rather_than_guessed(tmp_path):
    """Never merge two identities to raise a match rate.

    Taken from a real case the rehearsal surfaced: two clubs share the alias
    "Seattle Reign". Resolving it either way would attribute a forecast to the
    wrong match, which is worse than not scoring it at all.
    """
    import sqlite3

    from backend.services.forecast.evaluate import club_vocabulary

    db = _warehouse(
        tmp_path,
        teams=[(1, "Reign United"), (2, "Seattle Reign")],
        aliases=[("Seattle Reign", 1)],
        matches=[("usa.1", "2026-08-21T19:00:00Z", 1, 2, 1, 0)],
    )
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    vocab = club_vocabulary(conn, db)
    conn.close()
    # The alias points at club 1; club 2's own canonical name is the same
    # string. The canonical name is the store of record and wins.
    assert vocab["usa.1"]["seattle reign"] == 2
    assert vocab["usa.1"]["reign united"] == 1


def test_two_aliases_disagreeing_leave_the_name_unresolvable(tmp_path):
    import sqlite3

    from backend.services.forecast.evaluate import club_vocabulary

    db = _warehouse(
        tmp_path,
        teams=[(1, "Reign United"), (2, "Sound FC")],
        aliases=[("The Reign", 1), ("The Reign", 2)],
        matches=[("usa.1", "2026-08-21T19:00:00Z", 1, 2, 1, 0)],
    )
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    vocab = club_vocabulary(conn, db)
    conn.close()
    assert "the reign" not in vocab["usa.1"]


def test_a_warehouse_without_an_alias_table_still_joins(tmp_path):
    """Fewer names resolve; nothing breaks."""
    import sqlite3

    from backend.services.forecast.evaluate import join_results

    db = tmp_path / "bare.sqlite"
    conn = sqlite3.connect(db)
    conn.executescript("""
        CREATE TABLE teams (team_id INTEGER PRIMARY KEY, canonical_name TEXT);
        CREATE TABLE matches (
            match_id INTEGER PRIMARY KEY, competition_id TEXT, date_utc TEXT,
            home_team_id INTEGER, away_team_id INTEGER,
            home_score INTEGER, away_score INTEGER);
        INSERT INTO teams VALUES (1,'Liverpool'),(2,'Arsenal');
        INSERT INTO matches (competition_id, date_utc, home_team_id,
            away_team_id, home_score, away_score)
            VALUES ('eng.1','2026-08-21T19:00:00Z',1,2,3,0);
    """)
    conn.commit()
    conn.close()
    got = join_results([_snap("Liverpool", "Arsenal")], db=db)
    assert len(got) == 1 and got[0]["result"] == "H"


def test_a_name_is_only_resolved_inside_its_own_competition(tmp_path):
    """Two competitions, same club name, different clubs."""
    from backend.services.forecast.evaluate import club_vocabulary
    import sqlite3

    db = _warehouse(
        tmp_path,
        teams=[(1, "Arsenal"), (2, "Arsenal")],
        matches=[("eng.1", "2026-08-21T19:00:00Z", 1, 1, 1, 0),
                 ("eng.1.w", "2026-08-21T19:00:00Z", 2, 2, 1, 0)],
    )
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    vocab = club_vocabulary(conn, db)
    conn.close()
    assert vocab["eng.1"]["arsenal"] == 1
    assert vocab["eng.1.w"]["arsenal"] == 2
