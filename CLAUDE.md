# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Environment gotcha — read this first

The user runs two Python environments side-by-side:

- `/home/roaltshu/anaconda3/bin/python` (anaconda base, **Python 3.13**) — has `httpx`, `catboost`, all project deps. **This is the env to use.**
- `/home/roaltshu/anaconda3/envs/f1_predictions/bin/python` (Python 3.11) — **missing `httpx`** and other deps; will crash on import.

Non-interactive `bash` defaults to the f1_predictions env (because of PATH). Always invoke the absolute path explicitly:

```bash
/home/roaltshu/anaconda3/bin/python -m backend.scripts.train_models ...
```

The README's `npm run dev` script tries to call `./.venv/bin/uvicorn`, which doesn't exist by default. If running the dev server, either create `.venv` or edit the dev script to use the anaconda python.

## Commands

### Frontend / build
```bash
npm install                 # Node deps
npm run build               # next build — primary smoke test for TS errors
npm run dev                 # concurrently: FastAPI (uvicorn) + Next.js (next dev)
npm run lint                # next lint
npm test                    # jest (single test file at src/__tests__/components/Footer.test.tsx)
```

### Python / ML training (always use absolute python path — see gotcha above)
```bash
# Full retrain (all 14 leagues + cross-league global model)
/home/roaltshu/anaconda3/bin/python -m backend.scripts.train_models --global-model

# Subset
/home/roaltshu/anaconda3/bin/python -m backend.scripts.train_models --leagues eng.1 esp.1

# Re-train only the global challenger using saved per-league artifacts
/home/roaltshu/anaconda3/bin/python -m backend.scripts.train_models --global-only

# Generate / resolve predictions (3×/day cron also does these)
/home/roaltshu/anaconda3/bin/python -m backend.scripts.predict_upcoming --days 7
/home/roaltshu/anaconda3/bin/python -m backend.scripts.fetch_outcomes
/home/roaltshu/anaconda3/bin/python -m backend.scripts.train_feedback
```

### Walk-forward harness — three eval modes
The harness at `backend/services/prediction/backtest_walkforward.py` has **three mutually-exclusive modes**; pick the right one or numbers will mislead.

```bash
# 1) True walk-forward, full production ensemble per fold (slow, no leakage)
python -m backend.services.prediction.backtest_walkforward --all

# 2) Fast: single LightGBM per fold (~10–20× faster baseline)
python -m backend.services.prediction.backtest_walkforward --all --fast

# 3) Evaluate the saved production model — NO retrain, has lookahead leakage.
#    Trust only ECE / Brier / per-confidence-bucket coverage from this mode.
python -m backend.services.prediction.backtest_walkforward --all --load-production
```

Loose-threshold flags useful for sparse-data leagues (Primeira, Eredivisie, Euro, Copa):
`--warmup-seasons 2 --min-train-samples 200 --min-test-samples 20`.

Each report's `eval_mode` field tells you which mode produced it. Mode 3 also carries a `leakage_warning`.

### Continuous training orchestrator
```bash
# Force a full retrain + walk-forward + drift report (manual one-off)
python -m backend.scripts.continuous_training --force --global-model --verbose

# Eval-only (no retrain) — useful after a manual retrain
python -m backend.scripts.continuous_training --eval-only --force --verbose
```
Runs weekly via `.github/workflows/continuous_training.yml` and commits drift reports back to the branch. The orchestrator already uses the same loose harness thresholds (warmup=2, min_train=200, min_test=20) — don't change those without re-seeding the baseline.

## Architecture — the big picture

Three layers that move in concert. Reading any one in isolation will mislead.

**1. ML training pipeline → trained per-league + global artifacts.**
- `backend/services/prediction/training.py` — `FeatureBuilder` (72-feature vector incl. Phase-1.2 tournament-state features) + `ModelTrainer` (stacked ensemble: XGBoost + LightGBM + CatBoost + GB + RF + ET + AdaBoost + logistic meta-learner with recency-weighted refit + per-league bucketed calibration).
- `ModelTrainer._build_ensemble(class_weights, n_samples)` is **corpus-aware**: <1500 samples drops CatBoost and tightens regularization; <300 samples falls back to `VotingClassifier`. Three call sites (walk-forward audit, main train, cross_val_score) all pass `n_samples`.
- Per-league artifacts live in `backend/data/models/<espn_slug>/` (e.g. `eng.1/match_predictor.pkl` + `_scaler.pkl` + `_metadata.json` + `calibration_buckets.json`). The `backend/data/models/` directory is **gitignored**, but `model_selection.json` and `training_results.json` are explicitly tracked.
- League keys appear in two forms — **friendly** (`premier_league`) for backtest CLI and **ESPN slug** (`eng.1`) for model directories. `historical_data.ESPN_LEAGUES` is the canonical mapping. When loading a saved model from a friendly key, translate first.

**2. FastAPI inference + REST surface.**
- `backend/main.py` mounts routers from `backend/api/v1/*`. The hot path is `/api/predict/unified` (neural-first with ELO-Poisson fallback). Predictions are enriched with a `derived_markets` block (O/U 0.5–3.5, BTTS, Correct Score top-5) derived from `PoissonModel.score_matrix` + Dixon-Coles rho in `services/prediction/probabilistic.py`.
- WC Hub-specific routes: `backend/api/v1/world_cup_groups.py` (group simulator + what-if), `backend/api/v1/world_cup_bracket.py` (KO probability paths), `backend/api/v1/match_live.py` (event timeline + in-play Bayesian probability update), `backend/api/v1/search.py` (omni-search index), `backend/api/v1/teams.py` (team detail aggregator).
- All new routers must be registered in `backend/api/v1/__init__.py` — read it before editing; recent agents have added several routes there and a careless rewrite will drop them.

**3. Next.js App Router + proxies to FastAPI.**
- `src/app/api/**/route.ts` are thin proxies that forward to `${BACKEND_URL}/api/v1/...` (default `http://127.0.0.1:8000`). Mirror the pattern in `src/app/api/world-cup/groups/[groupId]/simulate/route.ts` when adding new ones.
- **Dynamic-segment naming conflict**: at any one URL level Next.js only allows ONE dynamic param name. `src/app/api/teams/[league]/` already exists, so the team-detail proxy reuses that slot (param is named `league` but the value is a team ID). Don't create a sibling `[teamId]` directory or the build fails.
- The dev/prod server runs **both** the FastAPI backend and Next.js via `concurrently` in `package.json`. Both must be alive for predictions to load.

## The Odds API — quota-protected route

`src/app/api/market-intelligence/live/route.ts` wraps The Odds API v4 with module-level cache + per-day/per-month quota counter. The free tier is **500 requests/month**; defaults are tuned to fit that budget:
- `ODDS_API_REGIONS=eu` (1 quota per call vs 3 for `us,uk,eu`)
- `ODDS_API_CACHE_TTL_MS=900000` (15 min fresh)
- `ODDS_API_STALE_OK_MS=21600000` (serve stale up to 6h when quota or provider blocks)
- `ODDS_API_DAILY_BUDGET=16`, `ODDS_API_MONTHLY_BUDGET=500`
- `?fresh=true` query param bypasses cache (counts toward quota)

The route degrades gracefully — 501 if no key, 429 with stale fallback when quota exhausted, 502 with stale fallback on network/provider errors. Response headers expose `x-quota-daily-used`, `x-provider-remaining`, `x-cache-source` for live debugging.

## Data sources

In priority order at every layer:
1. **ESPN site API** (`site.api.espn.com`) — live scores, standings, scoreboards, box scores, lineups, injuries. Client: `backend/services/espn/client.py`. Existing `ESPNClient` methods handle retry/pacing — reuse them, do not create parallel HTTP clients.
2. **FotMob** (`www.fotmob.com/api/*`) — fallback for lineups, top scorers, injuries. Client: `backend/services/fotmob/client.py`.
3. **football-data.co.uk** — historical betting odds embedded in `backend/services/prediction/historical_data.py`. Used at training time only (features 38–42 of the 72-vector). Not called live.
4. **The Odds API** — licensed live odds for the Betting Intelligence panel. Off by default; requires env var.

## Match-card / UI data rules (load-bearing — do not violate)

- Match rows display only **provider-backed** fields. Venue, referee, weather, H2H, and prediction modules are **hidden** when source data is unavailable. Never fabricate.
- Source provenance is labeled via `DataSourceBadge` — ESPN / FotMob / model.
- Live win-probability is rendered only when match is live AND score + clock + pre-match prob + live stats are all present.
- "Informational only, not betting advice" — keep the disclaimer in `BettingIntelligence.tsx` and the API responses (`guarantee: false, betting_advice: false`). All odds comparison is audit-only.

## Branch hygiene

The current working branch is `feat/phase1-retrain-v2-ui` (Phase-1 ML upgrades + v2 UI overhaul; sharing-ready before WC 2026 kickoff on June 11). Active plan and history live in `/home/roaltshu/.claude/plans/the-soccer-predictor-repo-fizzy-blum.md` and `docs/CONTINUOUS_TRAINING.md`.

When committing trained-artifact files (model_selection.json, training_results.json, historical/*.json) they're inside gitignored directories — use `git add -f` to stage them explicitly. The heavy `.pkl` files stay gitignored; the weekly continuous-training cron regenerates them in CI when needed.
