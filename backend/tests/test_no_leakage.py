"""Leakage guards for the unified feature pipeline.

Two invariants:

1. **Target-row blindness** — the feature vector for a fixture must be
   identical whether the target row carries its final score (training
   time) or NULL scores (the synthetic inference row built by
   `unified_inference._synthetic_match_row`). Any divergence means a
   feature is reading the row it is supposed to predict.

2. **Future blindness** — matches dated on/after the fixture must never
   influence its features, even when they involve the same teams.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from backend.services.data.team_resolver import TeamResolver
from backend.services.data.warehouse import MatchRow, Warehouse
from backend.services.prediction.feature_builder_v2 import (
    FEATURE_NAMES,
    FeatureBuilderV2,
)
from backend.services.prediction.unified_inference import _synthetic_match_row


@pytest.fixture()
def seeded_warehouse(tmp_path) -> Warehouse:
    wh = Warehouse(tmp_path / "wh.sqlite")
    wh.migrate()
    wh.upsert_competition("eng.1", "Premier League", gender="M", country="GB", tier=1)

    resolver = TeamResolver(wh, gender_default="M")
    teams = {
        name: resolver.resolve(name, gender="M").team_id
        for name in ["Arsenal", "Liverpool", "Chelsea", "Everton"]
    }

    start = datetime(2024, 1, 6, tzinfo=timezone.utc)
    fixtures = [
        ("Arsenal", "Liverpool", 2, 1),
        ("Chelsea", "Arsenal", 0, 0),
        ("Liverpool", "Everton", 3, 0),
        ("Arsenal", "Chelsea", 1, 2),
        ("Everton", "Liverpool", 1, 1),
        ("Liverpool", "Arsenal", 2, 2),
    ]
    rows = []
    for i, (home, away, hs, as_) in enumerate(fixtures):
        rows.append(MatchRow(
            match_id=f"hist{i}",
            source="test",
            competition_id="eng.1",
            season=2024,
            date_utc=(start + timedelta(days=i * 7)).isoformat(),
            home_team_id=teams[home], away_team_id=teams[away],
            home_score=hs, away_score=as_,
        ))
    # Give the history some xG so the xG feature block is exercised.
    for i, row in enumerate(rows):
        rows[i] = MatchRow(**{**row.__dict__, "home_xg": 1.2 + 0.1 * i, "away_xg": 0.9})

    # The target fixture, stored WITH a final score and xG (as during
    # training) — neither may leak into its own features.
    target_date = start + timedelta(days=70)
    rows.append(MatchRow(
        match_id="target",
        source="test",
        competition_id="eng.1",
        season=2024,
        date_utc=target_date.isoformat(),
        home_team_id=teams["Arsenal"], away_team_id=teams["Liverpool"],
        home_score=4, away_score=0,
        home_xg=3.7, away_xg=0.2,
    ))
    wh.upsert_matches(rows)
    wh._teams = teams  # noqa: SLF001 — test-only stash
    wh._target_date = target_date  # noqa: SLF001
    yield wh
    wh.close()


def _target_row(wh: Warehouse):
    return wh._conn.execute(  # noqa: SLF001
        "SELECT * FROM matches WHERE match_id = 'target'"
    ).fetchone()


def test_training_row_matches_synthetic_inference_row(seeded_warehouse: Warehouse):
    """Feature parity between the scored training row and the score-less
    synthetic row the inference path builds for the same fixture."""
    teams = seeded_warehouse._teams  # noqa: SLF001
    training_vector = FeatureBuilderV2(seeded_warehouse).build_from_row(
        _target_row(seeded_warehouse)
    ).dense

    synthetic = _synthetic_match_row(
        seeded_warehouse,
        home_team_id=teams["Arsenal"],
        away_team_id=teams["Liverpool"],
        competition_id="eng.1",
        date_utc=seeded_warehouse._target_date.isoformat(),  # noqa: SLF001
    )
    inference_vector = FeatureBuilderV2(seeded_warehouse).build_from_row(synthetic).dense

    mismatches = [
        (name, tr, inf)
        for name, tr, inf in zip(FEATURE_NAMES, training_vector, inference_vector)
        if tr != inf
    ]
    assert not mismatches, f"target-row fields leaked into features: {mismatches}"


def test_future_matches_do_not_change_features(seeded_warehouse: Warehouse):
    teams = seeded_warehouse._teams  # noqa: SLF001
    row = _target_row(seeded_warehouse)
    before = FeatureBuilderV2(seeded_warehouse).build_from_row(row).dense

    # Insert decisive future results involving both target teams.
    future = seeded_warehouse._target_date + timedelta(days=7)  # noqa: SLF001
    seeded_warehouse.upsert_matches([
        MatchRow(
            match_id="future1", source="test", competition_id="eng.1", season=2024,
            date_utc=future.isoformat(),
            home_team_id=teams["Arsenal"], away_team_id=teams["Everton"],
            home_score=9, away_score=0,
        ),
        MatchRow(
            match_id="future2", source="test", competition_id="eng.1", season=2024,
            date_utc=(future + timedelta(days=1)).isoformat(),
            home_team_id=teams["Liverpool"], away_team_id=teams["Chelsea"],
            home_score=0, away_score=9,
        ),
    ])

    after = FeatureBuilderV2(seeded_warehouse).build_from_row(row).dense
    changed = [
        (name, b, a) for name, b, a in zip(FEATURE_NAMES, before, after) if b != a
    ]
    assert not changed, f"future matches leaked into features: {changed}"


def test_same_kickoff_matches_are_excluded(seeded_warehouse: Warehouse):
    """A simultaneous kickoff (identical timestamp) must not feed features —
    the builder uses a strict `<` comparison on date_utc."""
    teams = seeded_warehouse._teams  # noqa: SLF001
    row = _target_row(seeded_warehouse)
    before = FeatureBuilderV2(seeded_warehouse).build_from_row(row).dense

    seeded_warehouse.upsert_matches([
        MatchRow(
            match_id="simultaneous", source="test", competition_id="eng.1", season=2024,
            date_utc=seeded_warehouse._target_date.isoformat(),  # noqa: SLF001
            home_team_id=teams["Arsenal"], away_team_id=teams["Everton"],
            home_score=7, away_score=7,
        ),
    ])
    after = FeatureBuilderV2(seeded_warehouse).build_from_row(row).dense
    assert before == after
