"""Train Match Engine v0 on the per-minute event dataset.

Teacher-forced Bernoulli-hazard likelihood over every (minute, side) cell of
every anchored match in ``backend/data/cache/engine/`` (built by
``build_event_dataset.py``): the label is "this side scored in this minute
bin" and the model probability is 1 - exp(-λ_DC · f_θ(state)/90). Because the
residual net is zero-initialised, epoch 0 IS the Dixon-Coles anchor — training
can only move away from DC where the state evidence says so.

Controls reported alongside the validation NLL (same likelihood, same cells):

* homogeneous  — one constant hazard per side (home/away), the MLE on the
  training split; the classic "goals fall uniformly" straw man.
* dc_anchor    — f = g = 1 (zero residual): pure walk-forward Dixon-Coles
  pushed through the per-minute likelihood. The engine must beat this on val
  NLL or its residual has learned nothing.

Memory discipline: features are built per batch from the compact uint8 grids
(never the full 5.7M-cell design matrix in RAM), so peak usage stays in the
tens of MB. CPU-only by design.

Checkpointing: every epoch a full training checkpoint (net + optimiser +
epoch) is written next to the dataset; ``--resume`` continues from it, and
``--max-minutes`` makes the process stop cleanly (checkpoint saved) before a
command timeout so long runs can be chained.

Outputs
-------
* weights: ``backend/data/models/match_engine_v0.pt``     (gitignored)
* summary: ``backend/data/diagnostics/match_engine_v0_summary.json`` (committed)

Run
---
    python -m backend.scripts.train_match_engine --gender both
    python -m backend.scripts.train_match_engine --smoke --matches 256
    python -m backend.scripts.train_match_engine --until 2025-03-14 --resume
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
import torch

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services.prediction.match_engine import (  # noqa: E402
    EngineConfig,
    N_MINUTES,
    ResidualNet,
    batch_cell_features,
    engine_state_dict,
    hazard_nll,
)

DATASET_DIR = ROOT / "backend" / "data" / "cache" / "engine"
WEIGHTS_OUT = ROOT / "backend" / "data" / "models" / "match_engine_v0.pt"
SUMMARY_OUT = (
    ROOT / "backend" / "data" / "diagnostics" / "match_engine_v0_summary.json"
)
SMOKE_SUMMARY_OUT = DATASET_DIR / "smoke_summary.json"
CHECKPOINT = DATASET_DIR / "train_checkpoint.pt"


# ---------------------------------------------------------------------------
# Dataset access
# ---------------------------------------------------------------------------
class EngineDataset:
    """Compact grids + metadata, with gender/date filtering."""

    def __init__(self, dataset_dir: Path) -> None:
        data = np.load(dataset_dir / "grids.npz")
        self.goal_home = data["goal_home"]
        self.goal_away = data["goal_away"]
        self.red_home = data["red_home"]
        self.red_away = data["red_away"]
        self.lam_dc = data["lam_dc"].astype(np.float64)
        self.mu_dc = data["mu_dc"].astype(np.float64)
        self.gender = data["gender"]
        self.meta: List[Dict[str, object]] = json.loads(
            (dataset_dir / "matches.json").read_text(encoding="utf-8")
        )
        self.dates = np.array([str(m["date_utc"]) for m in self.meta])
        assert len(self.meta) == self.goal_home.shape[0]

    def eligible_indices(
        self,
        gender: str = "both",
        until: Optional[str] = None,
        competition: Optional[str] = None,
    ) -> np.ndarray:
        """Anchored matches, optionally gender-/date-/competition-filtered."""
        mask = np.isfinite(self.lam_dc) & np.isfinite(self.mu_dc)
        if gender == "M":
            mask &= self.gender == 0
        elif gender == "F":
            mask &= self.gender == 1
        if until is not None:
            mask &= self.dates < until
        if competition is not None:
            comp = np.array([m["competition_id"] for m in self.meta])
            mask &= comp == competition
        idx = np.where(mask)[0]
        order = np.argsort(self.dates[idx], kind="stable")
        return idx[order]  # date-ordered

    def batch(self, idx: np.ndarray) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        return batch_cell_features(
            self.goal_home[idx],
            self.goal_away[idx],
            self.red_home[idx],
            self.red_away[idx],
            self.gender[idx],
            self.lam_dc[idx],
            self.mu_dc[idx],
        )


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------
def evaluate_nll(
    net: Optional[ResidualNet],
    dataset: EngineDataset,
    indices: np.ndarray,
    batch_matches: int = 512,
    homogeneous_nu: Optional[Tuple[float, float]] = None,
) -> float:
    """Mean per-cell hazard NLL. net=None with homogeneous_nu gives controls;
    net=None without gives the dc_anchor (f=g=1) control."""
    total = 0.0
    cells = 0
    if net is not None:
        net.eval()
    with torch.no_grad():
        for start in range(0, len(indices), batch_matches):
            idx = indices[start : start + batch_matches]
            feats, labels, base = dataset.batch(idx)
            if homogeneous_nu is not None:
                half = len(labels) // 2
                base = np.concatenate(
                    [
                        np.full(half, homogeneous_nu[0], dtype=np.float32),
                        np.full(half, homogeneous_nu[1], dtype=np.float32),
                    ]
                )
            base_t = torch.from_numpy(base)
            labels_t = torch.from_numpy(labels)
            if net is None:
                log_mult = torch.zeros_like(base_t)
            else:
                log_mult = net(torch.from_numpy(feats))
            nll = hazard_nll(log_mult, base_t, labels_t)
            total += float(nll) * len(labels)
            cells += len(labels)
    return total / max(cells, 1)


def model_class_floor(dataset: EngineDataset, indices: np.ndarray) -> float:
    """The exact overfit floor of this model class on a set of matches.

    The residual net maps each DISTINCT state-feature vector to one
    log-multiplier in [-LOG_MULT_CLAMP, +LOG_MULT_CLAMP]; cells sharing a
    feature vector (across matches) are therefore forced to share r. The
    floor is the per-group optimal-r NLL — literal NLL→0 is impossible BY
    DESIGN (no match-identity features), so "overfit" in smoke mode means
    converging to this floor.
    """
    from collections import defaultdict

    from scipy.optimize import minimize_scalar

    feats, labels, base = dataset.batch(indices)
    groups: Dict[bytes, List[int]] = defaultdict(list)
    for i, f in enumerate(feats):
        groups[f.tobytes()].append(i)
    total = 0.0
    for idxs in groups.values():
        y = labels[idxs]
        b = base[idxs].astype(np.float64)

        def nll(r: float) -> float:
            nu = np.clip(b * np.exp(r), 1e-8, 20.0)
            return -float(
                (y * np.log(-np.expm1(-nu) + 1e-12) + (1 - y) * (-nu)).sum()
            )

        total += minimize_scalar(nll, bounds=(-3, 3), method="bounded").fun
    return total / len(labels)


def homogeneous_hazard(dataset: EngineDataset, indices: np.ndarray) -> Tuple[float, float]:
    """Per-side constant hazard ν (MLE under the Bernoulli-hazard likelihood)."""
    p_home = float((dataset.goal_home[indices] > 0).mean())
    p_away = float((dataset.goal_away[indices] > 0).mean())
    eps = 1e-6
    return (
        -float(np.log(max(1.0 - p_home, eps))),
        -float(np.log(max(1.0 - p_away, eps))),
    )


# ---------------------------------------------------------------------------
# Training loop
# ---------------------------------------------------------------------------
def train(args: argparse.Namespace) -> int:
    t0 = time.time()
    torch.manual_seed(args.seed)
    torch.set_num_threads(args.threads)
    rng = np.random.default_rng(args.seed)

    dataset = EngineDataset(args.dataset)
    eligible = dataset.eligible_indices(gender=args.gender, until=args.until)
    if args.smoke:
        eligible = eligible[: args.matches]
    if len(eligible) < 32:
        print(f"Only {len(eligible)} eligible matches — nothing to train on.")
        return 1

    # Date-ordered split: the validation tail is strictly later than training.
    n_val = 0 if args.smoke else max(int(len(eligible) * args.val_frac), 1)
    train_idx = eligible[: len(eligible) - n_val] if n_val else eligible
    val_idx = eligible[len(eligible) - n_val :] if n_val else eligible
    print(
        f"Matches: {len(eligible)} eligible "
        f"({len(train_idx)} train / {len(val_idx)} val"
        f"{' — SMOKE: val==train' if args.smoke else ''}), "
        f"cells: {len(train_idx) * N_MINUTES * 2:,} train"
    )
    if args.until:
        print(f"Date cut: only matches strictly before {args.until}")

    config = EngineConfig(hidden=args.hidden)
    net = ResidualNet(hidden=args.hidden)
    optimizer = torch.optim.Adam(net.parameters(), lr=args.lr)
    start_epoch = 0
    best_val = float("inf")
    best_state = None
    history: List[Dict[str, float]] = []

    if args.resume and CHECKPOINT.exists():
        ckpt = torch.load(CHECKPOINT, map_location="cpu", weights_only=False)
        net.load_state_dict(ckpt["net"])
        optimizer.load_state_dict(ckpt["optimizer"])
        start_epoch = int(ckpt["epoch"]) + 1
        best_val = float(ckpt["best_val"])
        best_state = ckpt.get("best_state")
        history = list(ckpt.get("history", []))
        print(f"Resumed from {CHECKPOINT} at epoch {start_epoch}")

    nu_homog = homogeneous_hazard(dataset, train_idx)
    control_homog = evaluate_nll(None, dataset, val_idx, homogeneous_nu=nu_homog)
    control_dc = evaluate_nll(None, dataset, val_idx)
    print(
        f"Controls (val NLL/cell): homogeneous={control_homog:.6f}  "
        f"dc_anchor={control_dc:.6f}"
    )
    floor = None
    if args.smoke:
        floor = model_class_floor(dataset, train_idx)
        print(f"Model-class overfit floor (smoke): {floor:.6f}")

    patience_left = args.patience
    stopped_early = False
    timed_out = False
    for epoch in range(start_epoch, args.epochs):
        net.train()
        perm = rng.permutation(len(train_idx))
        epoch_loss = 0.0
        epoch_cells = 0
        for start in range(0, len(perm), args.batch_matches):
            idx = train_idx[perm[start : start + args.batch_matches]]
            feats, labels, base = dataset.batch(idx)
            optimizer.zero_grad()
            log_mult = net(torch.from_numpy(feats))
            loss = hazard_nll(
                log_mult, torch.from_numpy(base), torch.from_numpy(labels)
            )
            loss.backward()
            optimizer.step()
            epoch_loss += float(loss.detach()) * len(labels)
            epoch_cells += len(labels)
        train_nll = epoch_loss / max(epoch_cells, 1)
        val_nll = evaluate_nll(net, dataset, val_idx)
        history.append(
            {"epoch": epoch, "train_nll": train_nll, "val_nll": val_nll}
        )
        marker = ""
        if val_nll < best_val - 1e-7:
            best_val = val_nll
            best_state = {
                k: v.detach().clone() for k, v in net.state_dict().items()
            }
            patience_left = args.patience
            marker = "  *best*"
        else:
            patience_left -= 1
        print(
            f"epoch {epoch:>3}  train NLL {train_nll:.6f}  "
            f"val NLL {val_nll:.6f}{marker}  [{time.time() - t0:.0f}s]"
        )
        torch.save(
            {
                "net": net.state_dict(),
                "optimizer": optimizer.state_dict(),
                "epoch": epoch,
                "best_val": best_val,
                "best_state": best_state,
                "history": history,
                "config": config.to_dict(),
            },
            CHECKPOINT,
        )
        if not args.smoke and patience_left <= 0:
            stopped_early = True
            print(f"Early stop: no val improvement for {args.patience} epochs.")
            break
        if (time.time() - t0) / 60.0 > args.max_minutes:
            timed_out = True
            print(
                f"Time budget reached ({args.max_minutes} min) — checkpoint "
                f"saved; rerun with --resume to continue."
            )
            break

    if best_state is not None:
        net.load_state_dict(best_state)
    wall_clock = time.time() - t0

    # ---- persist ----
    weights_out: Path = args.weights_out
    summary_out: Path = SMOKE_SUMMARY_OUT if args.smoke else args.summary_out
    if not args.smoke:
        weights_out.parent.mkdir(parents=True, exist_ok=True)
        payload = engine_state_dict(net, config)
        payload["metadata"] = {
            "trained_until": args.until,
            "gender": args.gender,
            "n_train_matches": int(len(train_idx)),
            "n_val_matches": int(len(val_idx)),
            "val_nll": best_val,
            "generated_at": datetime.now(timezone.utc)
            .replace(microsecond=0)
            .isoformat(),
        }
        torch.save(payload, weights_out)
        print(f"Weights: {weights_out}")

    summary = {
        "schema": 1,
        "generated_at": datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat(),
        "smoke": bool(args.smoke),
        "config": {
            "hidden": args.hidden,
            "n_parameters": net.n_parameters(),
            "lr": args.lr,
            "batch_matches": args.batch_matches,
            "epochs_run": len(history),
            "gender": args.gender,
            "until": args.until,
            "val_frac": args.val_frac,
            "seed": args.seed,
        },
        "counts": {
            "eligible_matches": int(len(eligible)),
            "train_matches": int(len(train_idx)),
            "val_matches": int(len(val_idx)),
            "train_cells": int(len(train_idx)) * N_MINUTES * 2,
            "val_cells": int(len(val_idx)) * N_MINUTES * 2,
        },
        "val_nll": {
            "engine": best_val,
            "homogeneous_control": control_homog,
            "dc_anchor_control": control_dc,
            "beats_homogeneous": bool(best_val < control_homog),
            "beats_dc_anchor": bool(best_val < control_dc),
            "overfit_floor": floor,
            "gap_to_floor": (best_val - floor) if floor is not None else None,
        },
        "history": history,
        "wall_clock_seconds": round(wall_clock, 1),
        "stopped_early": stopped_early,
        "timed_out": timed_out,
    }
    summary_out.parent.mkdir(parents=True, exist_ok=True)
    summary_out.write_text(
        json.dumps(summary, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"Summary: {summary_out}")
    print(
        f"val NLL {best_val:.6f} vs homogeneous {control_homog:.6f} "
        f"({'BEATS' if best_val < control_homog else 'does NOT beat'}) and "
        f"dc_anchor {control_dc:.6f} "
        f"({'BEATS' if best_val < control_dc else 'does NOT beat'})  "
        f"[{wall_clock:.0f}s]"
    )
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Train Match Engine v0.")
    parser.add_argument("--dataset", type=Path, default=DATASET_DIR)
    parser.add_argument(
        "--gender",
        choices=["M", "F", "both"],
        default="both",
        help="Train on one gender or both (shared engine with a gender flag)",
    )
    parser.add_argument(
        "--until",
        type=str,
        default=None,
        help="Use only matches strictly before this ISO date (walk-forward "
        "hygiene for the backtest: set to the first scored block's date)",
    )
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--batch-matches", type=int, default=256)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--hidden", type=int, default=128)
    parser.add_argument("--val-frac", type=float, default=0.1)
    parser.add_argument("--patience", type=int, default=3)
    parser.add_argument("--seed", type=int, default=20260715)
    parser.add_argument("--threads", type=int, default=8)
    parser.add_argument(
        "--max-minutes",
        type=float,
        default=25.0,
        help="Stop cleanly (checkpointed) after this many minutes",
    )
    parser.add_argument("--resume", action="store_true")
    parser.add_argument(
        "--smoke",
        action="store_true",
        help="Overfit sanity run on a small subset (val == train, no early "
        "stop, artefacts go to the cache dir, committed summary untouched)",
    )
    parser.add_argument(
        "--matches", type=int, default=256, help="Subset size for --smoke"
    )
    parser.add_argument("--weights-out", type=Path, default=WEIGHTS_OUT)
    parser.add_argument("--summary-out", type=Path, default=SUMMARY_OUT)
    args = parser.parse_args(argv)
    return train(args)


if __name__ == "__main__":
    raise SystemExit(main())
