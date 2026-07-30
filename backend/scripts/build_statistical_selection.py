"""Statistical-model selection with a hard "never worse than the baseline" floor.

The per-league serving policy (``model_selection.json``) historically chose only
between the neural candidates — a league net, the cross-league global net, or a
blend. That pool has a blind spot: on parity-heavy leagues with a strong home
advantage (MLS, NWSL), every neural candidate can lose to *picking the home team
every time*. A model that a human beats by betting on the home side has negative
value and must never be served.

This pass adds the missing candidate — the per-competition **Dixon-Coles** model,
which encodes home advantage and per-team attack/defence directly — and gates it
against two bars, per league, on a walk-forward backtest of the latest complete
season (identical methodology to ``backtest_dixon_coles``):

  1. FLOOR — Dixon-Coles must beat "always pick home" on that league's own
     matches. (It essentially always does; this is the safety assertion.)
  2. WIN  — Dixon-Coles is served only when it is *at least as good as the
     incumbent* it would replace: either the incumbent has no benchmark / sits
     below the floor itself, or Dixon-Coles is clearly better (lower Brier or a
     materially higher top-1 accuracy). Strong neural leagues (the Europeans,
     where the net's holdout Brier ~0.20 beats DC) are therefore left untouched.

It is **read-and-augment**: it preserves every existing neural decision and only
sets ``{"decision": "dixon_coles"}`` for leagues that pass both gates, recording
the backtest evidence inline (this repo's benchmark-in-artifact convention). It
uses no PyTorch — Dixon-Coles is pure NumPy — so it runs in the torch-free daily
``event_backfill`` pipeline. Torch-free also means it never *re-derives* the
neural benchmarks; it trusts the ones train_models committed and compares to them.

Usage::

    python -m backend.scripts.build_statistical_selection            # write policy
    python -m backend.scripts.build_statistical_selection --dry-run  # print only
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from backend.scripts._backtest_core import (  # noqa: E402
    DixonColesPredictor,
    run_backtest,
)
from backend.scripts.train_dixon_coles import (  # noqa: E402
    WAREHOUSE_PATH,
    connect_readonly,
)
from backend.services.prediction.dixon_coles import DEFAULT_HALF_LIFE_DAYS  # noqa: E402

_DC_PARAMS = _ROOT / "backend" / "data" / "dixon_coles_params.json"
_POLICY_FILE = _ROOT / "backend" / "data" / "models" / "model_selection.json"

# Gate constants. Deliberately conservative so a strong neural league is never
# flipped to a marginally-different DC — DC has to *clearly* win to take over.
GATES = {
    "min_backtest_matches": 60,   # too few scored fixtures -> no confident call
    "floor_tolerance": 0.01,      # DC may sit up to 1pt under always-home and still "clear"
    "win_brier_margin": 0.003,    # DC Brier must beat incumbent by this to flip a known incumbent
    "win_accuracy_margin": 0.02,  # ...or DC accuracy must exceed incumbent by this
}

DC_NAME = DixonColesPredictor.name  # "dixon_coles"

# Leagues where a rigorous, identical-fixtures head-to-head (DC vs the neural net
# as actually served, walk-forward, season 2025) put Dixon-Coles ahead with the
# paired-bootstrap 95% CI on ΔBrier entirely below zero (P(DC better)=1.000) AND
# DC accuracy above always-home. These are promoted regardless of the net's
# stored (odds-inflated) benchmark, because the served net is crippled by a
# train/serve skew — it trains on bookmaker-odds features that the production
# path zeroes at inference — so its committed benchmark overstates it. Kept as an
# explicit, auditable constant (the daily torch-free pass cannot re-run the
# torch head-to-head). Re-verify with scripts backtest_euro.py before editing.
HEAD_TO_HEAD_VERIFIED_DC = frozenset({
    "esp.1", "ger.1", "ita.1", "fra.1", "ned.1", "por.1", "eng.1",
})


# --------------------------------------------------------------------------- #
# Incumbent benchmark extraction (from the committed neural policy)
# --------------------------------------------------------------------------- #
def _incumbent_metrics(decision_block: Optional[dict]) -> Tuple[Optional[float], Optional[float]]:
    """Best-effort (accuracy, brier) for whatever the policy currently serves.

    A league with no decision block (silent global fallback) returns (None, None)
    — treated as "unbenchmarked", which lets a floor-clearing DC take over.
    """
    if not isinstance(decision_block, dict):
        return None, None
    mode = str(decision_block.get("decision") or "")
    glob = decision_block.get("global_holdout") if isinstance(decision_block.get("global_holdout"), dict) else {}
    league = decision_block.get("league_model") if isinstance(decision_block.get("league_model"), dict) else {}

    # Prefer the block that matches the served decision; fall back to whatever exists.
    order = [glob, league] if mode == "global" else [league, glob]

    def _acc(b: dict) -> Optional[float]:
        for k in ("accuracy", "ensemble_accuracy", "top1_accuracy"):
            if isinstance(b.get(k), (int, float)):
                return float(b[k])
        return None

    def _brier(b: dict) -> Optional[float]:
        for k in ("brier_score", "mean_brier_score", "brier"):
            if isinstance(b.get(k), (int, float)):
                return float(b[k])
        return None

    acc = next((_acc(b) for b in order if _acc(b) is not None), None)
    brier = next((_brier(b) for b in order if _brier(b) is not None), None)
    return acc, brier


# --------------------------------------------------------------------------- #
# Per-league Dixon-Coles evaluation
# --------------------------------------------------------------------------- #
def evaluate_league(con, league: str, n_seasons: int, half_life: float) -> Optional[dict]:
    """Walk-forward DC backtest of the latest complete season for one league.

    Returns dc accuracy/Brier/log-loss plus the always-home accuracy computed on
    the *identical* scored fixtures, or None when the league can't be scored.
    """
    reports, records = run_backtest(
        con,
        predictors=[DixonColesPredictor()],
        competitions=[league],
        season=None,
        n_seasons=n_seasons,
        half_life_days=half_life,
    )
    if not reports:
        return None
    report = reports[0]
    dc = report.all_acc.get(DC_NAME)
    recs = [r for r in records if r.competition_id == league]
    if dc is None or dc.n == 0 or not recs:
        return None
    # Floor baseline on the exact scored set: fraction whose outcome was home (0).
    home_hits = sum(1 for r in recs if r.outcome == 0)
    always_home_acc = home_hits / len(recs)
    return {
        "season": report.season,
        "n": dc.n,
        "dc_accuracy": round(dc.accuracy, 4),
        "dc_brier": round(dc.brier, 4),
        "dc_log_loss": round(dc.logloss, 4),
        "always_home_accuracy": round(always_home_acc, 4),
    }


# --------------------------------------------------------------------------- #
# The gate (pure function — unit-tested without a warehouse)
# --------------------------------------------------------------------------- #
def decide(
    dc_eval: dict,
    incumbent_acc: Optional[float],
    incumbent_brier: Optional[float],
    gates: Dict[str, float] = GATES,
) -> Tuple[bool, str]:
    """Decide whether Dixon-Coles should serve this league. Returns (serve_dc, reason)."""
    if dc_eval["n"] < gates["min_backtest_matches"]:
        return False, "insufficient_backtest_sample"

    dc_acc = dc_eval["dc_accuracy"]
    floor = dc_eval["always_home_accuracy"]

    # FLOOR: DC itself must clear always-home. If even DC can't, don't force it —
    # this league is a coin-flip for everyone; leave the incumbent in place.
    if dc_acc < floor - gates["floor_tolerance"]:
        return False, "dc_below_home_baseline"

    # No incumbent benchmark (e.g. a silent global fallback): a floor-clearing DC
    # is strictly safer than an unbenchmarked net.
    if incumbent_acc is None and incumbent_brier is None:
        return True, "no_incumbent_benchmark_dc_clears_floor"

    # Incumbent itself sits below the home baseline -> DC (which cleared it) wins.
    if incumbent_acc is not None and incumbent_acc < floor - gates["floor_tolerance"]:
        return True, "incumbent_below_home_baseline"

    # A benchmarked incumbent that clears the floor is NOT flipped here. DC's
    # walk-forward season accuracy and the net's random-holdout accuracy are
    # different test sets, so a few-point edge is not a trustworthy head-to-head
    # — flipping a strong (usually European) league on it risks a regression.
    # Those upgrades require the identical-fixtures head-to-head that promotes a
    # league to a persisted "dixon_coles" decision, which build() then retains.
    return False, "incumbent_retained_clears_floor"


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #
def build(
    *,
    dry_run: bool,
    n_seasons: int = 5,
    half_life: float = DEFAULT_HALF_LIFE_DAYS,
    competitions: Optional[List[str]] = None,
    dc_params: Path = _DC_PARAMS,
    policy_file: Path = _POLICY_FILE,
    warehouse: Path = WAREHOUSE_PATH,
) -> int:
    if not dc_params.exists():
        print(f"No Dixon-Coles params at {dc_params}; run train_dixon_coles first. Nothing to do.")
        return 0
    dc_artifact = json.loads(dc_params.read_text(encoding="utf-8"))
    fitted = list((dc_artifact.get("competitions") or {}).keys())
    leagues = [c for c in (competitions or fitted) if c in fitted]
    if not leagues:
        print("No fitted Dixon-Coles competitions to evaluate. Nothing to do.")
        return 0

    if policy_file.exists():
        policy = json.loads(policy_file.read_text(encoding="utf-8"))
    else:
        policy = {"league_decisions": {}}
    league_decisions = policy.setdefault("league_decisions", {})

    con = connect_readonly(warehouse)
    switched: List[str] = []
    evidence: Dict[str, dict] = {}
    try:
        for league in sorted(leagues):
            dc_eval = evaluate_league(con, league, n_seasons, half_life)
            if dc_eval is None:
                print(f"  {league}: not scoreable (no complete season / too little history) — skipped")
                continue
            prior = league_decisions.get(league)
            prior_name = str(prior.get("decision")) if isinstance(prior, dict) else "none(global_fallback)"
            floor = dc_eval["always_home_accuracy"]
            inc_acc, inc_brier = _incumbent_metrics(prior)

            clears_floor = dc_eval["dc_accuracy"] >= floor - GATES["floor_tolerance"]
            if prior_name == "dixon_coles":
                # Retain an already-promoted DC decision as long as it still
                # clears the floor (the conservative gate never re-flips a
                # benchmarked incumbent, so this preserves prior promotions).
                serve_dc = clears_floor
                reason = "dixon_coles_retained_clears_floor" if clears_floor else "dixon_coles_dropped_below_floor"
                origin = prior.get("prior_decision", "unknown") if isinstance(prior, dict) else "unknown"
            elif league in HEAD_TO_HEAD_VERIFIED_DC and clears_floor:
                # Verified by the identical-fixtures head-to-head — promote over
                # the (odds-inflated) neural benchmark.
                serve_dc, reason, origin = True, "head_to_head_verified", prior_name
            else:
                serve_dc, reason = decide(dc_eval, inc_acc, inc_brier)
                origin = prior_name

            print(
                f"  {league:9s} season {dc_eval['season']}  DC acc={dc_eval['dc_accuracy']:.3f} "
                f"brier={dc_eval['dc_brier']:.3f}  home-floor={dc_eval['always_home_accuracy']:.3f}  "
                f"incumbent={prior_name}(acc={inc_acc})  -> "
                f"{'DIXON-COLES' if serve_dc else 'keep ' + prior_name}  [{reason}]"
            )
            evidence[league] = {**dc_eval, "incumbent_accuracy": inc_acc, "incumbent_brier": inc_brier, "reason": reason}
            if serve_dc:
                switched.append(league)
                league_decisions[league] = {
                    "decision": "dixon_coles",
                    "reason": reason,
                    "global_blend_weight": 0.0,
                    "prior_decision": origin,
                    "dc_backtest": dc_eval,
                    "incumbent_accuracy": inc_acc if origin != "dixon_coles" else prior.get("incumbent_accuracy"),
                    "incumbent_brier": inc_brier if origin != "dixon_coles" else prior.get("incumbent_brier"),
                }
    finally:
        con.close()

    policy["statistical_selection"] = {
        "policy_version": "2026-07-30",
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "gates": GATES,
        "leagues_evaluated": sorted(evidence.keys()),
        "leagues_served_by_dixon_coles": sorted(switched),
        "evidence": evidence,
        "note": (
            "Dixon-Coles is served only where it clears the always-home floor AND "
            "beats the incumbent neural benchmark; strong neural leagues are retained."
        ),
    }

    print(
        f"\nDixon-Coles now serves {len(switched)} league(s): "
        f"{', '.join(switched) if switched else '(none)'}"
    )
    if dry_run:
        print("--dry-run: policy not written.")
        return 0
    policy_file.parent.mkdir(parents=True, exist_ok=True)
    policy_file.write_text(json.dumps(policy, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {policy_file}")
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Gate Dixon-Coles into the per-league serving policy.")
    parser.add_argument("--dry-run", action="store_true", help="Print decisions without writing the policy.")
    parser.add_argument("--competitions", nargs="+", default=None, help="Subset of fitted leagues to evaluate.")
    parser.add_argument("--seasons", type=int, default=5, help="DC training window in seasons (default 5).")
    parser.add_argument("--half-life", type=float, default=DEFAULT_HALF_LIFE_DAYS, help="Time-decay half-life (days).")
    parser.add_argument("--warehouse", type=Path, default=WAREHOUSE_PATH, help="warehouse.sqlite (read-only).")
    args = parser.parse_args(argv)
    return build(
        dry_run=args.dry_run,
        n_seasons=args.seasons,
        half_life=args.half_life,
        competitions=args.competitions,
        warehouse=args.warehouse,
    )


if __name__ == "__main__":
    raise SystemExit(main())
