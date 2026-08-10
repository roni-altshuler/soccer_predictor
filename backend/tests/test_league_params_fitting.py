"""`league_params.json` must stay a measured artifact, not a drifting one.

The three parameters here — per-side expected goals, the goal-scale home
advantage, and the draw share — are directly observable. They were nonetheless
"learned" by adding a fraction of the last run's error on every pipeline run
and clamping the result, which is a random walk with absorbing barriers. By
2026-08-10 all fourteen leagues sat on a clamp; the Premier League was serving
`avg_goals` 0.75 and `home_adv` 0.05 to the `/predict` page.

These tests fail if either the drift returns or the committed values stop
looking like football.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.scripts.fit_league_params import BOUNDS, MIN_SAMPLE, _fit_one

PARAMS_PATH = Path(__file__).resolve().parents[1] / "data" / "league_params.json"

# The five leagues the product actually serves.
WAVE_A = ("eng.1", "esp.1", "ger.1", "ita.1", "fra.1")


@pytest.fixture(scope="module")
def leagues() -> dict:
    return json.loads(PARAMS_PATH.read_text())["leagues"]


@pytest.mark.parametrize("key", WAVE_A)
def test_no_wave_a_parameter_sits_on_a_clamp(leagues: dict, key: str) -> None:
    """A real league never lands exactly on a sanity bound.

    This is the specific signature of the drift bug: the walk stops where it is
    clipped, so the tell is a value equal to a bound rather than near it.
    """
    lp = leagues[key]
    for field, (lo, hi) in BOUNDS.items():
        value = lp[field]
        assert value != lo, (
            f"{key}.{field} is exactly its lower bound {lo} — that is where a "
            "drift loop comes to rest, not where a league lives"
        )
        assert value != hi, (
            f"{key}.{field} is exactly its upper bound {hi} — that is where a "
            "drift loop comes to rest, not where a league lives"
        )


@pytest.mark.parametrize("key", WAVE_A)
def test_wave_a_parameters_are_physically_plausible(leagues: dict, key: str) -> None:
    """Top-flight European football, stated as ranges wide enough to be true.

    `avg_goals` is per SIDE, so a match total is roughly twice it. Every top-5
    league has sat between 2.4 and 3.4 goals per match for decades, home
    advantage is worth a fifth to a half of a goal, and draws run 20-32%.
    """
    lp = leagues[key]
    assert 1.1 <= lp["avg_goals"] <= 1.8, (
        f"{key}: {lp['avg_goals']} goals per side means a "
        f"{lp['avg_goals'] * 2:.2f}-goal match, which is not this league"
    )
    assert 0.10 <= lp["home_adv"] <= 0.50, f"{key}: implausible home advantage"
    assert 0.18 <= lp["draw_rate"] <= 0.34, f"{key}: implausible draw rate"


def test_params_declare_who_fitted_them(leagues: dict) -> None:
    data = json.loads(PARAMS_PATH.read_text())
    assert data.get("params_fitted_by", "").endswith("fit_league_params.py"), (
        "league_params.json should record that it was fitted from the warehouse; "
        "if another writer has taken it over, that writer needs a convergence "
        "argument of its own"
    )


def test_train_feedback_no_longer_writes_serving_params() -> None:
    """The two paths that used to drift the file must stay closed."""
    from backend.scripts import train_feedback
    from backend.scripts.predict_upcoming import load_learned_adjustments

    assert train_feedback.suggested_params({"Premier League": {}}) == {}, (
        "suggested_params is drift arithmetic; it must not resume emitting "
        "serving parameters"
    )
    assert load_learned_adjustments() == {}, (
        "predict_upcoming must not layer model_adjustments.json on top of the "
        "fitted league_params.json"
    )


class TestEstimator:
    def test_recovers_known_quantities(self) -> None:
        # 4 matches: 2-1, 1-1, 0-0, 3-0. 8 goals over 4 matches = 1.0 per side.
        # Home minus away: +1, 0, 0, +3 -> 1.0. Draws: 2 of 4 -> 0.5.
        rows = [
            {"home_score": 2, "away_score": 1},
            {"home_score": 1, "away_score": 1},
            {"home_score": 0, "away_score": 0},
            {"home_score": 3, "away_score": 0},
        ]
        est = _fit_one(rows * 60)  # repeat past MIN_SAMPLE
        assert est is not None
        assert est["avg_goals"] == pytest.approx(1.0)
        assert est["home_adv"] == pytest.approx(1.0)
        assert est["draw_rate"] == pytest.approx(0.5)

    def test_refuses_a_thin_sample(self) -> None:
        rows = [{"home_score": 1, "away_score": 0}] * (MIN_SAMPLE - 1)
        assert _fit_one(rows) is None, "an estimate below the floor is noise"

    def test_ignores_unplayed_fixtures(self) -> None:
        played = [{"home_score": 2, "away_score": 0}] * MIN_SAMPLE
        pending = [{"home_score": None, "away_score": None}] * 500
        est = _fit_one(played + pending)
        assert est is not None
        assert est["n"] == MIN_SAMPLE
        assert est["avg_goals"] == pytest.approx(1.0)
