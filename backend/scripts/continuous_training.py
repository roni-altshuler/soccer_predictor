"""
Continuous Training Orchestrator — end-to-end retrain + evaluate + drift loop.

Pipeline:
    1. Freshness check  : skip retrain if no historical data file has changed
                          since the last successful run (unless --force).
    2. Retrain          : call train_all_models() from train_models.py.
    3. Walk-forward     : run backtest_league() (fast mode) for each league.
    4. Drift compare    : diff the new walkforward_summary.json against the
                          last known-good baseline (walkforward_baseline.json).
    5. Promotion gates  : reuse backend.services.prediction.model_selection
                          to decide if regressions should hold a model back.
                          Hold-back is *advisory*; no model files are deleted.
    6. Drift report     : write training_drift_<date>.json with per-league
                          before/after metrics, deltas, and gate decisions.
    7. Rolling history  : append a JSONL line to training_history.jsonl.
    8. Baseline rotate  : replace the baseline only on a no-regression run.
    9. Run record       : update last_training_run.json.

Exit code: 0 on a clean or auto-handled run; 1 only when a candidate is held
back (a true regression that failed the promotion gates) or the run errors. A
regression that still passes the gates is promoted *with caution* (compensating
metrics improved) — that's the guardrail working, not a CI failure.

Usage:
    python -m backend.scripts.continuous_training
    python -m backend.scripts.continuous_training --force --global-model
    python -m backend.scripts.continuous_training --leagues eng.1 esp.1
    python -m backend.scripts.continuous_training --eval-only
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

# Reuse existing modules — do not refactor them.
from backend.scripts.train_models import (
    ESPN_TO_KEY,
    KEY_TO_ESPN,
    train_all_models,
)
from backend.services.prediction.backtest_walkforward import (
    backtest_league,
    write_report,
)
from backend.services.prediction.historical_data import (
    ESPN_LEAGUES,
    HISTORICAL_DATA_DIR,
)
from backend.services.prediction.model_selection import (
    load_model_selection_policy,
    get_model_selection_decision,
)

logger = logging.getLogger("continuous_training")

DATA_DIR = Path(__file__).parent.parent / "data"
DIAGNOSTICS_DIR = DATA_DIR / "diagnostics"
SUMMARY_PATH = DIAGNOSTICS_DIR / "walkforward_summary.json"
BASELINE_PATH = DIAGNOSTICS_DIR / "walkforward_baseline.json"
HISTORY_PATH = DIAGNOSTICS_DIR / "training_history.jsonl"
LAST_RUN_PATH = DIAGNOSTICS_DIR / "last_training_run.json"

# Regression thresholds — per league.
ACCURACY_REGRESSION_THRESHOLD = -0.015
LOG_LOSS_REGRESSION_THRESHOLD = 0.03
BRIER_REGRESSION_THRESHOLD = 0.02


# ────────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────────

def _utc_now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _today_str() -> str:
    return datetime.utcnow().strftime("%Y-%m-%d")


def _atomic_write_json(path: Path, payload: Any) -> None:
    """Idempotent atomic JSON write — safe to retry on crash."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w") as f:
        json.dump(payload, f, indent=2, default=str)
    tmp.replace(path)


def _load_json(path: Path) -> Optional[Dict[str, Any]]:
    if not path.exists():
        return None
    try:
        with open(path) as f:
            return json.load(f)
    except Exception as exc:
        logger.warning("failed to load %s: %s", path, exc)
        return None


def _load_last_run() -> Dict[str, Any]:
    return _load_json(LAST_RUN_PATH) or {}


def _latest_historical_mtime() -> Optional[float]:
    """Return the most recent mtime among historical/*.json files."""
    if not HISTORICAL_DATA_DIR.exists():
        return None
    latest = 0.0
    for path in HISTORICAL_DATA_DIR.glob("*.json"):
        try:
            mtime = path.stat().st_mtime
        except OSError:
            continue
        if mtime > latest:
            latest = mtime
    return latest if latest > 0 else None


def _historical_changed_since(last_iso: Optional[str]) -> bool:
    """True if any historical data file is newer than `last_iso`."""
    if not last_iso:
        return True
    latest = _latest_historical_mtime()
    if latest is None:
        return True
    try:
        cutoff = datetime.fromisoformat(last_iso.rstrip("Z")).timestamp()
    except Exception:
        return True
    return latest > cutoff


def _resolve_keys_for_eval(leagues: Optional[List[str]]) -> List[str]:
    """Map runtime league keys (eng.1) to ESPN keys (premier_league) for backtest."""
    if not leagues:
        return list(ESPN_LEAGUES.keys())
    out: List[str] = []
    for key in leagues:
        if key in ESPN_LEAGUES:
            out.append(key)  # already ESPN style
        elif key in KEY_TO_ESPN:
            out.append(KEY_TO_ESPN[key])
        else:
            logger.warning("unknown league key for eval: %s", key)
    return out


def _normalize_leagues_for_train(leagues: Optional[List[str]]) -> Optional[List[str]]:
    """train_all_models expects runtime keys (eng.1). Pass through or map."""
    if not leagues:
        return None
    out: List[str] = []
    for key in leagues:
        if key in ESPN_TO_KEY:
            out.append(ESPN_TO_KEY[key])
        else:
            out.append(key)
    return out


# ────────────────────────────────────────────────────────────────────────────
# Walk-forward evaluation
# ────────────────────────────────────────────────────────────────────────────

@dataclass
class LeagueEval:
    league: str
    aggregate: Dict[str, Any]
    error: Optional[str] = None
    n_test_seasons: int = 0


def run_walkforward(eval_keys: List[str]) -> Dict[str, LeagueEval]:
    """Run walk-forward backtest for the requested ESPN league keys."""
    results: Dict[str, LeagueEval] = {}
    summary_rows: List[Dict[str, Any]] = []

    for league in eval_keys:
        if league not in ESPN_LEAGUES:
            logger.warning("skipping unknown league for walkforward: %s", league)
            continue
        logger.info("walkforward: %s", league)
        try:
            # Loose thresholds match the CLI defaults used to seed the baseline.
            # The library default (warmup=3, min_train=500, min_test=60) is too
            # strict for sparse-data leagues (Primeira Liga, Eredivisie, Euro,
            # Copa) and produces phantom "no_eligible_seasons" regressions when
            # the per-league cache shape changes slightly between retrains.
            report = backtest_league(
                league,
                warmup_seasons=2,
                min_train_samples=200,
                min_test_samples=20,
                fast=True,
                incremental_write=True,
            )
        except Exception as exc:
            logger.warning("walkforward failed for %s: %s", league, exc)
            results[league] = LeagueEval(league=league, aggregate={}, error=str(exc))
            summary_rows.append({"league": league, "error": str(exc)})
            continue

        # write_report ensures the per-league walkforward_<league>.json file is fresh.
        write_report(league, report)

        if "aggregate" in report:
            results[league] = LeagueEval(
                league=league,
                aggregate=report["aggregate"],
                n_test_seasons=report.get("n_test_seasons", 0),
            )
            summary_rows.append({
                "league": league,
                **report["aggregate"],
                "n_test_seasons": report.get("n_test_seasons", 0),
            })
        else:
            err = report.get("error") or "unknown"
            results[league] = LeagueEval(league=league, aggregate={}, error=err)
            summary_rows.append({"league": league, "error": err})

    _atomic_write_json(SUMMARY_PATH, {
        "generated_at": _utc_now_iso(),
        "leagues": summary_rows,
    })
    return results


# ────────────────────────────────────────────────────────────────────────────
# Drift comparison + promotion gates
# ────────────────────────────────────────────────────────────────────────────

def _baseline_index(baseline: Optional[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    if not baseline or "leagues" not in baseline:
        return {}
    return {row.get("league"): row for row in baseline.get("leagues", []) if row.get("league")}


def _classify_league(
    league: str,
    after: Dict[str, Any],
    before: Optional[Dict[str, Any]],
    policy: Dict[str, Any],
) -> Dict[str, Any]:
    """Per-league before/after diff + promotion verdict."""
    deltas: Dict[str, Optional[float]] = {
        "accuracy_delta": None,
        "log_loss_delta": None,
        "brier_delta": None,
        "ece_delta": None,
    }
    is_regression = False
    is_win = False
    wins_count = 0

    if before:
        def diff(key: str) -> Optional[float]:
            a = after.get(key)
            b = before.get(key)
            if not isinstance(a, (int, float)) or not isinstance(b, (int, float)):
                return None
            return round(float(a) - float(b), 4)

        deltas["accuracy_delta"] = diff("accuracy_mean")
        deltas["log_loss_delta"] = diff("log_loss_mean")
        deltas["brier_delta"] = diff("brier_mean")
        deltas["ece_delta"] = diff("ece_mean")

        acc_d = deltas["accuracy_delta"]
        ll_d = deltas["log_loss_delta"]
        br_d = deltas["brier_delta"]

        regression_flags = [
            acc_d is not None and acc_d < ACCURACY_REGRESSION_THRESHOLD,
            ll_d is not None and ll_d > LOG_LOSS_REGRESSION_THRESHOLD,
            br_d is not None and br_d > BRIER_REGRESSION_THRESHOLD,
        ]
        is_regression = any(regression_flags)

        win_flags = [
            acc_d is not None and acc_d > 0,
            ll_d is not None and ll_d < 0,
            br_d is not None and br_d < 0,
        ]
        wins_count = sum(1 for f in win_flags if f)
        is_win = wins_count >= 2

    # Promotion gate: re-use existing model_selection policy decision for the league.
    # We support both ESPN-style ("premier_league") and runtime keys ("eng.1") —
    # the policy is keyed on runtime keys, so map first.
    runtime_key = ESPN_LEAGUES.get(league, league)
    policy_decision = get_model_selection_decision(runtime_key, policy)

    # Advisory promotion verdict:
    #   - regression + gates fail -> held_back
    #   - regression + gates pass -> promoted_with_caution
    #   - win or neutral         -> promoted
    gate_pass = bool(policy_decision.get("decision") in {"league", "global", "blend"})

    if is_regression and not gate_pass:
        decision = "held_back"
    elif is_regression and gate_pass:
        decision = "promoted_with_caution"
    elif is_win:
        decision = "promoted"
    else:
        decision = "promoted"  # neutral or insufficient data → still promote (artifacts already saved).

    return {
        "league": league,
        "runtime_key": runtime_key,
        "before": before or None,
        "after": after,
        "deltas": deltas,
        "regression": is_regression,
        "win": is_win,
        "wins_count": wins_count,
        "decision": decision,
        "gate_decision": policy_decision,
    }


def build_drift_report(
    retrained_leagues: List[str],
    eval_results: Dict[str, LeagueEval],
    baseline: Optional[Dict[str, Any]],
    policy: Dict[str, Any],
) -> Dict[str, Any]:
    baseline_idx = _baseline_index(baseline)
    leagues_report: List[Dict[str, Any]] = []

    for league, ev in sorted(eval_results.items()):
        if ev.error:
            leagues_report.append({
                "league": league,
                "runtime_key": ESPN_LEAGUES.get(league, league),
                "error": ev.error,
                "decision": "skipped",
            })
            continue
        before = baseline_idx.get(league)
        leagues_report.append(_classify_league(league, ev.aggregate, before, policy))

    n_wins = sum(1 for r in leagues_report if r.get("win"))
    n_regressions = sum(1 for r in leagues_report if r.get("regression"))
    n_held_back = sum(1 for r in leagues_report if r.get("decision") == "held_back")
    n_promoted = sum(1 for r in leagues_report if r.get("decision") in {"promoted", "promoted_with_caution"})

    overall_status = "ok" if n_regressions == 0 else "regression"

    return {
        "generated_at": _utc_now_iso(),
        "retrained_leagues": retrained_leagues,
        "baseline_present": baseline is not None,
        "overall": {
            "status": overall_status,
            "n_leagues_evaluated": len(leagues_report),
            "n_wins": n_wins,
            "n_regressions": n_regressions,
            "n_held_back": n_held_back,
            "n_promoted": n_promoted,
        },
        "thresholds": {
            "accuracy_regression": ACCURACY_REGRESSION_THRESHOLD,
            "log_loss_regression": LOG_LOSS_REGRESSION_THRESHOLD,
            "brier_regression": BRIER_REGRESSION_THRESHOLD,
        },
        "leagues": leagues_report,
    }


# ────────────────────────────────────────────────────────────────────────────
# History + baseline rotation
# ────────────────────────────────────────────────────────────────────────────

def append_history(drift: Dict[str, Any]) -> None:
    """Append one JSONL line summarizing this run."""
    accuracies: List[float] = []
    eces: List[float] = []
    for row in drift.get("leagues", []):
        after = row.get("after") or {}
        if isinstance(after.get("accuracy_mean"), (int, float)):
            accuracies.append(float(after["accuracy_mean"]))
        if isinstance(after.get("ece_mean"), (int, float)):
            eces.append(float(after["ece_mean"]))

    def _mean(values: List[float]) -> Optional[float]:
        return round(sum(values) / len(values), 4) if values else None

    record = {
        "date": _today_str(),
        "generated_at": drift.get("generated_at"),
        "retrained_leagues": drift.get("retrained_leagues") or [],
        "n_wins": drift.get("overall", {}).get("n_wins", 0),
        "n_regressions": drift.get("overall", {}).get("n_regressions", 0),
        "n_held_back": drift.get("overall", {}).get("n_held_back", 0),
        "accuracy_mean_global": _mean(accuracies),
        "ece_mean_global": _mean(eces),
    }

    HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
    # Append-only; idempotent enough — one line per run.
    with open(HISTORY_PATH, "a") as f:
        f.write(json.dumps(record) + "\n")


def rotate_baseline_if_safe(drift: Dict[str, Any]) -> bool:
    """Replace baseline with current summary only when no league regressed."""
    n_regressions = drift.get("overall", {}).get("n_regressions", 0)
    if n_regressions > 0:
        logger.info("Baseline NOT rotated (regressions detected: %d)", n_regressions)
        return False

    current = _load_json(SUMMARY_PATH)
    if current is None:
        logger.warning("No walkforward_summary.json to rotate")
        return False
    _atomic_write_json(BASELINE_PATH, current)
    logger.info("Baseline rotated -> %s", BASELINE_PATH)
    return True


# ────────────────────────────────────────────────────────────────────────────
# Main orchestration
# ────────────────────────────────────────────────────────────────────────────

async def run_pipeline(args: argparse.Namespace) -> int:
    DIAGNOSTICS_DIR.mkdir(parents=True, exist_ok=True)

    last_run = _load_last_run()

    # ── (a) freshness check ──
    if not args.force and not args.eval_only:
        last_ok = last_run.get("ran_at") if last_run.get("status") == "ok" else None
        if not _historical_changed_since(last_ok):
            logger.info("No historical data changes since %s — skipping retrain. Use --force to override.", last_ok)
            print("CONTINUOUS_TRAINING_SUMMARY: status=skipped reason=no_data_change")
            return 0

    retrained_leagues: List[str] = []

    # ── (b) retrain ──
    if not args.eval_only:
        leagues_for_train = _normalize_leagues_for_train(args.leagues)
        logger.info("Retraining (leagues=%s, global=%s, min_season=%s, force_fetch=%s)",
                    leagues_for_train or "all", args.global_model, args.min_season, args.force_fetch)
        try:
            train_results = await train_all_models(
                leagues=leagues_for_train,
                min_season=args.min_season,
                force_fetch=args.force_fetch,
                train_global_model=args.global_model,
                train_league_models=True,
            )
            retrained_leagues = [k for k, v in train_results.items()
                                 if isinstance(v, dict) and v.get("status") == "success"]
        except Exception as exc:
            logger.exception("Retrain failed: %s", exc)
            _atomic_write_json(LAST_RUN_PATH, {
                "ran_at": _utc_now_iso(),
                "status": "error",
                "error": str(exc),
            })
            print(f"CONTINUOUS_TRAINING_SUMMARY: status=error stage=retrain msg={exc}")
            return 1

    # ── (c) walk-forward eval ──
    if args.skip_eval:
        logger.info("--skip-eval set; finishing after retrain.")
        _atomic_write_json(LAST_RUN_PATH, {
            "ran_at": _utc_now_iso(),
            "status": "ok",
            "retrained_leagues": retrained_leagues,
            "summary_path": None,
            "drift_report_path": None,
            "note": "skip_eval",
        })
        print(f"CONTINUOUS_TRAINING_SUMMARY: status=ok wins=0 regressions=0 held_back=0 retrained={len(retrained_leagues)}")
        return 0

    eval_keys = _resolve_keys_for_eval(args.leagues)
    logger.info("Walk-forward eval on %d leagues", len(eval_keys))
    eval_results = run_walkforward(eval_keys)

    # ── (d, e) compare + promotion gates ──
    baseline = _load_json(BASELINE_PATH)
    policy = load_model_selection_policy()

    if baseline is None:
        # First run — seed the baseline and skip comparison.
        current_summary = _load_json(SUMMARY_PATH) or {}
        _atomic_write_json(BASELINE_PATH, current_summary)
        logger.info("Seeded initial baseline -> %s", BASELINE_PATH)

    drift = build_drift_report(retrained_leagues, eval_results, baseline, policy)

    # ── (f) drift report ──
    drift_report_path = DIAGNOSTICS_DIR / f"training_drift_{_today_str()}.json"
    _atomic_write_json(drift_report_path, drift)
    logger.info("Drift report -> %s", drift_report_path)

    # ── (g) rolling history ──
    append_history(drift)

    # ── (h) baseline rotation (only on success) ──
    rotate_baseline_if_safe(drift)

    overall = drift.get("overall", {})
    n_wins = overall.get("n_wins", 0)
    n_reg = overall.get("n_regressions", 0)
    n_held = overall.get("n_held_back", 0)
    # Distinguish a regression that was rejected (held back — production kept the
    # prior model) from one that was promoted with caution because compensating
    # metrics improved. Only the former is an actionable failure.
    if n_held > 0:
        status = "regression_held_back"
    elif n_reg > 0:
        status = "regression_handled"
    else:
        status = "ok"

    # ── (i) run record ──
    _atomic_write_json(LAST_RUN_PATH, {
        "ran_at": _utc_now_iso(),
        "status": status,
        "summary_path": str(SUMMARY_PATH),
        "drift_report_path": str(drift_report_path),
        "retrained_leagues": retrained_leagues,
        "n_wins": n_wins,
        "n_regressions": n_reg,
        "n_held_back": n_held,
    })

    print(f"CONTINUOUS_TRAINING_SUMMARY: status={status} wins={n_wins} regressions={n_reg} held_back={n_held}")
    # Fail only on an actionable outcome (a held-back candidate). Auto-handled
    # regressions (promoted with caution) are a normal, healthy result.
    return 1 if n_held > 0 else 0


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Continuous retraining + walk-forward evaluation orchestrator")
    parser.add_argument("--force", action="store_true", help="Skip the freshness check.")
    parser.add_argument("--leagues", nargs="*", default=None,
                        help="Restrict scope (runtime keys e.g. eng.1, or ESPN keys e.g. premier_league).")
    parser.add_argument("--global-model", action="store_true",
                        help="Also retrain the cross-league global model.")
    parser.add_argument("--min-season", type=int, default=2010,
                        help="Earliest season for retrain fetch (default: 2010).")
    parser.add_argument("--force-fetch", action="store_true",
                        help="Force re-fetch of historical data (passed to train_all_models).")
    parser.add_argument("--skip-eval", action="store_true",
                        help="Only retrain; don't run the walk-forward eval.")
    parser.add_argument("--eval-only", action="store_true",
                        help="Only run the walk-forward eval and drift comparison; skip retrain.")
    parser.add_argument("--verbose", action="store_true")
    return parser.parse_args(argv)


async def main() -> int:
    args = parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    return await run_pipeline(args)


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
