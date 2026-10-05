"""Offline failure replays: providers must not certify or publish partial data."""
import asyncio
import json
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
import yaml

from backend.scripts import build_warehouse as build
from backend.services.data import espn_loader
from backend.services.data.provider_status import ProviderUnavailable
from backend.services.data.warehouse import MatchRow, open_warehouse
from backend.services.prediction.historical_data import HistoricalDataCollector


def event(mid="1", **changes):
    result = {"id": mid, "date": "2026-08-01T12:00:00Z", "competitions": [{
        "status": {"type": {"completed": True}}, "competitors": [
            {"homeAway": "home", "score": "1", "team": {"id": "a", "displayName": "Arsenal"}},
            {"homeAway": "away", "score": "0", "team": {"id": "b", "displayName": "Chelsea"}},
        ],
    }]}
    result.update(changes)
    return result


@pytest.fixture
def collector(tmp_path, monkeypatch):
    monkeypatch.setattr(HistoricalDataCollector, "_today", staticmethod(lambda: datetime(2026, 8, 3)))
    async def no_sleep(_):
        pass
    monkeypatch.setattr("backend.services.prediction.historical_data.asyncio.sleep", no_sleep)
    instance = HistoricalDataCollector(tmp_path)
    yield instance
    asyncio.run(instance.close())


def install_client(collector, handler):
    requests = []
    def transport(request):
        requests.append(request)
        return handler(request)
    collector._client = httpx.AsyncClient(transport=httpx.MockTransport(transport))
    return requests


def cache_snapshot(collector, fd=False):
    path = (collector.data_dir / "fd_premier_league_2026_2027.json" if fd
            else collector._cache_path("premier_league", 2026))
    match = collector._parse_espn_event(event(), "premier_league", 2026)
    if fd:
        match["match_id"] = "fd_premier_league_20260801_Arsenal_Chelsea"
    path.write_text(json.dumps({"fetched_at": "last-good", "matches": [match]}))
    return path, path.read_bytes(), path.stat().st_mtime_ns


def assert_preserved(snapshot):
    path, content, mtime = snapshot
    assert path.read_bytes() == content
    assert path.stat().st_mtime_ns == mtime


@pytest.mark.parametrize("response", [
    httpx.Response(401), httpx.Response(429), httpx.Response(500),
    httpx.Response(200, text="not JSON"), httpx.Response(200, json={}),
    httpx.Response(200, json={"events": None}), httpx.Response(200, json={"events": {}}),
    httpx.Response(200, json={"events": [None]}),
    httpx.Response(200, json={"events": [event(competitions=[])]}),
    httpx.Response(200, json={"events": [event(date="2019-08-01T12:00:00Z")]}),
    httpx.Response(200, json={"events": [event(date="2026-08-04T12:00:00Z")]}),
])
def test_espn_failure_preserves_last_good(collector, response):
    snapshot = cache_snapshot(collector)
    install_client(collector, lambda _: response)
    with pytest.raises(ProviderUnavailable):
        asyncio.run(collector.fetch_season_matches("premier_league", 2026, force=True))
    assert_preserved(snapshot)


@pytest.mark.parametrize("missing", ["score", "team", "homeAway"])
def test_final_with_missing_field_is_failure_not_zero_score(collector, missing):
    payload = event()
    del payload["competitions"][0]["competitors"][0][missing]
    with pytest.raises(ProviderUnavailable):
        collector._parse_espn_event(payload, "premier_league", 2026)


@pytest.mark.parametrize("score", [None, "", "-1", "1.5", True, 1.5])
def test_final_score_must_be_explicit_nonnegative_integer(collector, score):
    payload = event()
    payload["competitions"][0]["competitors"][0]["score"] = score
    with pytest.raises(ProviderUnavailable):
        collector._parse_espn_event(payload, "premier_league", 2026)


def test_daily_fallback_covers_every_day_once_and_deduplicates_events(collector):
    def handler(request):
        dates = request.url.params["dates"]
        if "-" in dates:
            return httpx.Response(400)
        return httpx.Response(200, json={"events": [event(), event()]})
    requests = install_client(collector, handler)
    rows = asyncio.run(collector.fetch_season_matches("premier_league", 2026, force=True))
    assert [r.url.params["dates"] for r in requests] == [
        "20260801-20260803", "20260801", "20260802", "20260803",
    ]
    assert len(rows) == 1
    assert collector.daily_fallback_budget == 90
    assert collector._is_cached("premier_league", 2026)


def test_historical_range_failure_does_not_start_unbounded_backfill(collector):
    requests = install_client(collector, lambda _: httpx.Response(400))
    with pytest.raises(ProviderUnavailable, match="budget"):
        asyncio.run(collector.fetch_season_matches("premier_league", 2025, force=True))
    assert len(requests) == 1
    assert not collector._cache_path("premier_league", 2025).exists()


def test_late_daily_failure_discards_earlier_results(collector):
    snapshot = cache_snapshot(collector)
    def handler(request):
        dates = request.url.params["dates"]
        if "-" in dates:
            return httpx.Response(400)
        if dates == "20260802":
            return httpx.Response(503)
        return httpx.Response(200, json={"events": [event()]})
    install_client(collector, handler)
    with pytest.raises(ProviderUnavailable):
        asyncio.run(collector.fetch_season_matches("premier_league", 2026, force=True))
    assert_preserved(snapshot)


def test_valid_empty_current_season_and_unplayed_event_are_distinct_from_failure(collector):
    pending = event()
    pending["competitions"][0]["status"]["type"]["completed"] = False
    del pending["competitions"][0]["competitors"][0]["score"]
    install_client(collector, lambda _: httpx.Response(200, json={"events": [pending]}))
    assert asyncio.run(collector.fetch_season_matches("premier_league", 2026)) == []
    assert not collector._is_cached("premier_league", 2026)  # Recheck an empty observation.


def test_empty_completed_season_is_not_certified(collector):
    install_client(collector, lambda _: httpx.Response(200, json={"events": []}))
    with pytest.raises(ProviderUnavailable, match="no results"):
        asyncio.run(collector.fetch_season_matches("premier_league", 2025))
    assert not collector._cache_path("premier_league", 2025).exists()


def test_legacy_cache_is_revalidated_and_regression_preserves_it(collector):
    snapshot = cache_snapshot(collector)
    assert not collector._is_cached("premier_league", 2026)
    install_client(collector, lambda _: httpx.Response(200, json={"events": []}))
    with pytest.raises(ProviderUnavailable, match="lost previously"):
        asyncio.run(collector.fetch_season_matches("premier_league", 2026))
    assert_preserved(snapshot)


def test_conflicting_event_id_and_truncated_response_are_failures(collector):
    conflict = event(date="2026-08-02T12:00:00Z")
    for events in ([event(), conflict], [event()] * 1000):
        install_client(collector, lambda _, events=events: httpx.Response(200, json={"events": events}))
        with pytest.raises(ProviderUnavailable):
            asyncio.run(collector.fetch_season_matches("premier_league", 2026, force=True))
    assert not collector._cache_path("premier_league", 2026).exists()


CSV_HEADER = "Date,HomeTeam,AwayTeam,FTHG,FTAG,FTR,B365H\n"
CSV_GOOD = "01/08/2026,Arsenal,Chelsea,1,0,H,2.1\n"


@pytest.mark.parametrize("response", [
    httpx.Response(404), httpx.Response(503), httpx.Response(200, text="<html>unavailable</html>"),
    httpx.Response(200, text="Date,HomeTeam,AwayTeam\n01/08/2026,A,B\n"),
    *[httpx.Response(200, text=CSV_HEADER + CSV_GOOD + bad) for bad in (
        "bad-date,A,B,1,0,H,2\n", "02/08/2026,,B,1,0,H,2\n",
        "02/08/2026,A,B,-1,0,A,2\n", "02/08/2026,A,B,1,,H,2\n",
        "02/08/2026,A,B,1,0,A,2\n",
        "02/08/2026,A,B,,,H,2\n",
        "01/08/2019,A,B,1,0,H,2\n", "04/08/2026,A,B,1,0,H,2\n",
    )],
])
def test_csv_http_header_and_late_row_failures_preserve_cache(collector, response):
    snapshot = cache_snapshot(collector, fd=True)
    install_client(collector, lambda _: response)
    with pytest.raises(ProviderUnavailable):
        asyncio.run(collector.fetch_football_data_season("premier_league", 2026, force=True))
    assert_preserved(snapshot)


def test_valid_csv_keeps_missing_or_nonfinite_prices_missing(collector):
    install_client(collector, lambda _: httpx.Response(200, text=CSV_HEADER + CSV_GOOD.replace("2.1", "NaN")))
    rows = asyncio.run(collector.fetch_football_data_season("premier_league", 2026))
    assert len(rows) == 1
    assert rows[0]["odds_home"] is None


def test_read_only_cache_mode_does_not_publish_on_success(collector):
    snapshot = cache_snapshot(collector)
    collector.persist_cache = False
    install_client(collector, lambda _: httpx.Response(200, json={"events": [event(), event("2")]}))
    assert len(asyncio.run(collector.fetch_season_matches("premier_league", 2026, force=True))) == 2
    assert_preserved(snapshot)


def seed(wh, season=2026, mid="seed", reverse=False):
    espn_loader.register_competitions(wh)
    home = wh.upsert_team("Arsenal", gender="M")
    away = wh.upsert_team("Chelsea", gender="M")
    if reverse:
        home, away = away, home
    wh.upsert_matches([MatchRow(
        match_id=mid, source="espn", competition_id="eng.1", season=season,
        date_utc=f"{season}-08-01T12:00:00+00:00", home_team_id=home,
        away_team_id=away, home_score=1, away_score=0,
    )])


def run_build(path, *flags):
    return build.main(["--db", str(path), "--min-season", "2018", *flags])


@pytest.mark.parametrize("kind", ["provider", "empty-selection", "phantom", "exception", "interrupt"])
def test_failed_build_preserves_db_bytes_timestamp_and_removes_candidate(tmp_path, monkeypatch, kind):
    path = tmp_path / "warehouse.sqlite"
    with open_warehouse(path) as wh:
        seed(wh)
    content, mtime = path.read_bytes(), path.stat().st_mtime_ns
    async def failed(wh, **kwargs):
        assert kwargs["persist_cache"] is False
        seed(wh, mid="partial")  # Prove rollback of an earlier real write.
        if kind == "exception":
            raise httpx.ConnectError("offline")
        if kind == "interrupt":
            raise KeyboardInterrupt
        if kind == "empty-selection":
            return []
        return [SimpleNamespace(competition_id="eng.1", season=2026, error="HTTP 400" if kind == "provider" else None,
                                phantom_rows_skipped=1 if kind == "phantom" else 0)]
    monkeypatch.setattr(build, "load_men_competitions", failed)
    assert run_build(path, "--espn") == (130 if kind == "interrupt" else 1)
    assert path.read_bytes() == content
    assert path.stat().st_mtime_ns == mtime
    assert not list(tmp_path.glob(".warehouse-*"))


def test_later_source_failure_does_not_publish_earlier_source(tmp_path, monkeypatch):
    path = tmp_path / "warehouse.sqlite"
    async def good(wh, **kwargs):
        seed(wh)
        return [espn_loader.LoadStats("eng.1", 2026, 1, 1)]
    async def bad(wh, **kwargs):
        assert kwargs["persist_cache"] is False
        return [SimpleNamespace(competition_id="eng.1", season=2026, error="wrong_competition")]
    monkeypatch.setattr(build, "load_men_competitions", good)
    monkeypatch.setattr(build, "load_football_data", bad)
    assert run_build(path, "--espn", "--football-data") == 1
    assert not path.exists()


@pytest.mark.parametrize("existing", [False, True])
def test_successful_candidate_is_published_and_integrity_checked(tmp_path, monkeypatch, existing):
    path = tmp_path / "warehouse.sqlite"
    if existing:
        with open_warehouse(path) as wh:
            seed(wh, mid="old", reverse=True)
    async def good(wh, **kwargs):
        seed(wh)
        return [espn_loader.LoadStats("eng.1", 2026, 1, 1)]
    monkeypatch.setattr(build, "load_men_competitions", good)
    assert run_build(path, "--espn") == 0
    with open_warehouse(path) as wh:
        assert wh._conn.execute("SELECT COUNT(*) FROM matches").fetchone()[0] == (2 if existing else 1)
        build._validate_candidate(wh, SimpleNamespace(min_season=2018))


def test_old_partial_season_cannot_pass_as_latest_snapshot(tmp_path, monkeypatch):
    path = tmp_path / "warehouse.sqlite"
    async def partial(wh, **kwargs):
        seed(wh, season=2018)
        return [espn_loader.LoadStats("eng.1", 2018, 1, 1)]
    monkeypatch.setattr(build, "load_men_competitions", partial)
    assert run_build(path, "--espn") == 1
    assert not path.exists()


def test_stats_on_missing_db_never_creates_empty_warehouse(tmp_path):
    path = tmp_path / "warehouse.sqlite"
    assert run_build(path, "--stats") == 2
    assert not path.exists()


def test_replace_error_and_interrupt_preserve_existing_warehouse(tmp_path, monkeypatch):
    path = tmp_path / "warehouse.sqlite"
    with open_warehouse(path) as wh:
        seed(wh)
    content, mtime = path.read_bytes(), path.stat().st_mtime_ns
    async def good(wh, **kwargs):
        seed(wh, mid="next", reverse=True)
        return [espn_loader.LoadStats("eng.1", 2026, 1, 1)]
    def blocked(*_):
        raise OSError("replace unavailable")
    monkeypatch.setattr(build, "load_men_competitions", good)
    monkeypatch.setattr(build.os, "replace", blocked)
    assert run_build(path, "--espn") == 1
    assert path.read_bytes() == content
    assert path.stat().st_mtime_ns == mtime
    assert not list(tmp_path.glob(".warehouse-*"))


def test_stats_reads_last_good_without_changing_it(tmp_path):
    path = tmp_path / "warehouse.sqlite"
    with open_warehouse(path) as wh:
        seed(wh)
    content, mtime = path.read_bytes(), path.stat().st_mtime_ns
    assert run_build(path, "--stats") == 0
    assert path.read_bytes() == content
    assert path.stat().st_mtime_ns == mtime


def test_empty_provider_cannot_certify_a_season_already_in_warehouse(tmp_path):
    path = tmp_path / "warehouse.sqlite"
    class Empty:
        async def fetch_season_matches(self, *args, **kwargs):
            return []
    with open_warehouse(path) as wh:
        seed(wh, mid="espn_eng.1_1")
        stat = asyncio.run(espn_loader._load_one(
            Empty(), wh, None, None, competition_id="eng.1",
            espn_league_key="premier_league", season=2026, gender="M", force=True,
        ))
        assert stat.error == "season response lost warehouse results"
        assert wh._conn.execute("SELECT COUNT(*) FROM matches").fetchone()[0] == 1


def test_concurrent_change_cannot_be_overwritten_by_candidate(tmp_path, monkeypatch):
    path = tmp_path / "warehouse.sqlite"
    with open_warehouse(path) as wh:
        seed(wh, mid="old")
    writer_bytes = []
    async def good(wh, **kwargs):
        seed(wh, mid="candidate", reverse=True)
        with open_warehouse(path) as live:
            seed(live, mid="concurrent-writer", reverse=True)
        writer_bytes.append(path.read_bytes())
        return [espn_loader.LoadStats("eng.1", 2026, 1, 1)]
    monkeypatch.setattr(build, "load_men_competitions", good)
    assert run_build(path, "--espn") == 1
    assert path.read_bytes() == writer_bytes[0]
    with open_warehouse(path) as wh:
        ids = {r[0] for r in wh._conn.execute("SELECT match_id FROM matches")}
        assert ids == {"old", "concurrent-writer"}


def test_active_wal_blocks_replacement(tmp_path, monkeypatch):
    path = tmp_path / "warehouse.sqlite"
    async def forbidden(*args, **kwargs):
        pytest.fail("must not fetch while a warehouse writer is active")
    monkeypatch.setattr(build, "load_men_competitions", forbidden)
    with open_warehouse(path) as wh:
        seed(wh)
        assert Path(str(path) + "-wal").stat().st_size > 0
        assert run_build(path, "--espn") == 1
        assert wh._conn.execute("SELECT COUNT(*) FROM matches").fetchone()[0] == 1


def test_workflows_require_core_refresh_and_validate_before_upload():
    root = Path(__file__).resolve().parents[2]
    workflow = yaml.safe_load((root / ".github/workflows/data_warehouse.yml").read_text())
    for job in workflow["jobs"].values():
        steps = job["steps"]
        validate = next(i for i, step in enumerate(steps) if step["name"] == "Validate warehouse before publication")
        upload = next(i for i, step in enumerate(steps) if "Upload" in step["name"])
        assert validate < upload
        assert not steps[validate].get("continue-on-error")
    assert "success()" in workflow["jobs"]["enrich"]["if"]
    for file, name in (
        ("prediction_pipeline.yml", "Refresh current-season results in warehouse"),
        ("season_forecast.yml", "Refresh current-season results"),
        ("train_unified.yml", "Refresh warehouse sources"),
    ):
        workflow = yaml.safe_load((root / ".github/workflows" / file).read_text())
        steps = [step for job in workflow["jobs"].values() for step in job["steps"]]
        assert not next(s for s in steps if s.get("name") == name).get("continue-on-error")
