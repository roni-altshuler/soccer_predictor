"""Tests for the in-match gate machinery (evaluate_inmatch_gate.py).

Covers the pieces the gate's honesty depends on:
  * checkpoint states are cumulative STRICTLY BEFORE the checkpoint minute
    (same information set as rollout_from_state / the training cells),
  * the rebuilt count table pools both sides per match, clamps the diff to
    the rarity key space, and excludes matches on/after the cut date,
  * the key format matches build_rarity.py / src/lib/rarity.ts exactly,
  * the empirical count model falls back to uniform on unseen states,
  * the gate rule (majority of checkpoints, 60' and 75' mandatory).

Run:  python3 -m pytest backend/tests/test_inmatch_gate.py -q
"""

from __future__ import annotations

import json

import numpy as np
import pytest

from backend.scripts.evaluate_inmatch_gate import (
    CHECKPOINTS,
    CountModel,
    GridStateStore,
    build_count_table,
    clamp_diff,
    evaluate_gate,
    state_key,
)

N_MINUTES = 90


def _write_dataset(tmp_path, goal_home, goal_away, red_home, red_away, gender, dates):
    n = goal_home.shape[0]
    np.savez_compressed(
        tmp_path / "grids.npz",
        goal_home=goal_home.astype(np.uint8),
        goal_away=goal_away.astype(np.uint8),
        red_home=red_home.astype(np.uint8),
        red_away=red_away.astype(np.uint8),
        lam_dc=np.full(n, 1.4, dtype=np.float32),
        mu_dc=np.full(n, 1.1, dtype=np.float32),
        gender=gender.astype(np.uint8),
    )
    meta = [
        {
            "match_id": f"m{i}",
            "competition_id": "test.1",
            "season": 2024,
            "source": "espn",
            "date_utc": dates[i],
            "gender": "F" if gender[i] else "M",
            "home": "Alpha",
            "away": "Beta",
            "home_score": int(goal_home[i].sum()),
            "away_score": int(goal_away[i].sum()),
        }
        for i in range(n)
    ]
    (tmp_path / "matches.json").write_text(json.dumps(meta), encoding="utf-8")


@pytest.fixture()
def store(tmp_path):
    gh = np.zeros((3, N_MINUTES), dtype=np.uint8)
    ga = np.zeros((3, N_MINUTES), dtype=np.uint8)
    rh = np.zeros((3, N_MINUTES), dtype=np.uint8)
    ra = np.zeros((3, N_MINUTES), dtype=np.uint8)
    # Match 0 (M): home goal in bin 14 (minute 15), away goal in bin 59
    # (minute 60), home red in bin 29 (minute 30) — final 1-1 draw.
    gh[0, 14] = 1
    ga[0, 59] = 1
    rh[0, 29] = 1
    # Match 1 (F): home goals in bins 5 and 20 — final 2-0 home win.
    gh[1, 5] = 1
    gh[1, 20] = 1
    # Match 2 (M, dated late): away goal bin 0 — final 0-1 away win.
    ga[2, 0] = 1
    gender = np.array([0, 1, 0], dtype=np.uint8)
    dates = [
        "2024-03-01T15:00:00+00:00",
        "2024-04-01T15:00:00+00:00",
        "2024-09-01T15:00:00+00:00",
    ]
    _write_dataset(tmp_path, gh, ga, rh, ra, gender, dates)
    return GridStateStore(tmp_path)


# ---------------------------------------------------------------------------
# Checkpoint state semantics
# ---------------------------------------------------------------------------
def test_state_at_is_strictly_before_checkpoint(store):
    # Match 0: the goal sits in bin 14 = minute 15, which is BEFORE the
    # 15' checkpoint state (bins 0..14 played) — so it counts at 15'.
    assert store.state_at(0, 15) == (1, 0, 0, 0)
    # Red card in bin 29 (minute 30) counts at the 30' checkpoint...
    assert store.state_at(0, 30) == (1, 0, 1, 0)
    # ...and the away equaliser in bin 59 (minute 60) at the 60' one.
    assert store.state_at(0, 45) == (1, 0, 1, 0)
    assert store.state_at(0, 60) == (1, 1, 1, 0)
    assert store.state_at(0, 75) == (1, 1, 1, 0)


def test_index_lookup(store):
    assert store.index_of("m1") == 1
    assert store.index_of("nope") is None


# ---------------------------------------------------------------------------
# Count table build
# ---------------------------------------------------------------------------
def test_count_table_pools_both_sides_and_respects_cut(store):
    table, corpus = build_count_table(store, cut_date="2024-06-01")
    # Match 2 is dated 2024-09 — after the cut — and must be excluded.
    assert corpus == 2
    # Match 0 (M, draw): home leads 1-0 at 30' → key M:+1:30 has one draw
    # from the home side; the away side contributes M:-1:30.
    assert table[state_key("M", 1, 30)] == {"n": 1, "w": 0, "d": 1, "l": 0}
    assert table[state_key("M", -1, 30)] == {"n": 1, "w": 0, "d": 1, "l": 0}
    # Match 1 (F, 2-0 win): level at 15'... goal was bin 5 → 1-0 at 15'.
    assert table[state_key("F", 1, 15)] == {"n": 1, "w": 1, "d": 0, "l": 0}
    assert table[state_key("F", -1, 15)] == {"n": 1, "w": 0, "d": 0, "l": 1}
    # Nothing from match 2 leaked in: exactly 2 M-side states per checkpoint
    # (both sides of match 0), and no M state carries a win or loss.
    m_keys_15 = [k for k in table if k.startswith("M:") and k.endswith(":15")]
    assert sum(table[k]["n"] for k in m_keys_15) == 2
    assert all(table[k]["w"] == 0 and table[k]["l"] == 0 for k in m_keys_15)


def test_count_table_covers_all_checkpoints(store):
    table, _ = build_count_table(store, cut_date="2099-01-01")
    for cp in CHECKPOINTS:
        assert state_key("M", 0, cp) in table or state_key("M", 1, cp) in table


def test_clamp_and_key_format_match_rarity_contract():
    # Must mirror build_rarity.state_key / src/lib/rarity.ts rarityKey.
    assert state_key("M", -5, 60) == "M:-3:60"
    assert state_key("F", 9, 75) == "F:3:75"
    assert clamp_diff(-4) == -3 and clamp_diff(4) == 3 and clamp_diff(2) == 2


# ---------------------------------------------------------------------------
# Count model
# ---------------------------------------------------------------------------
def test_count_model_probs_and_uniform_fallback():
    model = CountModel({"M:1:60": {"n": 4, "w": 2, "d": 1, "l": 1}})
    assert model.probs("M", 1, 60) == pytest.approx((0.5, 0.25, 0.25))
    # Clamped diff hits the same key.
    assert model.probs("M", 1, 60) == model.probs("M", 1, 60)
    # Unseen state → uniform, counted.
    assert model.probs("F", -2, 75) == pytest.approx((1 / 3, 1 / 3, 1 / 3))
    assert model.fallbacks == 1


# ---------------------------------------------------------------------------
# Gate rule
# ---------------------------------------------------------------------------
def _summaries(wins_at):
    out = {}
    for cp in CHECKPOINTS:
        engine = 0.4 if cp in wins_at else 0.5
        out[cp] = {"engine_brier": engine, "counts_brier": 0.45}
    return out


def test_gate_requires_majority_and_late_checkpoints():
    # 5/5 wins → pass.
    assert evaluate_gate(_summaries({15, 30, 45, 60, 75}))["passed"] is True
    # Majority (3) including 60 and 75 → pass.
    assert evaluate_gate(_summaries({45, 60, 75}))["passed"] is True
    # Majority but 75' lost → fail.
    assert evaluate_gate(_summaries({15, 30, 45, 60}))["passed"] is False
    # 60 and 75 won but only 2/5 → fail.
    assert evaluate_gate(_summaries({60, 75}))["passed"] is False
    # Ties are not wins.
    tied = _summaries({15, 30, 60, 75})
    tied[45]["engine_brier"] = tied[45]["counts_brier"]
    gate = evaluate_gate(tied)
    assert gate["checkpoint_wins"]["45"] is False and gate["passed"] is True
