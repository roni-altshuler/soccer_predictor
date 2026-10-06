"""Offline legacy routing, explicit-context precedence and identity provenance."""
from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys

import httpx
import pytest

from backend.services.data.injury_routing import DEFAULT_ROUTES_PATH, resolve_injury_league
from backend.services.data.provider_status import ProviderUnavailable
from backend.tests.test_injury_diagnostics import (
    PRIVATE, ROOT, assert_preserved, cli_args, harness, last_good, read_artifact,
)
from backend.services.data import injury_tracker as injury


def legacy_cache(tracker, team='364', source='espn'):
    path, _, _ = last_good(tracker, team, source)
    data = json.loads(path.read_text())
    data.pop('league_key')
    path.write_text(json.dumps(data))
    return path, path.read_bytes(), path.stat().st_mtime_ns


@pytest.mark.asyncio
@pytest.mark.parametrize('case,detail', [
    ('missing', 'missing_league_mapping'),
    ('conflict', 'conflicting_league_mapping'),
    ('duplicate', 'conflicting_league_mapping'),
    ('other_provider', 'missing_league_mapping'),
    ('unsupported', 'unsupported_league_mapping'),
    ('slug_mismatch', 'unsupported_league_mapping'),
    ('bad_root', 'invalid_routing_evidence'),
    ('bad_routes', 'invalid_routing_evidence'),
    ('bad_row', 'invalid_routing_evidence'),
    ('bad_identity', 'invalid_routing_evidence'),
    ('bad_provenance', 'invalid_routing_evidence'),
    ('bad_json', 'invalid_routing_evidence'),
    ('missing_file', 'invalid_routing_evidence'),
    ('duplicate_json_key', 'invalid_routing_evidence'),
])
async def test_unavailable_mapping_never_probes_or_falls_back(harness, monkeypatch, case, detail):
    tracker, _, requests, tmp_path = harness
    saved = legacy_cache(tracker)
    document = json.loads(DEFAULT_ROUTES_PATH.read_text())
    document['routes'] = [deepcopy(document['routes'][0])]
    row = document['routes'][0]
    if case == 'missing':
        document['routes'] = []
    elif case in ('conflict', 'duplicate'):
        second = deepcopy(row)
        if case == 'conflict':
            second.update(league_key='la_liga', league_slug='esp.1')
        document['routes'].append(second)
    elif case == 'other_provider':
        row['provider'] = 'fotmob'
    elif case == 'unsupported':
        row['league_key'] = PRIVATE
    elif case == 'slug_mismatch':
        row['league_slug'] = 'esp.1'
    elif case == 'bad_root':
        document = []
    elif case == 'bad_routes':
        document['routes'] = None
    elif case == 'bad_row':
        document['routes'] = [PRIVATE]
    elif case == 'bad_identity':
        row['team_id'] = True
    elif case == 'bad_provenance':
        document['provenance']['sha256'] = PRIVATE
    routes = tmp_path / 'routes.json'
    if case != 'missing_file':
        text = PRIVATE if case == 'bad_json' else json.dumps(document)
        if case == 'duplicate_json_key':
            text = text.replace('"schema_version": 1', '"schema_version": 1, "schema_version": 1')
        routes.write_text(text)
    tracker.routes_path = routes
    monkeypatch.setattr(injury, 'get_injury_tracker', lambda: tracker)
    output = tmp_path / 'cli-diagnostics.json'
    assert await injury._run_cli(cli_args(output)) == 1
    assert requests == []
    tracker._pace.assert_not_awaited()
    tracker.fotmob.get_team_injuries.assert_not_awaited()
    assert_preserved(saved)
    record = read_artifact(output)['records'][0]
    assert (record['reason'], record['detail']) == ('invalid_context', detail)
    assert record['provider'] == 'espn' and record['team_id'] == '364'
    assert record['league_key'] is None and record['http_status'] is None
    status = json.loads((tracker.data_dir / '364.status.json').read_text())
    assert status['availability'] == 'unavailable'
    assert status['last_good_fetched_at'] == '2026-01-01T00:00:00+00:00'


@pytest.mark.asyncio
@pytest.mark.parametrize('team,detail', [('999', 'missing_league_mapping'),
    ('0364', 'invalid_team_identity'), ('0', 'invalid_team_identity')])
async def test_unknown_or_noncanonical_legacy_identity_is_unavailable(harness, team, detail):
    tracker, _, requests, _ = harness
    saved = legacy_cache(tracker, team)
    with pytest.raises(ProviderUnavailable):
        await tracker.refresh_stale()
    assert requests == []
    assert_preserved(saved)
    assert tracker.diagnostics.records[0]['detail'] == detail
    tracker.fotmob.get_team_injuries.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize('caller,cached,slug', [(None, 'premier_league', 'eng.1'),
    ('la_liga', 'premier_league', 'esp.1'), (None, 'la_liga', 'esp.1')])
async def test_explicit_context_is_preserved_without_loading_manifest(harness, caller, cached, slug):
    tracker, replies, requests, tmp_path = harness
    path, _, _ = last_good(tracker)
    payload = json.loads(path.read_text())
    payload['league_key'] = cached
    path.write_text(json.dumps(payload))
    saved = path, path.read_bytes(), path.stat().st_mtime_ns
    tracker.routes_path = tmp_path / 'absent-manifest.json'
    replies.append(httpx.Response(200, json={'unrecognized': PRIVATE}))
    with pytest.raises(ProviderUnavailable):
        await tracker.fetch_team_injuries('364', league_key=caller)
    assert [request.url.path for request in requests] == [f'/apis/site/v2/sports/soccer/{slug}/teams/364/injuries']
    assert_preserved(saved)
    assert tracker.diagnostics.records[0]['league_slug'] == slug
    assert tracker.diagnostics.records[0]['reason'] == 'missing_injury_content'
    tracker.fotmob.get_team_injuries.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize('context', ['', 'eng.1', PRIVATE, True, [], 5])
async def test_unsupported_cached_explicit_context_is_not_replaced(harness, context):
    tracker, _, requests, _ = harness
    path, _, _ = last_good(tracker)
    payload = json.loads(path.read_text())
    payload['league_key'] = context
    path.write_text(json.dumps(payload))
    saved = path, path.read_bytes(), path.stat().st_mtime_ns
    with pytest.raises(ProviderUnavailable):
        await tracker.refresh_stale()
    assert requests == []
    assert_preserved(saved)
    assert tracker.diagnostics.records[0]['detail'] == 'unknown_league'


@pytest.mark.asyncio
async def test_same_numeric_fotmob_id_does_not_use_espn_binding(harness):
    tracker, _, requests, _ = harness
    saved = legacy_cache(tracker, source='fotmob')
    tracker.fotmob.get_team_injuries.return_value = None
    with pytest.raises(ProviderUnavailable):
        await tracker.refresh_stale()
    assert requests == []
    tracker.fotmob.get_team_injuries.assert_awaited_once_with(364)
    assert_preserved(saved)
    assert tracker.diagnostics.records[0]['provider'] == 'fotmob'
    assert tracker.diagnostics.records[0]['league_key'] is None


@pytest.mark.asyncio
@pytest.mark.parametrize('field,value,detail', [('source', None, 'unknown_provider'),
    ('source', PRIVATE, 'unknown_provider'), ('source', {}, 'unknown_provider'),
    ('team_id', '360', 'invalid_team_identity'), ('team_id', True, 'invalid_team_identity'),
    ('team_id', 364, 'invalid_team_identity'), ('team_id', None, 'invalid_team_identity')])
async def test_cached_identity_cannot_guess_provider_or_retarget_another_file(harness, field, value, detail):
    tracker, _, requests, _ = harness
    path, _, _ = legacy_cache(tracker)
    payload = json.loads(path.read_text())
    if field == 'source' and value is None:
        payload.pop(field)
    else:
        payload[field] = value
    path.write_text(json.dumps(payload))
    saved = path, path.read_bytes(), path.stat().st_mtime_ns
    with pytest.raises(ProviderUnavailable):
        await tracker.refresh_stale()
    assert requests == []
    assert_preserved(saved)
    assert tracker.diagnostics.records[0]['reason'] == 'invalid_context'
    assert tracker.diagnostics.records[0]['detail'] == detail
    tracker.fotmob.get_team_injuries.assert_not_awaited()


@pytest.mark.asyncio
async def test_valid_mapped_report_records_resolved_context(harness):
    tracker, replies, requests, _ = harness
    legacy_cache(tracker)
    replies.append(httpx.Response(200, json={'injuries': []}))
    assert await tracker.refresh_stale() == 1
    data = json.loads(tracker._cache_path('364').read_text())
    assert data['league_key'] == 'premier_league'
    assert len(requests) == 1 and data['injuries'] == []


def test_reviewed_routes_match_unique_current_repository_identity_evidence():
    manifest = json.loads(DEFAULT_ROUTES_PATH.read_text())
    evidence = json.loads((ROOT / manifest['provenance']['path']).read_text())
    for route in manifest['routes']:
        matches = [(name, competition['espn_league_slug'])
            for competition in evidence['competitions'].values()
            for name, row in competition['teams'].items()
            if row['espn_team_id'] == route['team_id']]
        assert matches == [(route['team_name'], route['league_slug'])]
        assert route['provider'] == 'espn'
        assert resolve_injury_league(route['provider'], route['team_id']) == route['league_key']


def test_routing_lookup_has_no_numerical_or_prediction_runtime_dependencies():
    code = '''
import importlib.abc, sys
class BlockML(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split('.')[0] in {'numpy','pandas','scipy','sklearn','torch','xgboost','lightgbm','penaltyblog'} or fullname.startswith('backend.services.prediction'):
            raise ImportError('Unexpected model dependency')
sys.meta_path.insert(0, BlockML())
from backend.services.data.injury_routing import resolve_injury_league
assert resolve_injury_league('espn', '364') == 'premier_league'
assert resolve_injury_league('espn', '360') == 'premier_league'
'''
    result = subprocess.run([sys.executable, '-c', code], cwd=ROOT, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
