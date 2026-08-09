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

## Current measured state (2026-08-09)

Two separate corpora, so read the columns not the rows. The first is the full
market benchmark; the second is the 2,264-fixture paired holdout from
`benchmark_unified_vs_dc` (2024-10 onward, Wave A, priced fixtures only).

| forecaster | Brier (full corpus) | Brier (paired holdout) |
|---|---|---|
| Market (closing line, Shin de-vig) | **.5666** | **.5848** |
| Neural stack, 75 features | — | .6014 |
| Dixon-Coles (`penaltyblog`, off-the-shelf) | .5977 | .6044 |
| 30-feature logreg baseline | .5871 | — |
| Constant base rate | .6468 | .6498 |

**Dixon-Coles remains the serving default for Wave A.** The retrained neural
stack is ahead of it on the point estimate (−.0030 pooled, and ahead in eng.1,
ger.1, ita.1) — and **that lead does not survive a paired bootstrap**. Pooled
95% CI [−.0112, +.0051], p(NN better) = .78; every individual league's interval
straddles zero, including the Premier League's −.0212. Three point-estimate
wins, zero significant ones. Re-run
`benchmark_unified_vs_dc` after any retrain; promote only on
`unified_beats_dc_significant_in`, never on the sign of the difference.

A goal-model bake-off (`backend/scripts/bakeoff_goal_models.py`) found all six penaltyblog goal models within .0017 Brier of each other and **every blend worse than Dixon-Coles alone** — their errors are too correlated for ensembling to help. Do not add a hybrid without new evidence.

### What the features are worth (ablation, 2026-08-09, 75-feature vector)

Rolling-origin folds, greedy selection on early folds and scored on later ones
it never saw. Δ is against the 30-feature logreg baseline; negative helps.

| group | Δ Brier | |
|---|---|---|
| market | **−.0102** | helps, but **cannot serve** — see the train/serve landmine |
| xg_form | **−.0011** | helps |
| news_sentiment_proxy | +.0001 | neutral |
| congestion | +.0004 | neutral |
| weather | +.0006 | harmful |
| clubelo | +.0007 | harmful |
| calendar | +.0007 | harmful |
| venue | +.0012 | harmful |
| referee | +.0015 | harmful |
| h2h_deep | +.0023 | harmful |

Greedy forward selection picked **one** group: market. Head-to-head, venue
records, referee effects, weather and kickoff timing all make the model worse
out of sample. This is the measured answer to "what else can give it an edge":
nothing in the current candidate set, and the remaining ceiling is in the data
rather than the feature list.

## League scope — Wave A only

Premier League (`eng.1`), La Liga (`esp.1`), Bundesliga (`ger.1`), Serie A (`ita.1`), Ligue 1 (`fra.1`).

MLS is Wave B; UCL/UEL/Euros/World Cup/Copa América are Wave C. Each wave advances only on measured evidence. Women's competitions were dropped in the pivot — a real cost, to be revisited on the same evidence gate.

## Known landmines

- **Train/serve skew (fixed 2026-08-08, understand it anyway).** Market features were in `FEATURE_NAMES` and populated for 96.1% of training rows, while `unified_inference.py` synthesised the live row with `NULL AS odds_home`. Every served prediction saw 0.0. Brier .5801 → .6561, *below* the constant base rate. This was the entire 60.56%-holdout / 46%-live gap. The schema guard could not catch it because feature **names** matched — only **values** differed. `_warn_on_dead_feature_blocks()` in `unified_inference.py` is the guard that does catch it. **Never put a feature in the served vector that the serving path cannot populate.**
- **Data integrity — fixed 2026-08-08, guard it.** The warehouse had 1,278 duplicate-fixture groups, 27 orphan team rows, and 60 of 77 league-seasons with the wrong team count. **One bug caused nearly all of it:** football-data's terse club names ("Ath Madrid", "Sp Lisbon") scored below `team_resolver`'s 0.92 fuzzy threshold, creating a second `teams` row, so `_find_existing_match` missed the ESPN fixture and inserted a duplicate. Dortmund "won" the 2018-19 Bundesliga because a 7-0 was counted twice. A second one-line bug — a naive local-midnight datetime run through `.astimezone(utc)` on an `Asia/Jerusalem` host — shifted every football-data kickoff back across midnight, making day-of-week wrong for 86% of Wave A.

  **Run `.venv/bin/python -m backend.scripts.validate_warehouse_integrity` after any ingest change.** 9 checks, exits non-zero. Prefer adding a spelling to `team_aliases.yml` over lowering the fuzzy threshold.
- **What is still genuinely missing.** Referees outside England are a *source* limitation — football-data publishes `Referee` for England only, and ESPN carries officials only from 2022-23 — so esp/ger/ita/fra sit at 0.8–1.8% and referee features stay untestable there. Kickoff times before 2019 do not exist upstream. Weather covers 66.6% of Wave A. There is no injury or lineup source at all: `player_form` and `match_events` are empty tables.
- **A constant feature is not free.** A zero-variance audit over 600 Wave A fixtures on 2026-08-09 found 9 of 81 served features constant. Six were constant because nothing fed them — `is_post_intl_break` (never derived), `home_squad_form` / `away_squad_form` / `home_missing_top3` / `away_missing_top3` (empty `player_form` table), `venue_altitude_m` (no source) — and were removed, 81 → 75. Three (`is_knockout`, `is_2leg_aggregate`, `is_neutral_venue`) are constant *by construction* in league play and go live in Wave C, so they stay. `away_travel_km` was in the first category until it was wired to the venue coordinates that now exist; it is real (median 311 km, max 2,260 km, 100% of Wave A). **Re-run the zero-variance check before adding a feature, and treat a permanently-constant column as a bug.**
- **ESPN host — use `site.web.api.espn.com`, never `site.api.espn.com`.** The two serve
  byte-identical payloads. Akamai answers `site.api` with **403 Access Denied** from
  datacentre IPs (Vercel, GitHub Actions) and its error page carries no CORS headers, so a
  browser fetch dies with `net::ERR_FAILED`. Measured 2026-08-09: every `site.api` request
  returned 403 while the same path on `site.web.api` returned 200 with
  `access-control-allow-origin: *`. This is what made the season simulation "unavailable"
  and blanked live standings/fixtures on all five league pages. The host is named once, in
  [`src/lib/espnHost.ts`](src/lib/espnHost.ts) (`ESPN_SITE` / `ESPN_V2`) and once in
  `backend/services/espn/client.py`. Do not hardcode it anywhere else.
- **ESPN's scoreboard silently caps at 100 events.** No error, no field saying so. Asking
  for a whole remaining season without `&limit=` returned the next 100 fixtures, and the
  Monte Carlo projected a "final table" from a quarter of a season. Any scoreboard call
  spanning more than a few weeks must pass an explicit `limit`.
- **An unmatched simulator prior is a silent, visible bug.** `build_sim_priors` resolves
  Dixon-Coles team names onto ESPN `displayName`s. A team it cannot match gets no prior and
  falls back to neutral — and at preseason the prior is the *only* signal, so the league's
  best clubs vanish from the title race. With `Inter` and `Roma` unresolved the Serie A
  projection made **Como** the favourite. The script now prints suggested
  `MANUAL_OVERRIDES` entries; check `unmatched_frontend_teams` after every rebuild and
  treat anything that is not a genuine promotion as a bug.
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
| Neural vs DC (promotion gate) | `.venv/bin/python -m backend.scripts.benchmark_unified_vs_dc` |
| Goal-model bake-off | `.venv/bin/python -m backend.scripts.bakeoff_goal_models` |
| Feature ablation | `.venv/bin/python -m backend.scripts.ablate_features` |
| Season projection backtest | `.venv/bin/python -m backend.scripts.backtest_season_projections` |
| Warehouse rebuild (with odds) | `.venv/bin/python -m backend.scripts.build_warehouse --espn --football-data` |

**Use `.venv/bin/python`** — the system Python lacks the dependencies.

## Architecture

### Backend (`backend/`)
- **FastAPI** at `backend/main.py`, routes under `backend/api/v1/`.
- **`services/prediction/`** — `unified_inference.py` (PyTorch artifacts), `dixon_coles.py`, `model.py` (legacy ELO-Poisson fallback), `market.py` (de-vigging, EV, Kelly, RPS/Brier — cross-validated against penaltyblog), `feature_builder_v2.py` (75 served features + a separate 6-feature market block), `features_v2.py` (candidate features with structurally-enforced point-in-time correctness), `tracker.py`.
- **`services/data/`** — SQLite warehouse at `backend/data/warehouse.sqlite` (**gitignored**) plus ingestion loaders and `team_resolver.py`.
- **`services/simulation/league_simulator.py`** — Monte Carlo season projections. Beats its naive baseline at every matchday; title Brier ≤.02 from matchday 10, relegation ≤.05 from matchday 26. **Overconfident in the 70–90% band** (says 80%, happens 69.8%) — do not print those raw.

### Frontend (`src/`)
Next.js 15 App Router, **10 pages** (was 26), **32 API routes** (was 67).

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

The first sweep deleted the backends and left the callers. On 2026-08-09 a second pass
removed the frontends that were still fetching those dead endpoints and silently rendering
nothing: `JusticeLedger`, `RarityStamp`, `SimilarMatches`, `BoardroomPanel`,
`CounterfactualMachine`, `LiveMatchTracker`, `UniverseBrowser`, the league News tab, and 17
orphaned API routes. **When deleting a feature, grep for its fetch URL, not just its
module** — a component whose endpoint 404s looks identical to one with no data.
