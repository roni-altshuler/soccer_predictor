# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this app is

**Pitchverse** is a soccer match-prediction dashboard: Next.js 15 frontend, Python/FastAPI backend, ML prediction engine. Deployed on Vercel.

It does **three things**, and nothing else (see [docs/PIVOT_2026-08.md](docs/PIVOT_2026-08.md)):

1. **Match outcome prediction** — 1X2 and scoreline, calibrated, scored against closing odds.
2. **Season projections** — title, relegation and final table, updated as the season runs.
3. **A value surface** — model probability vs no-vig implied probability, with EV and Kelly staking.

If a proposed feature is none of those three, it does not belong here. The project pivoted on 2026-08-08 away from a sprawling "world model of football" (VISION_2030) that had grown to 26 pages and 131k lines while the prediction engine regressed for nine straight weeks.

**This is a betting-adjacent product.** The former "educational only, no betting recommendations" constraint is retired. That raises the evidentiary bar rather than lowering it — see Standing rules below.

## Standing rules — read before changing anything

- **The market is the benchmark.** Any accuracy claim is stated as paired Brier/log-loss against closing odds on named fixtures, or it is not stated. Measured target on our own corpus: **market Brier .5666** over 25,746 fixtures (ECE .0049).
- **Calibration gates the product.** A league with no evidence ships no value flags. Displayed confidence never exceeds measured confidence.
- **Baselines are never deleted.** Constant base rate, Elo and Dixon-Coles stay live as yardsticks. A model that cannot beat them does not serve.
- **A regression blocks promotion.** No recording a regression and shipping anyway.
- **No fabricated data.** Sparse coverage stays genuinely missing; never impute a plausible value.
- **Features must earn their place** via temporal-split ablation against the market row. Adding all 53 candidate features *degraded* Brier by .0052.

## Current measured state (2026-08-08)

| forecaster | Brier | notes |
|---|---|---|
| Market (closing line, Shin de-vig) | **.5666** | the target; ECE .0049 |
| Dixon-Coles (`penaltyblog`, off-the-shelf) | .5977 | +.0207 to market; **the serving floor** |
| 30-feature logreg baseline | .5876 | closes 84% of the constant→market gap |
| Constant base rate | .6468 | |
| In-house neural ensemble | .6396 | +.0599 to market — captures ~17% of signal |

**Dixon-Coles is the serving default for Wave A.** The neural stack does not serve in a league until it beats DC out-of-sample there. It currently beats DC in zero leagues.

A goal-model bake-off (`backend/scripts/bakeoff_goal_models.py`) found all six penaltyblog goal models within .0017 Brier of each other and **every blend worse than Dixon-Coles alone** — their errors are too correlated for ensembling to help. Do not add a hybrid without new evidence.

## League scope — Wave A only

Premier League (`eng.1`), La Liga (`esp.1`), Bundesliga (`ger.1`), Serie A (`ita.1`), Ligue 1 (`fra.1`).

MLS is Wave B; UCL/UEL/Euros/World Cup/Copa América are Wave C. Each wave advances only on measured evidence. Women's competitions were dropped in the pivot — a real cost, to be revisited on the same evidence gate.

## Known landmines

- **Train/serve skew (fixed 2026-08-08, understand it anyway).** Market features were in `FEATURE_NAMES` and populated for 96.1% of training rows, while `unified_inference.py` synthesised the live row with `NULL AS odds_home`. Every served prediction saw 0.0. Brier .5801 → .6561, *below* the constant base rate. This was the entire 60.56%-holdout / 46%-live gap. The schema guard could not catch it because feature **names** matched — only **values** differed. `_warn_on_dead_feature_blocks()` in `unified_inference.py` is the guard that does catch it. **Never put a feature in the served vector that the serving path cannot populate.**
- **Data integrity — fixed 2026-08-08, guard it.** The warehouse had 1,278 duplicate-fixture groups, 27 orphan team rows, and 60 of 77 league-seasons with the wrong team count. **One bug caused nearly all of it:** football-data's terse club names ("Ath Madrid", "Sp Lisbon") scored below `team_resolver`'s 0.92 fuzzy threshold, creating a second `teams` row, so `_find_existing_match` missed the ESPN fixture and inserted a duplicate. Dortmund "won" the 2018-19 Bundesliga because a 7-0 was counted twice. A second one-line bug — a naive local-midnight datetime run through `.astimezone(utc)` on an `Asia/Jerusalem` host — shifted every football-data kickoff back across midnight, making day-of-week wrong for 86% of Wave A.

  **Run `.venv/bin/python -m backend.scripts.validate_warehouse_integrity` after any ingest change.** 9 checks, exits non-zero. Prefer adding a spelling to `team_aliases.yml` over lowering the fuzzy threshold.
- **What is still genuinely missing.** Referees outside England are a *source* limitation — football-data publishes `Referee` for England only, and ESPN carries officials only from 2022-23 — so esp/ger/ita/fra sit at 0.8–1.8% and referee features stay untestable there. Kickoff times before 2019 do not exist upstream. `feature_builder_v2` still hardcodes weather defaults and `away_travel_km = 0.0` even though both are now computable; wiring them and re-running the ablation is the next modelling task.
- **The prediction pipeline bot** commits to `main` 3×/day. Rebase feature branches often.
- **Vercel escalates ESLint warnings to errors.** Run `npx next lint` before pushing; `npm run build` is not enough.

## Common commands

| Task | Command |
|---|---|
| Run both servers | `npm run dev` |
| Production build | `npm run build` |
| Lint (Vercel hard gate) | `npx next lint` |
| Frontend tests | `npm test` |
| Backend tests | `.venv/bin/python -m pytest backend/tests/` |
| Market benchmark | `.venv/bin/python -m backend.scripts.benchmark_market` |
| Dixon-Coles challenger | `.venv/bin/python -m backend.scripts.benchmark_dc_challenger` |
| Goal-model bake-off | `.venv/bin/python -m backend.scripts.bakeoff_goal_models` |
| Feature ablation | `.venv/bin/python -m backend.scripts.ablate_features` |
| Season projection backtest | `.venv/bin/python -m backend.scripts.backtest_season_projections` |
| Warehouse rebuild (with odds) | `.venv/bin/python -m backend.scripts.build_warehouse --espn --football-data` |

**Use `.venv/bin/python`** — the system Python lacks the dependencies.

## Architecture

### Backend (`backend/`)
- **FastAPI** at `backend/main.py`, routes under `backend/api/v1/`.
- **`services/prediction/`** — `unified_inference.py` (PyTorch artifacts), `dixon_coles.py`, `model.py` (legacy ELO-Poisson fallback), `market.py` (de-vigging, EV, Kelly, RPS/Brier — cross-validated against penaltyblog), `feature_builder_v2.py` (81 served features + a separate 6-feature market block), `features_v2.py` (candidate features with structurally-enforced point-in-time correctness), `tracker.py`.
- **`services/data/`** — SQLite warehouse at `backend/data/warehouse.sqlite` (**gitignored**) plus ingestion loaders and `team_resolver.py`.
- **`services/simulation/league_simulator.py`** — Monte Carlo season projections. Beats its naive baseline at every matchday; title Brier ≤.02 from matchday 10, relegation ≤.05 from matchday 26. **Overconfident in the 70–90% band** (says 80%, happens 69.8%) — do not print those raw.

### Frontend (`src/`)
Next.js 15 App Router, **10 pages** (was 26), **45 API routes** (was 67).

Design language is **Bugatti**, ported from the sibling RaceIQ project (`../f1_predictions`): pure black `#000`, surfaces `#0d0d0d`/`#141414`, hairlines `#262626`, white uppercase letterspaced display, monospace for nav/buttons/captions/tables. **No gradients, no shadows, no glassmorphism, no chrome.** Colour carries meaning only — never decoration.

**Dark-only.** `<html class="dark">` is hardcoded and there is no theme provider; `:root` in `globals.css` is the single source of truth and the `.dark` block is intentionally empty.

### Conventions
- **CSS variables, never Tailwind colours** — `text-[var(--text-primary)]`, `bg-[var(--card-bg)]`, `border-[var(--border-color)]`. Hardcoded `text-white`/`bg-black`/`text-gray-400` bypass the token layer.
- **No bot attribution in commits** — no "Co-Authored-By: Claude" or "Generated with Claude Code" trailers in this repo.
- **Feature branches** for long-lived work; small fixes straight to `main`.
- Backend tests use absolute imports (`from backend.services...`); root `conftest.py` makes that work.
- `localStorage` keys still use the `fotpredict.*` prefix, preserving preferences across two rebrands.

## Deleted in the pivot — do not resurrect without a decision

Counterfactual Machine · Rarity Engine · Story Compiler · Boardroom agents · Almanac / Ask Pitchverse · match2vec · 3D Match Theater · Universe Browser · Justice Ledger · bracket challenge · news feed · players pages · world-cup hub · design-system page · the entire `services/llm/` layer (which also removes the Gemini free-tier quota failures from the critical path).
