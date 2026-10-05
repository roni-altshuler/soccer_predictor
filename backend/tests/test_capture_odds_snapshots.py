"""Offline provider failure, deduplication and publication contracts."""
from datetime import datetime, timedelta, timezone
import json
import sqlite3

import httpx
import pytest

from backend.scripts import capture_odds_snapshots as odds

NOW = datetime(2026, 10, 5, 12, tzinfo=timezone.utc)


def event(eid="123", priced=True):
    competition = {"status": {"type": {"state": "pre", "name": "STATUS_SCHEDULED"}}}
    if priced:
        competition["odds"] = [{
            "provider": {"name": "Book"}, "drawOdds": 200,
            "moneyline": {"home": {"close": {"odds": 120}, "open": {"odds": 110}},
                          "away": {"close": {"odds": -120}}},
        }]
    return {"id": eid, "date": (NOW + timedelta(days=1)).isoformat(),
            "competitions": [competition]}


def client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_range_400_falls_back_to_inclusive_days_and_deduplicates():
    dates = []
    def respond(request):
        day = request.url.params["dates"]
        dates.append(day)
        assert request.url.params["limit"] == "200"
        return httpx.Response(400) if "-" in day else httpx.Response(200, json={"events": [event()]})
    with client(respond) as cl:
        events = odds.fetch_events(cl, "eng.1", NOW, 2, 0)
    assert dates == ["20261005-20261007", "20261005", "20261006", "20261007"]
    assert [e["id"] for e in events] == ["123"]


@pytest.mark.parametrize("response", [httpx.Response(503), httpx.Response(403),
    httpx.Response(429), httpx.Response(200, text="not json"),
    httpx.Response(200, json={}), httpx.Response(200, json={"events": None}),
    httpx.Response(200, json={"events": [{}]}),
    httpx.Response(200, json={"events": [None]}),
    httpx.Response(200, json={"events": [{"id": True}]}),
])
def test_invalid_response_raises(response):
    with client(lambda _: response) as cl, pytest.raises(Exception):
        odds.fetch_events(cl, "eng.1", NOW, 1, 0)


def test_empty_schedule_and_unpriced_fixture_are_successful():
    with client(lambda _: httpx.Response(200, json={"events": []})) as cl:
        assert odds.fetch_events(cl, "eng.1", NOW, 1, 0) == []
    assert odds.snapshot_rows([event(priced=False)], "eng.1", NOW) == []


@pytest.mark.parametrize("mutate", [
    lambda e: e.update(competitions=[]),
    lambda e: e["competitions"][0].update(status=None),
    lambda e: e.update(date="invalid"),
    lambda e: e.update(date="2026-10-06"),
    lambda e: e["competitions"][0].update(odds={"wrong": "shape"}),
])
def test_malformed_event_fails_batch(mutate):
    e = event(); mutate(e)
    with pytest.raises((ValueError, TypeError)):
        odds.snapshot_rows([e], "eng.1", NOW)


@pytest.mark.parametrize("value", ["nan", "inf", "-inf", 0, None])
def test_invalid_moneyline_stays_missing(value):
    assert odds.american_to_decimal(value) is None


def test_duplicate_bookmaker_and_event_are_one_observation():
    e = event(); e["competitions"][0]["odds"] *= 2
    rows = odds.snapshot_rows([e, e], "eng.1", NOW)
    assert len(rows) == 1
    assert rows[0]["match_id"] == "espn_eng.1_123"
    assert rows[0]["odds_home"] == 2.2
    assert rows[0]["odds_draw"] == 3.0


@pytest.mark.parametrize("state", ["in", "post"])
def test_in_play_and_finished_events_are_not_captured(state):
    e = event(); e["competitions"][0]["status"]["type"]["state"] = state
    assert odds.snapshot_rows([e], "eng.1", NOW) == []


def setup_main(monkeypatch, tmp_path, handler):
    db = tmp_path / "warehouse.sqlite"
    with sqlite3.connect(db) as conn:
        odds.ensure_schema(conn)
        conn.execute("INSERT INTO odds_snapshots (match_id,bookmaker,captured_at) VALUES ('old','Book','old')")
    out = tmp_path / "odds"; out.mkdir()
    path = out / f"snapshots-{datetime.now(timezone.utc):%Y-%m}.jsonl"
    path.write_bytes(b'{"old":true}\n')
    original = httpx.Client
    monkeypatch.setattr(odds.httpx, "Client", lambda **_: original(transport=httpx.MockTransport(handler)))
    return db, out, path


def test_late_league_failure_leaves_database_and_jsonl_unchanged(monkeypatch, tmp_path):
    def respond(request):
        if "/eng.1/" in str(request.url):
            e = event(); e["date"] = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
            return httpx.Response(200, json={"events": [e]})
        return httpx.Response(503)
    db, out, path = setup_main(monkeypatch, tmp_path, respond)
    before = path.read_bytes(); stamp = path.stat().st_mtime_ns
    assert odds.main(["--db", str(db), "--jsonl-dir", str(out), "--leagues", "eng.1,esp.1", "--delay", "0"]) == 1
    assert path.read_bytes() == before and path.stat().st_mtime_ns == stamp
    with sqlite3.connect(db) as conn:
        assert conn.execute("SELECT match_id FROM odds_snapshots").fetchall() == [("old",)]


def test_late_daily_failure_cannot_publish_partial_batch(monkeypatch, tmp_path):
    calls = 0
    def respond(request):
        nonlocal calls
        calls += 1
        if calls == 1: return httpx.Response(400)
        if calls == 2: return httpx.Response(200, json={"events": [event()]})
        return httpx.Response(503)
    db, out, path = setup_main(monkeypatch, tmp_path, respond)
    assert odds.main(["--db", str(db), "--jsonl-dir", str(out), "--days-ahead", "1", "--leagues", "eng.1", "--delay", "0"]) == 1
    assert path.read_bytes() == b'{"old":true}\n'
    with sqlite3.connect(db) as conn:
        assert conn.execute("SELECT COUNT(*) FROM odds_snapshots").fetchone()[0] == 1


def test_jsonl_publish_failure_rolls_back_sqlite(monkeypatch, tmp_path):
    conn = sqlite3.connect(":memory:"); odds.ensure_schema(conn)
    path = tmp_path / "prices.jsonl"; path.write_bytes(b"old\n")
    def fail(*_): raise OSError("disk full")
    monkeypatch.setattr(odds.os, "replace", fail)
    with pytest.raises(OSError):
        odds.persist_rows(conn, odds.snapshot_rows([event()], "eng.1", NOW), path)
    assert path.read_bytes() == b"old\n"
    assert conn.execute("SELECT COUNT(*) FROM odds_snapshots").fetchone()[0] == 0
    assert list(tmp_path.iterdir()) == [path]
    conn.close()


def test_sqlite_failure_leaves_jsonl_and_database_unchanged(tmp_path):
    conn = sqlite3.connect(":memory:"); odds.ensure_schema(conn)
    conn.execute("CREATE TRIGGER reject_new BEFORE INSERT ON odds_snapshots WHEN NEW.match_id LIKE '%456' BEGIN SELECT RAISE(ABORT, 'rejected'); END")
    path = tmp_path / "prices.jsonl"; path.write_bytes(b"old\n")
    with pytest.raises(sqlite3.IntegrityError):
        odds.persist_rows(conn, odds.snapshot_rows([event(), event("456")], "eng.1", NOW), path)
    assert path.read_bytes() == b"old\n"
    assert conn.execute("SELECT COUNT(*) FROM odds_snapshots").fetchone()[0] == 0
    assert list(tmp_path.iterdir()) == [path]
    conn.close()


def test_success_preserves_history_and_writes_same_observations(tmp_path):
    conn = sqlite3.connect(":memory:"); odds.ensure_schema(conn)
    path = tmp_path / "prices.jsonl"; path.write_bytes(b'{"old":true}\n')
    rows = odds.snapshot_rows([event()], "eng.1", NOW)
    odds.persist_rows(conn, rows, path)
    assert path.read_bytes().startswith(b'{"old":true}\n')
    assert json.loads(path.read_text().splitlines()[1]) == rows[0]
    assert conn.execute("SELECT odds_home,odds_draw,odds_away FROM odds_snapshots").fetchone() == (2.2, 3.0, 1 + 100 / 120)
    conn.close()


def test_sqlite_commit_failure_restores_published_jsonl(tmp_path):
    conn = sqlite3.connect(":memory:"); odds.ensure_schema(conn)
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("CREATE TABLE parent (id TEXT PRIMARY KEY)")
    conn.execute("CREATE TABLE child (id TEXT REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)")
    conn.execute("CREATE TRIGGER commit_failure AFTER INSERT ON odds_snapshots BEGIN INSERT INTO child VALUES ('missing'); END")
    path = tmp_path / "prices.jsonl"; path.write_bytes(b"old\n")
    with pytest.raises(sqlite3.IntegrityError):
        odds.persist_rows(conn, odds.snapshot_rows([event()], "eng.1", NOW), path)
    assert path.read_bytes() == b"old\n"
    assert conn.execute("SELECT COUNT(*) FROM odds_snapshots").fetchone()[0] == 0
    conn.close()


def test_transport_failure_raises():
    def timeout(request):
        raise httpx.ReadTimeout("provider timeout", request=request)
    with client(timeout) as cl, pytest.raises(httpx.ReadTimeout):
        odds.fetch_events(cl, "eng.1", NOW, 1, 0)


@pytest.mark.parametrize("priced", [False, None])
def test_main_valid_no_prices_preserves_last_record(monkeypatch, tmp_path, priced):
    events = [event(priced=False)] if priced is False else []
    if events:
        events[0]["date"] = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    db, out, path = setup_main(monkeypatch, tmp_path, lambda _: httpx.Response(200, json={"events": events}))
    stamp = path.stat().st_mtime_ns
    assert odds.main(["--db", str(db), "--jsonl-dir", str(out), "--leagues", "eng.1", "--delay", "0"]) == 0
    assert path.read_bytes() == b'{"old":true}\n' and path.stat().st_mtime_ns == stamp
