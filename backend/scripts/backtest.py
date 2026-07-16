"""Pluggable walk-forward backtest — Dixon-Coles vs Match Engine v0 (vs market).

The gate for Match Engine v0 (VISION_2030 §8): beat Dixon-Coles on held-out
Brier, scored by ONE harness (``_backtest_core``) on byte-identical fixtures
with identical information sets. Both models refit/fine-tune per matchday
block on matches strictly before the block; both skip the same blocks
(MIN_FIT_MATCHES); both are compared against uniform and the de-vigged
bookmaker market on the odds subset.

Match Engine predictor
----------------------
* λ_DC/μ_DC anchors: the block's Dixon-Coles fit (shared with the DC
  predictor via ``BlockContext.dc_model`` — the exact same fit object).
* Residual net: warm-started from the committed base weights
  (``backend/data/models/match_engine_v0.pt``, trained STRICTLY BEFORE the
  first scored block — the checkpoint's ``trained_until`` metadata is
  enforced against every block start), then fine-tuned a few epochs per block
  on the event-covered subset of the block's training cut, carrying weights
  forward block to block within a competition (approved warm-start design).
* Prediction: exact forward DP from the kickoff state (0-0, red_diff fixed
  at 0 — v0 treats red cards as an observed training covariate, not a
  pre-match process).

Artifact (committed): ``backend/data/diagnostics/engine_v0_vs_dc.json`` with
per-competition DC/engine/market Brier, pooled deltas and a paired
block-bootstrap CI on ΔBrier.

Run
---
    python -m backend.scripts.backtest --predictors dixon_coles \
        --competitions eng.1
    python -m backend.scripts.backtest \
        --predictors dixon_coles match_engine_v0 \
        --competitions eng.1 esp.1 ita.1 fra.1 ger.1 usa.1.w
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

from backend.scripts._backtest_core import (  # noqa: E402
    BlockContext,
    CompetitionReport,
    DixonColesPredictor,
    MatchRecord,
    Probs,
    ScoreAccumulator,
    paired_block_bootstrap,
    run_backtest,
)
from backend.scripts.train_dixon_coles import (  # noqa: E402
    WAREHOUSE_PATH,
    connect_readonly,
)

DIAGNOSTICS_OUT = (
    ROOT / "backend" / "data" / "diagnostics" / "engine_v0_vs_dc.json"
)
DEFAULT_WEIGHTS = ROOT / "backend" / "data" / "models" / "match_engine_v0.pt"
DEFAULT_DATASET = ROOT / "backend" / "data" / "cache" / "engine"

ENGINE = "match_engine_v0"
DC = DixonColesPredictor.name


# ---------------------------------------------------------------------------
# Match Engine predictor
# ---------------------------------------------------------------------------
class MatchEnginePredictor:
    """DC-anchored Match Engine v0 with per-block warm-start fine-tuning."""

    name = ENGINE

    def __init__(
        self,
        weights_path: Path = DEFAULT_WEIGHTS,
        dataset_dir: Path = DEFAULT_DATASET,
        finetune_epochs: int = 2,
        finetune_lr: float = 1e-4,
        batch_matches: int = 512,
        seed: int = 20260715,
    ) -> None:
        import torch

        from backend.scripts.train_match_engine import EngineDataset
        from backend.services.prediction.match_engine import load_engine

        self._torch = torch
        payload = torch.load(weights_path, map_location="cpu", weights_only=False)
        self.net, self.config = load_engine(payload)
        self.metadata = dict(payload.get("metadata", {}))
        self.trained_until: Optional[str] = self.metadata.get("trained_until")
        self.dataset = EngineDataset(dataset_dir)
        self.finetune_epochs = finetune_epochs
        self.finetune_lr = finetune_lr
        self.batch_matches = batch_matches
        self.seed = seed
        self._base_state = {
            k: v.detach().clone() for k, v in self.net.state_dict().items()
        }
        # Per-competition carried weights + fine-tune progress marker.
        self._comp_state: Dict[str, Dict[str, object]] = {}
        self._ctx: Optional[BlockContext] = None
        self._rho: float = 0.0
        self._gender_f: float = 0.0
        self._rng = np.random.default_rng(seed)

    # -- block fitting -----------------------------------------------------
    def fit_block(self, ctx: BlockContext) -> None:
        from backend.services.prediction.match_engine import hazard_nll

        torch = self._torch
        # LEAKAGE GUARD: base weights must predate every scored block.
        if self.trained_until is not None and not (
            str(self.trained_until) <= ctx.block_start
        ):
            raise RuntimeError(
                f"match_engine_v0 base weights were trained on data up to "
                f"{self.trained_until}, which is not <= block start "
                f"{ctx.block_start} — refusing to score a leaky backtest. "
                f"Retrain with --until <first block date>."
            )
        comp = ctx.competition_id
        state = self._comp_state.get(comp)
        if state is None:
            self.net.load_state_dict(self._base_state)
            state = {"finetuned_until": None}
            self._comp_state[comp] = state
        else:
            self.net.load_state_dict(state["weights"])  # type: ignore[arg-type]

        # Fine-tune on the event-covered subset of this comp strictly before
        # the block (same information set as the DC refit; dataset anchors
        # are themselves walk-forward, so nothing post-dates the block).
        idx = self.dataset.eligible_indices(
            competition=comp, until=ctx.block_start
        )
        if len(idx) >= 32 and self.finetune_epochs > 0:
            if state["finetuned_until"] != ctx.block_start:
                self.net.train()
                optim = torch.optim.Adam(
                    self.net.parameters(), lr=self.finetune_lr
                )
                for _ in range(self.finetune_epochs):
                    perm = self._rng.permutation(len(idx))
                    for s in range(0, len(perm), self.batch_matches):
                        b = idx[perm[s : s + self.batch_matches]]
                        feats, labels, base = self.dataset.batch(b)
                        optim.zero_grad()
                        log_mult = self.net(torch.from_numpy(feats))
                        loss = hazard_nll(
                            log_mult,
                            torch.from_numpy(base),
                            torch.from_numpy(labels),
                        )
                        loss.backward()
                        optim.step()
        self.net.eval()
        state["weights"] = {
            k: v.detach().clone() for k, v in self.net.state_dict().items()
        }
        state["finetuned_until"] = ctx.block_start

        self._ctx = ctx
        self._rho = float(ctx.dc_model.rho)
        self._gender_f = 1.0 if ctx.gender == "F" else 0.0

    # -- prediction ----------------------------------------------------------
    def predict(self, home: str, away: str, ref_date: str) -> Optional[Probs]:
        from backend.services.prediction.match_engine import (
            outcome_probs,
            score_matrix,
        )

        assert self._ctx is not None, "fit_block must be called first"
        lam, mu = self._ctx.dc_model.expected_goals(home, away)
        mat = score_matrix(lam, mu, self._rho, self.net, self._gender_f)
        return outcome_probs(mat)


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------
def print_multi_report(
    reports: List[CompetitionReport], predictor_names: List[str]
) -> None:
    line = "-" * 78
    print()
    print("=" * 78)
    print("PLUGGABLE WALK-FORWARD BACKTEST")
    print("(identical fixtures & information set per predictor; lower is better)")
    print("=" * 78)
    for r in reports:
        n_scored = next(iter(r.all_acc.values())).n
        print()
        print(
            f"{r.competition_id}  season {r.season}  (source={r.source}, "
            f"{n_scored} matches scored across {r.n_blocks} matchday blocks"
            + (f", {r.skipped} skipped: insufficient history" if r.skipped else "")
            + ")"
        )
        print(line)
        print(f"{'model':<30}{'n':>6}{'Brier':>10}{'log-loss':>10}{'top-1 acc':>11}")
        print(line)
        rows: List[Tuple[str, ScoreAccumulator]] = [
            (f"{name} (all)", r.all_acc[name]) for name in predictor_names
        ]
        rows.append(("uniform 1/3 (all)", r.uni_all))
        if r.mkt.n:
            rows += [
                (f"{name} (odds subset)", r.odds_acc[name])
                for name in predictor_names
            ]
            rows += [
                ("market de-vig (odds subset)", r.mkt),
                ("uniform 1/3 (odds subset)", r.uni_mkt),
            ]
        for label, acc in rows:
            print(
                f"{label:<30}{acc.n:>6}{acc.brier:>10.4f}"
                f"{acc.logloss:>10.4f}{acc.accuracy:>11.3f}"
            )
        print(line)
        if ENGINE in r.all_acc and DC in r.all_acc:
            delta = r.all_acc[ENGINE].brier - r.all_acc[DC].brier
            verdict = "ENGINE better" if delta < 0 else "DC better"
            print(f"  engine - DC Brier: {delta:+.4f}  ({verdict})")


def build_artifact(
    reports: List[CompetitionReport],
    records: List[MatchRecord],
    predictor_names: List[str],
    n_boot: int,
    args_meta: Dict[str, object],
) -> Dict[str, object]:
    per_comp: Dict[str, object] = {}
    for r in reports:
        entry: Dict[str, object] = {
            "season": r.season,
            "source": r.source,
            "n": next(iter(r.all_acc.values())).n,
            "blocks": r.n_blocks,
            "skipped": r.skipped,
            "uniform_brier": round(r.uni_all.brier, 6),
        }
        for name in predictor_names:
            key = "dc" if name == DC else ("engine" if name == ENGINE else name)
            entry[f"{key}_brier"] = round(r.all_acc[name].brier, 6)
            entry[f"{key}_logloss"] = round(r.all_acc[name].logloss, 6)
            entry[f"{key}_accuracy"] = round(r.all_acc[name].accuracy, 6)
        if r.mkt.n:
            entry["market_brier"] = round(r.mkt.brier, 6)
            entry["market_n"] = r.mkt.n
            for name in predictor_names:
                key = "dc" if name == DC else (
                    "engine" if name == ENGINE else name
                )
                entry[f"{key}_brier_odds_subset"] = round(
                    r.odds_acc[name].brier, 6
                )
        else:
            entry["market_brier"] = None
            entry["market_n"] = 0
        if DC in r.all_acc and ENGINE in r.all_acc:
            entry["delta"] = round(
                r.all_acc[ENGINE].brier - r.all_acc[DC].brier, 6
            )
            comp_records = [
                rec for rec in records if rec.competition_id == r.competition_id
            ]
            entry["bootstrap"] = paired_block_bootstrap(
                comp_records, DC, ENGINE, n_boot=n_boot
            )
        per_comp[r.competition_id] = entry

    pooled: Dict[str, object] = {}
    if records and DC in predictor_names and ENGINE in predictor_names:
        from backend.scripts._backtest_core import brier as brier_fn

        dc_scores = [brier_fn(rec.probs[DC], rec.outcome) for rec in records]
        en_scores = [brier_fn(rec.probs[ENGINE], rec.outcome) for rec in records]
        pooled = {
            "n": len(records),
            "dc_brier": round(float(np.mean(dc_scores)), 6),
            "engine_brier": round(float(np.mean(en_scores)), 6),
            "delta": round(float(np.mean(en_scores) - np.mean(dc_scores)), 6),
            "bootstrap": paired_block_bootstrap(records, DC, ENGINE, n_boot=n_boot),
        }
        mkt_records = [rec for rec in records if rec.market is not None]
        if mkt_records:
            pooled["odds_subset"] = {
                "n": len(mkt_records),
                "dc_brier": round(
                    float(
                        np.mean(
                            [brier_fn(m.probs[DC], m.outcome) for m in mkt_records]
                        )
                    ),
                    6,
                ),
                "engine_brier": round(
                    float(
                        np.mean(
                            [
                                brier_fn(m.probs[ENGINE], m.outcome)
                                for m in mkt_records
                            ]
                        )
                    ),
                    6,
                ),
                "market_brier": round(
                    float(
                        np.mean(
                            [brier_fn(m.market, m.outcome) for m in mkt_records]
                        )
                    ),
                    6,
                ),
            }
        gate_pass = bool(
            pooled["delta"] < 0
            and pooled["bootstrap"] is not None
            and pooled["bootstrap"]["ci_high"] < 0
        )
        pooled["gate"] = {
            "criterion": "engine pooled Brier < DC pooled Brier AND paired "
            "block-bootstrap 95% CI on ΔBrier entirely below 0",
            "passed": gate_pass,
        }
    return {
        "schema": 1,
        "generated_at": datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat(),
        "predictors": predictor_names,
        "run": args_meta,
        "competitions": per_comp,
        "pooled": pooled,
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Pluggable walk-forward backtest (DC, Match Engine v0)."
    )
    parser.add_argument(
        "--predictors",
        nargs="+",
        default=[DC],
        choices=[DC, ENGINE],
        help="Which predictors to score (default: dixon_coles)",
    )
    parser.add_argument("--competitions", nargs="+", default=["eng.1"])
    parser.add_argument("--season", type=int, default=None)
    parser.add_argument("--seasons", type=int, default=5)
    parser.add_argument("--half-life", type=float, default=390.0)
    parser.add_argument("--warehouse", type=Path, default=WAREHOUSE_PATH)
    parser.add_argument("--engine-weights", type=Path, default=DEFAULT_WEIGHTS)
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument(
        "--finetune-epochs",
        type=int,
        default=2,
        help="Per-block warm-start fine-tune epochs for the engine (0 = off)",
    )
    parser.add_argument("--finetune-lr", type=float, default=1e-4)
    parser.add_argument("--bootstrap", type=int, default=10_000)
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help=f"Write the committed artifact JSON (default: "
        f"{DIAGNOSTICS_OUT} when both predictors run, else no file)",
    )
    args = parser.parse_args(argv)

    predictors: List[object] = []
    for name in args.predictors:
        if name == DC:
            predictors.append(DixonColesPredictor())
        elif name == ENGINE:
            predictors.append(
                MatchEnginePredictor(
                    weights_path=args.engine_weights,
                    dataset_dir=args.dataset,
                    finetune_epochs=args.finetune_epochs,
                    finetune_lr=args.finetune_lr,
                )
            )

    t0 = time.time()
    con = connect_readonly(args.warehouse)
    try:
        reports, records = run_backtest(
            con,
            predictors=predictors,
            competitions=args.competitions,
            season=args.season,
            n_seasons=args.seasons,
            half_life_days=args.half_life,
        )
    finally:
        con.close()

    if not reports:
        print("Nothing to report.")
        return 1
    names = [p.name for p in predictors]
    print_multi_report(reports, names)

    out = args.out
    if out is None and DC in names and ENGINE in names:
        out = DIAGNOSTICS_OUT
    if out is not None:
        artifact = build_artifact(
            reports,
            records,
            names,
            n_boot=args.bootstrap,
            args_meta={
                "competitions": args.competitions,
                "season": args.season,
                "seasons_window": args.seasons,
                "half_life_days": args.half_life,
                "finetune_epochs": args.finetune_epochs,
                "finetune_lr": args.finetune_lr,
                "wall_clock_seconds": round(time.time() - t0, 1),
            },
        )
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(
            json.dumps(artifact, indent=2, ensure_ascii=False, sort_keys=True)
            + "\n",
            encoding="utf-8",
        )
        print(f"\nArtifact: {out}")
        if artifact["pooled"]:
            pooled = artifact["pooled"]
            print(
                f"POOLED: DC {pooled['dc_brier']:.4f}  "
                f"engine {pooled['engine_brier']:.4f}  "
                f"delta {pooled['delta']:+.4f}  "
                f"gate {'PASSED' if pooled['gate']['passed'] else 'FAILED'}"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
