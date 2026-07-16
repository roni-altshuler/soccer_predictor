"""Export the Match Engine v0 kernel — weights, DP config, per-match anchors.

Produces the committed artifact ``backend/data/engine/kernel.json`` that the
frontend TypeScript port (``src/lib/engine/kernel.ts``) executes:

* ``weights`` — the residual MLP's exact float32 values (33→128→128→1),
  serialised as JSON floats (bit-faithful: float32 → float64 → shortest
  decimal round-trips exactly);
* ``config``  — the DP lattice/minute-folding constants the kernel needs;
* ``anchors`` — walk-forward Dixon-Coles anchors ``match_id → [λ, μ, ρ,
  gender]``. Fits run ONLY on the DOMINANT covered source per
  (competition, season) — the exact population whose anchors fed the
  in-match gate (``build_event_dataset``'s dedupe rule, extended to keep
  ρ). A fixture covered under a minority source (the espn twin of an
  fdcouk row, or a fixture the dominant source never listed) gets its id
  anchored by INHERITANCE FROM THE DOMINANT FIT: the dominant group's
  already-fitted model for that (competition, season) is evaluated at the
  fixture's teams, resolved into the model's vocabulary via the
  cross-source normaliser (exact match first, then containment; ambiguity
  or an unresolved side → unanchored, never guessed). Where a true twin
  row exists this yields byte-identical values to copying the twin's
  anchor — same model, same teams — and it also covers fixtures with no
  dominant row at all. This matters because minority-source walk-forward
  histories are thin and their own fits produce wild MLEs — v1 of this
  exporter shipped espn-twin anchors with λ+μ up to 102 for exactly the
  ids live match pages resolve to. Finally every anchor must pass a
  sanity gate calibrated on the
  dominant-fit population (λ+μ within [0.5, 7.0] and each component within
  [0.02, 6.0]; the trusted fd/of fits span λ+μ 0.51–6.15 with single
  components up to 5.59, so the bounds accept 100% of them): out-of-bounds
  anchors — in practice continental-cup groups where a qualifying-round
  minnow's one prior match explodes the MLE — are DROPPED, so the fork
  route answers ``available: false`` instead of serving nonsense.

TORCH-FREE BY DESIGN (the event-backfill workflow installs no torch):
``--weights auto`` reads the trained checkpoint
``backend/data/models/match_engine_v0.pt`` when it exists (local runs;
torch imported lazily) and otherwise re-uses the weights already inside the
committed kernel artifact (CI runs — anchors refresh daily, weights only
change when the engine is retrained locally).

This module also carries the REFERENCE IMPLEMENTATION of the kernel
(``reference_rollout``): a pure-numpy float64 forward pass + score-lattice
DP that defines the semantics the TypeScript port must reproduce. The
committed jest parity fixture (``src/lib/engine/__tests__/fixtures/
parity.json``) is generated from it; ``backend/tests/test_engine_kernel_
export.py`` asserts it agrees with the production torch engine to well
inside the fixture's 1e-6 tolerance. When weights are re-used from the
committed kernel the exporter VERIFIES the fixture instead of rewriting it,
so any accidental weight corruption fails the workflow loudly.

Run
---
    python -m backend.scripts.export_engine_kernel
    python -m backend.scripts.export_engine_kernel --weights kernel  # CI path
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.scripts.build_event_dataset import (  # noqa: E402
    MIN_ANCHOR_MATCHES,
    _anchor_training_rows,
    dedupe_by_dominant_covered_source,
    load_covered_matches,
)
from backend.services.data.team_resolver import _normalise  # noqa: E402
from backend.scripts.train_dixon_coles import (  # noqa: E402
    WAREHOUSE_PATH,
    connect_readonly,
)
from backend.services.prediction.dixon_coles import (  # noqa: E402
    DEFAULT_HALF_LIFE_DAYS,
    fit_dixon_coles,
)

KERNEL_OUT = ROOT / "backend" / "data" / "engine" / "kernel.json"
WEIGHTS_PT = ROOT / "backend" / "data" / "models" / "match_engine_v0.pt"
PARITY_FIXTURE = (
    ROOT / "src" / "lib" / "engine" / "__tests__" / "fixtures" / "parity.json"
)

SCHEMA_VERSION = 1
ANCHOR_DECIMALS = 5
PARITY_TOLERANCE = 1e-6
TOP_SCORELINES = 5

# Anchor sanity bounds, calibrated on the dominant-fit (fd/of) population:
# measured λ+μ ∈ [0.51, 6.15] with single components up to λ=5.59 / μ=4.28
# across 16,625 fits — the bounds below accept ALL of them with headroom
# while rejecting the exploded MLEs (λ+μ up to 102) that thin continental-
# cup histories produce for qualifying-round minnows.
ANCHOR_SUM_MIN = 0.5
ANCHOR_SUM_MAX = 7.0
ANCHOR_COMPONENT_MIN = 0.02
ANCHOR_COMPONENT_MAX = 6.0

# ---------------------------------------------------------------------------
# Kernel spec constants — duplicated from match_engine.py ON PURPOSE: that
# module imports torch at module level and this exporter must stay torch-free
# for the CI path. test_engine_kernel_export.py pins the two in agreement.
# ---------------------------------------------------------------------------
N_MINUTES = 90
MAX_GOALS = 10
MAX_INCREMENT = 6
SCORE_DIFF_CLIP = 3
RED_DIFF_CLIP = 2
LOG_MULT_CLAMP = 3.0
N_MINUTE_BUCKETS = N_MINUTES // 5  # 18
N_FEATURES = N_MINUTE_BUCKETS + 1 + (2 * SCORE_DIFF_CLIP + 1) + (
    2 * RED_DIFF_CLIP + 1
) + 1 + 1  # 33


# ---------------------------------------------------------------------------
# Reference implementation (float64 numpy) — the TypeScript port's spec
# ---------------------------------------------------------------------------
def _feature_vector(
    minute_bin: int,
    score_diff: int,
    red_diff: int,
    is_home: float,
    gender_f: float,
) -> np.ndarray:
    """One state-feature vector — mirrors match_engine.build_feature_array."""
    x = np.zeros(N_FEATURES, dtype=np.float64)
    b = min(max(minute_bin, 0), N_MINUTES - 1)
    x[b // 5] = 1.0
    col = N_MINUTE_BUCKETS
    x[col] = 1.0 if (minute_bin == 44 or minute_bin == N_MINUTES - 1) else 0.0
    col += 1
    sd = max(-SCORE_DIFF_CLIP, min(SCORE_DIFF_CLIP, score_diff))
    x[col + sd + SCORE_DIFF_CLIP] = 1.0
    col += 2 * SCORE_DIFF_CLIP + 1
    rd = max(-RED_DIFF_CLIP, min(RED_DIFF_CLIP, red_diff))
    x[col + rd + RED_DIFF_CLIP] = 1.0
    col += 2 * RED_DIFF_CLIP + 1
    x[col] = is_home
    x[col + 1] = gender_f
    return x


def _forward(weights: Dict[str, np.ndarray], x: np.ndarray) -> float:
    """MLP forward pass in float64; log-multiplier clamped to ±LOG_MULT_CLAMP."""
    h = np.maximum(weights["w0"] @ x + weights["b0"], 0.0)
    h = np.maximum(weights["w1"] @ h + weights["b1"], 0.0)
    r = float(weights["w2"] @ h + weights["b2"])
    return max(-LOG_MULT_CLAMP, min(LOG_MULT_CLAMP, r))


def _multiplier_table(
    weights: Dict[str, np.ndarray], gender_f: float, red_diff_home: int
) -> np.ndarray:
    """f/g multipliers over (minute bin, home score diff, side) — [90, 21, 2]."""
    n_diff = 2 * MAX_GOALS + 1
    table = np.empty((N_MINUTES, n_diff, 2), dtype=np.float64)
    for side, (is_home, sign) in enumerate(((1.0, 1), (0.0, -1))):
        for t in range(N_MINUTES):
            for d in range(n_diff):
                diff = d - MAX_GOALS
                x = _feature_vector(
                    t, sign * diff, sign * red_diff_home, is_home, gender_f
                )
                table[t, d, side] = np.exp(_forward(weights, x))
    return table


def reference_rollout(
    weights: Dict[str, np.ndarray],
    lam: float,
    mu: float,
    rho: float,
    gender_f: float,
    minute: int,
    score: Tuple[int, int],
    reds: Tuple[int, int],
) -> Dict[str, object]:
    """Distribution from a match state — semantics of kernel.ts simulateFrom.

    Input hygiene matches the TS port: minute clamps to 0..90 (stoppage/extra
    time collapses onto the 90' state), goals clamp onto the 0..MAX_GOALS
    lattice, and the red-card difference is held fixed for the remainder
    (the v0 covariate treatment).
    """
    m = min(max(int(minute), 0), N_MINUTES)
    h0 = min(max(int(score[0]), 0), MAX_GOALS)
    a0 = min(max(int(score[1]), 0), MAX_GOALS)
    red_diff_home = int(reds[0]) - int(reds[1])

    table = _multiplier_table(weights, gender_f, red_diff_home)
    size = MAX_GOALS + 1
    prob = np.zeros((size, size), dtype=np.float64)
    prob[h0, a0] = 1.0
    hh, aa = np.meshgrid(np.arange(size), np.arange(size), indexing="ij")
    diff_idx = (hh - aa) + MAX_GOALS

    for t in range(m, N_MINUTES):
        nu_h = (lam / N_MINUTES) * table[t, diff_idx, 0]
        nu_a = (mu / N_MINUTES) * table[t, diff_idx, 1]
        pmf_h = _poisson_pmfs(nu_h)
        pmf_a = _poisson_pmfs(nu_a)
        new = np.zeros_like(prob)
        for k in range(MAX_INCREMENT + 1):
            wk = prob * pmf_h[k]
            if k:
                wk = wk[: size - k, :]
            for j in range(MAX_INCREMENT + 1):
                w = wk * (pmf_a[j][: size - k, :] if k else pmf_a[j])
                if j:
                    new[k:, j:] += w[:, : size - j]
                elif k:
                    new[k:, :] += w
                else:
                    new += w
        prob = new

    # Dixon-Coles low-score dependence correction, then renormalise.
    prob[0, 0] *= 1.0 - lam * mu * rho
    prob[0, 1] *= 1.0 + lam * rho
    prob[1, 0] *= 1.0 + mu * rho
    prob[1, 1] *= 1.0 - rho
    prob = np.clip(prob, 0.0, None)
    total = prob.sum()
    if total > 0:
        prob = prob / total

    idx = np.arange(size)
    p_home = float(prob[idx[:, None] > idx[None, :]].sum())
    p_draw = float(np.trace(prob))
    p_away = float(prob[idx[:, None] < idx[None, :]].sum())
    s = p_home + p_draw + p_away
    if s > 0:
        p_home, p_draw, p_away = p_home / s, p_draw / s, p_away / s

    exp_home = float((idx[:, None] * prob).sum())
    exp_away = float((idx[None, :] * prob).sum())

    cells = [
        (int(h), int(a), float(prob[h, a]))
        for h in range(size)
        for a in range(size)
    ]
    cells.sort(key=lambda c: (-c[2], c[0], c[1]))
    top = [
        {"home": h, "away": a, "p": p} for h, a, p in cells[:TOP_SCORELINES]
    ]
    return {
        "pHome": p_home,
        "pDraw": p_draw,
        "pAway": p_away,
        "expHomeGoals": exp_home,
        "expAwayGoals": exp_away,
        "topScorelines": top,
    }


def _poisson_pmfs(nu: np.ndarray) -> np.ndarray:
    out = np.empty((MAX_INCREMENT + 1,) + nu.shape, dtype=np.float64)
    out[0] = np.exp(-nu)
    for k in range(1, MAX_INCREMENT + 1):
        out[k] = out[k - 1] * nu / k
    return out


# ---------------------------------------------------------------------------
# Weight loading (lazy torch for .pt; committed kernel for the CI path)
# ---------------------------------------------------------------------------
def weights_from_pt(path: Path) -> Tuple[Dict[str, np.ndarray], Dict[str, object]]:
    import torch  # local import: the CI path never reaches this line

    payload = torch.load(path, map_location="cpu", weights_only=False)
    sd = payload["state_dict"]
    weights = {
        "w0": sd["net.0.weight"].numpy().astype(np.float64),
        "b0": sd["net.0.bias"].numpy().astype(np.float64),
        "w1": sd["net.2.weight"].numpy().astype(np.float64),
        "b1": sd["net.2.bias"].numpy().astype(np.float64),
        "w2": sd["net.4.weight"].numpy().astype(np.float64).ravel(),
        "b2": float(sd["net.4.bias"].numpy()[0]),
    }
    meta = {
        "hidden": int(payload["config"]["hidden"]),
        "trained_until": payload.get("metadata", {}).get("trained_until"),
    }
    return weights, meta


def weights_from_kernel(path: Path) -> Tuple[Dict[str, np.ndarray], Dict[str, object]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    w = payload["weights"]
    weights = {
        "w0": np.asarray(w["w0"], dtype=np.float64),
        "b0": np.asarray(w["b0"], dtype=np.float64),
        "w1": np.asarray(w["w1"], dtype=np.float64),
        "b1": np.asarray(w["b1"], dtype=np.float64),
        "w2": np.asarray(w["w2"], dtype=np.float64),
        "b2": float(w["b2"]),
    }
    meta = {
        "hidden": int(payload["config"]["hidden"]),
        "trained_until": payload.get("trained_until"),
    }
    return weights, meta


def validate_weight_shapes(weights: Dict[str, np.ndarray], hidden: int) -> None:
    expect = {
        "w0": (hidden, N_FEATURES),
        "b0": (hidden,),
        "w1": (hidden, hidden),
        "b1": (hidden,),
        "w2": (hidden,),
    }
    for name, shape in expect.items():
        got = tuple(np.asarray(weights[name]).shape)
        if got != shape:
            raise ValueError(f"weight {name}: expected shape {shape}, got {got}")


# ---------------------------------------------------------------------------
# Walk-forward anchors with rho — dominant-source fits + twin inheritance
# ---------------------------------------------------------------------------
def _resolve_team(name: str, vocab: Dict[str, List[str]]) -> Optional[str]:
    """Resolve a minority-source team name into a fitted model's vocabulary.

    ``vocab`` maps normalised model-team names to their original spellings.
    Exact normalised equality wins; otherwise containment (either way, the
    same rule src/lib/match2vec.ts uses for its fixture fallback). Anything
    ambiguous or unmatched resolves to None — refused, never guessed.
    """
    norm = _normalise(name)
    if not norm:
        return None
    exact = vocab.get(norm, [])
    if len(exact) == 1:
        return exact[0]
    if len(exact) > 1:
        return None
    candidates = {
        orig
        for vnorm, origs in vocab.items()
        if norm in vnorm or vnorm in norm
        for orig in origs
    }
    return candidates.pop() if len(candidates) == 1 else None


def anchor_in_bounds(lam: float, mu: float) -> bool:
    return (
        ANCHOR_COMPONENT_MIN <= lam <= ANCHOR_COMPONENT_MAX
        and ANCHOR_COMPONENT_MIN <= mu <= ANCHOR_COMPONENT_MAX
        and ANCHOR_SUM_MIN <= lam + mu <= ANCHOR_SUM_MAX
    )


def compute_anchor_map(
    con, half_life_days: float
) -> Tuple[Dict[str, List[object]], Dict[str, object]]:
    rows = load_covered_matches(con)
    kept, _ = dedupe_by_dominant_covered_source(rows)
    kept_ids = {str(r["match_id"]) for r in kept}
    minority = [r for r in rows if str(r["match_id"]) not in kept_ids]

    # 1) Walk-forward fits for the DOMINANT (competition, season) source
    #    groups only — the population whose anchors passed the in-match gate.
    groups: Dict[Tuple[str, str, int], List[object]] = {}
    for r in kept:
        groups.setdefault(
            (r["competition_id"], r["source"], int(r["season"])), []
        ).append(r)

    anchors: Dict[str, List[object]] = {}
    anchor_comp: Dict[str, str] = {}
    stats: Dict[str, object] = {
        "covered_rows": len(rows),
        "dominant_rows": len(kept),
        "minority_twin_rows": len(minority),
        "groups": len(groups),
        "groups_fitted": 0,
        "groups_thin_history": 0,
    }
    dominant_fits: Dict[Tuple[str, int], object] = {}
    for (comp, source, season), members in sorted(groups.items()):
        season_start = min(str(r["date_utc"]) for r in members)
        train = _anchor_training_rows(con, comp, source, season_start)
        if len(train) < MIN_ANCHOR_MATCHES:
            stats["groups_thin_history"] += 1
            continue
        model = fit_dixon_coles(
            train, half_life_days=half_life_days, ref_date=season_start
        )
        stats["groups_fitted"] += 1
        dominant_fits[(comp, season)] = model
        rho = round(float(model.rho), ANCHOR_DECIMALS)
        for r in members:
            lam, mu = model.expected_goals(r["home"], r["away"])
            match_id = str(r["match_id"])
            anchors[match_id] = [
                round(float(lam), ANCHOR_DECIMALS),
                round(float(mu), ANCHOR_DECIMALS),
                rho,
                1 if r["gender"] == "F" else 0,
            ]
            anchor_comp[match_id] = comp

    # 2) Minority-source ids (cross-source twins AND fixtures the dominant
    #    source never listed) inherit the DOMINANT fit: the group's already-
    #    fitted walk-forward model — the exact population the in-match gate
    #    scored — evaluated at the fixture's teams resolved into the model's
    #    vocabulary. Minority-source histories are thin and their own fits
    #    produce wild MLEs, so an unresolvable side stays unanchored.
    vocab_cache: Dict[Tuple[str, int], Dict[str, List[str]]] = {}
    minority_anchored = unresolved_names = no_dominant_fit = 0
    for r in minority:
        key = (str(r["competition_id"]), int(r["season"]))
        model = dominant_fits.get(key)
        if model is None:
            no_dominant_fit += 1
            continue
        vocab = vocab_cache.get(key)
        if vocab is None:
            vocab = {}
            for team in model.teams:
                vocab.setdefault(_normalise(team), []).append(team)
            vocab_cache[key] = vocab
        home = _resolve_team(str(r["home"]), vocab)
        away = _resolve_team(str(r["away"]), vocab)
        if home is None or away is None:
            unresolved_names += 1
            continue
        lam, mu = model.expected_goals(home, away)
        match_id = str(r["match_id"])
        anchors[match_id] = [
            round(float(lam), ANCHOR_DECIMALS),
            round(float(mu), ANCHOR_DECIMALS),
            round(float(model.rho), ANCHOR_DECIMALS),
            1 if r["gender"] == "F" else 0,
        ]
        anchor_comp[match_id] = key[0]
        minority_anchored += 1
    stats["minority_anchored_from_dominant_fit"] = minority_anchored
    stats["minority_unresolved_names"] = unresolved_names
    stats["minority_no_dominant_fit"] = no_dominant_fit

    # 3) Sanity gate: drop out-of-bounds anchors LOUDLY (the fork route then
    #    answers available:false — an honest gap, never a nonsense number).
    dropped_by_comp: Dict[str, int] = {}
    for match_id in sorted(anchors):
        lam, mu = float(anchors[match_id][0]), float(anchors[match_id][1])
        if not anchor_in_bounds(lam, mu):
            comp = anchor_comp[match_id]
            dropped_by_comp[comp] = dropped_by_comp.get(comp, 0) + 1
            del anchors[match_id]
    stats["validation_bounds"] = {
        "sum_min": ANCHOR_SUM_MIN,
        "sum_max": ANCHOR_SUM_MAX,
        "component_min": ANCHOR_COMPONENT_MIN,
        "component_max": ANCHOR_COMPONENT_MAX,
    }
    stats["validation_dropped"] = sum(dropped_by_comp.values())
    stats["validation_dropped_by_competition"] = dict(
        sorted(dropped_by_comp.items())
    )
    stats["anchored_matches"] = len(anchors)
    return anchors, stats


# ---------------------------------------------------------------------------
# Parity fixture — fixed anchors/states so the fixture only changes when the
# WEIGHTS change (daily anchor refreshes must not churn it)
# ---------------------------------------------------------------------------
PARITY_CASES: List[Dict[str, object]] = [
    # name, anchor(lambda, mu, rho, gender), state(minute, hg, ag, hr, ar)
    {"name": "kickoff-m", "anchor": (1.55, 1.15, -0.05, "M"), "state": (0, 0, 0, 0, 0)},
    {"name": "kickoff-f", "anchor": (1.35, 1.25, -0.02, "F"), "state": (0, 0, 0, 0, 0)},
    {"name": "level-15-m", "anchor": (1.8, 0.95, -0.08, "M"), "state": (15, 0, 0, 0, 0)},
    {"name": "level-15-f", "anchor": (1.05, 1.45, 0.01, "F"), "state": (15, 0, 0, 0, 0)},
    {"name": "lead1-30-m", "anchor": (1.6, 1.2, -0.06, "M"), "state": (30, 1, 0, 0, 0)},
    {"name": "trail1-30-f", "anchor": (1.5, 1.3, -0.04, "F"), "state": (30, 0, 1, 0, 0)},
    {"name": "half-time-level", "anchor": (1.4, 1.1, -0.05, "M"), "state": (45, 1, 1, 0, 0)},
    {"name": "half-time-2up", "anchor": (2.6, 0.7, -0.12, "M"), "state": (45, 2, 0, 0, 0)},
    {"name": "lead1-60-m", "anchor": (1.45, 1.25, -0.05, "M"), "state": (60, 2, 1, 0, 0)},
    {"name": "trail1-60-f", "anchor": (1.2, 1.2, 0.0, "F"), "state": (60, 1, 2, 0, 0)},
    {"name": "lead1-75-m", "anchor": (1.7, 1.05, -0.07, "M"), "state": (75, 1, 0, 0, 0)},
    {"name": "trail1-75-m", "anchor": (1.7, 1.05, -0.07, "M"), "state": (75, 0, 1, 0, 0)},
    {"name": "trail2-75-f", "anchor": (1.3, 1.35, -0.03, "F"), "state": (75, 0, 2, 0, 0)},
    {"name": "red-down-30", "anchor": (1.5, 1.2, -0.05, "M"), "state": (30, 0, 0, 1, 0)},
    {"name": "red-up-60", "anchor": (1.5, 1.2, -0.05, "M"), "state": (60, 1, 1, 0, 1)},
    {"name": "two-reds-diff", "anchor": (1.25, 1.3, -0.02, "F"), "state": (50, 0, 1, 2, 0)},
    {"name": "blowout-5-0", "anchor": (3.1, 0.55, -0.15, "M"), "state": (70, 5, 0, 0, 0)},
    {"name": "goalfest-3-3", "anchor": (2.2, 1.9, -0.09, "M"), "state": (80, 3, 3, 0, 0)},
    {"name": "late-85", "anchor": (1.6, 1.1, -0.06, "M"), "state": (85, 1, 1, 0, 0)},
    {"name": "final-whistle-90", "anchor": (1.5, 1.2, -0.05, "M"), "state": (90, 2, 1, 0, 0)},
    {"name": "stoppage-93-clamps", "anchor": (1.5, 1.2, -0.05, "F"), "state": (93, 0, 0, 0, 0)},
]


def build_parity_fixture(weights: Dict[str, np.ndarray]) -> Dict[str, object]:
    cases = []
    for case in PARITY_CASES:
        lam, mu, rho, gender = case["anchor"]  # type: ignore[misc]
        minute, hg, ag, hr, ar = case["state"]  # type: ignore[misc]
        expected = reference_rollout(
            weights,
            float(lam),
            float(mu),
            float(rho),
            1.0 if gender == "F" else 0.0,
            int(minute),
            (int(hg), int(ag)),
            (int(hr), int(ar)),
        )
        cases.append(
            {
                "name": case["name"],
                "anchor": {
                    "lambda": lam,
                    "mu": mu,
                    "rho": rho,
                    "gender": gender,
                },
                "state": {
                    "minute": minute,
                    "homeGoals": hg,
                    "awayGoals": ag,
                    "homeReds": hr,
                    "awayReds": ar,
                },
                "expected": expected,
            }
        )
    return {
        "schema": SCHEMA_VERSION,
        "tolerance": PARITY_TOLERANCE,
        "cases": cases,
    }


def verify_parity_fixture(
    weights: Dict[str, np.ndarray], fixture_path: Path
) -> float:
    """Worst |Δp| between the current weights and the committed fixture."""
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    worst = 0.0
    for case in fixture["cases"]:
        anchor, state = case["anchor"], case["state"]
        got = reference_rollout(
            weights,
            float(anchor["lambda"]),
            float(anchor["mu"]),
            float(anchor["rho"]),
            1.0 if anchor["gender"] == "F" else 0.0,
            int(state["minute"]),
            (int(state["homeGoals"]), int(state["awayGoals"])),
            (int(state["homeReds"]), int(state["awayReds"])),
        )
        for key in ("pHome", "pDraw", "pAway"):
            worst = max(worst, abs(got[key] - case["expected"][key]))
    return worst


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Export the Match Engine v0 kernel artifact."
    )
    parser.add_argument("--warehouse", type=Path, default=WAREHOUSE_PATH)
    parser.add_argument("--out", type=Path, default=KERNEL_OUT)
    parser.add_argument("--pt", type=Path, default=WEIGHTS_PT)
    parser.add_argument(
        "--weights",
        choices=["auto", "pt", "kernel"],
        default="auto",
        help="Weight source: the trained .pt checkpoint (torch required), "
        "the committed kernel artifact (torch-free CI path), or auto "
        "(.pt when present, else kernel)",
    )
    parser.add_argument(
        "--half-life", type=float, default=DEFAULT_HALF_LIFE_DAYS
    )
    parser.add_argument("--parity-out", type=Path, default=PARITY_FIXTURE)
    parser.add_argument(
        "--no-parity",
        action="store_true",
        help="Skip parity fixture generation/verification",
    )
    args = parser.parse_args(argv)

    t0 = time.time()
    source = args.weights
    if source == "auto":
        source = "pt" if args.pt.exists() else "kernel"
    if source == "pt":
        weights, meta = weights_from_pt(args.pt)
        print(f"Weights: {args.pt} (trained_until={meta['trained_until']})")
    else:
        if not args.out.exists():
            print(
                f"!! No weight source: {args.pt} is absent and {args.out} "
                f"does not exist yet. Train the engine locally "
                f"(python -m backend.scripts.train_match_engine) and re-run."
            )
            return 1
        weights, meta = weights_from_kernel(args.out)
        print(
            f"Weights: re-used from committed {args.out} "
            f"(trained_until={meta['trained_until']})"
        )
    validate_weight_shapes(weights, meta["hidden"])

    # Parity: regenerate from fresh .pt weights; verify on the re-use path.
    if not args.no_parity:
        if source == "pt":
            fixture = build_parity_fixture(weights)
            args.parity_out.parent.mkdir(parents=True, exist_ok=True)
            args.parity_out.write_text(
                json.dumps(fixture, indent=1, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            print(f"Parity fixture: {args.parity_out} ({len(fixture['cases'])} cases)")
        elif args.parity_out.exists():
            worst = verify_parity_fixture(weights, args.parity_out)
            print(f"Parity fixture verification: worst |Δp| = {worst:.2e}")
            if worst > PARITY_TOLERANCE:
                print(
                    "!! Committed kernel weights no longer reproduce the "
                    "committed parity fixture — refusing to export. "
                    "Regenerate both from the trained checkpoint."
                )
                return 1

    con = connect_readonly(args.warehouse)
    try:
        anchors, stats = compute_anchor_map(con, args.half_life)
    finally:
        con.close()
    print(
        f"Anchors: {stats['anchored_matches']} matches "
        f"({stats['groups_fitted']} dominant groups fitted, "
        f"{stats['groups_thin_history']} thin-history groups skipped; "
        f"{stats['minority_anchored_from_dominant_fit']} minority ids "
        f"anchored from the dominant fit, "
        f"{stats['minority_unresolved_names']} unresolved-name, "
        f"{stats['minority_no_dominant_fit']} no-dominant-fit)"
    )
    if stats["validation_dropped"]:
        print(
            f"Validation: DROPPED {stats['validation_dropped']} "
            f"out-of-bounds anchors "
            f"(λ+μ outside [{ANCHOR_SUM_MIN}, {ANCHOR_SUM_MAX}] or a "
            f"component outside [{ANCHOR_COMPONENT_MIN}, "
            f"{ANCHOR_COMPONENT_MAX}]) by competition:"
        )
        for comp, n in stats["validation_dropped_by_competition"].items():
            print(f"    {comp}: {n}")
    else:
        print("Validation: all anchors within bounds")

    payload = {
        "schema": SCHEMA_VERSION,
        "generated_at": datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat(),
        "config": {
            "hidden": meta["hidden"],
            "version": "v0",
            "n_features": N_FEATURES,
            "n_minutes": N_MINUTES,
            "max_goals": MAX_GOALS,
            "max_increment": MAX_INCREMENT,
            "score_diff_clip": SCORE_DIFF_CLIP,
            "red_diff_clip": RED_DIFF_CLIP,
            "log_mult_clamp": LOG_MULT_CLAMP,
            "anchor_decimals": ANCHOR_DECIMALS,
            "top_scorelines": TOP_SCORELINES,
        },
        "trained_until": meta["trained_until"],
        "anchor_stats": stats,
        "weights": {
            "w0": weights["w0"].tolist(),
            "b0": weights["b0"].tolist(),
            "w1": weights["w1"].tolist(),
            "b1": weights["b1"].tolist(),
            "w2": weights["w2"].tolist(),
            "b2": weights["b2"],
        },
        "anchors": {k: anchors[k] for k in sorted(anchors)},
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(payload, indent=1, sort_keys=True) + "\n", encoding="utf-8"
    )
    size_mb = args.out.stat().st_size / 1e6
    print(
        f"Kernel: {args.out} ({size_mb:.2f} MB, "
        f"{stats['anchored_matches']} anchors) [{time.time() - t0:.0f}s]"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
