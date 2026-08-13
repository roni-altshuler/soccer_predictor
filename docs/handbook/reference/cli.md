# Reference — commands

Every artifact on the site is produced by one of these. They are Python modules
under `backend/scripts/`, run with `python3 -m backend.scripts.<name>`.

> **Check which interpreter has the dependencies before running anything.**
> The scripts need penaltyblog, torch, scikit-learn and fastapi. A bare
> interpreter will fail on the first import, and CI installs into a plain 3.12
> and calls `python -m ...` — a script that only works under one machine's
> named environment is a script CI cannot run.

---

## Running the site

| task | command |
|---|---|
| Both servers | `npm run dev` |
| Production build | `npm run build` |
| Lint (hard gate — Vercel escalates warnings to errors) | `npx next lint` |
| Frontend tests | `npm test` |
| Backend tests | `python3 -m pytest backend/tests/` |
| Responsive / tap-target audit | `node scripts/responsive_audit.mjs` |

The responsive audit drives real Playwright device descriptors at 320 / 375 /
390 / 768 / 1440 and **fails** on horizontal overflow, on a picker that does not
fit above the mobile tab bar, and on tap targets under 24px:

```bash
npx next start -p 3111
QA_BASE=http://127.0.0.1:3111 node scripts/responsive_audit.mjs
```

---

## Data

| task | command |
|---|---|
| Build the warehouse with odds | `python3 -m backend.scripts.build_warehouse --espn --football-data` |
| Rebuild the canonical layer | `python3 -m backend.scripts.build_canonical` |
| Integrity check (9 checks, exits non-zero) | `python3 -m backend.scripts.validate_warehouse_integrity` |
| Repair identities and duplicates | `python3 -m backend.scripts.repair_warehouse --fixpoint` |
| Verify per-league corpus sizes | `python3 -m backend.scripts.verify_corpus` |
| Ingest knockout competitions | `python3 -m backend.scripts.ingest_tournaments --all` |
| Ingest drawn-but-unplayed fixtures | `python3 -m backend.scripts.ingest_scheduled_fixtures --all` |
| Resolve knockout winners | `python3 -m backend.scripts.backfill_knockout_results` |

**Run `validate_warehouse_integrity` after any ingest change**, and run
`repair_warehouse` **to a fixpoint** — each merge exposes duplicates that expose
more identities.

---

## Forecasting

| task | command |
|---|---|
| Season projections | `python3 -m backend.scripts.forecast_season` |
| Forward tournament odds | `python3 -m backend.scripts.predict_tournaments` |
| Upcoming match picks | `python3 -m backend.scripts.predict_upcoming` |
| Score published forecasts | `python3 -m backend.scripts.evaluate_live` |
| Export the provenance record | `python3 -m backend.scripts.export_snapshots` |
| Restore the provenance record | `python3 -m backend.scripts.import_snapshots --allow-missing` |

`forecast_season` **refuses to publish when a league the live artifact serves
would disappear**, leaving the previous forecast up rather than shipping the
survivors. `--allow-missing-leagues` is for a competition that genuinely ended,
never for getting past a bad ingest.

---

## Measurement

These write the artifacts behind `/evaluation` and `/accuracy`. None of them is
scheduled — they are run deliberately, and their output is committed.

| task | command |
|---|---|
| Model vs the closing line | `python3 -m backend.scripts.benchmark_market` |
| Walk-forward baselines | `python3 -m backend.scripts.baseline_walkforward` |
| Per-league admission gate | `python3 -m backend.scripts.league_gate` |
| Dixon-Coles floor | `python3 -m backend.scripts.benchmark_dc_challenger` |
| Promotion gate: neural vs Dixon-Coles | `python3 -m backend.scripts.benchmark_unified_vs_dc` |
| Goal-model bake-off | `python3 -m backend.scripts.bakeoff_goal_models` |
| Feature ablation | `python3 -m backend.scripts.ablate_features` |
| Lineup ablation | `python3 -m backend.scripts.benchmark_lineup_features` |
| Does disagreeing with the price pay? | `python3 -m backend.scripts.benchmark_edge_buckets` |
| Season-projection backtest | `python3 -m backend.scripts.backtest_season_projections` |
| Knockout tie model | `python3 -m backend.scripts.benchmark_knockout` |
| Bracket Monte Carlo | `python3 -m backend.scripts.backtest_brackets --sims 20000` |

### Promotion rules

- **Promote on significance, never on the sign of a difference.**
  `benchmark_unified_vs_dc` reports `unified_beats_dc_significant_in`; that is
  the field that decides.
- **Whenever a challenger beats the closing line, suspect the harness first.** A
  model with no market features cannot out-predict the market by .027 Brier —
  that number was a bug announcing itself.
- **A regression blocks promotion.** Recording it and shipping anyway is not an
  option that exists here.

---

## Scheduled jobs

| workflow | cadence | what it does |
|---|---|---|
| `season_forecast.yml` | daily 07:30 UTC | pulls results, rebuilds canonical, retrains, re-simulates, publishes |
| `prediction_pipeline.yml` | 3×/day | match picks and odds snapshots; commits to `main` |
| `event_backfill.yml` | daily | ingests, folds split identities, dedupes, then backfills timelines |
| `train_unified.yml` | weekly | full warehouse rebuild and retrain |

The measurement commands above are **not** in any workflow. The evidence
artifacts change when someone re-derives them, which is the intended behaviour:
a benchmark that silently reruns is a benchmark nobody reads.

`event_backfill.yml` folds identities **before** deduping — a duplicate is only
visible once both rows point at the same club — and both run before the artifact
builders, so nothing is derived from a corpus that counts matches twice.
