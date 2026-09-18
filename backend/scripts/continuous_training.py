"""
Continuous Training Orchestrator — end-to-end retrain + evaluate + drift loop.

Pipeline:
    1. Freshness check  : skip retrain if no historical data file has changed
                          since the last successful run (unless --force).
    2. Snapshot         : copy the current production model artifacts aside so
                          a regressed candidate can be rolled back.
    3. Retrain          : call train_all_models() from train_models.py.
    4. Walk-forward     : run backtest_league() (fast mode) for each league.
    5. Drift compare    : diff the new walkforward_summary.json against the
                          last known-good baseline (walkforward_baseline.json).
    6. Promotion gate   : a league that regressed past ANY configured threshold
                          is held back and its production artifacts are
                          RESTORED from the step-2 snapshot. This is enforcement,
                          not advice.
    7. Drift report     : write training_drift_<date>.json with per-league
                          before/after metrics, deltas, threshold breaches and
                          the promotion verdict.
    8. Rolling history  : append a JSONL line to training_history.jsonl.
    9. Baseline rotate  : per league — promoted leagues adopt their new metrics,
                          held-back leagues keep the row describing the model
                          that is actually still in production.
   10. Run record       : update last_training_run.json.

The promotion gate requires complete finite comparison metrics and applies the
regression thresholds below. `model_selection.json` describes which
artifact the runtime *serves* (league / global / blend / dixon_coles); it is
recorded in the report as context under "serving_policy" but has no vote here.
Conflating the two is what let nine consecutive weeks of regressions ship.

Exit codes:
    0  clean run, or the gate did its job (some leagues held back, others
       promoted). A working guardrail is not a build failure.
    1  an actual error, or a systemic regression — EVERY comparable league
       regressed, which means the pipeline itself is broken rather than one
       league drifting.

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
import math
import os
import shutil
import sys
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

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
MODEL_DIR = DATA_DIR / "models"
# Kept outside MODEL_DIR so nothing walking models/ mistakes it for a league.
SNAPSHOT_DIR = DATA_DIR / ".model_promotion_snapshot"
QUARANTINE_DIR = DATA_DIR / ".model_quarantine"
SUMMARY_PATH = DIAGNOSTICS_DIR / "walkforward_summary.json"
BASELINE_PATH = DIAGNOSTICS_DIR / "walkforward_baseline.json"
HISTORY_PATH = DIAGNOSTICS_DIR / "training_history.jsonl"
LAST_RUN_PATH = DIAGNOSTICS_DIR / "last_training_run.json"

# Regression thresholds — per league. Breaching ANY of these blocks promotion.
ACCURACY_REGRESSION_THRESHOLD = -0.015
LOG_LOSS_REGRESSION_THRESHOLD = 0.03
BRIER_REGRESSION_THRESHOLD = 0.02

# Terminal verdicts a league can receive. There is deliberately no
# "promoted_with_caution" — that state was the loophole.
DECISION_PROMOTED = "promoted"
DECISION_HELD_BACK = "held_back"
DECISION_SKIPPED = "skipped"


# ────────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────────

def _utc_now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _gh_annotate(level: str, message: str) -> None:
    """Emit a GitHub Actions workflow command (harmless plain text elsewhere)."""
    # Annotations must be single-line; newlines are escaped per the GHA spec.
    safe = str(message).replace("\r", "").replace("\n", "%0A")
    print(f"::{level}::{safe}", flush=True)


def _gh_step_summary(markdown: str) -> None:
    """Append a Markdown block to the job summary when running under Actions."""
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    try:
        with open(path, "a") as f:
            f.write(markdown.rstrip() + "\n")
    except OSError as exc:
        logger.debug("could not write GITHUB_STEP_SUMMARY: %s", exc)


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
        # Same Wave A default as training, mapped to the backtest's ESPN keys.
        return [KEY_TO_ESPN.get(k, k) for k in WAVE_A_RUNTIME_KEYS]
    out: List[str] = []
    for key in leagues:
        if key in ESPN_LEAGUES:
            out.append(key)  # already ESPN style
        elif key in KEY_TO_ESPN:
            out.append(KEY_TO_ESPN[key])
        else:
            logger.warning("unknown league key for eval: %s", key)
    return out


# Default training scope. The pivot narrowed the product to these five, but
# this job kept retraining all fourteen every Sunday — `retrained_leagues:
# list[14]` in every training_drift artifact — and each one competed for the
# same promotion gate. Weekly compute spent on a league nothing serves is
# weekly compute not spent on the leagues that do, and a regression there still
# had to be triaged.
#
# Passing --leagues explicitly still reaches anything: this is the default, not
# a restriction. Restoring a league permanently means adding it here, in
# predict_upcoming.LEAGUES and in the frontend's WAVE_A_COMPETITION_IDS.
WAVE_A_RUNTIME_KEYS: Tuple[str, ...] = ("eng.1", "esp.1", "ger.1", "ita.1", "fra.1")


def _normalize_leagues_for_train(leagues: Optional[List[str]]) -> Optional[List[str]]:
    """train_all_models expects runtime keys (eng.1). Pass through or map."""
    if not leagues:
        return list(WAVE_A_RUNTIME_KEYS)
    out: List[str] = []
    for key in leagues:
        if key in ESPN_TO_KEY:
            out.append(ESPN_TO_KEY[key])
        else:
            out.append(key)
    return out


# ────────────────────────────────────────────────────────────────────────────
# Production artifact snapshot / rollback
#
# train_all_models() calls model.save(), which overwrites
# backend/data/models/<runtime_key>/ in place *before* we have any evaluation
# to judge it by. So "do not promote" can only be honoured by keeping a copy of
# the outgoing artifacts and putting them back when the candidate regresses.
# ────────────────────────────────────────────────────────────────────────────

def _candidate_runtime_keys(leagues_for_train: Optional[List[str]]) -> List[str]:
    """Runtime keys whose artifacts this run might overwrite."""
    if leagues_for_train:
        return sorted(set(leagues_for_train))
    return sorted(set(ESPN_LEAGUES.values()))


def snapshot_production_models(runtime_keys: Iterable[str]) -> List[str]:
    """Copy each league's current production artifacts into SNAPSHOT_DIR.

    Snapshot failure aborts BEFORE training can overwrite an incumbent. New
    candidates without an incumbent are quarantined if they do not pass.
    """
    runtime_keys = list(runtime_keys)
    if SNAPSHOT_DIR.exists() and any(SNAPSHOT_DIR.iterdir()):
        raise RuntimeError("An unresolved promotion snapshot exists; recover it before retraining")
    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    # Global training also rewrites the runtime routing policy. It must travel
    # with its model, otherwise rolling back weights can still change serving.
    selection = MODEL_DIR / "model_selection.json"
    if selection.exists():
        shutil.copy2(selection, SNAPSHOT_DIR / selection.name)

    captured: List[str] = []
    for key in runtime_keys:
        src = MODEL_DIR / key
        if not src.is_dir():
            continue
        try:
            shutil.copytree(src, SNAPSHOT_DIR / key)
            captured.append(key)
        except Exception as exc:  # pragma: no cover - disk-level failure
            raise RuntimeError(f"Cannot safely train: snapshot failed for {key}") from exc
    logger.info("Snapshotted %d production model dir(s) -> %s", len(captured), SNAPSHOT_DIR)
    _atomic_write_json(SNAPSHOT_DIR / "candidates.json", {"keys": runtime_keys})
    return captured


def restore_production_model(runtime_key: str) -> str:
    """Put the pre-retrain artifacts for one league back into production.

    Returns a short status string recorded in the drift report:
      restored           — previous production artifacts are back in place
      no_prior_artifact  — candidate quarantined; no incumbent exists (first train)
      failed             — the rollback itself errored (surfaced as a run error)
    """
    snap = SNAPSHOT_DIR / runtime_key
    live = MODEL_DIR / runtime_key
    rejected = QUARANTINE_DIR / uuid.uuid4().hex / runtime_key
    staging = SNAPSHOT_DIR / f".restore_{runtime_key}"
    try:
        rejected.parent.mkdir(parents=True, exist_ok=True)
        if live.exists():
            # Remove the candidate before any recovery step that could fail.
            live.rename(rejected)
        if runtime_key == "global":
            policy = MODEL_DIR / "model_selection.json"
            previous_policy = SNAPSHOT_DIR / policy.name
            if previous_policy.exists():
                temporary = MODEL_DIR / ".model_selection.restore.json"
                shutil.copy2(previous_policy, temporary)
                temporary.replace(policy)
            else:
                policy.unlink(missing_ok=True)
        if not snap.is_dir():
            return "no_prior_artifact"
        shutil.rmtree(staging, ignore_errors=True)
        shutil.copytree(snap, staging)
        staging.rename(live)
        logger.info("[%s] rolled back to pre-retrain artifacts", runtime_key)
        return "restored"
    except Exception as exc:
        logger.error("[%s] ROLLBACK FAILED: %s", runtime_key, exc)
        # Keep the snapshot for recovery. Never put a rejected candidate back.
        return "failed"


def clear_snapshots() -> None:
    shutil.rmtree(SNAPSHOT_DIR, ignore_errors=True)


def recover_snapshot_candidates() -> List[str]:
    """Recover the complete attempted set, including candidates with no prior model."""
    manifest = _load_json(SNAPSHOT_DIR / "candidates.json")
    if not manifest:
        # A partial backup never authorized training. Preserve it for diagnosis.
        return []
    keys = manifest.get("keys", [])
    statuses = [restore_production_model(key) for key in keys]
    if "failed" not in statuses:
        clear_snapshots()
    return keys


def enforce_promotion_gate(drift: Dict[str, Any]) -> Dict[str, Any]:
    """Roll back every league the gate held back. Mutates `drift` in place."""
    restored: List[str] = []
    missing: List[str] = []
    failed: List[str] = []

    for row in drift.get("leagues", []):
        if row.get("decision") != DECISION_HELD_BACK:
            continue
        key = row.get("runtime_key") or row.get("league")
        status = restore_production_model(str(key))
        row["rollback"] = status
        if status == "restored":
            restored.append(str(key))
        elif status == "no_prior_artifact":
            missing.append(str(key))
        else:
            failed.append(str(key))

    summary = {
        "rolled_back": restored,
        "no_prior_artifact": missing,
        "rollback_failed": failed,
    }
    drift["promotion_enforcement"] = summary
    return summary


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
    """Per-league before/after diff + promotion verdict.

    Missing evidence or a breached regression threshold holds the candidate back.
    """
    deltas: Dict[str, Optional[float]] = {
        "accuracy_delta": None,
        "log_loss_delta": None,
        "brier_delta": None,
        "ece_delta": None,
    }
    regression_reasons: List[str] = []
    is_win = False
    wins_count = 0
    comparable = bool(before)

    if before:
        def diff(key: str) -> Optional[float]:
            a = after.get(key)
            b = before.get(key)
            if not isinstance(a, (int, float)) or not isinstance(b, (int, float)):
                return None
            if not math.isfinite(a) or not math.isfinite(b):
                return None
            return round(float(a) - float(b), 4)

        deltas["accuracy_delta"] = diff("accuracy_mean")
        deltas["log_loss_delta"] = diff("log_loss_mean")
        deltas["brier_delta"] = diff("brier_mean")
        deltas["ece_delta"] = diff("ece_mean")

        acc_d = deltas["accuracy_delta"]
        ll_d = deltas["log_loss_delta"]
        br_d = deltas["brier_delta"]

        # Record *which* threshold tripped, so the report says why, not just that.
        if acc_d is not None and acc_d < ACCURACY_REGRESSION_THRESHOLD:
            regression_reasons.append(
                f"accuracy {acc_d:+.4f} < {ACCURACY_REGRESSION_THRESHOLD}"
            )
        if ll_d is not None and ll_d > LOG_LOSS_REGRESSION_THRESHOLD:
            regression_reasons.append(
                f"log_loss {ll_d:+.4f} > {LOG_LOSS_REGRESSION_THRESHOLD}"
            )
        if br_d is not None and br_d > BRIER_REGRESSION_THRESHOLD:
            regression_reasons.append(
                f"brier {br_d:+.4f} > {BRIER_REGRESSION_THRESHOLD}"
            )

        # No baseline metric at all means nothing to compare, not "no regression".
        comparable = all(v is not None for v in (acc_d, ll_d, br_d))

        win_flags = [
            acc_d is not None and acc_d > 0,
            ll_d is not None and ll_d < 0,
            br_d is not None and br_d < 0,
        ]
        wins_count = sum(1 for f in win_flags if f)
        is_win = wins_count >= 2

    is_regression = bool(regression_reasons)

    runtime_key = ESPN_LEAGUES.get(league, league)

    # Absence of comparable evidence is not evidence of non-regression.
    decision = DECISION_HELD_BACK if is_regression or not comparable else DECISION_PROMOTED

    # Context only. `model_selection.json` says which artifact the runtime
    # serves (league / global / blend / dixon_coles). It is NOT a promotion
    # verdict and must never be read as one: this used to be the gate, and
    # because it returns a serving mode for every healthy league it passed
    # unconditionally, promoting eight straight weeks of regressed models.
    serving_policy = get_model_selection_decision(runtime_key, policy)

    return {
        "league": league,
        "runtime_key": runtime_key,
        "before": before or None,
        "after": after,
        "deltas": deltas,
        "comparable": comparable,
        "regression": is_regression,
        "regression_reasons": regression_reasons,
        "evidence_missing": not comparable,
        "win": is_win,
        "wins_count": wins_count,
        "decision": decision,
        "serving_policy": serving_policy,
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
                "decision": DECISION_HELD_BACK,
            })
            continue
        before = baseline_idx.get(league)
        leagues_report.append(_classify_league(league, ev.aggregate, before, policy))

    n_wins = sum(1 for r in leagues_report if r.get("win"))
    n_regressions = sum(1 for r in leagues_report if r.get("regression"))
    n_held_back = sum(1 for r in leagues_report if r.get("decision") == DECISION_HELD_BACK)
    n_promoted = sum(1 for r in leagues_report if r.get("decision") == DECISION_PROMOTED)
    n_skipped = sum(1 for r in leagues_report if r.get("decision") == DECISION_SKIPPED)
    # Leagues we could actually judge: they had a baseline metric to diff against.
    # Leagues with no baseline can never regress, so they must not dilute the
    # "did everything regress?" systemic check.
    n_comparable = sum(1 for r in leagues_report if r.get("comparable"))

    # Missing evidence can hold a candidate without establishing regression.
    systemic = n_comparable > 0 and n_regressions == n_comparable

    if systemic:
        overall_status = "systemic_regression"
    elif n_held_back > 0:
        overall_status = "gate_enforced"
    else:
        overall_status = "ok"

    return {
        "generated_at": _utc_now_iso(),
        "retrained_leagues": retrained_leagues,
        "baseline_present": baseline is not None,
        "overall": {
            "status": overall_status,
            "n_leagues_evaluated": len(leagues_report),
            "n_comparable": n_comparable,
            "n_wins": n_wins,
            "n_regressions": n_regressions,
            "n_held_back": n_held_back,
            "n_promoted": n_promoted,
            "n_skipped": n_skipped,
            "systemic_regression": systemic,
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
        "n_promoted": drift.get("overall", {}).get("n_promoted", 0),
        "status": drift.get("overall", {}).get("status"),
        "accuracy_mean_global": _mean(accuracies),
        "ece_mean_global": _mean(eces),
    }

    HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
    # Append-only; idempotent enough — one line per run.
    with open(HISTORY_PATH, "a") as f:
        f.write(json.dumps(record) + "\n")


def rotate_baseline_per_league(drift: Dict[str, Any]) -> Dict[str, List[str]]:
    """Advance the baseline league by league.

    The baseline must describe *what is actually in production*:
      - promoted league  -> adopt its new walk-forward row
      - held-back league -> keep the existing row, because the rollback means
                            production is still running the older model
      - skipped league   -> keep the existing row, nothing was measured

    The previous all-or-nothing rule froze walkforward_baseline.json at
    2026-05-19: with at least one league regressing every week it never
    rotated again, so every subsequent run diffed against an ever-staler
    reference and reported a regression more or less by construction.
    """
    current = _load_json(SUMMARY_PATH)
    if current is None:
        logger.warning("No walkforward_summary.json to rotate")
        return {"advanced": [], "frozen": []}

    baseline = _load_json(BASELINE_PATH) or {}
    baseline_rows = {
        row.get("league"): row
        for row in baseline.get("leagues", [])
        if isinstance(row, dict) and row.get("league")
    }
    current_rows = {
        row.get("league"): row
        for row in current.get("leagues", [])
        if isinstance(row, dict) and row.get("league")
    }

    verdicts = {
        row.get("league"): row.get("decision")
        for row in drift.get("leagues", [])
        if row.get("league")
    }

    advanced: List[str] = []
    frozen: List[str] = []
    merged: List[Dict[str, Any]] = []

    for league, row in current_rows.items():
        if verdicts.get(league) == DECISION_PROMOTED:
            merged.append(row)
            advanced.append(league)
        else:
            if league in baseline_rows:
                merged.append(baseline_rows[league])
            frozen.append(league)

    # Preserve baseline-only leagues that this run did not evaluate at all.
    for league, row in baseline_rows.items():
        if league not in current_rows:
            merged.append(row)
            frozen.append(league)

    _atomic_write_json(BASELINE_PATH, {
        "generated_at": _utc_now_iso(),
        "rotation": "per_league",
        "leagues": merged,
    })
    logger.info(
        "Baseline rotated per league: %d advanced, %d held at previous values -> %s",
        len(advanced), len(frozen), BASELINE_PATH,
    )
    return {"advanced": sorted(advanced), "frozen": sorted(frozen)}


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
    candidate_keys: List[str] = []

    if args.skip_eval or (not args.eval_only and not args.rollback):
        logger.error("Training requires evaluation and rollback; use a separate research experiment for unvalidated models.")
        return 1

    # ── (b) snapshot + retrain ──
    if not args.eval_only:
        leagues_for_train = _normalize_leagues_for_train(args.leagues)

        # Snapshot BEFORE training: model.save() overwrites production artifacts
        # in place, so this copy is the only thing that makes "not promoted"
        # mean anything.
        if args.rollback:
            candidate_keys = _candidate_runtime_keys(leagues_for_train)
            if args.global_model:
                candidate_keys.append("global")
            snapshot_production_models(candidate_keys)
        else:
            logger.warning("--no-rollback set: a regressed model will NOT be rolled back.")

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
            # The retrain may have overwritten some leagues before dying. Put
            # every snapshot back so a crash never half-promotes.
            restored = [restore_production_model(key) for key in candidate_keys]
            if "failed" not in restored:
                clear_snapshots()
            _atomic_write_json(LAST_RUN_PATH, {
                "ran_at": _utc_now_iso(),
                "status": "error",
                "error": str(exc),
            })
            _gh_annotate("error", f"Continuous training crashed during retrain: {exc}")
            print(f"CONTINUOUS_TRAINING_SUMMARY: status=error stage=retrain msg={exc}")
            return 1

    # ── (c) walk-forward eval ──
    eval_keys = _resolve_keys_for_eval(args.leagues)
    logger.info("Walk-forward eval on %d leagues", len(eval_keys))
    try:
        eval_results = run_walkforward(eval_keys)
    except Exception:
        restored = [restore_production_model(key) for key in candidate_keys]
        if candidate_keys and "failed" not in restored:
            clear_snapshots()
        logger.exception("Evaluation failed; unevaluated candidates have been withdrawn")
        return 1

    # ── (d, e) compare + promotion gates ──
    baseline = _load_json(BASELINE_PATH)
    policy = load_model_selection_policy()

    if baseline is None and args.eval_only:
        # First run — seed the baseline and skip comparison.
        current_summary = _load_json(SUMMARY_PATH) or {}
        _atomic_write_json(BASELINE_PATH, current_summary)
        logger.info("Seeded initial baseline -> %s", BASELINE_PATH)

    drift = build_drift_report(retrained_leagues, eval_results, baseline, policy)
    for row in drift['leagues']:
        if candidate_keys and row.get('runtime_key') not in retrained_leagues:
            if row['decision'] == DECISION_PROMOTED:
                drift['overall']['n_promoted'] -= 1
                drift['overall']['n_held_back'] += 1
            row.update(decision=DECISION_HELD_BACK, error="No successful candidate training result")
    evaluated = {r.get("runtime_key") for r in drift["leagues"]}
    for key in candidate_keys:
        if key not in evaluated:
            drift["leagues"].append({"runtime_key": key, "league": key,
                                    "decision": DECISION_HELD_BACK,
                                    "error": "No candidate evaluation; withdrawn"})
            drift["overall"]["n_held_back"] += 1
    if drift['overall']['n_held_back'] and drift['overall']['status'] == 'ok':
        drift['overall']['status'] = 'gate_enforced'

    # ── (f) ENFORCE the gate: roll back every held-back league ──
    if args.rollback and not args.eval_only:
        enforcement = enforce_promotion_gate(drift)
    else:
        # --eval-only never retrained, so there is nothing to roll back.
        reason = "eval_only" if args.eval_only else "rollback_disabled"
        enforcement = {"rolled_back": [], "no_prior_artifact": [], "rollback_failed": [], "skipped": reason}
        drift["promotion_enforcement"] = enforcement
    if candidate_keys and not enforcement.get("rollback_failed"):
        clear_snapshots()

    # ── (g) drift report ──
    drift_report_path = DIAGNOSTICS_DIR / f"training_drift_{_today_str()}.json"
    _atomic_write_json(drift_report_path, drift)
    logger.info("Drift report -> %s", drift_report_path)

    # ── (h) rolling history ──
    append_history(drift)

    # ── (i) baseline rotation (per league) ──
    rotation = rotate_baseline_per_league(drift)

    overall = drift.get("overall", {})
    n_wins = overall.get("n_wins", 0)
    n_reg = overall.get("n_regressions", 0)
    n_held = overall.get("n_held_back", 0)
    n_promoted = overall.get("n_promoted", 0)
    n_comparable = overall.get("n_comparable", 0)
    systemic = bool(overall.get("systemic_regression"))
    rollback_failed = enforcement.get("rollback_failed") or []

    held_leagues = sorted(
        str(r.get("league")) for r in drift.get("leagues", [])
        if r.get("decision") == DECISION_HELD_BACK
    )

    # Status vocabulary, and the exit code that goes with it:
    #   ok                  clean run                                   -> 0
    #   gate_enforced       some held back, some promoted. The guardrail
    #                       worked; this is NOT a build failure          -> 0
    #   systemic_regression every comparable league regressed — that is
    #                       the pipeline breaking, not model drift       -> 1
    #   error               rollback failed; production state is unsafe  -> 1
    if rollback_failed:
        status = "error"
        rc = 1
    elif systemic:
        status = "systemic_regression"
        rc = 1
    elif n_held > 0:
        status = "gate_enforced"
        rc = 0
    else:
        status = "ok"
        rc = 0

    # ── (j) run record ──
    _atomic_write_json(LAST_RUN_PATH, {
        "ran_at": _utc_now_iso(),
        "status": status,
        "summary_path": str(SUMMARY_PATH),
        "drift_report_path": str(drift_report_path),
        "retrained_leagues": retrained_leagues,
        "n_wins": n_wins,
        "n_regressions": n_reg,
        "n_held_back": n_held,
        "n_promoted": n_promoted,
        "promotion_enforcement": enforcement,
        "baseline_rotation": rotation,
    })

    # ── (k) operator-facing summary ──
    held_detail = ", ".join(held_leagues) if held_leagues else "none"
    if rollback_failed:
        _gh_annotate(
            "error",
            f"Promotion gate could not roll back {', '.join(rollback_failed)} — "
            "production may be serving a regressed model. Investigate before the next run.",
        )
    elif systemic:
        _gh_annotate(
            "error",
            f"SYSTEMIC regression: all {n_comparable} comparable league(s) regressed "
            f"and were held back ({held_detail}). This points at the training pipeline, "
            "not at model drift — see backend/data/diagnostics/training_drift_*.json.",
        )
    elif n_held > 0:
        _gh_annotate(
            "notice",
            f"Promotion gate enforced: {n_promoted} model(s) promoted, {n_held} held back "
            f"({held_detail}). Rejected candidates withdrawn; incumbents restored where available. "
            "This is the guardrail working as designed — no action required unless a league "
            "stays held back across several runs.",
        )
    else:
        _gh_annotate(
            "notice",
            f"Promotion gate: all {n_promoted} evaluated model(s) promoted, 0 held back "
            f"({n_wins} improved on the baseline).",
        )

    rows = "\n".join(
        f"| {r.get('league')} | {r.get('decision')} | "
        f"{'; '.join(r.get('regression_reasons') or []) or '—'} | {r.get('rollback', '—')} |"
        for r in drift.get("leagues", [])
    )
    _gh_step_summary(
        f"### Continuous training — `{status}`\n\n"
        f"**{n_promoted} promoted · {n_held} held back · {n_comparable} comparable**\n\n"
        "| league | decision | threshold breach | rollback |\n"
        "|---|---|---|---|\n"
        f"{rows}\n"
    )

    print(
        f"CONTINUOUS_TRAINING_SUMMARY: status={status} wins={n_wins} regressions={n_reg} "
        f"held_back={n_held} promoted={n_promoted} comparable={n_comparable} systemic={int(systemic)}"
    )
    return rc


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
                        help="Deprecated: rejected because unvalidated training cannot be promoted.")
    parser.add_argument("--eval-only", action="store_true",
                        help="Only run the walk-forward eval and drift comparison; skip retrain.")
    parser.add_argument("--no-rollback", dest="rollback", action="store_false",
                        help="Deprecated: training without rollback is rejected.")
    parser.set_defaults(rollback=True)
    parser.add_argument("--verbose", action="store_true")
    return parser.parse_args(argv)


async def main() -> int:
    args = parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    try:
        return await run_pipeline(args)
    except Exception as exc:
        # Fail closed. If we died anywhere between the retrain and the gate,
        # freshly written (and unevaluated) artifacts are already live. Put the
        # snapshots back rather than leaving an unjudged model in production.
        logger.exception("Continuous training aborted: %s", exc)
        recovered = recover_snapshot_candidates()
        if recovered:
            logger.warning("Recovery attempted for %d unevaluated model(s): %s",
                           len(recovered), ", ".join(sorted(recovered)))
        _gh_annotate("error", f"Continuous training aborted: {exc}")
        print(f"CONTINUOUS_TRAINING_SUMMARY: status=error stage=pipeline msg={exc}")
        return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
