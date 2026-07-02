"""Outcome-probability calibration shared by training and inference.

The unified model emits two views of the W/D/L outcome:

* the classification head's logits, and
* outcome probabilities integrated from the bivariate-Poisson scoreline PMF.

Serving quality depends on how those two views are combined and mapped to
honest probabilities. This module owns that logic so `train_unified.py`
(which *fits* the calibration on the validation split) and
`unified_inference.py` (which *applies* it at serving time) can never
drift apart.

Two persisted calibrator formats are supported:

* **Legacy** (pre-2026-07): a plain ``{"home_win": IsotonicRegression,
  "draw": ..., "away_win": ...}`` dict. Applied to a hardcoded 50/50
  blend of head softmax and PMF-derived probabilities.
* **``temp_blend_v2``**: ``{"kind": "temp_blend_v2", "temperature": T,
  "alpha": a, "isotonic": {...} | None}``. The head logits are
  temperature-scaled, blended with the PMF view using a learned weight
  ``alpha`` (chosen to minimise validation NLL), and optionally passed
  through a final per-class isotonic map that is only kept when it
  improves validation ECE.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional, Tuple

import numpy as np
from sklearn.isotonic import IsotonicRegression

logger = logging.getLogger(__name__)

CALIBRATION_KIND_V2 = "temp_blend_v2"

# Legacy behaviour: fixed 50/50 blend of head softmax and PMF outcome.
LEGACY_BLEND_ALPHA = 0.5


# ---------- primitives ----------


def softmax(logits: np.ndarray, temperature: float = 1.0) -> np.ndarray:
    """Row-wise softmax with temperature. ``logits`` is ``(N, C)``."""
    z = np.asarray(logits, dtype=np.float64) / max(1e-6, float(temperature))
    z = z - z.max(axis=-1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=-1, keepdims=True)


def _nll(probs: np.ndarray, targets: np.ndarray) -> float:
    p_true = probs[np.arange(len(targets)), targets]
    return float(-np.log(np.clip(p_true, 1e-12, 1.0)).mean())


def ece_10bin(probs: np.ndarray, targets: np.ndarray, n_bins: int = 10) -> float:
    """Expected calibration error on the max-probability (top-1) view."""
    probs = np.asarray(probs, dtype=np.float64)
    conf = probs.max(axis=-1)
    pred = probs.argmax(axis=-1)
    hit = (pred == np.asarray(targets)).astype(np.float64)
    bins = np.minimum((conf * n_bins).astype(int), n_bins - 1)
    ece = 0.0
    n = len(conf)
    for b in range(n_bins):
        mask = bins == b
        if not mask.any():
            continue
        ece += abs(hit[mask].mean() - conf[mask].mean()) * (mask.sum() / n)
    return float(ece)


def _normalize_rows(probs: np.ndarray) -> np.ndarray:
    return probs / probs.sum(axis=-1, keepdims=True).clip(1e-12)


# ---------- fitting (used by train_unified on the validation split) ----------


def fit_temperature(logits: np.ndarray, targets: np.ndarray) -> float:
    """Grid-search the softmax temperature that minimises NLL.

    A 1-D coarse-to-fine grid is deliberate: it is deterministic, has no
    optimizer hyper-parameters, and NLL(T) is smooth enough that two
    passes land within ±0.01 of the optimum.
    """
    def nll_at(t: float) -> float:
        return _nll(softmax(logits, t), targets)

    coarse = np.linspace(0.25, 4.0, 76)
    t_best = min(coarse, key=nll_at)
    fine = np.linspace(max(0.05, t_best - 0.1), t_best + 0.1, 41)
    t_best = min(fine, key=nll_at)
    return float(t_best)


def fit_blend_alpha(
    head_probs: np.ndarray, pmf_probs: np.ndarray, targets: np.ndarray
) -> float:
    """Weight on the (tempered) head view vs the PMF view, by val NLL."""
    def nll_at(a: float) -> float:
        return _nll(_normalize_rows(a * head_probs + (1.0 - a) * pmf_probs), targets)

    alphas = np.linspace(0.0, 1.0, 101)
    return float(min(alphas, key=nll_at))


def fit_isotonic(probs: np.ndarray, targets: np.ndarray) -> Dict[str, IsotonicRegression]:
    """Per-class isotonic maps on already-blended probabilities."""
    calibrators: Dict[str, IsotonicRegression] = {}
    for k, name in enumerate(("home_win", "draw", "away_win")):
        iso = IsotonicRegression(out_of_bounds="clip", y_min=1e-4, y_max=1 - 1e-4)
        iso.fit(probs[:, k], (np.asarray(targets) == k).astype(np.float64))
        calibrators[name] = iso
    return calibrators


def fit_calibration(
    logits: np.ndarray, pmf_probs: np.ndarray, targets: np.ndarray
) -> Dict[str, Any]:
    """Fit the full ``temp_blend_v2`` calibration on a validation split.

    Steps: temperature on the head logits → blend weight vs the PMF view
    → optional per-class isotonic kept only if it improves validation ECE
    without hurting NLL.
    """
    targets = np.asarray(targets)
    temperature = fit_temperature(logits, targets)
    tempered = softmax(logits, temperature)
    alpha = fit_blend_alpha(tempered, pmf_probs, targets)
    blended = _normalize_rows(alpha * tempered + (1.0 - alpha) * pmf_probs)

    base_ece = ece_10bin(blended, targets)
    base_nll = _nll(blended, targets)

    # Isotonic has many effective parameters and overfits small validation
    # splits badly (observed on the women's universe: val ECE improved,
    # test log-loss regressed). Only consider it with a real sample.
    MIN_ISOTONIC_SAMPLES = 2000
    isotonic: Optional[Dict[str, IsotonicRegression]] = None
    iso_ece, iso_nll = base_ece, base_nll
    if len(targets) >= MIN_ISOTONIC_SAMPLES:
        isotonic = fit_isotonic(blended, targets)
        iso_probs = _apply_isotonic(blended, isotonic)
        iso_ece = ece_10bin(iso_probs, targets)
        iso_nll = _nll(iso_probs, targets)
        # Keep the extra map only when it genuinely helps calibration and
        # does not degrade the probabilistic score (within a small tolerance).
        if not (iso_ece < base_ece and iso_nll <= base_nll * 1.002):
            isotonic = None

    calibration = {
        "kind": CALIBRATION_KIND_V2,
        "temperature": temperature,
        "alpha": alpha,
        "isotonic": isotonic,
        "val_metrics": {
            "nll_blend": round(base_nll, 6),
            "ece_blend": round(base_ece, 6),
            "nll_isotonic": round(iso_nll, 6),
            "ece_isotonic": round(iso_ece, 6),
            "isotonic_kept": isotonic is not None,
        },
    }
    logger.info(
        "Fitted calibration: T=%.3f alpha=%.2f isotonic_kept=%s (val NLL %.4f, ECE %.4f)",
        temperature, alpha, isotonic is not None,
        _nll(apply_calibration(logits, pmf_probs, calibration), targets),
        ece_10bin(apply_calibration(logits, pmf_probs, calibration), targets),
    )
    return calibration


# ---------- application (used by inference and evaluation) ----------


def _apply_isotonic(
    probs: np.ndarray, calibrators: Dict[str, IsotonicRegression]
) -> np.ndarray:
    home = calibrators["home_win"].predict(probs[:, 0])
    draw = calibrators["draw"].predict(probs[:, 1])
    away = calibrators["away_win"].predict(probs[:, 2])
    return _normalize_rows(np.stack([home, draw, away], axis=-1))


def is_v2_calibration(calibration: Any) -> bool:
    return isinstance(calibration, dict) and calibration.get("kind") == CALIBRATION_KIND_V2


def apply_calibration(
    logits: np.ndarray, pmf_probs: np.ndarray, calibration: Any
) -> np.ndarray:
    """Map raw model outputs to served W/D/L probabilities.

    Handles all persisted calibrator formats:

    * ``None`` — plain legacy 50/50 blend, no mapping.
    * legacy per-class isotonic dict — 50/50 blend then isotonic.
    * ``temp_blend_v2`` — tempered head, learned blend, optional isotonic.

    Args:
        logits: ``(N, 3)`` raw outcome-head logits.
        pmf_probs: ``(N, 3)`` outcome probabilities from the scoreline PMF.

    Returns:
        ``(N, 3)`` probabilities, rows summing to 1.
    """
    logits = np.asarray(logits, dtype=np.float64)
    pmf_probs = np.asarray(pmf_probs, dtype=np.float64)

    if is_v2_calibration(calibration):
        tempered = softmax(logits, float(calibration["temperature"]))
        alpha = float(calibration["alpha"])
        blended = _normalize_rows(alpha * tempered + (1.0 - alpha) * pmf_probs)
        isotonic = calibration.get("isotonic")
        if isotonic:
            blended = _apply_isotonic(blended, isotonic)
        return blended

    # Legacy path: fixed 50/50 blend of untempered softmax and PMF view.
    blended = _normalize_rows(
        LEGACY_BLEND_ALPHA * softmax(logits) + (1.0 - LEGACY_BLEND_ALPHA) * pmf_probs
    )
    if isinstance(calibration, dict) and "home_win" in calibration:
        blended = _apply_isotonic(blended, calibration)
    return blended


__all__ = [
    "CALIBRATION_KIND_V2",
    "apply_calibration",
    "ece_10bin",
    "fit_blend_alpha",
    "fit_calibration",
    "fit_isotonic",
    "fit_temperature",
    "is_v2_calibration",
    "softmax",
]
