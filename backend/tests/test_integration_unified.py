"""End-to-end integration test: warehouse → features → training → inference.

Trains the real `UnifiedMatchModel` for one epoch on a tiny synthetic
warehouse, saves artifacts to a temp dir, then serves a prediction
through `unified_inference.predict_one` and checks the payload contract.
This is the guard against silent train/inference drift (feature order,
vocab maps, calibrator format, scaler shape).
"""

from __future__ import annotations

import math
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from itertools import permutations

import pytest

from backend.services.data.team_resolver import TeamResolver
from backend.services.data.warehouse import MatchRow, Warehouse

pytestmark = pytest.mark.slow

TEAM_NAMES = ["Arsenal", "Liverpool", "Chelsea", "Everton", "Fulham", "Brentford"]


@pytest.fixture()
def seeded_warehouse(tmp_path) -> Warehouse:
    wh = Warehouse(tmp_path / "wh.sqlite")
    wh.migrate()
    wh.upsert_competition("eng.1", "Premier League", gender="M", country="GB", tier=1)

    resolver = TeamResolver(wh, gender_default="M")
    teams = {name: resolver.resolve(name, gender="M").team_id for name in TEAM_NAMES}

    start = datetime(2022, 8, 6, tzinfo=timezone.utc)
    pairs = list(permutations(TEAM_NAMES, 2))  # 30 ordered fixtures per cycle
    rows = []
    i = 0
    for cycle in range(5):  # 150 completed matches total
        for home, away in pairs:
            # Deterministic pseudo-scores so every outcome class appears.
            hs = (i * 7 + cycle) % 4
            as_ = (i * 5 + 2 * cycle) % 3
            rows.append(MatchRow(
                match_id=f"m{i}",
                source="test",
                competition_id="eng.1",
                season=2022 + cycle // 2,
                date_utc=(start + timedelta(days=i * 3)).isoformat(),
                home_team_id=teams[home], away_team_id=teams[away],
                home_score=hs, away_score=as_,
            ))
            i += 1
    wh.upsert_matches(rows)
    wh._teams = teams  # noqa: SLF001 — test-only stash
    wh._last_date = start + timedelta(days=i * 3)  # noqa: SLF001
    yield wh
    wh.close()


@contextmanager
def _noop_ctx(wh: Warehouse):
    yield wh


def test_train_then_predict_end_to_end(seeded_warehouse: Warehouse, tmp_path, monkeypatch):
    import backend.scripts.train_unified as train_unified
    import backend.services.prediction.unified_inference as unified_inference

    model_dir = tmp_path / "models"
    monkeypatch.setattr(train_unified, "MODEL_DIR", model_dir)
    monkeypatch.setattr(unified_inference, "MODEL_DIR", model_dir)
    monkeypatch.setattr(
        train_unified, "open_warehouse", lambda: _noop_ctx(seeded_warehouse)
    )
    # Fresh per-test store cache so a previous test's artifacts can't leak in.
    monkeypatch.setattr(unified_inference, "_STORES", {})

    rc = train_unified.main(["--gender", "M", "--epochs", "1", "--device", "cpu", "--seed", "7"])
    assert rc == 0

    expected = {
        "unified_men.pt",
        "unified_men_scaler.pkl",
        "unified_men_calibrator.pkl",
        "unified_men_metadata.json",
        "unified_men_holdout.json",
    }
    assert expected.issubset({p.name for p in model_dir.iterdir()})

    teams = seeded_warehouse._teams  # noqa: SLF001
    kickoff = seeded_warehouse._last_date + timedelta(days=7)  # noqa: SLF001
    prediction = unified_inference.predict_one(
        warehouse=seeded_warehouse,
        home_team_id=teams["Arsenal"],
        away_team_id=teams["Liverpool"],
        home_team_name="Arsenal",
        away_team_name="Liverpool",
        competition_id="eng.1",
        competition_name="Premier League",
        kickoff_utc=kickoff,
        gender="M",
    )

    assert prediction is not None
    total = (
        prediction.outcome.home_win
        + prediction.outcome.draw
        + prediction.outcome.away_win
    )
    assert total == pytest.approx(1.0, abs=1e-4)
    assert all(
        0.0 <= p <= 1.0
        for p in (
            prediction.outcome.home_win,
            prediction.outcome.draw,
            prediction.outcome.away_win,
        )
    )
    assert 0.0 <= prediction.outcome.confidence <= 1.0

    # Scoreline product: a most-likely score plus 4 alternatives, each valid.
    assert prediction.most_likely_score is not None
    assert len(prediction.alternative_scores) == 4
    for s in [prediction.most_likely_score, *prediction.alternative_scores]:
        assert 0.0 <= s.probability <= 1.0
        h, a = s.score.split("-")
        assert int(h) == s.home_goals and int(a) == s.away_goals

    assert prediction.goals.home_expected_goals > 0
    assert prediction.goals.away_expected_goals > 0
    assert math.isfinite(prediction.goals.total_expected_goals)
    assert prediction.model_version.startswith("unified-multitask")


def test_missing_artifacts_fall_back_to_none(seeded_warehouse: Warehouse, tmp_path, monkeypatch):
    """No trained artifacts → predict_one returns None so callers can fall back."""
    import backend.services.prediction.unified_inference as unified_inference

    monkeypatch.setattr(unified_inference, "MODEL_DIR", tmp_path / "empty")
    monkeypatch.setattr(unified_inference, "_STORES", {})

    teams = seeded_warehouse._teams  # noqa: SLF001
    prediction = unified_inference.predict_one(
        warehouse=seeded_warehouse,
        home_team_id=teams["Arsenal"],
        away_team_id=teams["Liverpool"],
        home_team_name="Arsenal",
        away_team_name="Liverpool",
        competition_id="eng.1",
        competition_name="Premier League",
        kickoff_utc=datetime(2026, 1, 1, tzinfo=timezone.utc),
        gender="M",
    )
    assert prediction is None
