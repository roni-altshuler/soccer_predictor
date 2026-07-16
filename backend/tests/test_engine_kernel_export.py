"""Tests for the exported Match Engine kernel (export_engine_kernel.py).

Pins the three-way agreement the Counterfactual Machine relies on:

  torch production engine  ==  numpy float64 reference  ==  committed fixture

* the exporter's feature builder matches the production engine's
  (the spec constants are duplicated on purpose — the exporter must stay
  torch-free for the CI path — so this test is what keeps them honest),
* ``reference_rollout`` agrees with ``rollout_from_state`` (run on a net
  rebuilt from the COMMITTED kernel weights) within the fixture tolerance,
* the committed parity fixture reproduces from the committed kernel,
* the committed kernel artifact is structurally sound (shapes, anchors).

Everything here reads only COMMITTED artifacts — no warehouse, no .pt —
so the suite runs identically in CI.

Run:  python3 -m pytest backend/tests/test_engine_kernel_export.py -q
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
import torch

from backend.scripts.export_engine_kernel import (
    KERNEL_OUT,
    N_FEATURES,
    PARITY_FIXTURE,
    PARITY_TOLERANCE,
    _feature_vector,
    _resolve_team,
    anchor_in_bounds,
    reference_rollout,
    validate_weight_shapes,
    verify_parity_fixture,
    weights_from_kernel,
)
from backend.services.prediction.match_engine import (
    ResidualNet,
    build_feature_array,
    outcome_probs,
    rollout_from_state,
)

pytestmark = pytest.mark.skipif(
    not KERNEL_OUT.exists() or not PARITY_FIXTURE.exists(),
    reason="committed kernel/fixture artifacts not present",
)


@pytest.fixture(scope="module")
def kernel_weights():
    weights, meta = weights_from_kernel(KERNEL_OUT)
    validate_weight_shapes(weights, meta["hidden"])
    return weights, meta


@pytest.fixture(scope="module")
def kernel_net(kernel_weights):
    """ResidualNet rebuilt from the committed kernel's float values."""
    weights, meta = kernel_weights
    net = ResidualNet(hidden=meta["hidden"])
    state = {
        "net.0.weight": torch.tensor(weights["w0"], dtype=torch.float32),
        "net.0.bias": torch.tensor(weights["b0"], dtype=torch.float32),
        "net.2.weight": torch.tensor(weights["w1"], dtype=torch.float32),
        "net.2.bias": torch.tensor(weights["b1"], dtype=torch.float32),
        "net.4.weight": torch.tensor(
            weights["w2"], dtype=torch.float32
        ).unsqueeze(0),
        "net.4.bias": torch.tensor([weights["b2"]], dtype=torch.float32),
    }
    net.load_state_dict(state)
    net.eval()
    return net


@pytest.fixture(scope="module")
def fixture_cases():
    return json.loads(PARITY_FIXTURE.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Spec duplication stays honest
# ---------------------------------------------------------------------------
def test_exporter_features_match_production_engine():
    """The exporter's torch-free feature builder IS the engine's layout."""
    rng = np.random.default_rng(20260716)
    for _ in range(200):
        minute = int(rng.integers(0, 90))
        diff = int(rng.integers(-6, 7))
        reds = int(rng.integers(-3, 4))
        is_home = float(rng.integers(0, 2))
        gender = float(rng.integers(0, 2))
        ours = _feature_vector(minute, diff, reds, is_home, gender)
        theirs = build_feature_array(
            np.array([minute]),
            np.array([diff]),
            np.array([reds]),
            np.array([is_home]),
            np.array([gender]),
        )[0]
        np.testing.assert_array_equal(ours, theirs.astype(np.float64))
    assert N_FEATURES == theirs.shape[0]


# ---------------------------------------------------------------------------
# Three-way parity
# ---------------------------------------------------------------------------
def test_reference_matches_torch_engine_on_fixture_states(
    kernel_weights, kernel_net, fixture_cases
):
    """numpy-f64 reference vs the torch DP, both on the committed weights."""
    weights, _ = kernel_weights
    worst = 0.0
    for case in fixture_cases["cases"]:
        anchor, state = case["anchor"], case["state"]
        gender_f = 1.0 if anchor["gender"] == "F" else 0.0
        ref = reference_rollout(
            weights,
            anchor["lambda"],
            anchor["mu"],
            anchor["rho"],
            gender_f,
            state["minute"],
            (state["homeGoals"], state["awayGoals"]),
            (state["homeReds"], state["awayReds"]),
        )
        mat = rollout_from_state(
            anchor["lambda"],
            anchor["mu"],
            anchor["rho"],
            kernel_net,
            gender_f=gender_f,
            start_minute=min(max(int(state["minute"]), 0), 90),
            score=(
                min(state["homeGoals"], 10),
                min(state["awayGoals"], 10),
            ),
            reds=(state["homeReds"], state["awayReds"]),
        )
        p_home, p_draw, p_away = outcome_probs(mat)
        worst = max(
            worst,
            abs(ref["pHome"] - p_home),
            abs(ref["pDraw"] - p_draw),
            abs(ref["pAway"] - p_away),
        )
    assert worst <= PARITY_TOLERANCE, (
        f"reference vs torch drifted to {worst:.2e} (> {PARITY_TOLERANCE:.0e})"
    )


def test_committed_fixture_reproduces_from_committed_kernel(kernel_weights):
    weights, _ = kernel_weights
    worst = verify_parity_fixture(weights, PARITY_FIXTURE)
    assert worst <= PARITY_TOLERANCE, (
        f"committed fixture no longer matches committed weights "
        f"(worst |Δp| = {worst:.2e}) — regenerate both via "
        f"python -m backend.scripts.export_engine_kernel"
    )


def test_fixture_distributions_are_proper(fixture_cases):
    assert fixture_cases["tolerance"] == PARITY_TOLERANCE
    assert len(fixture_cases["cases"]) >= 20
    genders = set()
    for case in fixture_cases["cases"]:
        exp = case["expected"]
        total = exp["pHome"] + exp["pDraw"] + exp["pAway"]
        assert total == pytest.approx(1.0, abs=1e-9)
        assert len(exp["topScorelines"]) == 5
        genders.add(case["anchor"]["gender"])
    assert genders == {"M", "F"}


def test_fixture_degenerate_minute_90(fixture_cases):
    by_name = {c["name"]: c for c in fixture_cases["cases"]}
    done = by_name["final-whistle-90"]["expected"]
    assert done["pHome"] == pytest.approx(1.0, abs=1e-12)
    assert done["topScorelines"][0] == {"home": 2, "away": 1, "p": 1.0}
    clamped = by_name["stoppage-93-clamps"]["expected"]
    assert clamped["pDraw"] == pytest.approx(1.0, abs=1e-12)


def test_fixture_monotonicity_lead_vs_trail_at_75(fixture_cases):
    by_name = {c["name"]: c for c in fixture_cases["cases"]}
    lead = by_name["lead1-75-m"]["expected"]
    trail = by_name["trail1-75-m"]["expected"]
    assert lead["pHome"] > trail["pHome"]
    assert trail["pAway"] > trail["pHome"]


# ---------------------------------------------------------------------------
# Artifact structure
# ---------------------------------------------------------------------------
def test_kernel_artifact_structure():
    payload = json.loads(KERNEL_OUT.read_text(encoding="utf-8"))
    assert payload["schema"] == 1
    cfg = payload["config"]
    assert cfg["n_features"] == N_FEATURES
    assert cfg["n_minutes"] == 90 and cfg["max_goals"] == 10
    anchors = payload["anchors"]
    assert len(anchors) > 10_000
    # EVERY anchor must be inside the exporter's sanity bounds — the v1
    # artifact shipped minority-source fits with λ+μ up to 102 for exactly
    # the ids live match pages resolve to; this scan keeps that impossible.
    for match_id, row in anchors.items():
        assert isinstance(match_id, str) and len(row) == 4
        lam, mu, rho, gender = row
        assert anchor_in_bounds(lam, mu), f"{match_id}: λ={lam} μ={mu}"
        assert abs(rho) < 1.0 and gender in (0, 1)
    # Both universes present, and both event-page (espn_*) and secondary
    # source ids anchored (minority ids inherit the dominant fit).
    assert any(v[3] == 1 for v in anchors.values())
    assert any(k.startswith("espn_") for k in anchors)
    assert any(not k.startswith("espn_") for k in anchors)
    # The validation/inheritance audit trail is recorded in the artifact.
    stats = payload["anchor_stats"]
    assert stats["validation_bounds"]["sum_max"] == 7.0
    assert stats["validation_dropped"] >= 0
    assert "validation_dropped_by_competition" in stats
    assert stats["minority_anchored_from_dominant_fit"] >= 0
    assert stats["anchored_matches"] == len(anchors)


def test_anchor_bounds_reject_the_v1_failure_modes():
    assert not anchor_in_bounds(101.05, 0.94)  # exploded cup-minnow MLE
    assert not anchor_in_bounds(1.34, 71.17)
    assert not anchor_in_bounds(0.01, 0.4)  # degenerate near-zero fit
    assert not anchor_in_bounds(4.0, 3.5)  # λ+μ beyond the trusted range
    assert anchor_in_bounds(1.30, 1.80)  # a normal league fixture
    assert anchor_in_bounds(5.59, 1.2)  # trusted-population extreme, kept
    assert anchor_in_bounds(0.3, 0.25)  # defensive low-scoring women's tie


def test_resolve_team_refuses_ambiguity():
    vocab = {
        "liverpool": ["Liverpool"],
        "aston villa": ["Aston Villa"],
        "sevilla": ["Sevilla"],
        "sevilla atletico": ["Sevilla Atlético"],
    }
    assert _resolve_team("Liverpool", vocab) == "Liverpool"
    assert _resolve_team("Aston Villa FC", vocab) == "Aston Villa"
    # Exact normalised match beats containment ambiguity.
    assert _resolve_team("Sevilla", vocab) == "Sevilla"
    # Containment-ambiguous names are refused, never guessed.
    vocab_no_exact = {
        "sevilla fc b": ["Sevilla FC B"],
        "sevilla atletico": ["Sevilla Atlético"],
    }
    assert _resolve_team("Sevilla", vocab_no_exact) is None
    assert _resolve_team("Nowhere Town", vocab) is None
