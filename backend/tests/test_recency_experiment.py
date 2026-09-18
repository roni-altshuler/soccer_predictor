import numpy as np
import pytest
from backend.scripts.experiment_recency import recency_weights, week_bootstrap


def test_decay_halves_weight_each_half_life_and_preserves_scale():
    days = np.array(['2022-01-01', '2023-01-01'], dtype='datetime64[D]')
    weights = recency_weights(days, np.datetime64('2024-01-01'), 365)
    assert weights[1] / weights[0] == pytest.approx(2)
    assert weights.mean() == pytest.approx(1)


def test_training_cutoff_excludes_same_day_and_future_results():
    with pytest.raises(ValueError, match='precede'):
        recency_weights(np.array(['2024-01-01'], dtype='datetime64[D]'), np.datetime64('2024-01-01'), 365)


def test_week_bootstrap_preserves_pairing_and_week_clusters():
    p = np.array([[0.6, 0.2, 0.2], [0.2, 0.2, 0.6], [0.2, 0.6, 0.2]])
    days = np.array(['2024-01-01', '2024-01-07', '2024-01-08'], dtype='datetime64[D]')
    result = week_bootstrap(p, p, np.array([0, 2, 1]), days, draws=130)
    assert result['weeks'] == 2
    assert result['ci_low'] == result['ci_high'] == result['delta_brier'] == 0


def test_known_improvement_has_negative_delta():
    good = np.tile([0.9, 0.05, 0.05], (20, 1))
    bad = np.tile([0.1, 0.1, 0.8], (20, 1))
    days = np.arange('2024-01-01', '2024-01-21', dtype='datetime64[D]')
    result = week_bootstrap(good, bad, np.zeros(20, dtype=int), days)
    assert result['ci_high'] < 0


def test_chunked_legacy_bootstrap_keeps_original_rng_results():
    from backend.scripts.baseline_walkforward import paired_bootstrap
    rng = np.random.default_rng(3)
    a, b = rng.dirichlet([1, 1, 1], 100), rng.dirichlet([1, 1, 1], 100)
    y = rng.integers(0, 3, 100)
    delta = ((a - np.eye(3)[y]) ** 2).sum(1) - ((b - np.eye(3)[y]) ** 2).sum(1)
    expected = delta[np.random.default_rng(17).integers(0, 100, (130, 100))].mean(1)
    result = paired_bootstrap(a, b, y, n=130)
    assert result['ci_low'] == pytest.approx(np.percentile(expected, 2.5))
    assert result['ci_high'] == pytest.approx(np.percentile(expected, 97.5))
