from argparse import Namespace
import asyncio

import pytest

from backend.scripts import continuous_training as ct


@pytest.fixture
def paths(tmp_path, monkeypatch):
    for name in ('MODEL_DIR', 'SNAPSHOT_DIR', 'QUARANTINE_DIR', 'DIAGNOSTICS_DIR'):
        path = tmp_path / name
        path.mkdir()
        monkeypatch.setattr(ct, name, path)
    monkeypatch.setattr(ct, 'LAST_RUN_PATH', tmp_path / 'last.json')
    return tmp_path


def model(path, value):
    path.mkdir(parents=True, exist_ok=True)
    (path / 'weights').write_text(value)


def test_rejected_first_model_is_removed_from_serving_path(paths):
    model(ct.MODEL_DIR / 'eng.1', 'rejected')
    result = ct.enforce_promotion_gate({'leagues': [{'runtime_key': 'eng.1', 'decision': 'held_back'}]})
    assert result['no_prior_artifact'] == ['eng.1']
    assert not (ct.MODEL_DIR / 'eng.1').exists()
    assert next(ct.QUARANTINE_DIR.glob('*/eng.1/weights')).read_text() == 'rejected'


def test_incumbent_restored_and_rejected_candidate_quarantined(paths):
    model(ct.MODEL_DIR / 'eng.1', 'incumbent')
    ct.snapshot_production_models(['eng.1'])
    model(ct.MODEL_DIR / 'eng.1', 'rejected')
    assert ct.restore_production_model('eng.1') == 'restored'
    assert (ct.MODEL_DIR / 'eng.1/weights').read_text() == 'incumbent'
    assert next(ct.QUARANTINE_DIR.glob('*/eng.1/weights')).read_text() == 'rejected'


def test_global_routing_policy_rolls_back_with_weights(paths):
    policy = ct.MODEL_DIR / 'model_selection.json'
    policy.write_text('{"mode":"incumbent"}')
    model(ct.MODEL_DIR / 'global', 'incumbent')
    ct.snapshot_production_models(['global'])
    model(ct.MODEL_DIR / 'global', 'candidate')
    policy.write_text('{"mode":"candidate"}')
    assert ct.restore_production_model('global') == 'restored'
    assert policy.read_text() == '{"mode":"incumbent"}'


def test_abort_recovery_includes_first_time_candidates(paths):
    ct.snapshot_production_models(['eng.1'])
    model(ct.MODEL_DIR / 'eng.1', 'unevaluated')
    assert ct.recover_snapshot_candidates() == ['eng.1']
    assert not (ct.MODEL_DIR / 'eng.1').exists()
    assert not ct.SNAPSHOT_DIR.exists()


def test_failed_recovery_keeps_snapshot_and_blocks_new_training(paths, monkeypatch):
    model(ct.MODEL_DIR / 'eng.1', 'incumbent')
    ct.snapshot_production_models(['eng.1'])
    model(ct.MODEL_DIR / 'eng.1', 'candidate')
    monkeypatch.setattr(ct, 'restore_production_model', lambda key: 'failed')
    ct.recover_snapshot_candidates()
    assert (ct.SNAPSHOT_DIR / 'eng.1/weights').read_text() == 'incumbent'
    with pytest.raises(RuntimeError, match='unresolved'):
        ct.snapshot_production_models(['eng.1'])


def test_failed_restore_never_reinstates_rejected_candidate(paths, monkeypatch):
    model(ct.MODEL_DIR / 'eng.1', 'rejected')
    model(ct.SNAPSHOT_DIR / 'eng.1', 'incumbent')
    def fail(*args, **kwargs):
        raise OSError('disk full')
    monkeypatch.setattr(ct.shutil, 'copytree', fail)
    assert ct.restore_production_model('eng.1') == 'failed'
    assert not (ct.MODEL_DIR / 'eng.1').exists()
    assert (ct.SNAPSHOT_DIR / 'eng.1/weights').read_text() == 'incumbent'


def test_snapshot_failure_aborts_before_training(paths, monkeypatch):
    model(ct.MODEL_DIR / 'eng.1', 'incumbent')
    def fail(*args, **kwargs):
        raise OSError('disk full')
    monkeypatch.setattr(ct.shutil, 'copytree', fail)
    with pytest.raises(RuntimeError, match='Cannot safely train'):
        ct.snapshot_production_models(['eng.1'])
    assert (ct.MODEL_DIR / 'eng.1/weights').read_text() == 'incumbent'


@pytest.mark.parametrize('before', [None, {}, {'accuracy_mean': 0.6},
    {'accuracy_mean': 0.5, 'brier_mean': float('nan'), 'log_loss_mean': 1.0}])
def test_missing_or_nonfinite_evidence_holds_candidate(before):
    after = {'accuracy_mean': 0.6, 'brier_mean': 0.5, 'log_loss_mean': 0.9}
    row = ct._classify_league('premier_league', after, before, {})
    assert row['decision'] == 'held_back'
    assert row['evidence_missing']


def test_evaluation_error_is_held_back():
    report = ct.build_drift_report(['eng.1'], {'premier_league': ct.LeagueEval('premier_league', {}, 'failed')}, None, {})
    assert report['leagues'][0]['decision'] == 'held_back'


@pytest.mark.parametrize('skip_eval,rollback', [(True, True), (False, False)])
def test_training_cannot_bypass_gate(paths, skip_eval, rollback):
    args = Namespace(force=True, eval_only=False, skip_eval=skip_eval, rollback=rollback)
    assert asyncio.run(ct.run_pipeline(args)) == 1


def test_failed_eval_only_run_preserves_pending_recovery(paths, monkeypatch):
    model(ct.MODEL_DIR / 'eng.1', 'incumbent')
    ct.snapshot_production_models(['eng.1'])
    def fail(keys):
        raise RuntimeError('evaluation unavailable')
    monkeypatch.setattr(ct, 'run_walkforward', fail)
    args = Namespace(force=True, eval_only=True, skip_eval=False, rollback=True, leagues=None)
    assert asyncio.run(ct.run_pipeline(args)) == 1
    assert (ct.SNAPSHOT_DIR / 'eng.1/weights').read_text() == 'incumbent'
