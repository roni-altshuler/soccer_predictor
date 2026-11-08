"""Schedule spellings must reuse established identities, never invent clubs."""

import sqlite3
from datetime import date, timedelta

import pytest
import yaml

from backend.services.forecast.schedule_identity import with_pinned_schedule_aliases


def pinned(tmp_path, entries):
    path = tmp_path / "aliases.yml"
    path.write_text(yaml.safe_dump({"teams": entries}))
    return path


def test_current_deportivo_spelling_reuses_the_existing_pin():
    # This spelling only occurs in unplayed FBref rows. Historical graph
    # evidence knows "Dep. La Coruña", so it cannot learn the new article.
    learned = {("esp.1", "dep la coruna"): "deportivo la coruna"}
    aliases = with_pinned_schedule_aliases(learned, ["esp.1::deportivo la coruna"])
    assert aliases[("esp.1", "dep a coruna")] == "deportivo la coruna"
    assert aliases[("esp.1", "dep la coruna")] == "deportivo la coruna"
    assert learned == {("esp.1", "dep la coruna"): "deportivo la coruna"}


def test_learned_evidence_is_never_overridden(tmp_path):
    path = pinned(
        tmp_path, [{"canonical": "Alpha", "gender": "M", "aliases": ["Short"]}]
    )
    learned = {("esp.1", "short"): "beta"}
    assert (
        with_pinned_schedule_aliases(learned, ["esp.1::alpha"], alias_file=path)
        == learned
    )


@pytest.mark.parametrize("reverse", [False, True])
def test_ambiguous_pins_are_refused_in_either_order(tmp_path, reverse):
    entries = [
        {"canonical": club, "gender": "M", "aliases": ["United"]}
        for club in ["Alpha", "Beta"]
    ]
    path = pinned(tmp_path, entries[::-1] if reverse else entries)
    assert (
        with_pinned_schedule_aliases(
            {}, ["eng.1::alpha", "eng.1::beta"], alias_file=path
        )
        == {}
    )


def test_a_pin_cannot_rename_another_canonical_club(tmp_path):
    path = pinned(
        tmp_path, [{"canonical": "Alpha", "gender": "M", "aliases": ["Beta"]}]
    )
    assert (
        with_pinned_schedule_aliases(
            {}, ["esp.1::alpha", "esp.1::beta"], alias_file=path
        )
        == {}
    )


def test_pins_are_competition_and_gender_scoped(tmp_path):
    path = pinned(
        tmp_path, [{"canonical": "Alpha", "gender": "M", "aliases": ["Short"]}]
    )
    aliases = with_pinned_schedule_aliases(
        {}, ["esp.1::alpha", "eng.1::beta", "esp.1.w::alpha"], alias_file=path
    )
    assert aliases == {("esp.1", "short"): "alpha"}


def test_unknown_and_similar_names_are_not_guessed(tmp_path):
    path = pinned(
        tmp_path, [{"canonical": "Alpha", "gender": "M", "aliases": ["Short"]}]
    )
    assert with_pinned_schedule_aliases({}, ["esp.1::alphas"], alias_file=path) == {}


def test_load_upcoming_keeps_a_single_deportivo_and_removes_its_played_fixture(
    monkeypatch,
    tmp_path,
):
    """Exercise the real schedule SQL and resolver with a full 20-club season.

    Real temporary SQLite and canonical files exercise the read-only loader
    without downloading DuckDB extensions or reading the checkout's data.
    """
    duckdb = pytest.importorskip("duckdb")
    from backend.scripts import forecast_season as fs

    canonical = tmp_path / "canonical.duckdb"
    con = duckdb.connect(str(canonical))
    con.execute(
        "CREATE TABLE team_aliases(competition_id TEXT, fb_norm TEXT, wh_norm TEXT)"
    )
    con.execute("CREATE TABLE teams(team_key TEXT)")
    clubs = ["deportivo la coruna"] + [f"opponent {i}" for i in range(19)]
    con.executemany(
        "INSERT INTO teams VALUES (?)", [(f"esp.1::{club}",) for club in clubs]
    )
    day = (date.today() + timedelta(days=1)).isoformat()
    rows = [
        (
            "Spain La Liga",
            "2026-2027",
            day,
            "20:00",
            "Dep. A Coruña" if home == clubs[0] else home,
            "Dep. A Coruña" if away == clubs[0] else away,
            "1",
            None,
        )
        for home in clubs
        for away in clubs
        if home != away
    ]
    con.close()
    data = tmp_path / "backend/data"
    data.mkdir(parents=True)
    with sqlite3.connect(data / "fbref.sqlite") as schedule:
        schedule.execute(
            "CREATE TABLE fbref_fixtures(league TEXT, season TEXT, date TEXT, "
            "time TEXT, home TEXT, away TEXT, round TEXT, home_goals INTEGER)"
        )
        schedule.executemany(
            "INSERT INTO fbref_fixtures VALUES (?,?,?,?,?,?,?,?)", rows
        )
    played = [
        {
            "competition_id": "esp.1",
            "season": 2026,
            "home_key": "esp.1::deportivo la coruna",
            "away_key": "esp.1::opponent 0",
        }
    ]

    monkeypatch.setattr(fs, "ROOT", tmp_path)
    monkeypatch.setattr(fs, "CANONICAL", canonical)
    upcoming = fs.load_upcoming(["esp.1"], played)
    assert len(upcoming) == 379
    assert len({row[key] for row in upcoming for key in ["home_key", "away_key"]}) == 20
    assert not any(
        "dep a coruna" in row[key]
        for row in upcoming
        for key in ["home_key", "away_key"]
    )
    assert not any(
        (row["home_key"], row["away_key"])
        == (played[0]["home_key"], played[0]["away_key"])
        for row in upcoming
    )
    assert (
        sum("Dep. A Coruña" in (row["home_name"], row["away_name"]) for row in upcoming)
        == 37
    )
    assert all(row["local_date"].isoformat() == day for row in upcoming)
    assert all(row["kickoff"] == "20:00" for row in upcoming)
