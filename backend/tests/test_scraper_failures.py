"""Scrapers must preserve last-good data and fail visibly without ML imports."""
import argparse
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import subprocess
import sys
from unittest.mock import AsyncMock

import httpx
import pytest
import yaml

from backend.services.data import injury_tracker as injury
from backend.services.data import lineup_scraper as lineup
from backend.services.data.provider_status import ProviderUnavailable, write_json_atomic
from backend.services.fotmob.client import FotMobClient

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def tracker(tmp_path, monkeypatch):
    tracker = injury.InjuryTracker(data_dir=tmp_path)
    monkeypatch.setattr(tracker, "_pace", AsyncMock())
    monkeypatch.setattr(tracker.espn, "_request", AsyncMock(return_value=None))
    monkeypatch.setattr(tracker.fotmob, "get_team_injuries", AsyncMock(return_value=None))
    return tracker


def save_last_good(tracker, source="espn"):
    payload = {"team_id": "123", "source": source, "league_key": "premier_league",
               "fetched_at": "2026-01-01T00:00:00+00:00", "injuries": [{"name": "Known injury"}]}
    path = tracker._cache_path("123"); path.write_text(json.dumps(payload))
    return path, path.read_bytes(), path.stat().st_mtime_ns


@pytest.mark.asyncio
@pytest.mark.parametrize("response", [None, {}, {"injuries": None}, {"injuries": {}}, {"injuries": [{}]}])
async def test_espn_failure_preserves_last_good_bytes_and_timestamps(tracker, response):
    path, before, stamp = save_last_good(tracker)
    tracker.espn._request.return_value = response
    with pytest.raises(ProviderUnavailable):
        await tracker.fetch_team_injuries("123", league_key="premier_league")
    assert path.read_bytes() == before and path.stat().st_mtime_ns == stamp
    assert json.loads(path.read_text())["fetched_at"] == "2026-01-01T00:00:00+00:00"
    status = json.loads((path.parent / "123.status.json").read_text())
    assert status["availability"] == "unavailable"
    assert status["last_good_fetched_at"] == "2026-01-01T00:00:00+00:00"
    tracker.fotmob.get_team_injuries.assert_not_awaited()


@pytest.mark.asyncio
async def test_transport_failure_is_unavailable_and_preserves_cache(tracker):
    path, before, stamp = save_last_good(tracker)
    tracker.espn._request.side_effect = httpx.ReadTimeout("timeout")
    with pytest.raises(ProviderUnavailable):
        await tracker.fetch_team_injuries("123", league_key="premier_league")
    assert path.read_bytes() == before and path.stat().st_mtime_ns == stamp


@pytest.mark.asyncio
@pytest.mark.parametrize("source", ["espn", "fotmob"])
async def test_valid_empty_report_is_available_and_cached(tracker, source):
    path, _, _ = save_last_good(tracker, source)
    tracker.espn._request.return_value = {"injuries": []}
    tracker.fotmob.get_team_injuries.return_value = []
    assert await tracker.fetch_team_injuries("123", source=source, league_key="premier_league") == []
    data = json.loads(path.read_text())
    assert data["injuries"] == [] and data["fetched_at"] != "2026-01-01T00:00:00+00:00"
    assert json.loads((path.parent / "123.status.json").read_text())["availability"] == "available"


@pytest.mark.asyncio
@pytest.mark.parametrize("raw", [None, {}, [{}]])
async def test_fotmob_unavailable_is_not_a_fresh_empty_report(tracker, raw):
    path, before, stamp = save_last_good(tracker, "fotmob")
    tracker.fotmob.get_team_injuries.return_value = raw
    with pytest.raises(ProviderUnavailable):
        await tracker.fetch_team_injuries("123", source="fotmob")
    assert path.read_bytes() == before and path.stat().st_mtime_ns == stamp
    tracker.espn._request.assert_not_awaited()


@pytest.mark.asyncio
async def test_refresh_uses_cached_provider_and_ignores_status_files(tracker):
    path, _, _ = save_last_good(tracker, "fotmob")
    (path.parent / "123.status.json").write_text('{}')
    tracker.fotmob.get_team_injuries.return_value = []
    assert await tracker.refresh_stale() == 1
    tracker.fotmob.get_team_injuries.assert_awaited_once_with(123)
    tracker.espn._request.assert_not_awaited()
    assert json.loads(path.read_text())["source"] == "fotmob"


@pytest.mark.asyncio
async def test_refresh_stale_failure_is_not_counted_as_success(tracker):
    path, before, stamp = save_last_good(tracker)
    with pytest.raises(ProviderUnavailable, match="Failed to refresh 1"):
        await tracker.refresh_stale()
    assert path.read_bytes() == before and path.stat().st_mtime_ns == stamp


@pytest.mark.asyncio
async def test_fresh_cache_does_not_cross_provider_namespace(tracker):
    path, _, _ = save_last_good(tracker, "espn")
    payload = json.loads(path.read_text()); payload["fetched_at"] = datetime.now(timezone.utc).isoformat()
    path.write_text(json.dumps(payload))
    tracker.fotmob.get_team_injuries.return_value = []
    assert await tracker.fetch_team_injuries("123", source="fotmob") == []
    tracker.fotmob.get_team_injuries.assert_awaited_once()


def test_atomic_cache_write_failure_preserves_file(tmp_path, monkeypatch):
    path = tmp_path / "cache.json"; path.write_bytes(b'{"old":true}')
    stamp = path.stat().st_mtime_ns
    def fail(*_): raise OSError("disk full")
    monkeypatch.setattr("backend.services.data.provider_status.os.replace", fail)
    with pytest.raises(OSError): write_json_atomic(path, {"new": True})
    assert path.read_bytes() == b'{"old":true}' and path.stat().st_mtime_ns == stamp
    assert list(tmp_path.iterdir()) == [path]


@pytest.fixture
def scraper(tmp_path, monkeypatch):
    scraper = lineup.LineupScraper(data_dir=tmp_path)
    monkeypatch.setattr(scraper, "_pace", AsyncMock())
    monkeypatch.setattr(scraper.espn, "get_scoreboard", AsyncMock(return_value={"events": []}))
    monkeypatch.setattr(scraper.espn, "get_match_details", AsyncMock(return_value={"header": {"id": "123"}, "rosters": []}))
    monkeypatch.setattr(scraper.fotmob, "get_match_details", AsyncMock(return_value=None))
    return scraper


@pytest.mark.asyncio
@pytest.mark.parametrize("response", [None, {}, {"events": None}, {"events": [{}]}])
async def test_failed_scoreboard_cannot_be_an_empty_lineup_batch(scraper, response):
    scraper.espn.get_scoreboard.return_value = response
    with pytest.raises(ProviderUnavailable):
        await scraper.fetch_upcoming_lineups("premier_league")


@pytest.mark.asyncio
async def test_late_daily_failure_stops_before_lineup_writes(scraper):
    e = {"id": "123", "date": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()}
    scraper.espn.get_scoreboard.side_effect = [{"events": [e]}, None]
    with pytest.raises(ProviderUnavailable):
        await scraper.fetch_upcoming_lineups("premier_league", days_ahead=1)
    scraper.espn.get_match_details.assert_not_awaited()


@pytest.mark.asyncio
async def test_unpublished_lineup_and_empty_schedule_succeed(scraper):
    assert await scraper.fetch_upcoming_lineups("premier_league") == []
    assert await scraper.fetch_match_lineup("123", "premier_league") is None
    scraper.fotmob.get_match_details.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("data", [None, {}, {"header": {}}, {"header": {"id": "456"}},
    {"header": {"id": "123"}, "rosters": {}}])
async def test_lineup_failure_keeps_cache_and_does_not_reuse_provider_id(scraper, data):
    path = scraper._cache_path("premier_league", "123")
    path.write_bytes(b'{"fetched_at":"2026-01-01T00:00:00Z","source":"espn","home_xi":[{"name":"Known"}]}')
    before, stamp = path.read_bytes(), path.stat().st_mtime_ns
    scraper.espn.get_match_details.return_value = data
    with pytest.raises(ProviderUnavailable):
        await scraper.fetch_match_lineup("123", "premier_league")
    assert path.read_bytes() == before and path.stat().st_mtime_ns == stamp
    scraper.fotmob.get_match_details.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("data", [{"squad": None}, {"squad": {}}, {"squad": {"squad": None}},
    {"squad": {"squad": [{}]}}])
async def test_fotmob_invalid_squad_is_unavailable(monkeypatch, data):
    cl = FotMobClient(); monkeypatch.setattr(cl, "get_team", AsyncMock(return_value=data))
    assert await cl.get_team_injuries(123) is None


@pytest.mark.asyncio
async def test_fotmob_valid_empty_squad_is_valid_empty(monkeypatch):
    cl = FotMobClient(); monkeypatch.setattr(cl, "get_team", AsyncMock(return_value={"squad": {"squad": []}}))
    assert await cl.get_team_injuries(123) == []


@pytest.mark.asyncio
@pytest.mark.parametrize("module", [lineup, injury])
async def test_cli_returns_failure_and_closes_clients(module, monkeypatch):
    service = AsyncMock()
    service.fetch_upcoming_lineups.side_effect = ProviderUnavailable("failed")
    service.refresh_stale.side_effect = ProviderUnavailable("failed")
    getter = "get_lineup_scraper" if module is lineup else "get_injury_tracker"
    monkeypatch.setattr(module, getter, lambda: service)
    args = argparse.Namespace(all_leagues=False, league="premier_league", days_ahead=1,
                              refresh_stale=True, team_id=None, source="espn")
    assert await module._run_cli(args) == 1
    service.close.assert_awaited_once()


@pytest.mark.parametrize("module", [lineup, injury])
def test_main_propagates_cli_result(module, monkeypatch):
    monkeypatch.setattr(module, "_run_cli", AsyncMock(return_value=7))
    monkeypatch.setattr(sys, "argv", [module.__name__])
    assert module.main() == 7


@pytest.mark.parametrize("module", ["lineup_scraper", "injury_tracker"])
def test_cli_startup_without_numerical_or_prediction_imports(module):
    code = '''
import importlib.abc, runpy, sys
class BlockML(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split('.')[0] in {'numpy','pandas','scipy','sklearn','torch','xgboost','lightgbm','penaltyblog'} or fullname.startswith('backend.services.prediction'):
            raise ImportError('Unexpected prediction dependency: ' + fullname)
sys.meta_path.insert(0, BlockML())
sys.argv = ['scraper', '--help']
runpy.run_module(sys.argv_module, run_name='__main__')
'''.replace("sys.argv_module", repr("backend.services.data." + module))
    result = subprocess.run([sys.executable, "-c", code], cwd=ROOT, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert "usage:" in result.stdout


def test_workflow_does_not_mask_failures_or_commit_failed_batches():
    steps = yaml.safe_load((ROOT / '.github/workflows/scrape_lineups.yml').read_text())["jobs"]["scrape-lineups"]["steps"]
    for name in ["Scrape upcoming lineups", "Refresh stale injury reports"]:
        step = next(s for s in steps if s.get("name") == name)
        assert not step.get("continue-on-error", False)
    injury_step = next(s for s in steps if s.get("name") == "Refresh stale injury reports")
    assert "!cancelled()" in injury_step["if"]
    commit = next(s for s in steps if s.get("name") == "Commit updated scrape data")
    assert commit.get("if", "success()") == "success()"
    assert "|| true" not in commit["run"]


def test_public_service_exports_remain_compatible():
    import backend.services as services
    from backend.services.prediction import PredictionService
    from backend.services.ratings import EloRatingSystem
    assert services.PredictionService is PredictionService
    assert services.EloRatingSystem is EloRatingSystem
    assert services.FotMobClient is FotMobClient
    with pytest.raises(AttributeError):
        getattr(services, "unknown_service")
