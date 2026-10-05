"""Daily provider fetches, exact settlement IDs and atomic result publication."""
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path

import httpx
import pytest
import yaml

from backend.scripts import fetch_outcomes as outcomes


def prediction(eid="123", league="Premier League", day="2026-09-20"):
    return {"match_id": eid, "match_date": day, "league": league,
            "home_team": "Manchester City", "away_team": "Arsenal",
            "actual_winner": None, "predicted_winner": "home", "predicted_scoreline": "2-1",
            "predicted_home_goals": 2.0, "predicted_away_goals": 1.0,
            "top_scorelines": [{"score": "2-1"}]}


def event(eid="123", home="2", away="1", status="STATUS_FULL_TIME"):
    return {"id": eid, "status": {"type": {"name": status}}, "competitions": [{"competitors": [
        {"homeAway": "home", "score": home, "team": {"displayName": "Manchester City", "shortDisplayName": "City"}},
        {"homeAway": "away", "score": away, "team": {"displayName": "Arsenal"}},
    ]}]}


def setup(monkeypatch, tmp_path, handler, records=None):
    monkeypatch.setattr(outcomes, "DATA_DIR", tmp_path)
    monkeypatch.setattr(outcomes.time, "sleep", lambda _: None)
    original = httpx.Client
    monkeypatch.setattr(outcomes.httpx, "Client", lambda **_: original(transport=httpx.MockTransport(handler)))
    path = tmp_path / "predictions_2026-09.json"
    path.write_text(json.dumps({"generated_at": "original", "predictions": records or [prediction()]}))
    return path


def test_daily_requests_and_verified_scores_settle_exact_id(monkeypatch, tmp_path):
    calls = []
    def respond(request):
        calls.append(request.url.params["dates"])
        assert request.url.params["limit"] == "200"
        return httpx.Response(200, json={"events": [event(), event()]})
    path = setup(monkeypatch, tmp_path, respond)
    assert outcomes.fetch_outcomes() == 1
    assert calls == ["20260920"]
    row = json.loads(path.read_text())["predictions"][0]
    assert row["actual_home_goals"] == 2 and row["actual_away_goals"] == 1
    assert row["actual_winner"] == "home"
    assert row["winner_correct"] and row["scoreline_correct"] and row["scoreline_in_top5"]


def test_same_home_team_name_cannot_settle_another_event(monkeypatch, tmp_path):
    path = setup(monkeypatch, tmp_path, lambda _: httpx.Response(200, json={"events": [event("999")]}))
    before, stamp = path.read_bytes(), path.stat().st_mtime_ns
    assert outcomes.fetch_outcomes() == 0
    assert path.read_bytes() == before and path.stat().st_mtime_ns == stamp


@pytest.mark.parametrize("events", [[], [event(status="STATUS_SCHEDULED")], [event(status="STATUS_IN_PROGRESS")]])
def test_valid_empty_or_unfinished_result_is_no_update(monkeypatch, tmp_path, events):
    path = setup(monkeypatch, tmp_path, lambda _: httpx.Response(200, json={"events": events}))
    before = path.read_bytes()
    assert outcomes.main() == 0
    assert path.read_bytes() == before


@pytest.mark.parametrize("response", [httpx.Response(400), httpx.Response(403), httpx.Response(429),
    httpx.Response(503), httpx.Response(200, text="not json"), httpx.Response(200, json={}),
    httpx.Response(200, json={"events": None}), httpx.Response(200, json={"events": [{}]})])
def test_provider_failure_is_nonzero_without_file_changes(monkeypatch, tmp_path, response):
    path = setup(monkeypatch, tmp_path, lambda _: response)
    before, stamp = path.read_bytes(), path.stat().st_mtime_ns
    assert outcomes.main() == 1
    assert path.read_bytes() == before and path.stat().st_mtime_ns == stamp


@pytest.mark.parametrize("score", [None, "", "NaN", "1.5", -1, True])
def test_missing_or_invalid_scores_are_not_fabricated_as_zero(monkeypatch, tmp_path, score):
    path = setup(monkeypatch, tmp_path, lambda _: httpx.Response(200, json={"events": [event(home=score)]}))
    before = path.read_bytes()
    assert outcomes.main() == 1
    assert path.read_bytes() == before


def test_late_league_failure_cannot_publish_earlier_results(monkeypatch, tmp_path):
    def respond(request):
        if "/esp.1/" in str(request.url): return httpx.Response(503)
        return httpx.Response(200, json={"events": [event()]})
    path = setup(monkeypatch, tmp_path, respond)
    second = tmp_path / "predictions_2026-10.json"
    second.write_text(json.dumps({"predictions": [prediction("456", "La Liga")]}))
    originals = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in (path, second)}
    assert outcomes.main() == 1
    for p, (data, stamp) in originals.items():
        assert p.read_bytes() == data and p.stat().st_mtime_ns == stamp


def test_query_deduplication_across_files(monkeypatch, tmp_path):
    calls = []
    def respond(request):
        calls.append(request.url.params["dates"])
        return httpx.Response(200, json={"events": [event()]})
    setup(monkeypatch, tmp_path, respond)
    (tmp_path / "predictions_2026-08.json").write_text(json.dumps({"predictions": [prediction()]}))
    assert outcomes.fetch_outcomes() == 2
    assert calls == ["20260920"]


def test_future_predictions_are_not_queried(monkeypatch, tmp_path):
    def unexpected(_): raise AssertionError("Future event requested")
    future = (datetime.now(timezone.utc) + timedelta(days=2)).date().isoformat()
    path = setup(monkeypatch, tmp_path, unexpected, [prediction(day=future)])
    before = path.read_bytes()
    assert outcomes.fetch_outcomes() == 0
    assert path.read_bytes() == before


def test_iso_timestamp_query_uses_utc_day():
    assert outcomes._prediction_day("2026-09-20T00:30:00+02:00") == "20260919"
    assert outcomes._prediction_day("2026-09-20T15:00:00Z") == "20260920"


def test_transport_failure_is_nonzero(monkeypatch, tmp_path):
    def timeout(request): raise httpx.ReadTimeout("timeout", request=request)
    path = setup(monkeypatch, tmp_path, timeout)
    before = path.read_bytes()
    assert outcomes.main() == 1 and path.read_bytes() == before


def test_conflicting_duplicate_scores_fail_batch(monkeypatch, tmp_path):
    path = setup(monkeypatch, tmp_path, lambda _: httpx.Response(200, json={"events": [event(), event(home="3")]}))
    before = path.read_bytes()
    assert outcomes.main() == 1 and path.read_bytes() == before


def test_second_file_replace_failure_restores_first(monkeypatch, tmp_path):
    first, second = tmp_path / "first.json", tmp_path / "second.json"
    first.write_bytes(b'{"old":1}'); second.write_bytes(b'{"old":2}')
    original = outcomes.os.replace
    failed = False
    def fail_second(source, destination):
        nonlocal failed
        if destination == second and not failed:
            failed = True
            raise OSError("disk full")
        return original(source, destination)
    monkeypatch.setattr(outcomes.os, "replace", fail_second)
    with pytest.raises(OSError):
        outcomes._publish_updates({first: {"new": 1}, second: {"new": 2}})
    assert first.read_bytes() == b'{"old":1}' and second.read_bytes() == b'{"old":2}'
    assert set(tmp_path.iterdir()) == {first, second}


def test_malformed_prediction_file_blocks_publication(monkeypatch, tmp_path):
    path = setup(monkeypatch, tmp_path, lambda _: httpx.Response(200, json={"events": [event()]}))
    (tmp_path / "predictions_2026-10.json").write_text("broken")
    before = path.read_bytes()
    assert outcomes.main() == 1 and path.read_bytes() == before


def test_outcome_failure_blocks_prediction_feedback_and_commits():
    root = Path(__file__).resolve().parents[2]
    steps = yaml.safe_load((root / '.github/workflows/prediction_pipeline.yml').read_text())["jobs"]["prediction-pipeline"]["steps"]
    fetch = next(s for s in steps if s.get("name") == "Fetch match outcomes")
    assert not fetch.get("continue-on-error", False)
    for name in ["Generate new predictions", "Run training feedback", "Commit updated predictions"]:
        step = next(s for s in steps if s.get("name") == name)
        assert step.get("if", "success()") == "success()"
