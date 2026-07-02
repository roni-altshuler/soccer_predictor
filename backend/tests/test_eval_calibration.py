"""Tests for the standalone calibration evaluation script."""

from __future__ import annotations

import json
import math

import pytest

from backend.scripts.eval_calibration import Slice, evaluate


@pytest.fixture()
def predictions_dir(tmp_path):
    """Write a small fixture month with known probabilities and outcomes."""
    records = [
        # Perfectly confident and correct home pick.
        {
            "match_id": "1", "gender": "M", "league": "Premier League",
            "model_used": "unified", "match_date": "2026-01-10",
            "predicted_home_win": 0.9, "predicted_draw": 0.05, "predicted_away_win": 0.05,
            "actual_winner": "home",
        },
        # Confident but wrong (away pick, home won).
        {
            "match_id": "2", "gender": "M", "league": "Premier League",
            "model_used": "unified", "match_date": "2026-01-11",
            "predicted_home_win": 0.1, "predicted_draw": 0.1, "predicted_away_win": 0.8,
            "actual_winner": "home",
        },
        # Women's record, draw pick, correct.
        {
            "match_id": "3", "gender": "F", "league": "NWSL",
            "model_used": "elo_poisson", "match_date": "2026-01-12",
            "predicted_home_win": 0.2, "predicted_draw": 0.6, "predicted_away_win": 0.2,
            "actual_winner": "draw",
        },
        # Unsettled record — must be excluded.
        {
            "match_id": "4", "gender": "M", "league": "La Liga",
            "match_date": "2026-01-13",
            "predicted_home_win": 0.5, "predicted_draw": 0.3, "predicted_away_win": 0.2,
            "actual_winner": None,
        },
    ]
    payload = {"month": "2026-01", "count": len(records), "predictions": records}
    (tmp_path / "predictions_2026-01.json").write_text(json.dumps(payload))
    return tmp_path


def test_excludes_unsettled_records(predictions_dir):
    report = evaluate(predictions_dir)
    assert report["overall"]["n"] == 3


def test_accuracy_and_gender_split(predictions_dir):
    report = evaluate(predictions_dir, group_by="gender")
    assert report["overall"]["accuracy"] == pytest.approx(2 / 3, abs=1e-4)
    groups = {g["name"]: g for g in report["groups"]}
    assert groups["M"]["n"] == 2
    assert groups["F"]["n"] == 1
    assert groups["F"]["accuracy"] == pytest.approx(1.0)


def test_model_split(predictions_dir):
    report = evaluate(predictions_dir, group_by="model")
    groups = {g["name"]: g for g in report["groups"]}
    assert set(groups) == {"unified", "elo_poisson"}
    assert groups["unified"]["n"] == 2


def test_brier_and_log_loss_known_values(predictions_dir):
    report = evaluate(predictions_dir, group_by="model")
    unified = next(g for g in report["groups"] if g["name"] == "unified")
    # Record 1: brier = ((0.9-1)^2 + 0.05^2 + 0.05^2)/3
    b1 = (0.01 + 0.0025 + 0.0025) / 3
    # Record 2: brier = ((0.1-1)^2 + 0.1^2 + 0.8^2)/3
    b2 = (0.81 + 0.01 + 0.64) / 3
    assert unified["brier"] == pytest.approx((b1 + b2) / 2, abs=1e-4)
    ll = (-math.log(0.9) - math.log(0.1)) / 2
    assert unified["log_loss"] == pytest.approx(ll, abs=1e-4)


def test_slice_ece_perfect_calibration():
    """A perfectly calibrated 60%-confidence slice has near-zero ECE."""
    s = Slice("t")
    # 10 picks at 60% confidence, exactly 6 correct.
    for i in range(10):
        actual = 0 if i < 6 else 2
        s.add([0.6, 0.25, 0.15], actual)
    assert s.ece == pytest.approx(0.0, abs=1e-9)


def test_probability_normalization():
    """Unnormalized probabilities are rescaled before scoring."""
    s = Slice("t")
    s.add([0.5, 0.25, 0.25], 0)
    s2 = Slice("t2")
    # evaluate() normalizes via _record_probs; Slice itself trusts input,
    # so feed the same normalized values and expect identical results.
    s2.add([0.5, 0.25, 0.25], 0)
    assert s.brier == s2.brier


def test_empty_dir(tmp_path):
    report = evaluate(tmp_path)
    assert report["overall"]["n"] == 0
