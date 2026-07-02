"""Tests for the scoreline product fields on the prediction tracker."""

from __future__ import annotations

import pytest

from backend.services.prediction.tracker import PredictionRecord, PredictionTracker

TOP5 = [
    {"score": "2-1", "probability": 0.11},
    {"score": "1-1", "probability": 0.10},
    {"score": "1-0", "probability": 0.09},
    {"score": "2-0", "probability": 0.08},
    {"score": "0-0", "probability": 0.06},
]


@pytest.fixture()
def tracker(tmp_path) -> PredictionTracker:
    return PredictionTracker(storage_dir=tmp_path)


def _store(tracker: PredictionTracker, match_id: str = "m1", **kwargs):
    defaults = dict(
        match_id=match_id,
        home_team="Arsenal",
        away_team="Liverpool",
        league="Premier League",
        match_date="2026-07-01",
        home_win_prob=0.5,
        draw_prob=0.25,
        away_win_prob=0.25,
        home_xG=1.8,
        away_xG=1.1,
        confidence=0.5,
    )
    defaults.update(kwargs)
    return tracker.store_prediction(**defaults)


def test_store_with_top_scorelines(tracker):
    record = _store(tracker, predicted_scoreline="2-1", top_scorelines=TOP5)
    assert record.predicted_scoreline == "2-1"
    assert record.top_scorelines == TOP5
    assert record.scoreline_in_top5 is None  # not settled yet


def test_legacy_fallback_scoreline_unchanged(tracker):
    record = _store(tracker)
    assert record.predicted_scoreline == "2-1"  # round(1.8)-round(1.1)
    assert record.top_scorelines is None


def test_update_outcome_sets_top5_flag_hit(tracker):
    _store(tracker, predicted_scoreline="2-1", top_scorelines=TOP5)
    record = tracker.update_outcome("m1", 1, 1)
    assert record.scoreline_correct is False
    assert record.scoreline_in_top5 is True


def test_update_outcome_sets_top5_flag_miss(tracker):
    _store(tracker, predicted_scoreline="2-1", top_scorelines=TOP5)
    record = tracker.update_outcome("m1", 4, 3)
    assert record.scoreline_in_top5 is False


def test_update_outcome_legacy_record_keeps_none(tracker):
    _store(tracker)
    record = tracker.update_outcome("m1", 2, 1)
    assert record.scoreline_correct is True
    assert record.scoreline_in_top5 is None


def test_metrics_top5_rate_counts_only_eligible(tracker):
    # Two records with top_scorelines (one hit, one miss), one legacy.
    _store(tracker, match_id="a", top_scorelines=TOP5)
    _store(tracker, match_id="b", top_scorelines=TOP5)
    _store(tracker, match_id="c")
    tracker.update_outcome("a", 1, 1)  # hit (1-1 in top5)
    tracker.update_outcome("b", 4, 3)  # miss
    tracker.update_outcome("c", 2, 1)  # legacy — not eligible

    metrics = tracker.calculate_accuracy_metrics()
    assert metrics.scoreline_top5_eligible == 2
    assert metrics.scoreline_top5_count == 1
    assert metrics.scoreline_top5_rate == pytest.approx(0.5)


def test_roundtrip_persistence(tracker, tmp_path):
    _store(tracker, top_scorelines=TOP5)
    tracker.update_outcome("m1", 1, 1)

    reloaded = PredictionTracker(storage_dir=tmp_path)
    record = reloaded.get_prediction("m1")
    assert record is not None
    assert record.top_scorelines == TOP5
    assert record.scoreline_in_top5 is True


def test_from_dict_tolerates_old_records():
    """Records written before the new fields existed must still load."""
    old = {
        "match_id": "x",
        "home_team": "A",
        "away_team": "B",
        "league": "L",
        "match_date": "2026-01-01",
        "predicted_home_win": 0.4,
        "predicted_draw": 0.3,
        "predicted_away_win": 0.3,
        "predicted_home_goals": 1.0,
        "predicted_away_goals": 1.0,
        "predicted_scoreline": "1-1",
        "predicted_winner": "home",
        "confidence": 0.4,
    }
    record = PredictionRecord.from_dict(old)
    assert record.top_scorelines is None
    assert record.scoreline_in_top5 is None
