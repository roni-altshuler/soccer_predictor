"""Provider collisions, explicit permission and cache integrity; no provider calls."""
from copy import deepcopy
import hashlib
import io
import json
from pathlib import Path
from unittest.mock import Mock

from PIL import Image
import pytest

from backend.scripts import fetch_player_headshots as fetcher
from backend.services.data import player_portraits as policy

CONTRACT = json.loads((Path(__file__).parent / 'fixtures/portraits/contract.json').read_text())


@pytest.mark.parametrize('case', CONTRACT['cases'], ids=lambda case: case['name'])
def test_shared_portrait_contract(case):
    assert bool(policy.approved_portrait(case['identity'], case['entry'])) is case['valid']


@pytest.fixture
def local(tmp_path, monkeypatch):
    monkeypatch.setattr(fetcher, 'PUBLIC_HEADSHOT_DIR', tmp_path)
    monkeypatch.setattr(fetcher, 'MANIFEST_PATH', tmp_path / 'manifest.json')
    monkeypatch.setattr(fetcher.time, 'sleep', lambda _: None)
    return tmp_path


def approval(provider='espn', identifier='123'):
    row = deepcopy(CONTRACT['cases'][0]['entry'])
    row['subject'] = row['asset'] = {'provider': provider, 'id': identifier}
    row['source_url'] = policy.SOURCE_TEMPLATES[provider].format(identifier)
    row.pop('path'); row.pop('sha256')
    return row


def png(color='red'):
    out = io.BytesIO()
    Image.new('RGB', (2, 2), color).save(out, format='PNG')
    return out.getvalue()


def response(content=None, status=200):
    return Mock(status_code=status, headers={'Content-Type': 'image/png'}, content=content or png())


@pytest.mark.parametrize('force', [False, True])
@pytest.mark.parametrize('records', [{}, {'espn:123': {'rights': {'status': 'unknown'}}}])
def test_missing_approval_never_fetches_or_promotes_legacy_cache(local, monkeypatch, records, force):
    legacy = local / '123.webp'; legacy.write_bytes(b'unknown old portrait')
    manifest = local / 'manifest.json'; manifest.write_text('{"123":"/headshots/123.webp"}')
    before = manifest.read_bytes(), manifest.stat().st_mtime_ns, legacy.read_bytes(), legacy.stat().st_mtime_ns
    get = Mock(); monkeypatch.setattr(fetcher.requests, 'get', get)
    fetcher.fetch_all(['espn:123'], force=force, approvals=records)
    assert before == (manifest.read_bytes(), manifest.stat().st_mtime_ns, legacy.read_bytes(), legacy.stat().st_mtime_ns)
    get.assert_not_called()


@pytest.mark.parametrize('key', ['123', 'unknown:123', 'espn:../123', 'espn:00123'])
def test_unqualified_or_ambiguous_id_is_rejected_before_requests(local, monkeypatch, key):
    get = Mock(); monkeypatch.setattr(fetcher.requests, 'get', get)
    with pytest.raises(ValueError): fetcher.fetch_all([key])
    get.assert_not_called()
    assert list(local.iterdir()) == []


def test_colliding_ids_fetch_only_their_own_provider_and_keep_separate_cache(local, monkeypatch):
    get = Mock(side_effect=[response(png('red')), response(png('blue'))])
    monkeypatch.setattr(fetcher.requests, 'get', get)
    entries = {'espn:123': approval(), 'fotmob:123': approval('fotmob')}
    manifest = fetcher.fetch_all(entries, approvals=entries)
    assert [call.args[0] for call in get.call_args_list] == [entries[key]['source_url'] for key in entries]
    assert all(call.kwargs['allow_redirects'] is False for call in get.call_args_list)
    for key in entries:
        identity = policy.parse_identity(key)
        assert policy.cached_portrait(identity, manifest, local) == manifest[key]
        assert manifest[key]['path'].startswith(f'/headshots/{identity["provider"]}/')
    get.reset_mock()
    stamp = (local / 'manifest.json').stat().st_mtime_ns
    assert fetcher.fetch_all(entries, approvals=entries) == manifest
    get.assert_not_called()
    assert (local / 'manifest.json').stat().st_mtime_ns == stamp


def test_failed_provider_is_not_retried_under_another_namespace(local, monkeypatch):
    get = Mock(return_value=response(status=404)); monkeypatch.setattr(fetcher.requests, 'get', get)
    assert fetcher.fetch_all(['espn:123'], approvals={'espn:123': approval()}) == {}
    get.assert_called_once()
    assert get.call_args.args[0] == policy.SOURCE_TEMPLATES['espn'].format('123')
    assert list(local.iterdir()) == []


def test_verified_crosswalk_uses_asset_id_not_subject_digits(local, monkeypatch):
    row = deepcopy(next(case['entry'] for case in CONTRACT['cases'] if case['name'] == 'explicit verified crosswalk'))
    get = Mock(return_value=response()); monkeypatch.setattr(fetcher.requests, 'get', get)
    fetcher.fetch_all(['espn:123'], approvals={'espn:123': row})
    assert get.call_args.args[0] == policy.SOURCE_TEMPLATES['fotmob'].format('456')


def test_refresh_retains_previous_asset_and_failed_manifest_write_preserves_cache(local, monkeypatch):
    get = Mock(side_effect=[response(png('red')), response(png('blue'))]); monkeypatch.setattr(fetcher.requests, 'get', get)
    manifest = fetcher.fetch_all(['espn:123'], approvals={'espn:123': approval()})
    old_asset = local / manifest['espn:123']['path'].removeprefix('/headshots/')
    old_bytes, stamp = old_asset.read_bytes(), old_asset.stat().st_mtime_ns
    path = local / 'manifest.json'; previous = path.read_bytes(), path.stat().st_mtime_ns
    monkeypatch.setattr(fetcher, 'write_json_atomic', Mock(side_effect=OSError('failed write')))
    with pytest.raises(OSError): fetcher.fetch_all(['espn:123'], force=True, approvals={'espn:123': approval()})
    assert (old_asset.read_bytes(), old_asset.stat().st_mtime_ns) == (old_bytes, stamp)
    assert (path.read_bytes(), path.stat().st_mtime_ns) == previous
    assert policy.cached_portrait({'provider':'espn','id':'123'}, manifest, local)


def test_wrong_cached_bytes_or_provider_never_establish_subject(local):
    entry = deepcopy(CONTRACT['cases'][0]['entry'])
    target = local / entry['path'].removeprefix('/headshots/'); target.parent.mkdir()
    target.write_bytes(b'wrong bytes')
    assert policy.cached_portrait(entry['subject'], {'espn:123': entry}, local) is None
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    valid_path = target.parent / f'123-{digest}.webp'; valid_path.write_bytes(target.read_bytes())
    entry.update(sha256=digest, path=f'/headshots/espn/{valid_path.name}')
    assert policy.cached_portrait(entry['subject'], {'espn:123': entry}, local)
    assert policy.cached_portrait({'provider':'fotmob','id':'123'}, {'fotmob:123': entry}, local) is None


def test_malformed_manifest_is_preserved(local, monkeypatch):
    path = local / 'manifest.json'; path.write_bytes(b'not json')
    get = Mock(); monkeypatch.setattr(fetcher.requests, 'get', get)
    with pytest.raises(ValueError): fetcher.fetch_all(['espn:123'], approvals={'espn:123': approval()})
    get.assert_not_called()
    assert path.read_bytes() == b'not json'
