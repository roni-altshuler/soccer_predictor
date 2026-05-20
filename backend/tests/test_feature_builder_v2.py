"""Tests for `FeatureBuilderV2`.

These guard the *contract* between the warehouse, the feature builder,
and the model: the dense vector is always the same length, every element
is finite, and the categorical IDs land in the embedding vocab.
"""

from __future__ import annotations

import math
import sqlite3
from datetime import datetime, timedelta, timezone

import pytest

from backend.services.data.team_resolver import TeamResolver
from backend.services.data.warehouse import MatchRow, Warehouse
from backend.services.prediction.feature_builder_v2 import (
    FEATURE_NAMES,
    FeatureBuilderV2,
)


@pytest.fixture()
def seeded_warehouse(tmp_path) -> Warehouse:
    wh = Warehouse(tmp_path / "wh.sqlite")
    wh.migrate()

    wh.upsert_competition("eng.1", "Premier League", gender="M", country="GB", tier=1)
    wh.upsert_competition("esp.1", "La Liga", gender="M", country="ES", tier=1)
    wh.upsert_competition("uefa.champions", "UEFA CL", gender="M", tier=1)

    r = TeamResolver(wh, gender_default="M")
    teams = {name: r.resolve(name, gender="M").team_id for name in
             ["Arsenal", "Liverpool", "Chelsea", "Manchester United", "Manchester City"]}

    start = datetime(2024, 1, 1, tzinfo=timezone.utc)
    rows = []
    fixtures = [
        ("Arsenal", "Liverpool", 1, 0, "eng.1", 2024),
        ("Liverpool", "Chelsea", 2, 2, "eng.1", 2024),
        ("Manchester City", "Arsenal", 3, 1, "eng.1", 2024),
        ("Manchester United", "Liverpool", 0, 4, "eng.1", 2024),
        ("Chelsea", "Manchester United", 1, 1, "eng.1", 2024),
        ("Arsenal", "Manchester City", 0, 0, "eng.1", 2024),
    ]
    for i, (home, away, hs, as_, comp, season) in enumerate(fixtures):
        rows.append(MatchRow(
            match_id=f"s{i}",
            source="test",
            competition_id=comp,
            season=season,
            date_utc=(start + timedelta(days=i * 7)).isoformat(),
            home_team_id=teams[home], away_team_id=teams[away],
            home_score=hs, away_score=as_,
        ))
    wh.upsert_matches(rows)
    wh._teams = teams  # stash for tests  # noqa: SLF001
    yield wh
    wh.close()


def _last_match(wh: Warehouse) -> sqlite3.Row:
    return wh._conn.execute("SELECT * FROM matches ORDER BY date_utc DESC LIMIT 1").fetchone()  # noqa: SLF001


def test_feature_names_are_unique():
    assert len(FEATURE_NAMES) == len(set(FEATURE_NAMES))


def test_dense_vector_has_expected_length(seeded_warehouse: Warehouse):
    builder = FeatureBuilderV2(seeded_warehouse)
    built = builder.build_from_row(_last_match(seeded_warehouse))
    assert len(built.dense) == len(FEATURE_NAMES)


def test_all_features_are_finite(seeded_warehouse: Warehouse):
    builder = FeatureBuilderV2(seeded_warehouse)
    built = builder.build_from_row(_last_match(seeded_warehouse))
    assert all(math.isfinite(v) for v in built.dense)


def test_no_target_leakage(seeded_warehouse: Warehouse):
    """Features for a match must only consider history strictly before its date."""
    builder = FeatureBuilderV2(seeded_warehouse)
    # The newest match (Arsenal vs Manchester City). Take a snapshot now, then
    # add a *fake* result for it via direct SQL UPDATE — features must NOT change.
    row = _last_match(seeded_warehouse)
    built_before = builder.build_from_row(row)
    # Simulate someone running the builder a second time after the result is in.
    # The builder reads history strictly before row.date_utc, so even if we
    # bump this match's own score it should not affect the produced vector.
    seeded_warehouse._conn.execute(  # noqa: SLF001
        "UPDATE matches SET home_score = 99, away_score = 0 WHERE match_id = ?",
        (row["match_id"],),
    )
    refreshed = seeded_warehouse._conn.execute(  # noqa: SLF001
        "SELECT * FROM matches WHERE match_id = ?", (row["match_id"],)
    ).fetchone()
    built_after = FeatureBuilderV2(seeded_warehouse).build_from_row(refreshed)
    assert built_before.dense == built_after.dense


def test_vocabulary_ids_grow_consistently(seeded_warehouse: Warehouse):
    builder = FeatureBuilderV2(seeded_warehouse)
    for row in seeded_warehouse.iter_matches():
        builder.build_from_row(row)
    n_leagues, n_teams, n_referees = builder.vocab_dims()
    assert n_leagues > 1
    assert n_teams > 1
    # Every encoded ID is in [1, vocab_size).
    for raw_id, encoded in builder.team_id_map.items():
        assert 1 <= encoded < n_teams


def test_h2h_features_increase_with_more_history(seeded_warehouse: Warehouse):
    builder = FeatureBuilderV2(seeded_warehouse)
    # The fixture data has multiple Arsenal/Liverpool encounters; build for a synthetic
    # row dated AFTER all of them and check that h2h_matches > 0.
    target = seeded_warehouse._conn.execute(  # noqa: SLF001
        """SELECT 'fake' as match_id, 'test' as source, 'eng.1' as competition_id,
                  2024 as season, '2025-01-01T15:00:00+00:00' as date_utc,
                  ? as home_team_id, ? as away_team_id,
                  NULL as home_score, NULL as away_score,
                  NULL as phase, NULL as referee_id,
                  NULL as home_shots, NULL as away_shots,
                  NULL as home_sot, NULL as away_sot,
                  NULL as home_corners, NULL as away_corners,
                  NULL as home_yellows, NULL as away_yellows,
                  NULL as home_reds, NULL as away_reds,
                  NULL as home_xg, NULL as away_xg,
                  NULL as attendance,
                  NULL as odds_home, NULL as odds_draw, NULL as odds_away,
                  NULL as odds_over_2_5, NULL as venue,
                  datetime('now') as fetched_at""",
        (seeded_warehouse._teams["Arsenal"], seeded_warehouse._teams["Liverpool"]),  # noqa: SLF001
    ).fetchone()
    built = builder.build_from_row(target)
    feat_by_name = dict(zip(FEATURE_NAMES, built.dense))
    assert feat_by_name["h2h_matches"] >= 1.0
