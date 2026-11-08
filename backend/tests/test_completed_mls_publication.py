"""Offline CLI publication, source reads, and last-good/history boundaries."""

import json
import sqlite3
from collections import defaultdict
from datetime import datetime, timezone
from types import SimpleNamespace

import duckdb
import numpy as np
import pytest

from backend.scripts import capture_projection_history as history
from backend.scripts import forecast_season as fs
from backend.services.forecast.snapshots import SnapshotStore
from backend.tests.test_completed_mls import NOW, make_evidence


@pytest.fixture
def inputs(tmp_path, monkeypatch):
    e = make_evidence()
    data = tmp_path / "backend/data"
    out = data / "predictions"
    out.mkdir(parents=True)
    canonical = data / "canonical.duckdb"
    con = duckdb.connect(str(canonical))
    con.execute(
        "CREATE TABLE matches (match_uid VARCHAR,competition_id VARCHAR,season INTEGER,"
        "local_date DATE,home_key VARCHAR,away_key VARCHAR,"
        "home_name VARCHAR,away_name VARCHAR,home_score INTEGER,away_score INTEGER,"
        "result VARCHAR,phase VARCHAR,kickoff_utc VARCHAR)"
    )
    for m in e["played"]:
        row = {k: v for k, v in m.items() if k != "kickoff_at"}
        row["result"] = (
            "H"
            if m["home_score"] > m["away_score"]
            else "A" if m["home_score"] < m["away_score"] else "D"
        )
        row["kickoff_utc"] = m["kickoff_at"]
        placeholders = ",".join("?" for _ in row)
        con.execute(
            f"INSERT INTO matches ({','.join(row)}) VALUES ({placeholders})",
            list(row.values()),
        )
    con.execute(
        "CREATE TABLE team_aliases "
        "(competition_id VARCHAR,fb_norm VARCHAR,wh_norm VARCHAR)"
    )
    con.execute("CREATE TABLE teams (team_key VARCHAR)")
    keys = sorted({m[k] for m in e["played"] for k in ("home_key", "away_key")})
    con.executemany("INSERT INTO teams VALUES (?)", [(k,) for k in keys])
    con.close()
    schedule = data / "fbref.sqlite"
    with sqlite3.connect(schedule) as con:
        con.execute(
            "CREATE TABLE fbref_fixtures (league TEXT,season TEXT,row_key TEXT,"
            "date TEXT,time TEXT,home TEXT,away TEXT,round TEXT,"
            "home_goals INTEGER,away_goals INTEGER)"
        )
        con.execute(
            "CREATE TABLE fbref_seasons (league TEXT,season TEXT,scraped_at TEXT)"
        )
        con.execute(
            "INSERT INTO fbref_seasons VALUES ('USA MLS','2026',?)",
            [e["schedule_verified_at"]],
        )
        displays = {
            m[k + "_key"]: m[k + "_name"] for m in e["played"] for k in ["home", "away"]
        }
        con.executemany(
            "INSERT INTO fbref_fixtures "
            "VALUES ('USA MLS','2026',?,?,?, ?,?,?,NULL,NULL)",
            [
                (
                    f["row_key"],
                    str(f["local_date"]),
                    "20:00 (22:00)",
                    displays[f["home_key"]],
                    displays[f["away_key"]],
                    f["round"],
                )
                for f in e["schedule"]
            ],
        )
    cfg = {
        "season": 2026,
        "groups": [
            {
                **g,
                "teams": [
                    r["team"] for r in e["standings"]["rows"] if r["group"] == g["name"]
                ],
            }
            for g in e["groups"]
        ],
        "regular_season_standings": e["standings"],
    }
    conferences = data / "conferences.json"
    conferences.write_text(json.dumps({"competitions": {"usa.1": cfg}}))
    (out / "season_projections.json").write_text(
        json.dumps(
            {
                "generated_at": "2026-10-24T12:00:00Z",
                "leagues": [
                    {
                        "competition_id": "usa.1",
                        "table": [{"team": "Past forecast", "p_title": 0.34}],
                    }
                ],
            }
        )
    )
    (out / "season_fixtures.json").write_text('{"retained": true}')
    monkeypatch.setattr(fs, "ROOT", tmp_path)
    monkeypatch.setattr(fs, "CANONICAL", canonical)
    monkeypatch.setattr(fs, "CONFERENCES", conferences)
    monkeypatch.setattr(fs, "OUT_DIR", out)
    real_load = fs.load_matches
    monkeypatch.setattr(
        fs,
        "load_matches",
        lambda comps, minimum, maximum: real_load(
            comps, minimum, maximum, database=canonical
        ),
    )

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return NOW if tz else NOW.replace(tzinfo=None)

    monkeypatch.setattr(fs, "datetime", Clock)

    def unexpected(*args, **kwargs):
        raise AssertionError(
            "Completed observations must not be predicted or simulated"
        )

    head = SimpleNamespace(predict_proba=unexpected)
    monkeypatch.setattr(fs, "fit_head", lambda *args: head)
    monkeypatch.setattr(
        fs,
        "replay_features",
        lambda played: (
            np.zeros((len(played), 1)),
            ["elo_synthetic"],
            None,
            None,
            SimpleNamespace(emit=unexpected, elo=SimpleNamespace(rating={})),
        ),
    )
    monkeypatch.setattr(fs, "simulate_season", unexpected)
    return SimpleNamespace(
        e=e,
        data=data,
        out=out,
        canonical=canonical,
        schedule=schedule,
        conferences=conferences,
        tmp=tmp_path,
    )


def test_completed_only_run_publishes_observations_without_predicting_empty_arrays(
    inputs,
):
    assert fs.main(["--competitions", "usa.1", "--sims", "10", "--no-snapshots"]) == 0
    observed = json.loads((inputs.out / "season_projections.json").read_text())
    assert observed["leagues"][0]["state"] == "regular_season_completed"
    assert observed["leagues"][0]["table"] == []
    assert len(observed["leagues"][0]["observed_table"]) == 30
    assert (
        json.loads((inputs.out / "season_fixtures.json").read_text())["fixtures"] == []
    )
    assert history.rows_for(observed) == []


@pytest.mark.parametrize(
    "damage",
    [
        "missing_result",
        "missing_schedule",
        "wrong_phase",
        "bad_standings",
        "unknown_round",
    ],
)
def test_failed_proof_keeps_both_last_good_files_and_timestamps(inputs, damage):
    saved = {
        path: (path.read_bytes(), path.stat().st_mtime_ns)
        for path in inputs.out.glob("*.json")
    }
    if damage in ("missing_result", "wrong_phase"):
        with duckdb.connect(str(inputs.canonical)) as con:
            con.execute(
                "DELETE FROM matches WHERE match_uid='result-0'"
                if damage == "missing_result"
                else "UPDATE matches SET phase='postseason' WHERE match_uid='result-0'"
            )
    elif damage in ("missing_schedule", "unknown_round"):
        with sqlite3.connect(inputs.schedule) as con:
            con.execute(
                "DELETE FROM fbref_fixtures WHERE row_key='scheduled-0'"
                if damage == "missing_schedule"
                else "UPDATE fbref_fixtures SET round='unrecognized phase' "
                "WHERE row_key='scheduled-0'"
            )
    else:
        payload = json.loads(inputs.conferences.read_text())
        payload["competitions"]["usa.1"]["regular_season_standings"]["rows"][0][
            "points"
        ] += 1
        inputs.conferences.write_text(json.dumps(payload))
    assert fs.main(["--competitions", "usa.1", "--no-snapshots"]) == 1
    for path, (body, stamp) in saved.items():
        assert path.read_bytes() == body and path.stat().st_mtime_ns == stamp


def test_completed_record_excludes_playoffs_and_all_star_non_participants(inputs):
    with duckdb.connect(str(inputs.canonical)) as con:
        con.execute(
            "INSERT INTO matches SELECT 'playoff',competition_id,season,"
            "'2026-11-20',home_key,away_key,home_name,away_name,9,0,"
            "'H','conference-semifinals','2026-11-20T20:00:00Z' "
            "FROM matches LIMIT 1"
        )
        con.execute(
            "INSERT INTO matches VALUES ('all-star','usa.1',2026,'2026-07-20',"
            "'usa.1::all star a','usa.1::all star b','All Star A','All Star B',"
            "8,0,'H','regular-season','2026-07-20T20:00:00Z')"
        )
    record = fs.completed_mls_record(
        fs.load_matches(["usa.1"], 2026, None),
        datetime(2026, 11, 25, tzinfo=timezone.utc),
    )
    assert len(record["observed_table"]) == 30
    assert all(r["played"] == 34 for r in record["observed_table"])
    assert record["observation"]["matches_reconciled"] == 510


def test_read_only_schedule_loader_preserves_aliases_and_never_creates_missing_database(
    inputs,
):
    with duckdb.connect(str(inputs.canonical)) as con:
        con.execute("INSERT INTO team_aliases VALUES ('usa.1','fixture spelling','00')")
    with sqlite3.connect(inputs.schedule) as con:
        con.execute(
            "INSERT INTO fbref_fixtures VALUES ('USA MLS','2026','future','2026-11-10',"
            "'20:00 (22:00)','Fixture Spelling','Club 01',NULL,NULL,NULL)"
        )
    rows = fs.load_upcoming(["usa.1"])
    assert len(rows) == 1 and rows[0]["home_key"] == "usa.1::00"
    assert rows[0]["kickoff"] == "20:00"
    inputs.schedule.unlink()
    with pytest.raises(sqlite3.OperationalError):
        fs.load_upcoming(["usa.1"])
    assert not inputs.schedule.exists()


def test_existing_missing_league_guard_is_still_required(inputs):
    artifact = inputs.out / "season_projections.json"
    assert fs._leagues_lost(artifact, set(), {"usa.1"}) == {"usa.1"}
    assert fs._leagues_lost(artifact, {"usa.1"}, {"usa.1"}) == set()


def test_mixed_run_keeps_european_forecasts_and_snapshots_separate_from_observed_mls(
    inputs,
    monkeypatch,
):
    # Synthetic European schedule/model stubs isolate routing and publication;
    # no model accuracy is inferred from these deterministic test predictions.
    teams = [f"Euro Club {i:02}" for i in range(20)]
    with sqlite3.connect(inputs.schedule) as con:
        con.executemany(
            "INSERT INTO fbref_fixtures VALUES "
            "('England Premier League','2026-2027',?,'2026-11-10',"
            "'20:00',?,?,NULL,NULL,NULL)",
            [(f"europe-{h}-{a}", h, a) for h in teams for a in teams if h != a],
        )
    emitted, simulated = [], []
    probabilities = fs.outcome_probs(fs.score_matrix(1.0, 1.0))

    def emit(fixture):
        emitted.append(fixture["competition_id"])
        return {"elo_synthetic": 0.0}

    state = SimpleNamespace(
        emit=emit, elo=SimpleNamespace(rating=defaultdict(lambda: 1500.0))
    )
    monkeypatch.setattr(
        fs,
        "replay_features",
        lambda played: (
            np.zeros((len(played), 1)),
            ["elo_synthetic"],
            None,
            None,
            state,
        ),
    )
    head = SimpleNamespace(
        predict_proba=lambda features: np.tile(probabilities, (len(features), 1))
    )
    monkeypatch.setattr(fs, "fit_head", lambda *args: head)
    monkeypatch.setattr(fs, "reconcile", lambda *args: (1.0, 1.0))

    def simulate(fixtures, table, *, sims, groups=None, **kwargs):
        assert {f["competition_id"] for f in fixtures} == {"eng.1"}
        assert groups is None and len(fixtures) == 380
        simulated.append("eng.1")
        return {
            team: {"pos": np.full(sims, i), "pts": np.full(sims, 50)}
            for i, team in enumerate(sorted(table))
        }

    monkeypatch.setattr(fs, "simulate_season", simulate)
    snapshot_path = inputs.tmp / "snapshots.sqlite"
    monkeypatch.setattr(fs, "SnapshotStore", lambda: SnapshotStore(snapshot_path))
    assert fs.main(["--competitions", "eng.1,usa.1", "--sims", "10"]) == 0
    payload = json.loads((inputs.out / "season_projections.json").read_text())
    leagues = {r["competition_id"]: r for r in payload["leagues"]}
    assert set(leagues) == {"eng.1", "usa.1"}
    assert leagues["usa.1"]["state"] == "regular_season_completed"
    assert leagues["usa.1"]["table"] == []
    assert len(leagues["eng.1"]["table"]) == 20
    assert set(emitted) == {"eng.1"} and simulated == ["eng.1"]
    with sqlite3.connect(snapshot_path) as con:
        assert con.execute(
            "SELECT competition_id,count(*) FROM prediction_snapshots "
            "GROUP BY competition_id"
        ).fetchall() == [("eng.1", 380)]
    archived = inputs.out / "projection_history.jsonl"
    past = {
        "generated_at": "2026-10-24T12:00:00Z",
        "competition_id": "usa.1",
        "team": "Past forecast",
        "p_title": 0.34,
    }
    before = json.dumps(past) + "\n"
    archived.write_text(before)
    monkeypatch.setattr(history, "ROOT", inputs.tmp)
    assert (
        history.main(
            [
                "--source",
                str(inputs.out / "season_projections.json"),
                "--out",
                str(archived),
            ]
        )
        == 0
    )
    rows = [json.loads(line) for line in archived.read_text().splitlines()]
    assert rows[0] == past and archived.read_text().startswith(before)
    assert len(rows) == 21 and {r["competition_id"] for r in rows[1:]} == {"eng.1"}
