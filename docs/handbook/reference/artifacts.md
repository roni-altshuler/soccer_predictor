# Reference — artifacts

The site is served from committed JSON. Every number on a page comes from one
of these files, and every file is regenerable from the commands in
[Commands](cli.md).

**Why files and not a database.** The warehouse is gitignored and FastAPI is
not deployed on Vercel, so a page that needed a live database would be a page
that could not render on a fresh checkout. Artifacts also make a claim
auditable: the file carries its own `generated_at`, method block and sample
sizes, and a reviewer can diff two runs.

**Artifacts are published with temp-file + `os.replace`**, so a crash mid-write
leaves the previous valid file serving rather than a truncated one.

---

## Forecast artifacts — `backend/data/predictions/`

| file | written by | served at |
|---|---|---|
| `season_projections.json` | `forecast_season` | `/api/v1/season/projections`, `/leagues` |
| `season_fixtures.json` | `forecast_season` | `/api/v1/season/fixtures` |
| `tournaments.json` | `predict_tournaments` | `/api/v1/tournaments/predictions`, `/tournaments` |
| `predictions_<YYYY-MM>.json` | `predict_upcoming` | the pick record |
| `model_adjustments.json` | `train_feedback` | serving adjustments |

### `season_projections.json`

Top level: `generated_at`, `method`, `leagues[]`. Each league carries its
identity, its structural facts (`teams`, `relegation_places`, `top_cut`,
`groups`), its own `measured` walk-forward block, and a `table[]` of per-club
probabilities. Field detail in [the API reference](api.md#get-apiv1seasonprojections).

**`measured` is per league on purpose.** Inheriting a pooled headline would
promote four leagues into a claim measured only on the top five.

### `tournaments.json`

One entry per **edition**, not per competition — the last several seasons of
each of the fourteen knockout competitions, each with its status, bracket and
odds. Shape and invariants in
[the API reference](api.md#get-apiv1tournamentspredictions).

`predict_tournaments` needs a warehouse holding all fourteen competitions plus
resolved `knockout_results`. A partial warehouse cannot regenerate it correctly
— it will silently publish fewer competitions — so on a machine without the
full corpus, treat this file as read-only.

---

## Evidence artifacts — `backend/data/diagnostics/`

| file | written by | what it measures |
|---|---|---|
| `market_benchmark.json` | `benchmark_market` | model vs closing line, identical fixtures |
| `baseline_ladder.json` | `baseline_walkforward` | uniform, base rate, always-home |
| `unified_vs_dc.json` | `benchmark_unified_vs_dc` | the promotion gate |
| `goal_model_bakeoff.json` | `bakeoff_goal_models` | six goal models and blends |
| `feature_ablation.json` | `ablate_features` | what each feature group is worth |
| `edge_buckets.json` | `benchmark_edge_buckets` | does disagreeing with the price pay? |
| `knockout_model.json` | `benchmark_knockout` | tie model: ladder, calibration, per round |
| `bracket_backtest.json` | `backtest_brackets` | whole brackets simulated to a champion |
| `season_projection_backtest.json` | `backtest_season_projections` | projections matchday by matchday |
| `league_track_record.json` | `build_league_track_record` | per-league published record |
| `walkforward_*.json` | `baseline_walkforward` | per-competition walk-forward |
| `projection_calibrator.json` | `fit_projection_calibrator` | the 70–90% overconfidence correction |

### `knockout_model.json`

```jsonc
{
  "generated_at": "2026-08-11T09:14:23Z",
  "method": { "unit": "knockout tie (two outcomes), not match (three)",
              "split": "train on every previous season, test on the season played",
              "competitions": ["uefa.champions", "..."],
              "progression_check": { "checked": 2442, "confirmed": 2433, "rate": 0.996 } },
  "n_ties_total": 3132,
  "n_ties_scored": 2141,
  "test_seasons": [2013, "..."],
  "ladder": [ { "key": "coin_flip", "label": "Coin flip", "accuracy": 0.5, "brier": 0.25 } ],
  "models": { "logistic": {}, "random_forest": {}, "hist_gbm": {}, "xgboost": {} },
  "best_model": "random_forest",
  "calibration": [ { "stated_low": 50, "stated_high": 60, "n": 817,
                     "mean_stated": 0.551, "observed": 0.5569 } ],
  "by_round": { "quarterfinals": { "correct": 0, "n": 0, "accuracy": 0.0 } },
  "by_competition": { "uefa.champions": { "correct": 0, "n": 0, "accuracy": 0.0, "brier": 0.0 } },
  "permutation_importance": [ { "feature": "elo_diff", "importance": 0.02073, "std": 0.00398 } ]
}
```

`by_competition` is optional — it is written by current versions of
`benchmark_knockout` and absent from artifacts generated before 2026-08-13. The
UI renders it when present and shows the pooled record when it is not.

### `bracket_backtest.json`

`summary` plus one `events[]` entry per reconstructed tournament:

```jsonc
{ "competition": "uefa.champions", "season": 2021, "field": 16,
  "champion": 382, "model_p": 0.147, "elo_p": 0.126, "uniform_p": 0.125,
  "model_favourite": 86, "model_favourite_p": 0.310,
  "model_top1_hit": 0, "elo_leader_hit": 0, "model_top3_hit": 1 }
```

`model_p` is the probability the simulation put on the team that actually lifted
it — which is what makes a per-competition log loss computable from this file
alone.

---

## Evaluation artifacts — `backend/data/evaluation/`

### `live.json`

Written by `evaluate_live`. Carries `historical` and `live` as separate blocks,
each with its own `basis`, plus the `join` report and the `snapshot_store`
census. See [Evaluation](../concepts/evaluation.md).

---

## Baseline records — `reports/baselines/`

| file | what it pins |
|---|---|
| `league_gate.json` | the per-league gate evidence that admits a league to the site |
| `corpus.json` | per-league corpus sizes, checked before every publish |

**A corpus baseline may only be re-recorded with the arithmetic in hand.**
`verify_corpus` cannot tell a de-duplication from a truncation, so a drop is
explained *before* it is recorded, never after.

---

## Reading an artifact from outside the repo

Raw files are fetchable from GitHub:

```bash
curl -s https://raw.githubusercontent.com/roni-altshuler/soccer_predictor/main/backend/data/predictions/tournaments.json | jq '.tournaments | length'
```

```python
import json, urllib.request
BASE = "https://raw.githubusercontent.com/roni-altshuler/soccer_predictor/main/"
d = json.load(urllib.request.urlopen(BASE + "backend/data/diagnostics/bracket_backtest.json"))
print(d["summary"]["log_loss"])
```

Anything reading these files should key on `generated_at` and on the `method`
block rather than assuming a field exists — artifacts gain fields, and every
consumer in this repo is written to render nothing rather than guess.
