"""Routine refresh replays: bounded progress must never certify partial coverage."""
import asyncio
import ast
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest
import yaml

from backend.scripts import build_warehouse as build
from backend.services.data import espn_loader
from backend.services.data.espn_refresh import CurrentSeasonRefresh, ROUTINE_COMPETITIONS
from backend.services.data.provider_status import ProviderUnavailable
from backend.services.data.warehouse import MatchRow, open_warehouse

NOW = datetime(2026, 10, 5, tzinfo=timezone.utc)
FIVE = list(ROUTINE_COMPETITIONS)[:5]


def event(mid="1", day="20260821", final=True):
    return {"id": mid, "date": f"{day[:4]}-{day[4:6]}-{day[6:]}T12:00:00Z",
            "competitions": [{"status": {"type": {"completed": final}}, "competitors": [
                {"homeAway": "home", "score": "1", "team": {"id": "a", "displayName": "Arsenal"}},
                {"homeAway": "away", "score": "0", "team": {"id": "b", "displayName": "Chelsea"}},
            ]}]}


def payload(comp, days, events=None, season=2026):
    return {"leagues": [{"slug": comp, "season": {"year": season}, "calendarType": "day",
                         "calendarIsWhitelist": True,
                         "calendarStartDate": f"{season}-01-01T00:00:00Z",
                         "calendarEndDate": f"{season + 1}-07-31T00:00:00Z",
                         "calendar": [f"{d[:4]}-{d[4:6]}-{d[6:]}T00:00:00Z" for d in days]}],
            "events": events or []}


@pytest.fixture(autouse=True)
def no_delay(monkeypatch):
    async def no_sleep(_):
        pass
    monkeypatch.setattr("backend.services.data.espn_refresh.asyncio.sleep", no_sleep)


def make_refresh(tmp_path, handler, **kwargs):
    requests = []
    def transport(request):
        requests.append(request)
        return handler(request)
    refresh = CurrentSeasonRefresh(tmp_path / "receipts.sqlite", now=kwargs.pop("now", NOW),
                                  client=httpx.AsyncClient(transport=httpx.MockTransport(transport)), **kwargs)
    return refresh, requests


def fetch(refresh, scope=FIVE):
    async def run():
        try:
            return await refresh.fetch(scope)
        finally:
            await refresh.close()
    return asyncio.run(run())


def five_workload():
    # Actual October 5 calendar workload: 17 + 31 + 12 + 18 + 16 = 94 dates.
    start = datetime(2026, 8, 1)
    return {comp: [(start + timedelta(days=i)).strftime("%Y%m%d") for i in range(count)]
            for comp, count in zip(FIVE, [17, 31, 12, 18, 16])}


def workload_handler(calendars):
    def handler(request):
        comp = request.url.path.split("/")[-2]
        day = request.url.params["dates"]
        events = [] if day == "20261005" else [event(f"{comp}-{day}", day)]
        return httpx.Response(200, json=payload(comp, calendars[comp], events))
    return handler


def test_five_league_bootstrap_exhausts_then_resumes_with_no_false_completeness(tmp_path):
    calendars = five_workload()
    refresh, calls = make_refresh(tmp_path, workload_handler(calendars))
    with pytest.raises(ProviderUnavailable, match="budget exhausted"):
        fetch(refresh)
    assert len(calls) == 93
    with sqlite3.connect(tmp_path / "receipts.sqlite") as db:
        assert db.execute("SELECT COUNT(*) FROM receipts").fetchone()[0] == 88
    refresh, calls = make_refresh(tmp_path, workload_handler(calendars))
    result = fetch(refresh)
    assert len(calls) == 11  # Five fresh calendars + six remaining dates.
    assert sum(len(matches) for _, matches in result.values()) == 94
    refresh, calls = make_refresh(tmp_path, workload_handler(calendars))
    assert fetch(refresh) == result
    assert len(calls) == 5


def test_interruption_retains_only_validated_progress(tmp_path):
    calendars = {"eng.1": ["20260821", "20260822"]}
    def handler(request):
        if request.url.params["dates"] == "20260822":
            raise KeyboardInterrupt()
        return workload_handler(calendars)(request)
    refresh, _ = make_refresh(tmp_path, handler)
    with pytest.raises(KeyboardInterrupt):
        fetch(refresh, ["eng.1"])
    with sqlite3.connect(tmp_path / "receipts.sqlite") as db:
        assert db.execute("SELECT day FROM receipts").fetchall() == [("20260821",)]
    refresh, calls = make_refresh(tmp_path, workload_handler(calendars))
    assert len(fetch(refresh, ["eng.1"])["eng.1"][1]) == 2
    assert [r.url.params["dates"] for r in calls] == ["20261005", "20260822"]


@pytest.mark.parametrize("mutation", [
    lambda p: p.update(events=None),
    lambda p: p.update(events=[event(final=True) | {"competitions": []}]),
    lambda p: p["leagues"][0].update(calendarIsWhitelist=False),
    lambda p: p["leagues"][0].update(calendarType="month"),
    lambda p: p["leagues"][0].update(slug="esp.1"),
    lambda p: p["leagues"][0].update(season={"year": "2026"}),
    lambda p: p["leagues"][0].update(calendar=None),
    lambda p: p["leagues"][0].update(calendarStartDate="2026-09-01T00:00:00Z"),
    lambda p: p["leagues"][0].update(calendarEndDate="2026-09-01T00:00:00Z"),
    lambda p: p["leagues"][0].update(calendar=["bad date"]),
    lambda p: p["leagues"][0].update(calendar=["2026-08-21T00:00:00Z"] * 2),
])
def test_invalid_discovery_cannot_create_receipts(tmp_path, mutation):
    body = payload("eng.1", ["20260821"])
    mutation(body)
    refresh, _ = make_refresh(tmp_path, lambda _: httpx.Response(200, json=body))
    with pytest.raises(ProviderUnavailable):
        fetch(refresh, ["eng.1"])
    with sqlite3.connect(tmp_path / "receipts.sqlite") as db:
        assert db.execute("SELECT COUNT(*) FROM receipts").fetchone()[0] == 0


def test_calendar_change_during_daily_fetch_does_not_save_changed_receipt(tmp_path):
    def handler(request):
        days = ["20260821"] if request.url.params["dates"] == "20261005" else ["20260821", "20260822"]
        return httpx.Response(200, json=payload("eng.1", days))
    refresh, _ = make_refresh(tmp_path, handler)
    with pytest.raises(ProviderUnavailable, match="calendar changed"):
        fetch(refresh, ["eng.1"])
    with sqlite3.connect(tmp_path / "receipts.sqlite") as db:
        assert db.execute("SELECT COUNT(*) FROM receipts").fetchone()[0] == 0


def test_new_calendar_date_requires_new_observation_not_max_match_date(tmp_path):
    first = {"eng.1": ["20260821"]}
    refresh, _ = make_refresh(tmp_path, workload_handler(first))
    fetch(refresh, ["eng.1"])
    second = {"eng.1": ["20260820", "20260821"]}
    refresh, calls = make_refresh(tmp_path, workload_handler(second))
    assert len(fetch(refresh, ["eng.1"])["eng.1"][1]) == 2
    assert [r.url.params["dates"] for r in calls] == ["20261005", "20260820"]


@pytest.mark.parametrize("kind", ["recent", "pending", "empty"])
def test_recent_pending_and_listed_empty_days_expire_and_failed_refresh_keeps_receipt(tmp_path, kind):
    day = "20261004" if kind == "recent" else "20260821"
    def good(request):
        events = [] if request.url.params["dates"] == "20261005" or kind == "empty" else [event(day=day, final=kind != "pending")]
        return httpx.Response(200, json=payload("eng.1", [day], events))
    refresh, _ = make_refresh(tmp_path, good)
    fetch(refresh, ["eng.1"])
    with sqlite3.connect(tmp_path / "receipts.sqlite") as db:
        before = db.execute("SELECT * FROM receipts").fetchall()
    def bad(request):
        return good(request) if request.url.params["dates"] == "20261005" else httpx.Response(503)
    refresh, calls = make_refresh(tmp_path, bad, now=NOW + timedelta(hours=2))
    with pytest.raises(ProviderUnavailable, match="503"):
        fetch(refresh, ["eng.1"])
    assert len(calls) == 4
    with sqlite3.connect(tmp_path / "receipts.sqlite") as db:
        assert db.execute("SELECT * FROM receipts").fetchall() == before


@pytest.mark.parametrize("response", [httpx.Response(429), httpx.Response(503)])
def test_retries_count_against_hard_cap(tmp_path, response):
    refresh, calls = make_refresh(tmp_path, lambda _: response, budget=2)
    with pytest.raises(ProviderUnavailable, match="budget"):
        fetch(refresh, ["eng.1"])
    assert len(calls) == 2


def test_long_retry_after_stops_without_hammering_provider(tmp_path):
    refresh, calls = make_refresh(tmp_path, lambda _: httpx.Response(429, headers={"Retry-After": "120"}))
    with pytest.raises(ProviderUnavailable, match="retry later"):
        fetch(refresh, ["eng.1"])
    assert len(calls) == 1


def test_retry_backoff_and_pacing(monkeypatch, tmp_path):
    delays = []
    async def sleep(delay):
        delays.append(delay)
    monkeypatch.setattr("backend.services.data.espn_refresh.asyncio.sleep", sleep)
    calls = 0
    def handler(_):
        nonlocal calls
        calls += 1
        return httpx.Response(503) if calls < 3 else httpx.Response(200, json=payload("eng.1", []))
    refresh, _ = make_refresh(tmp_path, handler)
    assert fetch(refresh, ["eng.1"])["eng.1"] == (2026, [])
    assert delays == [.25, 1, .25, 2, .25]


def test_tampered_receipt_is_refetched(tmp_path):
    handler = workload_handler({"eng.1": ["20260821"]})
    refresh, _ = make_refresh(tmp_path, handler)
    fetch(refresh, ["eng.1"])
    with sqlite3.connect(tmp_path / "receipts.sqlite") as db:
        db.execute("UPDATE receipts SET body='{}'")
    refresh, calls = make_refresh(tmp_path, handler)
    assert len(fetch(refresh, ["eng.1"])["eng.1"][1]) == 1
    assert len(calls) == 2


def seed(path, *, source="fdcouk", score=1, mid="fd-original"):
    with open_warehouse(path) as wh:
        espn_loader.register_competitions(wh)
        resolver = espn_loader.TeamResolver(wh, gender_default="M")
        home = resolver.resolve("Arsenal", gender="M").team_id
        away = resolver.resolve("Chelsea", gender="M").team_id
        wh.upsert_matches([MatchRow(mid, source, "eng.1", 2026, "2026-08-21T00:00:00+00:00",
                                   home, away, score, 0, odds_home=2.4, home_xg=1.8)])
        wh._conn.execute("INSERT INTO weather(match_id,temp_c) VALUES(?,20)", (mid,))
        wh._conn.execute("INSERT INTO match_event_coverage VALUES(?,'original',1,'old')", (mid,))


def mock_observations(monkeypatch, raw=None, error=None):
    async def observed(self, scope):
        if error:
            raise error
        return {"eng.1": (2026, raw if raw is not None else [self.parser._parse_espn_event(event(), "premier_league", 2026)])}
    monkeypatch.setattr(CurrentSeasonRefresh, "fetch", observed)


def test_cross_source_reconciliation_preserves_id_enrichment_and_children(tmp_path, monkeypatch):
    path = tmp_path / "warehouse.sqlite"
    seed(path)
    mock_observations(monkeypatch)
    with open_warehouse(path) as wh:
        stats = asyncio.run(espn_loader.load_current_competitions(wh, competitions=["eng.1"], receipts_path=tmp_path / "receipts"))
        assert stats[0].written == 1
        row = wh._conn.execute("SELECT * FROM matches").fetchone()
        assert (row["match_id"], row["source"], row["odds_home"], row["home_xg"]) == ("fd-original", "fdcouk", 2.4, 1.8)
        assert wh._conn.execute("SELECT COUNT(*) FROM weather").fetchone()[0] == 1
        assert wh._conn.execute("SELECT source FROM match_event_coverage").fetchone()[0] == "original"
        assert wh._conn.execute("SELECT event_id,match_id FROM provider_match_ids").fetchone()[:] == ("1", "fd-original")
        asyncio.run(espn_loader.load_current_competitions(wh, competitions=["eng.1"], receipts_path=tmp_path / "receipts"))
        assert wh.count_matches() == 1


@pytest.mark.parametrize("kind", ["lost", "score", "identity", "new-event-id", "ambiguous"])
def test_reconciliation_refuses_lost_or_conflicting_baseline(tmp_path, monkeypatch, kind):
    path = tmp_path / "warehouse.sqlite"
    seed(path, source="espn" if kind in ("identity", "new-event-id") else "fdcouk",
         mid="espn_eng.1_1" if kind in ("identity", "new-event-id") else "fd-original",
         score=2 if kind == "score" else 1)
    with open_warehouse(path) as wh:
        if kind == "ambiguous":
            wh._conn.execute("INSERT INTO matches SELECT 'duplicate',source,competition_id,season,date_utc,"
                             "home_team_id,away_team_id,home_score,away_score,phase,referee_id,home_shots,away_shots,"
                             "home_sot,away_sot,home_corners,away_corners,home_yellows,away_yellows,home_reds,away_reds,"
                             "home_xg,away_xg,attendance,odds_home,odds_draw,odds_away,odds_over_2_5,venue,fetched_at,"
                             "odds_close_home,odds_close_draw,odds_close_away FROM matches")
        parser = CurrentSeasonRefresh(tmp_path / "temp-receipts", now=NOW)
        raw = parser.parser._parse_espn_event(event(), "premier_league", 2026)
        asyncio.run(parser.close())
        if kind == "identity":
            raw["home_team"] = "Everton"
        if kind == "new-event-id":
            raw["match_id"] = "2"
        mock_observations(monkeypatch, [] if kind == "lost" else [raw])
        with pytest.raises(ProviderUnavailable):
            asyncio.run(espn_loader.load_current_competitions(wh, competitions=["eng.1"], receipts_path=tmp_path / "receipts"))


def test_build_failure_with_saved_progress_preserves_live_database(tmp_path, monkeypatch):
    path = tmp_path / "warehouse.sqlite"
    seed(path)
    original = path.read_bytes()
    original_mtime, inode = path.stat().st_mtime_ns, path.stat().st_ino
    monkeypatch.setattr("backend.services.data.espn_refresh.datetime", datetime)
    calendars = five_workload()
    real_init = CurrentSeasonRefresh.__init__
    def init(self, receipt_path):
        real_init(self, receipt_path, now=NOW,
                  client=httpx.AsyncClient(transport=httpx.MockTransport(workload_handler(calendars))))
    monkeypatch.setattr(CurrentSeasonRefresh, "__init__", init)
    code = build.main(["--db", str(path), "--espn", "--current-season", "--resume-current",
                       "--competitions", ",".join(FIVE), "--receipts-db", str(tmp_path / "receipts")])
    assert code == 1
    assert path.read_bytes() == original
    assert (path.stat().st_mtime_ns, path.stat().st_ino) == (original_mtime, inode)
    with sqlite3.connect(tmp_path / "receipts") as db:
        assert db.execute("SELECT COUNT(*) FROM receipts").fetchone()[0] == 88


def test_build_validation_failure_after_complete_fetch_preserves_live_database(tmp_path, monkeypatch):
    path = tmp_path / "warehouse.sqlite"
    seed(path)
    original = path.read_bytes()
    mock_observations(monkeypatch)
    def invalid(*_):
        raise ProviderUnavailable("integrity gate")
    monkeypatch.setattr(build, "_validate_candidate", invalid)
    assert build.main(["--db", str(path), "--espn", "--current-season", "--resume-current",
                       "--competitions", "eng.1", "--receipts-db", str(tmp_path / "receipts")]) == 1
    assert path.read_bytes() == original


def test_workflow_scopes_follow_served_leagues_and_retain_failure_gate():
    root = Path(__file__).resolve().parents[2]
    for filename, script in [("prediction_pipeline.yml", "predict_upcoming.py"), ("season_forecast.yml", "forecast_season.py")]:
        tree = ast.parse((root / "backend/scripts" / script).read_text())
        leagues = next(ast.literal_eval(node.value) for node in tree.body
                       if (isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "LEAGUES" for t in node.targets))
                       or (isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.target.id == "LEAGUES"))
        workflow = yaml.safe_load((root / ".github/workflows" / filename).read_text())
        steps = next(iter(workflow["jobs"].values()))["steps"]
        refresh = next(s for s in steps if "--resume-current" in s.get("run", ""))
        scope = refresh["run"].split("--competitions ")[1].split()[0].split(",")
        assert set(scope) == set(leagues)
        assert not refresh.get("continue-on-error", False)
        save = next(s for s in steps if s.get("uses", "").startswith("actions/cache/save@"))
        assert save["if"] == "always()"
        assert steps.index(save) > steps.index(refresh)
        assert "cache-primary-key" in save["with"]["key"]


@pytest.mark.parametrize("args", [[], ["--espn"], ["--espn", "--current-season"],
    ["--espn", "--current-season", "--competitions", "uefa.champions"],
    ["--espn", "--current-season", "--competitions", "eng.1,eng.1"],
    ["--espn", "--current-season", "--competitions", "eng.1", "--force"]])
def test_routine_cli_requires_explicit_valid_scope(args):
    with pytest.raises(SystemExit) as exc:
        build.main(["--resume-current", *args])
    assert exc.value.code == 2


def test_six_league_forecast_bootstrap_resumes_with_same_hard_cap(tmp_path):
    calendars = five_workload()
    calendars['usa.1'] = [(datetime(2026, 8, 1) + timedelta(days=i)).strftime('%Y%m%d') for i in range(56)]
    refresh, calls = make_refresh(tmp_path, workload_handler(calendars))
    with pytest.raises(ProviderUnavailable, match='budget'):
        fetch(refresh, list(ROUTINE_COMPETITIONS))
    assert len(calls) == 93
    refresh, calls = make_refresh(tmp_path, workload_handler(calendars))
    selected = fetch(refresh, list(ROUTINE_COMPETITIONS))
    assert len(calls) == 69
    assert sum(len(matches) for _, matches in selected.values()) == 150


def test_january_uses_each_competitions_own_current_season(tmp_path):
    clock = datetime(2026, 1, 10, tzinfo=timezone.utc)
    def handler(request):
        comp = request.url.path.split('/')[-2]
        day = request.url.params['dates']
        season, fixture_day = (2025, '20251231') if comp == 'eng.1' else (2026, '20260101')
        events = [] if day == '20260110' else [event(comp, fixture_day)]
        return httpx.Response(200, json=payload(comp, [fixture_day], events, season=season))
    refresh, calls = make_refresh(tmp_path, handler, now=clock)
    result = fetch(refresh, ['eng.1', 'usa.1'])
    assert result['eng.1'][0] == 2025
    assert result['usa.1'][0] == 2026
    assert len(calls) == 4


def test_conflicting_cross_day_event_receipts_are_refused_then_revalidated(tmp_path):
    days = ['20260930', '20261001']
    conflicting = True
    def handler(request):
        day = request.url.params['dates']
        ev = event(day='20261001')
        if conflicting and day == '20261001':
            ev['competitions'][0]['competitors'][0]['score'] = '2'
        return httpx.Response(200, json=payload('usa.1', days, [] if day == '20261005' else [ev]))
    refresh, calls = make_refresh(tmp_path, handler)
    with pytest.raises(ProviderUnavailable, match='conflicting event'):
        fetch(refresh, ['usa.1'])
    with sqlite3.connect(tmp_path / 'receipts.sqlite') as db:
        before = db.execute('SELECT * FROM receipts').fetchall()
        assert len(before) == 2
        assert db.execute('SELECT COUNT(*) FROM invalidated').fetchone()[0] == 2
    conflicting = False
    refresh, calls = make_refresh(tmp_path, handler)
    assert len(fetch(refresh, ['usa.1'])['usa.1'][1]) == 1
    assert len(calls) == 3
    with sqlite3.connect(tmp_path / 'receipts.sqlite') as db:
        assert db.execute('SELECT COUNT(*) FROM invalidated').fetchone()[0] == 0


@pytest.mark.parametrize('case', ['status', 'bad-json', 'bad-day', 'pending-schema', 'future-final', 'saturated'])
def test_invalid_daily_response_never_becomes_a_receipt(tmp_path, case):
    day = '20260821'
    def handler(request):
        if request.url.params['dates'] == '20261005':
            return httpx.Response(200, json=payload('eng.1', [day]))
        if case == 'status':
            return httpx.Response(401)
        if case == 'bad-json':
            return httpx.Response(200, text='not json')
        ev = event(day='20260822' if case == 'bad-day' else day)
        if case == 'pending-schema':
            ev = event(day=day, final=False)
            del ev['competitions'][0]['competitors']
        if case == 'future-final':
            ev = event(day='20261006')
        events = [ev] * 1000 if case == 'saturated' else [ev]
        return httpx.Response(200, json=payload('eng.1', [day], events))
    refresh, _ = make_refresh(tmp_path, handler)
    with pytest.raises(ProviderUnavailable):
        fetch(refresh, ['eng.1'])
    with sqlite3.connect(tmp_path / 'receipts.sqlite') as db:
        assert db.execute('SELECT COUNT(*) FROM receipts').fetchone()[0] == 0


def test_budget_cannot_be_raised_above_hard_cap(tmp_path):
    with pytest.raises(ValueError, match='93'):
        CurrentSeasonRefresh(tmp_path / 'receipts', budget=94)


def test_only_explicit_attendance_and_card_observations_are_retained(tmp_path):
    refresh, _ = make_refresh(tmp_path, lambda _: httpx.Response(200))
    ev = event()
    ev['competitions'][0]['venue'] = {'capacity': 50000, 'fullName': 'Stadium'}
    matches, pending = refresh._events(payload('eng.1', ['20260821'], [ev]), 'eng.1', 2026, '20260821')
    assert matches[0]['attendance'] is None
    assert matches[0]['home_yellows'] is None
    assert matches[0]['home_reds'] is None
    assert not pending
    asyncio.run(refresh.close())


def test_reused_completed_receipts_keep_their_observation_timestamp(tmp_path):
    handler = workload_handler({'eng.1': ['20260821']})
    refresh, _ = make_refresh(tmp_path, handler)
    first = fetch(refresh, ['eng.1'])['eng.1'][1][0]
    refresh, calls = make_refresh(tmp_path, handler, now=NOW + timedelta(hours=2))
    second = fetch(refresh, ['eng.1'])['eng.1'][1][0]
    assert second['_observed_at'] == first['_observed_at'] == NOW.isoformat()
    assert len(calls) == 1


def test_loader_uses_receipt_timestamp_for_match_and_verified_alias(tmp_path, monkeypatch):
    path = tmp_path / 'warehouse.sqlite'
    seed(path)
    refresh = CurrentSeasonRefresh(tmp_path / 'temp', now=NOW)
    raw = refresh.parser._parse_espn_event(event(), 'premier_league', 2026)
    asyncio.run(refresh.close())
    raw['_observed_at'] = '2026-10-04T12:00:00+00:00'
    mock_observations(monkeypatch, [raw])
    with open_warehouse(path) as wh:
        asyncio.run(espn_loader.load_current_competitions(wh, competitions=['eng.1'], receipts_path=tmp_path / 'receipts'))
        assert wh._conn.execute('SELECT fetched_at FROM matches').fetchone()[0] == raw['_observed_at']
        assert wh._conn.execute('SELECT observed_at FROM provider_match_ids').fetchone()[0] == raw['_observed_at']


@pytest.mark.parametrize('value', [None, True, {}, [], ''])
@pytest.mark.parametrize('final', [True, False])
def test_invalid_event_and_team_ids_cannot_certify_a_receipt(tmp_path, value, final):
    refresh, _ = make_refresh(tmp_path, lambda _: httpx.Response(200))
    for field in ['event', 'team']:
        ev = event(final=final)
        if field == 'event':
            ev['id'] = value
        else:
            ev['competitions'][0]['competitors'][0]['team']['id'] = value
        with pytest.raises(ProviderUnavailable):
            refresh._events(payload('eng.1', ['20260821'], [ev]), 'eng.1', 2026, '20260821')
    asyncio.run(refresh.close())
