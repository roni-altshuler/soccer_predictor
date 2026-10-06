"""Offline request classification and failed-run diagnostic retention."""
import argparse
from copy import deepcopy
import json
from pathlib import Path
from unittest.mock import AsyncMock, Mock

import httpx
import pytest
import pytest_asyncio
import yaml

from backend.services.data import injury_tracker as injury
from backend.services.data.injury_diagnostics import InjuryDiagnostics, MAX_RECORDS
from backend.services.data.provider_status import ProviderUnavailable
from backend.services.espn.client import ESPNClient, ESPN_LEAGUE_IDS

PRIVATE = 'SYNTHETIC_PRIVATE_BODY_MEDICAL_TOKEN'
ROOT = Path(__file__).resolve().parents[2]
VALID = {'athlete': {'id': '7', 'displayName': PRIVATE}, 'status': 'Out',
         'details': {'type': PRIVATE}, 'shortComment': PRIVATE}


@pytest_asyncio.fixture
async def harness(tmp_path, monkeypatch):
    tracker = injury.InjuryTracker(tmp_path / 'data')
    tracker.espn = ESPNClient()
    tracker.fotmob = AsyncMock()
    tracker._pace = AsyncMock()
    tracker.close = AsyncMock()
    tracker.espn.rate_limiter.acquire = AsyncMock()
    replies = []
    requests = []

    def handler(request):
        requests.append(request)
        reply = replies[0] if len(replies) == 1 else replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(tracker.espn, '_get_client', AsyncMock(return_value=client))
    yield tracker, replies, requests, tmp_path
    await client.aclose()


def last_good(tracker, team='364', source='espn'):
    path = tracker._cache_path(team)
    path.write_text(json.dumps({'team_id': team, 'source': source, 'league_key': 'premier_league',
                               'fetched_at': '2026-01-01T00:00:00+00:00', 'injuries': [{'name': PRIVATE}]}))
    return path, path.read_bytes(), path.stat().st_mtime_ns


def assert_preserved(saved):
    path, content, stamp = saved
    assert path.read_bytes() == content
    assert path.stat().st_mtime_ns == stamp
    assert json.loads(path.read_text())['fetched_at'] == '2026-01-01T00:00:00+00:00'


def read_artifact(path):
    """Inspect an existing artifact without creating or repairing it."""
    text = path.read_text()
    assert PRIVATE not in text
    assert all(word not in text for word in ('Authorization', 'headers', 'response_body', 'shortComment'))
    data = json.loads(text)
    assert data['schema_version'] == 1
    assert all(set(row) == {'provider', 'team_id', 'league_key', 'league_slug',
                           'reason', 'detail', 'http_status', 'checked_at'} for row in data['records'])
    return data


def export_artifact(tracker, tmp_path):
    """Export the ledger for non-CLI serialization checks only."""
    path = tmp_path / 'artifact' / 'injury-diagnostics.json'
    tracker.diagnostics.write(path)
    return read_artifact(path)


@pytest.mark.asyncio
@pytest.mark.parametrize('payload,reason,detail', [
    ({'other': PRIVATE}, 'missing_injury_content', None),
    ({'injuries': None}, 'invalid_schema', 'injuries_null'),
    ({'injuries': {}}, 'invalid_schema', 'injuries_non_list'),
    ({'injuries': PRIVATE}, 'invalid_schema', 'injuries_non_list'),
    ({'injuries': False}, 'invalid_schema', 'injuries_non_list'),
    ([], 'invalid_schema', 'root_non_object'),
    (None, 'invalid_schema', 'root_non_object'),
])
async def test_200_is_not_evidence_of_a_report_and_keeps_cache(harness, payload, reason, detail):
    tracker, replies, requests, tmp_path = harness
    saved = last_good(tracker)
    replies.append(httpx.Response(200, content=json.dumps(payload), headers={'Content-Type': 'application/json'}))
    with pytest.raises(ProviderUnavailable):
        await tracker.fetch_team_injuries('364', league_key='premier_league')
    assert_preserved(saved)
    row = export_artifact(tracker, tmp_path)['records'][0]
    assert (row['reason'], row['detail']) == (reason, detail)
    assert row['provider'] == 'espn' and row['team_id'] == '364'
    assert row['league_key'] == 'premier_league' and row['league_slug'] == 'eng.1'
    assert len(requests) == 1
    tracker.fotmob.get_team_injuries.assert_not_awaited()
    status = json.loads((tracker.data_dir / '364.status.json').read_text())
    assert status['availability'] == 'unavailable'
    assert status['last_good_fetched_at'] == '2026-01-01T00:00:00+00:00'
    assert status['diagnostics'][0]['reason'] == reason
    assert PRIVATE not in json.dumps(status)


@pytest.mark.asyncio
@pytest.mark.parametrize('reply,reason,status', [
    (httpx.Response(403, text=PRIVATE), 'http_error', 403),
    (httpx.Response(429, text=PRIVATE), 'http_error', 429),
    (httpx.Response(500, text=PRIVATE), 'http_error', 500),
    (httpx.Response(503, text=PRIVATE), 'http_error', 503),
    (httpx.Response(200, text=PRIVATE), 'invalid_json', 200),
    (httpx.ReadTimeout(PRIVATE), 'timeout', None),
    (httpx.ConnectError(PRIVATE), 'transport_error', None),
])
async def test_real_shared_http_layer_retains_sanitized_failure_kind(harness, reply, reason, status):
    tracker, replies, requests, tmp_path = harness
    saved = last_good(tracker)
    replies.append(reply)
    with pytest.raises(ProviderUnavailable):
        await tracker.fetch_team_injuries('364', league_key='premier_league')
    assert_preserved(saved)
    row = export_artifact(tracker, tmp_path)['records'][0]
    assert (row['reason'], row['http_status']) == (reason, status)
    # Opt-in errors do not activate additional retry requests in the tracker.
    assert len(requests) == 1
    tracker.fotmob.get_team_injuries.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize('bad', [None, {}, {'athlete': {}},
    {**VALID, 'status': []}, {**VALID, 'type': []}, {**VALID, 'details': []},
    {**VALID, 'shortComment': {}}, {**VALID, 'athlete': {'id': True}},
])
async def test_malformed_entries_never_publish_a_partial_report(harness, bad):
    tracker, replies, requests, tmp_path = harness
    saved = last_good(tracker)
    replies.append(httpx.Response(200, json={'injuries': [deepcopy(VALID), bad]}))
    with pytest.raises(ProviderUnavailable):
        await tracker.fetch_team_injuries('364', league_key='premier_league')
    assert_preserved(saved)
    assert export_artifact(tracker, tmp_path)['records'][0]['reason'] == 'malformed_entries'
    assert len(requests) == 1
    tracker.fotmob.get_team_injuries.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize('rows', [[], [VALID]])
async def test_only_explicit_valid_reports_can_replace_observations(harness, rows):
    tracker, replies, requests, tmp_path = harness
    saved = last_good(tracker)
    replies.append(httpx.Response(200, json={'injuries': rows}))
    result = await tracker.fetch_team_injuries('364', league_key='premier_league')
    assert len(result) == len(rows)
    data = json.loads(saved[0].read_text())
    assert data['injuries'] == result
    assert data['fetched_at'] != '2026-01-01T00:00:00+00:00'
    assert export_artifact(tracker, tmp_path)['records'][0]['reason'] == 'available'
    assert len(requests) == 1


def cli_args(path):
    return argparse.Namespace(refresh_stale=True, team_id=None, source='espn', league=None, diagnostics_path=path)


@pytest.mark.asyncio
@pytest.mark.parametrize('checkpoint_enabled', [True, False], ids=['checkpoints', 'final-export-only'])
async def test_failed_cli_retains_all_42_legacy_attempts_without_publishing(harness, monkeypatch, checkpoint_enabled):
    tracker, replies, requests, tmp_path = harness
    saved = [last_good(tracker, team) for team in ('364', '360')]
    for path, _, _ in saved:
        payload = json.loads(path.read_text())
        payload.pop('league_key')
        path.write_text(json.dumps(payload))
    saved = [(path, path.read_bytes(), path.stat().st_mtime_ns) for path, _, _ in saved]
    replies.append(httpx.Response(200, json={'unrecognized': PRIVATE}))
    monkeypatch.setattr(injury, 'get_injury_tracker', lambda: tracker)
    if not checkpoint_enabled:
        # Isolate CLI final export; incremental checkpoints must not conceal
        # a missing final write. Checkpoint retention is exercised separately.
        monkeypatch.setattr(InjuryDiagnostics, '_checkpoint', Mock())
    output = tmp_path / 'artifact' / 'injury-diagnostics.json'
    assert await injury._run_cli(cli_args(output)) == 1
    tracker.close.assert_awaited_once()
    for cache in saved:
        assert_preserved(cache)
    data = read_artifact(output)
    assert len(requests) == len(data['records']) == 2 * len(ESPN_LEAGUE_IDS) == 42
    assert {row['reason'] for row in data['records']} == {'missing_injury_content'}
    for team in ('364', '360'):
        assert {row['league_key'] for row in data['records'] if row['team_id'] == team} == set(ESPN_LEAGUE_IDS)
    tracker.fotmob.get_team_injuries.assert_not_awaited()
    assert output.is_file()


@pytest.mark.asyncio
async def test_sidecar_and_artifact_write_failures_do_not_mask_provider_failure(harness, monkeypatch, caplog):
    tracker, replies, _, tmp_path = harness
    saved = last_good(tracker)
    replies.append(httpx.Response(403, text=PRIVATE))
    monkeypatch.setattr(tracker, '_write_status', Mock(side_effect=OSError(PRIVATE)))
    monkeypatch.setattr(injury, 'get_injury_tracker', lambda: tracker)
    output = tmp_path / 'artifact' / 'injury-diagnostics.json'
    assert await injury._run_cli(cli_args(output)) == 1
    reasons = {row['reason'] for row in read_artifact(output)['records']}
    assert {'http_error', 'status_write_error'} <= reasons
    assert_preserved(saved)
    previous_ledger = tracker.diagnostics
    failed_output = tmp_path / 'artifact' / 'failed-injury-diagnostics.json'
    write_failure = Mock(side_effect=OSError(PRIVATE))
    # _run_cli constructs a fresh ledger, so inject on its class rather than
    # the previous invocation's instance. The spy proves the error was raised.
    monkeypatch.setattr(InjuryDiagnostics, 'write', write_failure)
    caplog.clear()
    assert await injury._run_cli(cli_args(failed_output)) == 1
    assert tracker.diagnostics is not previous_ledger
    write_failure.assert_called_with(failed_output)
    assert any(record.message == 'Could not retain injury diagnostics' for record in caplog.records)
    assert not failed_output.exists()
    assert_preserved(saved)


@pytest.mark.asyncio
async def test_initialization_failure_still_exports_only_safe_metadata(tmp_path, monkeypatch):
    monkeypatch.setattr(injury, 'get_injury_tracker', Mock(side_effect=OSError(PRIVATE)))
    output = tmp_path / 'injury-diagnostics.json'
    assert await injury._run_cli(cli_args(output)) == 1
    text = output.read_text()
    assert PRIVATE not in text
    assert json.loads(text)['records'][0]['reason'] == 'initialization_error'


@pytest.mark.asyncio
async def test_cache_write_failure_preserves_previous_observation_and_fails_cli(harness, monkeypatch):
    tracker, replies, _, tmp_path = harness
    saved = last_good(tracker)
    replies.append(httpx.Response(200, json={'injuries': []}))
    monkeypatch.setattr(tracker, '_write_cache', Mock(side_effect=OSError(PRIVATE)))
    monkeypatch.setattr(injury, 'get_injury_tracker', lambda: tracker)
    output = tmp_path / 'artifact' / 'injury-diagnostics.json'
    assert await injury._run_cli(cli_args(output)) == 1
    assert_preserved(saved)
    assert {row['reason'] for row in read_artifact(output)['records']} == {'available', 'cache_write_error'}


@pytest.mark.asyncio
async def test_invalid_cached_timestamp_cannot_leak_into_status_metadata(harness):
    tracker, replies, _, tmp_path = harness
    path, _, _ = last_good(tracker)
    payload = json.loads(path.read_text())
    payload['fetched_at'] = PRIVATE
    path.write_text(json.dumps(payload))
    content, stamp = path.read_bytes(), path.stat().st_mtime_ns
    replies.append(httpx.Response(403, text=PRIVATE))
    with pytest.raises(ProviderUnavailable):
        await tracker.fetch_team_injuries('364', league_key='premier_league')
    assert path.read_bytes() == content and path.stat().st_mtime_ns == stamp
    status = (tracker.data_dir / '364.status.json').read_text()
    assert PRIVATE not in status
    assert json.loads(status)['last_good_fetched_at'] is None
    export_artifact(tracker, tmp_path)


@pytest.mark.asyncio
async def test_cleanup_failure_does_not_make_run_successful_and_retains_metadata(harness, monkeypatch):
    tracker, _, requests, tmp_path = harness
    tracker.diagnostics.record('espn', '999', 'premier_league', 'available')
    tracker.close.side_effect = OSError(PRIVATE)
    monkeypatch.setattr(injury, 'get_injury_tracker', lambda: tracker)
    output = tmp_path / 'artifact' / 'injury-diagnostics.json'
    assert await injury._run_cli(cli_args(output)) == 1
    records = read_artifact(output)['records']
    assert [row['reason'] for row in records] == ['cleanup_error']
    assert requests == []


@pytest.mark.asyncio
async def test_shared_client_default_failure_behavior_is_unchanged(harness):
    tracker, replies, requests, _ = harness
    replies.append(httpx.Response(403, text=PRIVATE))
    assert await tracker.espn._request('eng.1/teams/364/injuries') is None
    assert len(requests) == 1


def test_ledger_bounds_and_filters_untrusted_context(tmp_path):
    ledger = InjuryDiagnostics()
    for _ in range(MAX_RECORDS + 5):
        ledger.record(PRIVATE, PRIVATE, PRIVATE, PRIVATE, PRIVATE, PRIVATE)
    output = tmp_path / 'diagnostics.json'
    ledger.write(output)
    text = output.read_text()
    assert PRIVATE not in text
    report = json.loads(text)
    assert len(report['records']) == MAX_RECORDS
    assert report['dropped_records'] == 5
    assert set(report['records'][0]) == {
        'provider', 'team_id', 'league_key', 'league_slug', 'reason', 'detail', 'http_status', 'checked_at',
    }


def test_checkpoint_retains_completed_attempts_before_cli_finalization(tmp_path):
    ledger = InjuryDiagnostics()
    output = tmp_path / 'diagnostics.json'
    ledger.set_output(output)
    assert json.loads(output.read_text())['records'] == []
    ledger.record('espn', '364', 'premier_league', 'http_error', http_status=429)
    record = json.loads(output.read_text())['records'][0]
    assert record['reason'] == 'http_error' and record['http_status'] == 429


def test_workflow_retains_only_current_metadata_after_provider_failure():
    workflow = yaml.safe_load((ROOT / '.github/workflows/scrape_lineups.yml').read_text())
    steps = workflow['jobs']['scrape-lineups']['steps']
    refresh = next(step for step in steps if step['name'] == 'Refresh stale injury reports')
    commit = next(step for step in steps if step['name'] == 'Commit updated scrape data')
    retain = next(step for step in steps if step['name'] == 'Retain injury provider diagnostics')
    assert '--diagnostics-path "$RUNNER_TEMP/injury-diagnostics.json"' in refresh['run']
    assert not refresh.get('continue-on-error')
    assert commit.get('if', 'success()') == 'success()'
    assert steps.index(commit) < steps.index(retain)
    assert retain['if'] == '${{ always() }}' and retain['continue-on-error'] is True
    assert retain['uses'] == 'actions/upload-artifact@v4'
    assert retain['with']['path'] == '${{ runner.temp }}/injury-diagnostics.json'
    assert retain['with']['retention-days'] == 7
    assert retain['with']['if-no-files-found'] == 'warn'
    assert 'injury-diagnostics' not in commit['run']
