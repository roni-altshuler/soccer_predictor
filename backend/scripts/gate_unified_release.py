"""Promotion gate for freshly trained unified model artifacts.

Compares the just-written holdout summary
(``backend/data/diagnostics/unified_<gender>_summary.json``) against the
previously committed version of the same file and decides whether the
new artifacts may be published to the ``models-latest`` release.

A model is HELD BACK when it regresses beyond tolerance on any of:
  * accuracy   (drop > 1.5 percentage points)
  * log loss   (increase > 3% relative)
  * ECE        (increase > 0.02 absolute)

Exit codes: 0 = promote, 3 = hold back, 2 = usage/data error.
A missing baseline (first ever run) promotes by default.

Usage:
    python -m backend.scripts.gate_unified_release --gender M
    python -m backend.scripts.gate_unified_release --gender F \
        --baseline-ref origin/main
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, Optional

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SUMMARY_REL = "backend/data/diagnostics/unified_{suffix}_summary.json"

ACCURACY_DROP_TOLERANCE = 0.015
LOG_LOSS_REL_TOLERANCE = 0.03
ECE_ABS_TOLERANCE = 0.02


def _load_current(suffix: str) -> Optional[Dict[str, Any]]:
    path = REPO_ROOT / SUMMARY_REL.format(suffix=suffix)
    if not path.exists():
        return None
    return json.loads(path.read_text())


def _load_baseline(suffix: str, ref: str) -> Optional[Dict[str, Any]]:
    rel = SUMMARY_REL.format(suffix=suffix)
    try:
        out = subprocess.run(
            ["git", "show", f"{ref}:{rel}"],
            cwd=REPO_ROOT, capture_output=True, text=True, check=True,
        ).stdout
        return json.loads(out)
    except (subprocess.CalledProcessError, json.JSONDecodeError):
        return None


def evaluate_gate(current: Dict[str, Any], baseline: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Pure decision logic — returns {promote: bool, reasons: [...]}."""
    if baseline is None:
        return {"promote": True, "reasons": ["no baseline summary — first publish"]}

    cur = current.get("holdout", {})
    base = baseline.get("holdout", {})
    reasons = []

    acc_delta = float(cur.get("accuracy", 0.0)) - float(base.get("accuracy", 0.0))
    if acc_delta < -ACCURACY_DROP_TOLERANCE:
        reasons.append(f"accuracy regressed {acc_delta:+.4f} (tolerance -{ACCURACY_DROP_TOLERANCE})")

    base_ll = float(base.get("log_loss", 0.0))
    cur_ll = float(cur.get("log_loss", 0.0))
    if base_ll > 0 and (cur_ll - base_ll) / base_ll > LOG_LOSS_REL_TOLERANCE:
        reasons.append(
            f"log_loss regressed {base_ll:.4f} → {cur_ll:.4f} (tolerance +{LOG_LOSS_REL_TOLERANCE:.0%})"
        )

    ece_delta = float(cur.get("ece", 0.0)) - float(base.get("ece", 0.0))
    if ece_delta > ECE_ABS_TOLERANCE:
        reasons.append(f"ece regressed {ece_delta:+.4f} (tolerance +{ECE_ABS_TOLERANCE})")

    if reasons:
        return {"promote": False, "reasons": reasons}
    return {
        "promote": True,
        "reasons": [
            f"accuracy {float(base.get('accuracy', 0)):.4f} → {float(cur.get('accuracy', 0)):.4f}, "
            f"log_loss {base_ll:.4f} → {cur_ll:.4f}, "
            f"ece {float(base.get('ece', 0)):.4f} → {float(cur.get('ece', 0)):.4f}"
        ],
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gender", choices=["M", "F"], required=True)
    parser.add_argument(
        "--baseline-ref", default="HEAD",
        help="Git ref holding the previous committed summary (default: HEAD).",
    )
    args = parser.parse_args(argv)
    suffix = "men" if args.gender == "M" else "women"

    current = _load_current(suffix)
    if current is None:
        print(f"GATE ERROR: no freshly written summary for {suffix}", file=sys.stderr)
        return 2

    baseline = _load_baseline(suffix, args.baseline_ref)
    verdict = evaluate_gate(current, baseline)
    tag = "PROMOTE" if verdict["promote"] else "HOLD BACK"
    print(f"GATE {tag} unified_{suffix}:")
    for reason in verdict["reasons"]:
        print(f"  - {reason}")
    return 0 if verdict["promote"] else 3


if __name__ == "__main__":
    raise SystemExit(main())
