"""Synthetic contract fixtures, never exported as real prediction evidence."""

import hashlib
from copy import deepcopy
import json
import sqlite3

import pytest

from backend.scripts.build_track_record import write_record
from backend.services.forecast.track_record import build_record, from_database, instant

AS_OF = "2026-08-20T00:00:00Z"
VOCAB = {"eng.1": {"alpha": 1, "beta": 2}}


def snapshot(**changes):
    row = dict(
        fixture_uid="one",
        competition_id="eng.1",
        season=2026,
        home_team="Alpha",
        away_team="Beta",
        kickoff_at="2026-08-15T12:00:00",
        generated_at="2026-08-15T08:00:00Z",
        model_version="old",
        trained_through="2026-08-14",
        p_home=0.2,
        p_draw=0.6,
        p_away=0.2,
        outcome_period="regulation",
        scoreline_period="regulation",
        top_scoreline="1-1",
    )
    return {**row, **changes}


def event(**changes):
    row = dict(
        match_id="game",
        competition_id="eng.1",
        season=2026,
        source="espn",
        home_team_id=1,
        away_team_id=2,
        home_team="Alpha",
        away_team="Beta",
        date_utc="2026-08-15T19:00:00Z",
        fetched_at="2026-08-16T08:00:00Z",
        home_score=1,
        away_score=1,
        aliases=[
            dict(
                provider="espn",
                event_id="123",
                match_id="game",
                competition_id="eng.1",
                observed_at="2026-08-16T08:00:00Z",
            )
        ],
    )
    row.update(changes)
    row.setdefault("regulation_receipt", receipt_for(row))
    return row


def receipt_for(row):
    eid = str(row["aliases"][0]["event_id"]) if row["aliases"] else "123"
    status = {
        "period": 2,
        "clock": 5400,
        "type": {"name": "STATUS_FULL_TIME", "state": "post", "completed": True},
    }
    raw = {
        "id": eid,
        "date": row["date_utc"],
        "status": deepcopy(status),
        "competitions": [
            {
                "id": eid,
                "date": row["date_utc"],
                "timeValid": True,
                "format": {"regulation": {"periods": 2}},
                "status": deepcopy(status),
                "competitors": [
                    {
                        "homeAway": "home",
                        "team": {"id": "1"},
                        "score": row["home_score"],
                    },
                    {
                        "homeAway": "away",
                        "team": {"id": "2"},
                        "score": row["away_score"],
                    },
                ],
            }
        ],
    }
    body = json.dumps(
        {"leagues": [{"slug": row["competition_id"]}], "events": [raw]},
        separators=(",", ":"),
    )
    return {
        "provider": "espn",
        "competition_id": row["competition_id"],
        "event_id": eid,
        "observed_at": row["fetched_at"],
        "validated_at": AS_OF,
        "invalidated": False,
        "expired": False,
        "body": body,
        "digest": hashlib.sha256(body.encode()).hexdigest(),
    }


def record(snapshots=None, events=None):
    return build_record(
        snapshots if snapshots is not None else [snapshot()],
        events if events is not None else [event()],
        VOCAB,
        as_of=AS_OF,
    )


def pick(snapshots=None, events=None):
    return record(snapshots, events)["rows"][0]


def test_last_before_real_kickoff_across_versions_not_earliest_or_own_synthetic_noon():
    got = pick(
        [
            snapshot(),
            snapshot(generated_at="2026-08-15T18:59:59Z", model_version="new"),
            snapshot(generated_at="2026-08-15T19:00:00Z", model_version="too-late"),
        ]
    )
    assert got["status"] == "scored"
    assert got["modelVersion"] == "new"
    assert got["kickoffAt"] == "2026-08-15T19:00:00+00:00"
    assert got["pick"] == got["actual"]["outcome"] == "D"


def test_synthetic_noon_never_admits_a_forecast_after_real_early_kickoff():
    got = pick(
        [snapshot(generated_at="2026-08-15T10:00:00Z")],
        [event(date_utc="2026-08-15T09:00:00Z")],
    )
    assert got["status"] == "retrospective"
    assert got["actual"] == {"home": 1, "away": 1, "outcome": "D"}


def test_offset_order_is_instant_order_not_string_order():
    got = pick(
        [
            snapshot(generated_at="2026-08-15T19:30:00+02:00", model_version="earlier"),
            snapshot(generated_at="2026-08-15T18:00:00Z", model_version="last"),
        ]
    )
    assert got["modelVersion"] == "last"
    assert got["status"] == "scored"


@pytest.mark.parametrize(
    "stamp",
    [
        None,
        "",
        "2026-08-15",
        "2026-08-15T19:00:00",
        "2026-02-30T12:00:00Z",
        "2026-08-15T24:00:00Z",
    ],
)
def test_unknown_or_invalid_time_is_never_assigned_a_timezone_or_noon(stamp):
    assert instant(stamp) is None
    assert pick([snapshot(), snapshot(generated_at=stamp)])["status"] == "unverified"
    assert pick(events=[event(date_utc=stamp)])["status"] != "scored"


def test_a_real_noon_with_verified_identity_is_allowed():
    assert pick(events=[event(date_utc="2026-08-15T12:00:00Z")])["status"] == "scored"


@pytest.mark.parametrize(
    "changes",
    [
        {"aliases": []},
        {"source": "fdcouk"},
        {"fetched_at": "2026-08-15T18:00:00Z"},
        {"fetched_at": "2026-08-21T00:00:00Z"},
        {"fetched_at": "2026-08-16"},
        {"home_score": None},
        {"home_score": True},
        {"away_score": -1},
        {"away_score": 1.5},
        {"date_utc": "2026-08-21T19:00:00Z"},
    ],
)
def test_result_identity_final_score_and_post_event_observation_are_required(changes):
    assert not any(
        r["status"] == "scored" for r in record(events=[event(**changes)])["rows"]
    )


@pytest.mark.parametrize(
    "field,value",
    [
        ("provider", "other"),
        ("event_id", "unknown"),
        ("match_id", "other"),
        ("competition_id", "esp.1"),
        ("observed_at", "2026-08-15T18:00:00Z"),
    ],
)
def test_provider_alias_is_verified_not_merely_present(field, value):
    e = event()
    e["aliases"][0][field] = value
    assert pick(events=[e])["status"] == "unverified"


@pytest.mark.parametrize(
    "changes",
    [
        {"p_home": float("nan")},
        {"p_home": 0.8},
        {"trained_through": None},
        {"trained_through": "2026-08-15"},
        {"model_version": ""},
        {"model_version": None},
        {"model_version": 123},
    ],
)
def test_bad_latest_forecast_never_falls_back_to_an_earlier_better_record(changes):
    got = pick([snapshot(), snapshot(generated_at="2026-08-15T18:00:00Z", **changes)])
    assert got["status"] == "unverified"
    assert got["generatedAt"] == "2026-08-15T18:00:00+00:00"


def test_conflicting_final_versions_with_same_time_are_withheld_but_exact_duplicates_collapse():
    assert (
        pick([snapshot(), snapshot(model_version="different")])["status"]
        == "unverified"
    )
    rows = record([snapshot(), snapshot()])["rows"]
    assert len(rows) == 1 and rows[0]["status"] == "scored"


def test_multiple_fixture_uids_for_same_real_game_score_only_once():
    rows = record(
        [
            snapshot(),
            snapshot(fixture_uid="renamed", generated_at="2026-08-15T09:00:00Z"),
        ]
    )["rows"]
    assert len(rows) == 1 and rows[0]["fixtureUid"] == "renamed"


def test_multiple_warehouse_ids_sharing_provider_event_never_score_twice():
    e2 = event(
        match_id="duplicate",
        date_utc="2026-08-17T19:00:00Z",
        fetched_at="2026-08-18T08:00:00Z",
    )
    e2["aliases"][0].update(match_id="duplicate", observed_at="2026-08-18T08:00:00Z")
    rows = record(
        [snapshot(), snapshot(fixture_uid="two", kickoff_at="2026-08-17T12:00:00Z")],
        [event(), e2],
    )["rows"]
    assert not any(r["status"] == "scored" for r in rows)
    assert sum("shared" in r["reason"] for r in rows) == 2


def test_ambiguous_join_never_uses_first_result_or_another_snapshot_to_clear_hold():
    e2 = event(match_id="second", date_utc="2026-08-16T19:00:00Z")
    e2["aliases"][0].update(match_id="second", event_id="456")
    rows = record(
        [snapshot(), snapshot(fixture_uid="other", kickoff_at="2026-08-14T12:00:00Z")],
        [event(), e2],
    )["rows"]
    assert not any(r["status"] == "scored" for r in rows)
    assert any("ambiguous" in r["reason"] for r in rows)


@pytest.mark.parametrize(
    "changes",
    [
        {"season": 2025},
        {"competition_id": "esp.1"},
        {"home_team_id": 2, "away_team_id": 1},
    ],
)
def test_season_competition_and_home_away_identity_do_not_cross(changes):
    assert not any(
        r["status"] == "scored" for r in record(events=[event(**changes)])["rows"]
    )


def test_pending_missing_and_empty_are_not_scored_and_do_not_acquire_actual_outcome():
    assert pick(events=[event(home_score=None, away_score=None)])["status"] == "pending"
    empty = record([], [])
    assert empty["rows"] == [] and empty["historyThrough"] is None
    missing = event(match_id="other", date_utc="2026-08-19T19:00:00Z", home_team_id=9)
    assert any(
        r["status"] == "missing" and r["pick"] is None
        for r in record(events=[event(), missing])["rows"]
    )


def test_future_snapshot_cannot_displace_the_final_forecast_known_by_audit():
    assert (
        pick(
            [
                snapshot(),
                snapshot(generated_at="2026-08-22T00:00:00Z", model_version="future"),
            ]
        )["modelVersion"]
        == "old"
    )


def test_newer_unmatched_result_does_not_refresh_scored_sample_freshness():
    missing = event(
        match_id="other",
        home_team_id=9,
        date_utc="2026-08-19T19:00:00Z",
        fetched_at="2026-08-19T22:00:00Z",
    )
    missing["aliases"][0].update(
        match_id="other", event_id="456", observed_at="2026-08-19T22:00:00Z"
    )
    missing["regulation_receipt"] = receipt_for(missing)
    got = record(events=[event(), missing])
    assert got["resultThrough"] == "2026-08-16T08:00:00+00:00"
    assert any(r["status"] == "missing" and r["actual"] for r in got["rows"])


@pytest.mark.parametrize(
    "changes", [{"trained_through": None}, {"p_home": 0.9}, {"model_version": None}]
)
def test_known_actual_result_is_visible_even_when_the_forecast_is_not_eligible(changes):
    got = record([snapshot(**changes)])
    row = got["rows"][0]
    assert row["status"] == "unverified"
    assert row["actual"] == {"home": 1, "away": 1, "outcome": "D"}
    assert row["settledAt"] == "2026-08-16T08:00:00+00:00"
    assert got["resultThrough"] is None  # Scored-sample freshness stays absent.


def test_atomic_export_failure_keeps_last_good_artifact(tmp_path):
    target = tmp_path / "record.json"
    write_record({"good": 1}, target)
    with pytest.raises(ValueError):
        write_record({"bad": float("nan")}, target)
    assert json.loads(target.read_text()) == {"good": 1}
    assert list(tmp_path.iterdir()) == [target]


def test_missing_database_is_not_created(tmp_path):
    db = tmp_path / "missing.sqlite"
    with pytest.raises(sqlite3.OperationalError):
        from_database(db, as_of=AS_OF)
    assert not db.exists()


def test_read_only_export_never_changes_source_database(tmp_path):
    db = tmp_path / "input.sqlite"
    with sqlite3.connect(db) as conn:
        conn.executescript(
            """CREATE TABLE teams(team_id INTEGER PRIMARY KEY, canonical_name TEXT);
          INSERT INTO teams VALUES(1,'Alpha'),(2,'Beta');
          CREATE TABLE team_aliases(competition_id TEXT, alias TEXT, team_id INTEGER);
          CREATE TABLE matches(match_id TEXT,competition_id TEXT,season INTEGER,source TEXT,
            home_team_id INTEGER,away_team_id INTEGER,date_utc TEXT,fetched_at TEXT,home_score INTEGER,away_score INTEGER,regulation_receipt TEXT);
          CREATE TABLE provider_match_ids(provider TEXT,event_id TEXT,match_id TEXT,competition_id TEXT,observed_at TEXT);"""
        )
        e = event()
        keys = [k for k in e if k not in ("aliases", "home_team", "away_team")]
        conn.execute(
            f"INSERT INTO matches ({','.join(keys)}) VALUES ({','.join('?' for _ in keys)})",
            [json.dumps(e[k]) if k == "regulation_receipt" else e[k] for k in keys],
        )
        a = e["aliases"][0]
        conn.execute(
            f"INSERT INTO provider_match_ids ({','.join(a)}) VALUES ({','.join('?' for _ in a)})",
            list(a.values()),
        )
    before = hashlib.sha256(db.read_bytes()).hexdigest()
    got = from_database(db, as_of=AS_OF, snapshots=[snapshot()])
    assert got["rows"][0]["status"] == "scored"
    assert hashlib.sha256(db.read_bytes()).hexdigest() == before


@pytest.mark.parametrize("period", [None, "", "unknown", "including_extra_time"])
def test_unknown_or_different_forecast_period_stays_unscored(period):
    row = pick([snapshot(outcome_period=period)])
    assert row["status"] == "unverified"
    assert row["scoreForecast"] == {"home": 1, "away": 1}
    assert (
        row["actual"]["outcome"] == "D"
    )  # Result proof does not prove forecast scope.


def test_latest_unknown_period_does_not_fall_back_to_an_earlier_verified_forecast():
    row = pick(
        [snapshot(), snapshot(generated_at="2026-08-15T18:00:00Z", outcome_period=None)]
    )
    assert row["generatedAt"] == "2026-08-15T18:00:00+00:00"
    assert row["status"] == "unverified"


def test_legacy_warehouse_score_is_not_original_period_evidence():
    raw = event()
    raw.pop("regulation_receipt")
    row = pick(events=[raw])
    assert row["status"] == "unverified" and row["actual"] is None
    assert row["resultPeriod"] is None and row["resultEvidence"] is None


@pytest.mark.parametrize(
    "change",
    [
        "expired",
        "invalidated",
        "validation-clock",
        "digest",
        "provider",
        "competition",
        "event-id",
        "naive-time",
        "date-only",
        "date-disagreement",
        "time-invalid",
        "incomplete",
        "extra-time",
        "float-score",
        "duplicate-side",
        "score-conflict",
        "body-competition",
        "clock",
    ],
)
def test_receipt_requires_original_consistent_regulation_proof(change, monkeypatch):
    import httpx

    def forbidden(*args, **kwargs):
        raise AssertionError("A failed receipt must never refresh a provider")

    monkeypatch.setattr(httpx, "Client", forbidden)
    raw = event()
    receipt = raw["regulation_receipt"]
    body = json.loads(receipt["body"])
    item = body["events"][0]
    comp = item["competitions"][0]
    if change in ("expired", "invalidated"):
        receipt[change] = True
    elif change == "validation-clock":
        receipt["validated_at"] = "2026-08-19T00:00:00Z"
    elif change == "provider":
        receipt["provider"] = "other"
    elif change == "competition":
        receipt["competition_id"] = "other"
    elif change == "event-id":
        receipt["event_id"] = "999"
    elif change == "naive-time":
        item["date"] = comp["date"] = "2026-08-15T19:00:00"
    elif change == "date-only":
        item["date"] = comp["date"] = "2026-08-15"
    elif change == "date-disagreement":
        comp["date"] = "2026-08-15T18:00:00Z"
    elif change == "body-competition":
        body["leagues"][0]["slug"] = "other"
    elif change == "clock":
        comp["status"]["clock"] = 7200
    elif change == "time-invalid":
        comp["timeValid"] = False
    elif change == "incomplete":
        comp["status"]["type"]["completed"] = False
    elif change == "extra-time":
        for status in (item["status"], comp["status"]):
            status.update(period=4, clock=7200)
            status["type"]["name"] = "STATUS_FULL_TIME_AET"
        comp["regulation_home_score"] = comp["regulation_away_score"] = 1
    elif change == "float-score":
        comp["competitors"][0]["score"] = 1.5
    elif change == "duplicate-side":
        comp["competitors"][1]["homeAway"] = "home"
    elif change == "score-conflict":
        comp["competitors"][0]["score"] = 2
    receipt["body"] = json.dumps(body, separators=(",", ":"))
    receipt["digest"] = (
        "bad"
        if change == "digest"
        else hashlib.sha256(receipt["body"].encode()).hexdigest()
    )
    row = pick(events=[raw])
    assert row["status"] == "unverified" and row["actual"] is None


def test_knockout_regulation_draw_is_not_advancement():
    row = pick(events=[event(phase="knockout", advancing_team="home")])
    assert row["status"] == "scored" and row["actual"]["outcome"] == "D"
    assert row["resultPeriod"] == "regulation"
    assert "advancing_team" not in row and "advancement" not in row


@pytest.mark.parametrize(
    "value,status",
    [(None, "missing"), ("", "missing"), ("1.5-1", "invalid"), (True, "invalid")],
)
def test_missing_or_invalid_score_forecast_never_changes_outcome_eligibility(
    value, status
):
    row = pick([snapshot(top_scoreline=value)])
    assert row["status"] == "scored" and row["pick"] == "D"
    assert row["scoreForecast"] is None and row["scoreForecastStatus"] == status


def test_latest_stored_score_is_exported_without_rounding_or_earlier_fallback():
    row = pick(
        [
            snapshot(top_scoreline="0-0"),
            snapshot(generated_at="2026-08-15T18:00:00Z", top_scoreline="2-1"),
        ]
    )
    assert row["scoreForecast"] == {"home": 2, "away": 1}
    row = pick(
        [snapshot(), snapshot(generated_at="2026-08-15T18:00:00Z", top_scoreline=None)]
    )
    assert row["scoreForecastStatus"] == "missing"


def test_score_conflict_is_separate_from_consistent_outcome_forecast():
    row = pick([snapshot(), snapshot(top_scoreline="0-0")])
    assert row["status"] == "scored"
    assert row["scoreForecast"] is None and row["scoreForecastStatus"] == "ambiguous"


def test_original_receipt_observation_is_not_freshened_by_warehouse_metadata():
    raw = event()
    raw["fetched_at"] = "2026-08-19T20:00:00Z"
    raw["aliases"][0]["observed_at"] = "2026-08-19T20:00:00Z"
    row = pick(events=[raw])
    assert row["settledAt"] == "2026-08-16T08:00:00+00:00"


def test_csv_preserves_explicit_periods_and_never_supplies_missing_ones(tmp_path):
    import csv
    from backend.scripts.build_track_record import read_snapshots

    path = tmp_path / "snapshots.csv"
    source = {**snapshot(), "lambda_home": 1.1, "lambda_away": 1.0}
    for declared in (True, False):
        raw = dict(source)
        if not declared:
            raw.pop("outcome_period")
            raw.pop("scoreline_period")
        with path.open("w") as stream:
            writer = csv.DictWriter(stream, fieldnames=list(raw))
            writer.writeheader()
            writer.writerow(raw)
        before = path.read_bytes()
        rows = read_snapshots(path)
        assert rows[0]["outcome_period"] == ("regulation" if declared else None)
        assert rows[0]["scoreline_period"] == ("regulation" if declared else None)
        assert rows[0]["top_scoreline"] == "1-1" and path.read_bytes() == before


def test_csv_periods_cannot_be_spliced_from_a_replacement_file(tmp_path, monkeypatch):
    import csv
    from backend.scripts import import_snapshots
    from backend.scripts.build_track_record import read_snapshots

    path = tmp_path / "snapshots.csv"
    raw = {**snapshot(), "lambda_home": 1.1, "lambda_away": 1.0}

    def write(period):
        with path.open("w") as stream:
            writer = csv.DictWriter(stream, fieldnames=list(raw))
            writer.writeheader()
            writer.writerow({**raw, "outcome_period": period})

    write("regulation")
    original = import_snapshots.parse

    def replace_after_parse(staged):
        parsed = original(staged)
        write("including_extra_time")
        return parsed

    monkeypatch.setattr(import_snapshots, "parse", replace_after_parse)
    assert read_snapshots(path)[0]["outcome_period"] == "regulation"
