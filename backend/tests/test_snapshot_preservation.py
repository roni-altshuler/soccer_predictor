from dataclasses import replace
import gzip
import pytest

from backend.scripts.export_snapshots import main, verify_preserved
from backend.scripts.import_snapshots import parse
from backend.services.forecast.snapshots import Snapshot, SnapshotStore


def test_export_refuses_lost_or_changed_history_and_preserves_output(tmp_path):
    db = tmp_path / 'history.sqlite'
    old, output = tmp_path / 'previous.csv.gz', tmp_path / 'output.csv.gz'
    row = Snapshot(fixture_uid='a', generated_at='2026-08-01T00:00:00Z', model_version='v1',
                   competition_id='eng.1', season=2026, kickoff_at='2026-08-20T12:00:00Z',
                   home_team='A', away_team='B', p_home=.5, p_draw=.3, p_away=.2,
                   lambda_home=1.5, lambda_away=1.0)
    with SnapshotStore(db) as store:
        store.record([row])
    assert main(['--database', str(db), '--output', str(old)]) == 0
    output.write_bytes(b'previous good export')
    empty = tmp_path / 'empty.sqlite'
    with pytest.raises(ValueError, match='lost or changed'):
        main(['--database', str(empty), '--output', str(output), '--previous-input', str(old)])
    assert output.read_bytes() == b'previous good export'
    with SnapshotStore(db) as store:
        store.record([replace(row, fixture_uid='b')])
    assert main(['--database', str(db), '--output', str(output), '--previous-input', str(old)]) == 0
    assert len(parse(output)) == 2
    changed = tmp_path / 'changed.sqlite'
    with SnapshotStore(changed) as store:
        store.record([replace(row, p_home=.4, p_away=.3)])
    assert main(['--database', str(changed), '--output', str(tmp_path / 'changed.gz')]) == 0
    with pytest.raises(ValueError, match='lost or changed'):
        verify_preserved(old, tmp_path / 'changed.gz')


def test_invalid_header_is_not_an_empty_valid_history(tmp_path):
    path = tmp_path / 'empty.csv.gz'
    with gzip.open(path, 'wt') as f:
        f.write('invalid,header\n')
    with pytest.raises(ValueError, match='missing'):
        parse(path)
