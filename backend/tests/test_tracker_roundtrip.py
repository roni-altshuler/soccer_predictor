"""What a save is allowed to change about a prediction already on disk.

`_save_predictions` rewrites EVERY row in a month to record one outcome, so
whatever `PredictionRecord` does to a row on the way in and out happens to
1,635 records the first time the live app touches the file. Two writers share
these files — the scheduled pipeline and this class — and they do not agree on
the schema, so the round-trip has to be lossless in the one direction that
matters: a column this class has never heard of must survive it.

Measured 2026-08-15: a single outcome update deleted `model_selection`,
`draw_min_prob` and `draw_margin` from every record on disk. Nothing read them,
so nothing broke. That is luck, not design.
"""
import importlib.util
import sys
import types

import pytest


def _load_tracker():
    """Import tracker.py directly: its package __init__ pulls in httpx."""
    for name in ("backend", "backend.services", "backend.services.prediction"):
        if name not in sys.modules:
            module = types.ModuleType(name)
            module.__path__ = [name.replace(".", "/")]
            sys.modules[name] = module
    spec = importlib.util.spec_from_file_location(
        "backend.services.prediction.tracker",
        "backend/services/prediction/tracker.py",
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module.PredictionRecord


PredictionRecord = _load_tracker()


def row(**over):
    base = {
        "match_id": "401879301",
        "home_team": "Arsenal",
        "away_team": "Fulham",
        "league": "Premier League",
        "match_date": "2026-05-02",
        "predicted_home_win": 0.62,
        "predicted_draw": 0.22,
        "predicted_away_win": 0.16,
        "predicted_home_goals": 2.1,
        "predicted_away_goals": 0.9,
        "predicted_scoreline": "2-1",
        "confidence": 0.62,
        "prediction_timestamp": "2026-05-01T09:00:00+00:00",
    }
    base.update(over)
    return base


class TestUnknownColumns:
    def test_a_column_this_class_never_named_survives_a_save(self):
        # The whole point. These three are written by the scheduled pipeline
        # and have never been fields of PredictionRecord.
        given = row(model_selection={"why": "policy"}, draw_min_prob=0.24, draw_margin=0.02)
        got = PredictionRecord.from_dict(given).to_dict()
        assert got["model_selection"] == {"why": "policy"}
        assert got["draw_min_prob"] == 0.24
        assert got["draw_margin"] == 0.02

    def test_nothing_at_all_is_dropped(self):
        given = row(model_selection=None, draw_min_prob=0.24, venue="Emirates", weather_factor=1.0)
        got = PredictionRecord.from_dict(given).to_dict()
        assert set(given) <= set(got)

    def test_the_carrier_itself_never_reaches_the_file(self):
        # A private field would serialise as a literal "_extra" column and then
        # be re-read as an unknown key on the next pass, nesting each time.
        got = PredictionRecord.from_dict(row(draw_margin=0.02)).to_dict()
        assert "_extra" not in got

    def test_a_known_column_beats_a_stale_copy_of_itself(self):
        # This class is the authority on what it names; a carried-through value
        # must never overwrite one it computed.
        rec = PredictionRecord.from_dict(row())
        rec._extra["predicted_home_win"] = 0.99
        assert rec.to_dict()["predicted_home_win"] == pytest.approx(0.62)

    def test_saving_twice_changes_nothing_further(self):
        given = row(model_selection={"why": "policy"}, draw_margin=0.02)
        once = PredictionRecord.from_dict(given).to_dict()
        twice = PredictionRecord.from_dict(once).to_dict()
        assert once == twice


class TestDeliberateNormalisation:
    def test_confidence_is_still_normalised_to_a_fraction(self):
        # Intended, and documented in from_dict. Every reader on both sides
        # normalises defensively, so this is safe — it is only recorded here so
        # that changing it is a decision rather than an accident.
        assert PredictionRecord.from_dict(row(confidence=51.4)).to_dict()["confidence"] == pytest.approx(0.514)

    def test_a_fraction_is_left_alone(self):
        assert PredictionRecord.from_dict(row(confidence=0.43)).to_dict()["confidence"] == pytest.approx(0.43)

    def test_the_derived_columns_are_still_backfilled(self):
        got = PredictionRecord.from_dict(row()).to_dict()
        assert got["edge_score"] == pytest.approx(0.62 - 1 / 3)
        assert isinstance(got["threshold_qualified"], bool)
        assert got["predicted_winner"] == "home"
