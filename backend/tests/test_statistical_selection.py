"""Tests for the statistical-model selection gate (build_statistical_selection).

The gate's job is a safety guarantee: never serve a model that loses to "always
pick the home team", and only take a league from the neural net when it is
clearly safe to do so. These tests pin that logic without touching the warehouse.
"""

from __future__ import annotations

from backend.scripts.build_statistical_selection import (
    GATES,
    _incumbent_metrics,
    decide,
)


def _dc(acc: float, floor: float, n: int = 300, brier: float = 0.62) -> dict:
    return {
        "season": 2025,
        "n": n,
        "dc_accuracy": acc,
        "dc_brier": brier,
        "dc_log_loss": 1.05,
        "always_home_accuracy": floor,
    }


# --------------------------------------------------------------------------- #
# The floor — DC must clear always-home to be eligible at all
# --------------------------------------------------------------------------- #
def test_dc_below_home_baseline_is_not_served():
    serve, reason = decide(_dc(acc=0.40, floor=0.45), incumbent_acc=0.38, incumbent_brier=0.70)
    assert serve is False
    assert reason == "dc_below_home_baseline"


def test_insufficient_sample_never_flips():
    serve, reason = decide(_dc(acc=0.55, floor=0.45, n=10), incumbent_acc=None, incumbent_brier=None)
    assert serve is False
    assert reason == "insufficient_backtest_sample"


# --------------------------------------------------------------------------- #
# The clear-cut wins — the cases this change is meant to fix
# --------------------------------------------------------------------------- #
def test_no_incumbent_benchmark_serves_floor_clearing_dc():
    # NWSL / eng.1.w: no policy decision at all -> silent net fallback.
    serve, reason = decide(_dc(acc=0.48, floor=0.45), incumbent_acc=None, incumbent_brier=None)
    assert serve is True
    assert reason == "no_incumbent_benchmark_dc_clears_floor"


def test_incumbent_below_baseline_is_replaced_by_dc():
    # MLS: the league net scored 42.9%, below its own home floor.
    serve, reason = decide(_dc(acc=0.482, floor=0.447), incumbent_acc=0.429, incumbent_brier=0.71)
    assert serve is True
    assert reason == "incumbent_below_home_baseline"


# --------------------------------------------------------------------------- #
# The conservative retmain — strong (European) neural leagues are NOT flipped
# on a mismatched-holdout comparison
# --------------------------------------------------------------------------- #
def test_benchmarked_incumbent_that_clears_floor_is_retained():
    # esp.1: DC looks a touch better here, but the net's benchmark clears the
    # floor and the comparison is cross-methodology -> keep the net.
    serve, reason = decide(_dc(acc=0.528, floor=0.484, brier=0.579), incumbent_acc=0.502, incumbent_brier=0.198)
    assert serve is False
    assert reason == "incumbent_retained_clears_floor"


# --------------------------------------------------------------------------- #
# Incumbent-benchmark extraction from the committed policy shapes
# --------------------------------------------------------------------------- #
def test_incumbent_metrics_reads_global_holdout():
    block = {"decision": "global", "global_holdout": {"accuracy": 0.51, "brier_score": 0.20}}
    acc, brier = _incumbent_metrics(block)
    assert acc == 0.51 and brier == 0.20


def test_incumbent_metrics_reads_league_model():
    block = {"decision": "league", "league_model": {"ensemble_accuracy": 0.42, "mean_brier_score": 0.22}}
    acc, brier = _incumbent_metrics(block)
    assert acc == 0.42 and brier == 0.22


def test_incumbent_metrics_absent_is_none():
    assert _incumbent_metrics(None) == (None, None)
    assert _incumbent_metrics({"decision": "global"}) == (None, None)


def test_gates_are_conservative():
    # A regression guard on the constants the safety argument rests on.
    assert GATES["min_backtest_matches"] >= 30
    assert 0.0 <= GATES["floor_tolerance"] <= 0.03
