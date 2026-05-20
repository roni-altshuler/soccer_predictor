"""Train the unified multi-task match model for one gender universe.

End-to-end pipeline
-------------------
1. Open the warehouse and iterate matches for the requested gender.
2. Build feature vectors via the shared `FeatureBuilderV2` (no separate
   training-vs-inference code paths anymore).
3. Chronological 70/15/15 train/val/test split.
4. StandardScaler on dense features (fitted on train only, persisted).
5. Train `UnifiedMatchModel` with AdamW, focal loss + bivariate Poisson
   NLL + xG MSE, early stopping on val NLL.
6. Fit an isotonic calibrator on the val set's outcome head.
7. Walk-forward evaluation on the test set; write metrics JSON.

Run
---
    # Men's universe, all data:
    python -m backend.scripts.train_unified --gender M

    # Women's universe, since 2010:
    python -m backend.scripts.train_unified --gender F --min-season 2010

    # Fast smoke run (10 epochs):
    python -m backend.scripts.train_unified --gender M --epochs 10 --device cpu

Artifacts (under `backend/data/models/`):
    unified_<gender>.pt              torch state blob (model + config + vocab maps)
    unified_<gender>_scaler.pkl      sklearn StandardScaler
    unified_<gender>_calibrator.pkl  per-class isotonic regressors
    unified_<gender>_metadata.json   feature names, vocab sizes, training metrics
    unified_<gender>_holdout.json    test-set metrics for the audit dashboard
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import pickle
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
import torch
from sklearn.isotonic import IsotonicRegression
from sklearn.preprocessing import StandardScaler

from backend.services.data import open_warehouse
from backend.services.prediction.feature_builder_v2 import (
    FEATURE_NAMES,
    FeatureBuilderV2,
)
from backend.services.prediction.losses import outcome_probabilities_from_pmf, scoreline_distribution
from backend.services.prediction.unified_model import (
    PHASE_VOCAB,
    UnifiedMatchModel,
    UnifiedModelConfig,
    n_parameters,
)

logger = logging.getLogger(__name__)

MODEL_DIR = Path(__file__).resolve().parent.parent / "data" / "models"


# ---------- dataset assembly ----------


@dataclass
class TrainingRow:
    dense: np.ndarray            # (D,) float32
    league_id: int
    home_team_id: int
    away_team_id: int
    referee_id: int
    phase_id: int
    outcome_target: int          # 0 = home_win, 1 = draw, 2 = away_win
    home_goals: int
    away_goals: int
    date_utc: str
    competition_id: str


def _build_training_rows(warehouse, *, gender: str, min_season: Optional[int]) -> Tuple[List[TrainingRow], FeatureBuilderV2]:
    builder = FeatureBuilderV2(warehouse)

    # Pre-warm vocabularies so the embedding sizes are stable: encode every
    # team and league that appears, in chronological order.
    rows = list(warehouse.iter_matches(gender=gender))
    if min_season is not None:
        rows = [r for r in rows if int(r["season"] or 0) >= min_season]

    logger.info("Loaded %d %s matches from warehouse", len(rows), "men's" if gender == "M" else "women's")

    out: List[TrainingRow] = []
    skipped = 0
    for i, row in enumerate(rows):
        if row["home_score"] is None or row["away_score"] is None:
            skipped += 1
            continue
        built = builder.build_from_row(row)
        hs, as_ = int(row["home_score"]), int(row["away_score"])
        if hs > as_:
            target = 0
        elif hs < as_:
            target = 2
        else:
            target = 1
        out.append(
            TrainingRow(
                dense=np.array(built.dense, dtype=np.float32),
                league_id=built.context.league_id,
                home_team_id=built.context.home_team_id,
                away_team_id=built.context.away_team_id,
                referee_id=built.context.referee_id,
                phase_id=built.context.phase_id,
                outcome_target=target,
                home_goals=hs,
                away_goals=as_,
                date_utc=row["date_utc"],
                competition_id=row["competition_id"],
            )
        )
        if (i + 1) % 5000 == 0:
            logger.info("  built features for %d/%d rows", i + 1, len(rows))
    logger.info("Built %d training rows (skipped %d incomplete)", len(out), skipped)
    return out, builder


def _chronological_split(
    rows: List[TrainingRow], *, train_frac: float = 0.7, val_frac: float = 0.15
) -> Tuple[List[TrainingRow], List[TrainingRow], List[TrainingRow]]:
    rows = sorted(rows, key=lambda r: (r.date_utc, r.competition_id))
    n = len(rows)
    n_train = int(n * train_frac)
    n_val = int(n * val_frac)
    return rows[:n_train], rows[n_train : n_train + n_val], rows[n_train + n_val :]


def _to_tensors(
    rows: Sequence[TrainingRow], device: torch.device, scaler: Optional[StandardScaler] = None
) -> Dict[str, torch.Tensor]:
    dense = np.stack([r.dense for r in rows])
    if scaler is not None:
        dense = scaler.transform(dense).astype(np.float32)
    return {
        "dense": torch.from_numpy(dense).to(device),
        "league_id": torch.tensor([r.league_id for r in rows], dtype=torch.long, device=device),
        "home_team_id": torch.tensor([r.home_team_id for r in rows], dtype=torch.long, device=device),
        "away_team_id": torch.tensor([r.away_team_id for r in rows], dtype=torch.long, device=device),
        "referee_id": torch.tensor([r.referee_id for r in rows], dtype=torch.long, device=device),
        "phase_id": torch.tensor([r.phase_id for r in rows], dtype=torch.long, device=device),
        "outcome_target": torch.tensor([r.outcome_target for r in rows], dtype=torch.long, device=device),
        "home_goals": torch.tensor([r.home_goals for r in rows], dtype=torch.long, device=device),
        "away_goals": torch.tensor([r.away_goals for r in rows], dtype=torch.long, device=device),
    }


# ---------- training loop ----------


def _iterate_batches(tensors: Dict[str, torch.Tensor], batch_size: int, *, shuffle: bool):
    n = tensors["dense"].size(0)
    indices = torch.randperm(n) if shuffle else torch.arange(n)
    for start in range(0, n, batch_size):
        idx = indices[start : start + batch_size]
        yield {k: v[idx] for k, v in tensors.items()}


def _train_one_epoch(
    model: UnifiedMatchModel,
    optimizer: torch.optim.Optimizer,
    tensors: Dict[str, torch.Tensor],
    *,
    batch_size: int,
    class_weights: torch.Tensor,
    outcome_weight: float,
    bivariate_weight: float,
    xg_mse_weight: float,
    focal_gamma: float,
) -> Dict[str, float]:
    model.train()
    totals = {"total": 0.0, "outcome": 0.0, "bivariate": 0.0, "xg_mse": 0.0, "n": 0}
    for batch in _iterate_batches(tensors, batch_size, shuffle=True):
        optimizer.zero_grad()
        out = model(
            dense=batch["dense"], league_id=batch["league_id"],
            home_team_id=batch["home_team_id"], away_team_id=batch["away_team_id"],
            referee_id=batch["referee_id"], phase_id=batch["phase_id"],
        )
        loss, parts = model.compute_loss(
            out,
            outcome_target=batch["outcome_target"],
            home_goals=batch["home_goals"],
            away_goals=batch["away_goals"],
            class_weights=class_weights,
            outcome_weight=outcome_weight,
            bivariate_weight=bivariate_weight,
            xg_mse_weight=xg_mse_weight,
            focal_gamma=focal_gamma,
        )
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=5.0)
        optimizer.step()
        bs = batch["dense"].size(0)
        for k in ("total", "outcome", "bivariate", "xg_mse"):
            totals[k] += parts[k] * bs
        totals["n"] += bs
    return {k: totals[k] / max(1, totals["n"]) for k in ("total", "outcome", "bivariate", "xg_mse")}


@torch.no_grad()
def _evaluate(
    model: UnifiedMatchModel,
    tensors: Dict[str, torch.Tensor],
    *,
    batch_size: int = 1024,
) -> Dict[str, float]:
    """Compute outcome accuracy, log-loss, Brier, draw recall on the whole split."""
    model.eval()
    correct = 0
    total = 0
    nll_sum = 0.0
    brier_sum = 0.0
    draw_correct = 0
    draw_total = 0
    confusion = np.zeros((3, 3), dtype=np.int64)

    for batch in _iterate_batches(tensors, batch_size, shuffle=False):
        out = model(
            dense=batch["dense"], league_id=batch["league_id"],
            home_team_id=batch["home_team_id"], away_team_id=batch["away_team_id"],
            referee_id=batch["referee_id"], phase_id=batch["phase_id"],
        )
        pmf = scoreline_distribution(out.lam_home, out.lam_away, out.lam_corr, max_goals=model.config.max_goals)
        hw, dr, aw = outcome_probabilities_from_pmf(pmf)
        # Reported outcome: blend of head softmax and pmf-derived (start at 0.5).
        head = torch.softmax(out.outcome_logits, dim=-1)
        outcome = 0.5 * head + 0.5 * torch.stack([hw, dr, aw], dim=-1)
        outcome = outcome / outcome.sum(dim=-1, keepdim=True).clamp(min=1e-12)

        preds = outcome.argmax(dim=-1)
        target = batch["outcome_target"]
        correct += int((preds == target).sum().item())
        total += int(target.numel())
        target_oh = torch.nn.functional.one_hot(target, num_classes=3).float()
        nll_sum += -(target_oh * outcome.clamp(min=1e-9, max=1.0).log()).sum(dim=-1).sum().item()
        brier_sum += ((outcome - target_oh) ** 2).sum(dim=-1).sum().item()
        draw_mask = target == 1
        draw_total += int(draw_mask.sum().item())
        draw_correct += int(((preds == 1) & draw_mask).sum().item())
        for t, p in zip(target.tolist(), preds.tolist()):
            confusion[t, p] += 1

    return {
        "accuracy": correct / max(1, total),
        "log_loss": nll_sum / max(1, total),
        "brier": brier_sum / max(1, total),
        "draw_recall": draw_correct / max(1, draw_total),
        "n": total,
        "confusion": confusion.tolist(),
    }


def _fit_calibrator(model: UnifiedMatchModel, val_tensors: Dict[str, torch.Tensor]) -> Dict[str, IsotonicRegression]:
    """Per-class isotonic regression on the val set's outcome distribution."""
    model.eval()
    probs_list = []
    targets_list = []
    with torch.no_grad():
        for batch in _iterate_batches(val_tensors, 1024, shuffle=False):
            out = model(
                dense=batch["dense"], league_id=batch["league_id"],
                home_team_id=batch["home_team_id"], away_team_id=batch["away_team_id"],
                referee_id=batch["referee_id"], phase_id=batch["phase_id"],
            )
            pmf = scoreline_distribution(out.lam_home, out.lam_away, out.lam_corr, max_goals=model.config.max_goals)
            hw, dr, aw = outcome_probabilities_from_pmf(pmf)
            head = torch.softmax(out.outcome_logits, dim=-1)
            outcome = 0.5 * head + 0.5 * torch.stack([hw, dr, aw], dim=-1)
            outcome = outcome / outcome.sum(dim=-1, keepdim=True).clamp(min=1e-12)
            probs_list.append(outcome.cpu().numpy())
            targets_list.append(batch["outcome_target"].cpu().numpy())
    probs = np.concatenate(probs_list, axis=0)
    targets = np.concatenate(targets_list, axis=0)

    calibrators = {}
    for k, name in enumerate(("home_win", "draw", "away_win")):
        iso = IsotonicRegression(out_of_bounds="clip", y_min=1e-4, y_max=1 - 1e-4)
        iso.fit(probs[:, k], (targets == k).astype(np.float32))
        calibrators[name] = iso
    return calibrators


# ---------- artifact persistence ----------


def _save_artifacts(
    gender: str,
    model: UnifiedMatchModel,
    scaler: StandardScaler,
    calibrators: Dict[str, IsotonicRegression],
    *,
    train_metrics: List[Dict[str, float]],
    val_metrics: Dict[str, float],
    test_metrics: Dict[str, float],
    feature_names: Sequence[str],
    league_map: Dict[str, int],
    team_map: Dict[int, int],
    referee_map: Dict[int, int],
) -> None:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    suffix = "men" if gender == "M" else "women"

    blob = model.state_blob()
    blob["vocab"] = {
        "league_id_map": league_map,
        "team_id_map": team_map,
        "referee_id_map": referee_map,
        "phase_vocab": list(PHASE_VOCAB),
    }
    torch.save(blob, MODEL_DIR / f"unified_{suffix}.pt")

    with open(MODEL_DIR / f"unified_{suffix}_scaler.pkl", "wb") as f:
        pickle.dump(scaler, f)
    with open(MODEL_DIR / f"unified_{suffix}_calibrator.pkl", "wb") as f:
        pickle.dump(calibrators, f)

    metadata = {
        "gender": gender,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "feature_names": list(feature_names),
        "n_parameters": n_parameters(model),
        "vocab_sizes": {
            "leagues": max(league_map.values(), default=0) + 1,
            "teams": max(team_map.values(), default=0) + 1,
            "referees": max(referee_map.values(), default=0) + 1,
            "phases": len(PHASE_VOCAB),
        },
        "training_history": train_metrics,
        "val_metrics_final": val_metrics,
    }
    (MODEL_DIR / f"unified_{suffix}_metadata.json").write_text(json.dumps(metadata, indent=2, default=str))
    (MODEL_DIR / f"unified_{suffix}_holdout.json").write_text(json.dumps(test_metrics, indent=2, default=str))


# ---------- main ----------


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--gender", choices=["M", "F"], default="M")
    parser.add_argument("--min-season", type=int, default=None)
    parser.add_argument("--epochs", type=int, default=80)
    parser.add_argument("--batch-size", type=int, default=512)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--patience", type=int, default=10, help="Early stopping patience in epochs.")
    parser.add_argument("--device", default=None, help="torch device, e.g. 'cpu' or 'cuda'.")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--outcome-loss-weight", type=float, default=0.7,
        help="Weight on the focal outcome loss. Lower values prevent the model "
             "from collapsing onto the majority class.",
    )
    parser.add_argument(
        "--bivariate-loss-weight", type=float, default=1.0,
        help="Weight on the bivariate-Poisson scoreline NLL.",
    )
    parser.add_argument(
        "--xg-mse-weight", type=float, default=0.25,
        help="Weight on the auxiliary xG MSE anchor.",
    )
    parser.add_argument(
        "--focal-gamma", type=float, default=1.5,
        help="Focal loss focusing parameter. 0 = cross-entropy; 2 = paper default.",
    )
    parser.add_argument(
        "--class-weight-cap", type=float, default=1.5,
        help="Maximum ratio between any two class weights. 1.0 disables class "
             "weighting entirely; full inverse-frequency would be ~1.8.",
    )
    parser.add_argument(
        "--draw-recall-floor", type=float, default=0.10,
        help="Composite stopping criterion penalises models whose val draw "
             "recall drops below this threshold.",
    )
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stderr,
    )

    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    device = torch.device(args.device or ("cuda" if torch.cuda.is_available() else "cpu"))
    logger.info("Training on device: %s", device)

    with open_warehouse() as wh:
        rows, builder = _build_training_rows(wh, gender=args.gender, min_season=args.min_season)

    if len(rows) < 100:
        logger.error("Not enough training rows (%d). Build the warehouse first via build_warehouse.py.", len(rows))
        return 2

    train_rows, val_rows, test_rows = _chronological_split(rows)
    logger.info("Split sizes — train: %d, val: %d, test: %d", len(train_rows), len(val_rows), len(test_rows))

    scaler = StandardScaler()
    dense_train = np.stack([r.dense for r in train_rows])
    scaler.fit(dense_train)

    train_tensors = _to_tensors(train_rows, device, scaler)
    val_tensors = _to_tensors(val_rows, device, scaler)
    test_tensors = _to_tensors(test_rows, device, scaler)

    # Build / load model
    n_leagues, n_teams, n_referees = builder.vocab_dims()
    config = UnifiedModelConfig(
        feature_names=list(FEATURE_NAMES),
        n_leagues=n_leagues,
        n_teams=n_teams,
        n_referees=n_referees,
    )
    model = UnifiedMatchModel(config).to(device)
    logger.info("Built UnifiedMatchModel with %d parameters", n_parameters(model))

    # Class weights to nudge the model away from collapsing onto home_win.
    # Full inverse-frequency over-corrects (the bug we hit in the first real
    # run: model collapsed onto away_win). Cap the spread between any two
    # classes at `--class-weight-cap` so the rare-class bonus stays gentle.
    class_counts = np.bincount([r.outcome_target for r in train_rows], minlength=3)
    inv_freq = class_counts.sum() / np.maximum(class_counts, 1) / 3.0
    if args.class_weight_cap > 1.0:
        min_w = inv_freq.min()
        capped = np.minimum(inv_freq, min_w * args.class_weight_cap)
        class_weights_np = capped / capped.mean()  # renormalise so mean weight = 1
    else:
        class_weights_np = np.ones(3, dtype=np.float32)
    class_weights = torch.tensor(class_weights_np, dtype=torch.float32, device=device)
    logger.info("Class weights (home_win, draw, away_win): %s", class_weights.tolist())

    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)

    # Composite stopping score: accuracy − sharp penalty when draw recall
    # drops below the floor. This prevents the "ignore draws to chase
    # accuracy" failure mode we saw in the v1 run (best val_log_loss
    # epoch had val_draw_recall = 0.017).
    def _composite_score(m: Dict[str, float]) -> float:
        penalty = max(0.0, args.draw_recall_floor - m["draw_recall"])
        return m["accuracy"] - 0.5 * penalty

    best_score = -math.inf
    best_state: Optional[Dict] = None
    best_epoch_metrics: Dict[str, float] = {}
    epochs_no_improve = 0
    history: List[Dict] = []

    for epoch in range(args.epochs):
        t0 = time.time()
        train_metrics = _train_one_epoch(
            model, optimizer, train_tensors,
            batch_size=args.batch_size, class_weights=class_weights,
            outcome_weight=args.outcome_loss_weight,
            bivariate_weight=args.bivariate_loss_weight,
            xg_mse_weight=args.xg_mse_weight,
            focal_gamma=args.focal_gamma,
        )
        val_metrics = _evaluate(model, val_tensors)
        scheduler.step()

        history.append({"epoch": epoch, **{f"train_{k}": v for k, v in train_metrics.items()},
                        "val_accuracy": val_metrics["accuracy"],
                        "val_log_loss": val_metrics["log_loss"],
                        "val_brier": val_metrics["brier"],
                        "val_draw_recall": val_metrics["draw_recall"]})

        score = _composite_score(val_metrics)
        logger.info(
            "epoch %3d/%d  train=%.4f  val_acc=%.4f  val_ll=%.4f  val_dr=%.3f  score=%.4f  (%.1fs)",
            epoch + 1, args.epochs,
            train_metrics["total"],
            val_metrics["accuracy"], val_metrics["log_loss"],
            val_metrics["draw_recall"], score,
            time.time() - t0,
        )

        if score > best_score + 1e-4:
            best_score = score
            best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}
            best_epoch_metrics = dict(val_metrics)
            best_epoch_metrics["epoch"] = epoch + 1
            best_epoch_metrics["score"] = score
            epochs_no_improve = 0
        else:
            epochs_no_improve += 1
            if epochs_no_improve >= args.patience:
                logger.info("Early stopping at epoch %d (no composite-score improvement for %d epochs).", epoch + 1, args.patience)
                break

    if best_state is not None:
        model.load_state_dict(best_state)
    logger.info(
        "Best epoch: %d  val_acc=%.4f  val_ll=%.4f  val_dr=%.3f  score=%.4f",
        best_epoch_metrics.get("epoch", -1),
        best_epoch_metrics.get("accuracy", 0.0),
        best_epoch_metrics.get("log_loss", 0.0),
        best_epoch_metrics.get("draw_recall", 0.0),
        best_score,
    )

    # Fit calibrator on val set, evaluate on test set.
    calibrators = _fit_calibrator(model, val_tensors)
    test_metrics = _evaluate(model, test_tensors)
    logger.info(
        "TEST  accuracy=%.4f  log_loss=%.4f  brier=%.4f  draw_recall=%.3f  n=%d",
        test_metrics["accuracy"], test_metrics["log_loss"], test_metrics["brier"], test_metrics["draw_recall"], test_metrics["n"],
    )

    _save_artifacts(
        args.gender, model, scaler, calibrators,
        train_metrics=history,
        val_metrics=_evaluate(model, val_tensors),
        test_metrics=test_metrics,
        feature_names=FEATURE_NAMES,
        league_map=builder.league_id_map,
        team_map=builder.team_id_map,
        referee_map=builder.referee_id_map,
    )
    suffix = "men" if args.gender == "M" else "women"
    logger.info("Saved artifacts to %s/unified_%s.*", MODEL_DIR, suffix)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
