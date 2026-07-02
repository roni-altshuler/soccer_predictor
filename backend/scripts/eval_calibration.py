"""Evaluate live prediction calibration from committed artifacts.

Reads the committed monthly prediction records
(``backend/data/predictions/predictions_YYYY-MM.json``) and reports
probabilistic quality — accuracy, log loss, Brier score, and 10-bin
expected calibration error (ECE) — split by gender universe, league,
and the model that produced each pick (``model_used``).

This script needs NO model artifacts and NO network: it is the
before/after yardstick for every serving-stack change. Run it before
and after a model or calibration change lands and compare the tables.

Usage
-----
    python -m backend.scripts.eval_calibration
    python -m backend.scripts.eval_calibration --days 90
    python -m backend.scripts.eval_calibration --by league
    python -m backend.scripts.eval_calibration --json out.json
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

PREDICTIONS_DIR = Path(__file__).resolve().parent.parent / "data" / "predictions"

N_BINS = 10


@dataclass
class Slice:
    """Accumulated metrics for one group (gender / league / model)."""

    name: str
    n: int = 0
    correct: int = 0
    brier_sum: float = 0.0
    log_loss_sum: float = 0.0
    bin_counts: List[int] = field(default_factory=lambda: [0] * N_BINS)
    bin_conf: List[float] = field(default_factory=lambda: [0.0] * N_BINS)
    bin_acc: List[float] = field(default_factory=lambda: [0.0] * N_BINS)

    def add(self, probs: List[float], actual_idx: int) -> None:
        self.n += 1
        actual = [0.0, 0.0, 0.0]
        actual[actual_idx] = 1.0
        self.brier_sum += sum((p - a) ** 2 for p, a in zip(probs, actual)) / 3.0
        self.log_loss_sum += -math.log(max(1e-12, probs[actual_idx]))
        conf = max(probs)
        pred_idx = probs.index(conf)
        hit = 1.0 if pred_idx == actual_idx else 0.0
        self.correct += int(hit)
        b = min(N_BINS - 1, int(conf * N_BINS))
        self.bin_counts[b] += 1
        self.bin_conf[b] += conf
        self.bin_acc[b] += hit

    @property
    def accuracy(self) -> float:
        return self.correct / self.n if self.n else 0.0

    @property
    def brier(self) -> float:
        return self.brier_sum / self.n if self.n else 0.0

    @property
    def log_loss(self) -> float:
        return self.log_loss_sum / self.n if self.n else 0.0

    @property
    def ece(self) -> float:
        if not self.n:
            return 0.0
        total = float(self.n)
        ece = 0.0
        for i in range(N_BINS):
            if self.bin_counts[i] == 0:
                continue
            avg_conf = self.bin_conf[i] / self.bin_counts[i]
            avg_acc = self.bin_acc[i] / self.bin_counts[i]
            ece += abs(avg_acc - avg_conf) * (self.bin_counts[i] / total)
        return ece

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "n": self.n,
            "accuracy": round(self.accuracy, 4),
            "brier": round(self.brier, 4),
            "log_loss": round(self.log_loss, 4),
            "ece": round(self.ece, 4),
        }


def _iter_completed_records(
    predictions_dir: Path, since: Optional[str] = None
) -> Iterable[Dict[str, Any]]:
    for path in sorted(predictions_dir.glob("predictions_*.json")):
        try:
            with open(path) as f:
                payload = json.load(f)
        except (OSError, json.JSONDecodeError):
            continue
        for rec in payload.get("predictions", []):
            if rec.get("actual_winner") not in ("home", "draw", "away"):
                continue
            if since and str(rec.get("match_date", "")) < since:
                continue
            yield rec


def _record_probs(rec: Dict[str, Any]) -> Optional[List[float]]:
    try:
        probs = [
            max(0.0, float(rec.get("predicted_home_win", 0.0))),
            max(0.0, float(rec.get("predicted_draw", 0.0))),
            max(0.0, float(rec.get("predicted_away_win", 0.0))),
        ]
    except (TypeError, ValueError):
        return None
    total = sum(probs)
    if total <= 0:
        return None
    return [p / total for p in probs]


ACTUAL_IDX = {"home": 0, "draw": 1, "away": 2}


def evaluate(
    predictions_dir: Path = PREDICTIONS_DIR,
    *,
    days: Optional[int] = None,
    group_by: str = "all",
) -> Dict[str, Any]:
    """Aggregate calibration metrics from committed prediction records.

    ``group_by`` is one of: "all", "gender", "league", "model".
    Returns a JSON-serializable report; "all" always includes the
    overall slice plus per-gender slices (the headline view).
    """
    since = None
    if days:
        since = (datetime.now(timezone.utc) - timedelta(days=days)).date().isoformat()

    overall = Slice("overall")
    slices: Dict[str, Slice] = {}

    def key_for(rec: Dict[str, Any]) -> Optional[str]:
        if group_by == "gender" or group_by == "all":
            return "F" if str(rec.get("gender", "M") or "M").upper() == "F" else "M"
        if group_by == "league":
            return str(rec.get("league") or "unknown")
        if group_by == "model":
            return str(rec.get("model_used") or "unknown")
        return None

    for rec in _iter_completed_records(predictions_dir, since):
        probs = _record_probs(rec)
        if probs is None:
            continue
        actual_idx = ACTUAL_IDX[rec["actual_winner"]]
        overall.add(probs, actual_idx)
        key = key_for(rec)
        if key is not None:
            if key not in slices:
                slices[key] = Slice(key)
            slices[key].add(probs, actual_idx)

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "predictions_dir": str(predictions_dir),
        "days": days,
        "group_by": group_by,
        "overall": overall.to_dict(),
        "groups": [s.to_dict() for s in sorted(slices.values(), key=lambda s: -s.n)],
    }


def _print_table(report: Dict[str, Any]) -> None:
    header = f"{'group':<28} {'n':>6} {'acc':>7} {'brier':>7} {'logloss':>8} {'ece':>7}"
    print(header)
    print("-" * len(header))
    rows = [report["overall"]] + report["groups"]
    for row in rows:
        print(
            f"{row['name']:<28} {row['n']:>6} {row['accuracy']:>7.4f} "
            f"{row['brier']:>7.4f} {row['log_loss']:>8.4f} {row['ece']:>7.4f}"
        )


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--days", type=int, default=None, help="Only records from the last N days.")
    parser.add_argument(
        "--by",
        choices=("all", "gender", "league", "model"),
        default="all",
        help="Grouping for the breakdown table (default: gender).",
    )
    parser.add_argument("--json", type=Path, default=None, help="Also write the report as JSON.")
    parser.add_argument(
        "--predictions-dir", type=Path, default=PREDICTIONS_DIR,
        help="Override the predictions directory (used by tests).",
    )
    args = parser.parse_args(argv)

    report = evaluate(args.predictions_dir, days=args.days, group_by=args.by)
    if report["overall"]["n"] == 0:
        print("No completed prediction records found.", file=sys.stderr)
        return 1

    _print_table(report)
    if args.json:
        args.json.write_text(json.dumps(report, indent=2))
        print(f"\nwrote {args.json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
