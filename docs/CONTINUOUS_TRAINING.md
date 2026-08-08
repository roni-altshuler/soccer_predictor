# Continuous Training

A long-running self-improvement loop: as new historical match data arrives, the
model automatically retrains, evaluates on real walk-forward data, compares to
the prior baseline, and either promotes the new model or holds it back.

## What the orchestrator does

Entry point: `python -m backend.scripts.continuous_training`

1. **Freshness check.** Inspects `backend/data/historical/*.json` mtimes. Skips
   the retrain step if no file has changed since the last successful run
   (recorded in `backend/data/diagnostics/last_training_run.json`). Override
   with `--force`.
2. **Retrain.** Calls `train_all_models(...)` from
   `backend.scripts.train_models` in-process (async).
3. **Walk-forward evaluation.** Runs `backtest_league(..., fast=True)` for each
   league. Per-league reports go to `backend/data/diagnostics/walkforward_<league>.json`
   (incremental writes), and a fresh `walkforward_summary.json` is aggregated.
4. **Baseline comparison.** Diffs the new summary against
   `walkforward_baseline.json` (the last known-good state).
5. **Promotion gate.** Reuses `backend.services.prediction.model_selection`
   to consult `model_selection.json`. Decision is recorded per league.
6. **Drift report.** Writes `training_drift_<YYYY-MM-DD>.json` with per-league
   before/after metrics, deltas, regression flags, and gate decisions.
7. **Rolling history.** Appends one JSONL line to `training_history.jsonl`
   (date, retrained leagues, win/regression counts, global means).
8. **Baseline rotation.** Replaces `walkforward_baseline.json` only when no
   league regressed.

## Regression criteria (per league)

A league is flagged as a **regression** if any of:

- `accuracy_delta < -0.015`
- `log_loss_delta > 0.03`
- `brier_delta   > 0.02`

A league is flagged as a **win** when at least 2 of (accuracy improved,
log-loss decreased, brier decreased) hold.

## Promotion gates

Promotion verdicts are **enforced**, not advisory. The verdict is decided purely
by the regression thresholds:

| Verdict     | Condition                                                      |
|-------------|----------------------------------------------------------------|
| `promoted`  | win, or neutral (no regression beyond thresholds)                |
| `held_back` | regression beyond any threshold — production artifact restored   |
| `skipped`   | walk-forward errored (e.g. insufficient seasons)                 |

`n_regressions == n_held_back` holds by construction.

**A regression blocks promotion.** Production artifacts are snapshotted before
retraining and restored for any league that regresses, fail-closed: an abort
between retrain and gate rolls everything back rather than leaving an
unevaluated model in place. Each held-back league carries
`regression_reasons` naming the threshold it broke.

**`serving_policy` is context, never a verdict.** The drift report carries the
`model_selection.json` decision (`league` / `global` / `blend` / `dixon_coles`)
for context only. It answers "which artifact should the runtime serve?" and
says nothing about whether a retrained candidate got worse. It must never be
read as a promotion gate.

> **History.** It was, from 2026-06-07 to 2026-08-02. The gate tested
> `serving_policy.decision in {"league","global","blend"}`, which every healthy
> league satisfied, so regressions were relabelled `promoted_with_caution` and
> counted as promoted — nine consecutive weeks reporting
> `"status": "regression"` with `n_held_back: 0`. It only started working when
> the Dixon-Coles floor introduced a fourth enum value that happened to fall
> outside the hardcoded set. The `promoted_with_caution` verdict was removed
> because that state *was* the loophole.

**Exit codes.** `ok` and `gate_enforced` exit 0 — a working guardrail is not a
build failure. Only `systemic_regression` (every comparable league regressed)
or an error/failed rollback exits 1.

## CLI flags

```
--force                 # skip the freshness check
--leagues <key...>      # restrict scope (runtime keys eng.1 or ESPN keys)
--global-model          # also retrain the cross-league global model
--min-season <year>     # default 2010
--force-fetch           # force re-fetch of historical data
--skip-eval             # only retrain, no walk-forward
--eval-only             # only walk-forward + drift, skip retrain
--verbose
```

Exit code: `0` if no regression, `1` if any league regressed.

The final log line is always a one-shot summary:

```
CONTINUOUS_TRAINING_SUMMARY: status=ok wins=4 regressions=1 held_back=0
```

## How to manually trigger

Local:

```bash
python -m backend.scripts.continuous_training --global-model
```

GitHub Actions (`.github/workflows/continuous_training.yml`):

- Cron: Sundays at 04:00 UTC.
- Manual: Actions → "Continuous Training" → Run workflow. Optional inputs:
  `leagues` (space-separated keys) and `force` (boolean).
- Concurrency group `continuous-training`, `cancel-in-progress: false`.
- Commits `backend/data/diagnostics/` and `backend/data/training_results.json`
  back to `main` using the same `github-actions[bot]` pattern as
  `prediction_pipeline.yml`. The job fails visibly on regression but the drift
  report is still committed.

## How to inspect the drift report

```bash
ls -lt backend/data/diagnostics/training_drift_*.json | head
jq '.overall' backend/data/diagnostics/training_drift_$(date -u +%Y-%m-%d).json
jq '.leagues[] | {league, decision, deltas, regression}' \
   backend/data/diagnostics/training_drift_$(date -u +%Y-%m-%d).json
```

Programmatic surfaces (FastAPI, in `backend/api/v1/tracking.py`):

- `GET /api/v1/tracking/training/history?limit=12` → last N JSONL records.
- `GET /api/v1/tracking/training/latest` → last-run record + latest drift report
  + history tail.

## File layout under `backend/data/diagnostics/`

| File                              | Purpose                                                |
|-----------------------------------|--------------------------------------------------------|
| `walkforward_<league>.json`       | Per-league season-by-season walk-forward results.      |
| `walkforward_summary.json`        | Aggregate from the most recent run.                    |
| `walkforward_baseline.json`       | Last known-good summary; updated only on a clean run.  |
| `training_drift_<YYYY-MM-DD>.json`| Timestamped drift report from one run.                 |
| `training_history.jsonl`          | Append-only rolling history (one line per run).        |
| `last_training_run.json`          | Cursor for the freshness check + last run status.      |
