"""Tests for the shared calibration module: fitting, application, and
backward compatibility with legacy per-class-isotonic calibrator pickles."""

from __future__ import annotations

import numpy as np
import pytest
from sklearn.isotonic import IsotonicRegression

from backend.services.prediction.calibration import (
    CALIBRATION_KIND_V2,
    apply_calibration,
    ece_10bin,
    fit_calibration,
    fit_temperature,
    is_v2_calibration,
    softmax,
)


def _synthetic_split(n: int = 4000, seed: int = 0, overconfidence: float = 2.0):
    """Simulate an overconfident model: logits scaled up by `overconfidence`
    relative to the true generative distribution, plus a PMF view that is a
    noisy but honest copy of the truth."""
    rng = np.random.default_rng(seed)
    true_logits = rng.normal(0.0, 1.0, size=(n, 3))
    true_probs = softmax(true_logits)
    targets = np.array([rng.choice(3, p=p) for p in true_probs])
    logits = true_logits * overconfidence  # overconfident head
    pmf_probs = softmax(true_logits + rng.normal(0.0, 0.3, size=(n, 3)))
    return logits, pmf_probs, targets


def test_rows_sum_to_one_all_formats():
    logits, pmf_probs, targets = _synthetic_split(200)
    legacy_iso = {
        name: IsotonicRegression(out_of_bounds="clip", y_min=1e-4, y_max=1 - 1e-4).fit(
            np.linspace(0, 1, 50), np.linspace(0, 1, 50)
        )
        for name in ("home_win", "draw", "away_win")
    }
    v2 = fit_calibration(logits, pmf_probs, targets)
    for calibration in (None, legacy_iso, v2):
        out = apply_calibration(logits, pmf_probs, calibration)
        assert out.shape == (200, 3)
        np.testing.assert_allclose(out.sum(axis=-1), 1.0, atol=1e-9)
        assert (out >= 0).all()


def test_legacy_identity_isotonic_matches_5050_blend():
    """Identity isotonic maps must reproduce the raw legacy 50/50 blend."""
    logits, pmf_probs, _ = _synthetic_split(100)
    identity = {
        name: IsotonicRegression(out_of_bounds="clip", y_min=1e-4, y_max=1 - 1e-4).fit(
            np.linspace(0, 1, 200), np.linspace(0, 1, 200)
        )
        for name in ("home_win", "draw", "away_win")
    }
    raw = apply_calibration(logits, pmf_probs, None)
    via_identity = apply_calibration(logits, pmf_probs, identity)
    np.testing.assert_allclose(raw, via_identity, atol=2e-2)


def test_fit_temperature_recovers_overconfidence():
    """Head logits scaled 2x should fit a temperature near 2."""
    logits, _, targets = _synthetic_split(8000, overconfidence=2.0)
    t = fit_temperature(logits, targets)
    assert 1.6 < t < 2.5


def test_fit_calibration_returns_v2_and_improves_metrics():
    logits, pmf_probs, targets = _synthetic_split(6000)
    calibration = fit_calibration(logits, pmf_probs, targets)
    assert is_v2_calibration(calibration)
    assert calibration["kind"] == CALIBRATION_KIND_V2
    assert 0.0 <= calibration["alpha"] <= 1.0
    assert calibration["temperature"] > 0

    before = apply_calibration(logits, pmf_probs, None)
    after = apply_calibration(logits, pmf_probs, calibration)

    def nll(p):
        return -np.log(p[np.arange(len(targets)), targets].clip(1e-12)).mean()

    # Fitted on this split, so it must not be worse on it.
    assert nll(after) <= nll(before) + 1e-9
    assert ece_10bin(after, targets) <= ece_10bin(before, targets) + 0.01


def test_v2_without_isotonic_applies_temperature_and_alpha():
    logits = np.array([[2.0, 0.0, -2.0]])
    pmf_probs = np.array([[1 / 3, 1 / 3, 1 / 3]])
    calibration = {
        "kind": CALIBRATION_KIND_V2,
        "temperature": 2.0,
        "alpha": 1.0,
        "isotonic": None,
    }
    out = apply_calibration(logits, pmf_probs, calibration)
    expected = softmax(logits, 2.0)
    np.testing.assert_allclose(out, expected, atol=1e-12)

    # alpha=0 must ignore the head entirely.
    calibration["alpha"] = 0.0
    out = apply_calibration(logits, pmf_probs, calibration)
    np.testing.assert_allclose(out, pmf_probs, atol=1e-12)


def test_ece_perfectly_calibrated_is_low():
    rng = np.random.default_rng(1)
    logits = rng.normal(0, 1, size=(20000, 3))
    probs = softmax(logits)
    targets = np.array([rng.choice(3, p=p) for p in probs])
    assert ece_10bin(probs, targets) < 0.02
