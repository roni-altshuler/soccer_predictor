# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this app is

Pitchverse (renamed from "Pitchwise" in July 2026; originally "FotPredict AI" until 2026-05-28) is a Next.js 15 + FastAPI app that combines FotMob-style live scores with a custom ML prediction engine. The frontend is deployed on Vercel; the backend is a Python service. Two ML models ship: `unified_men.pt` (60.56% test accuracy across 13 men's competitions, 11,661-match holdout) and `unified_women.pt` (51.45% across 5 women's competitions). Personal/educational project — no license, not for betting. Tagline: "Calibrated football intelligence." Note that localStorage keys still use the `fotpredict.*` prefix to preserve existing users' preferences across the rebrands.

## Common commands

| Task | Command |
|---|---|
| Run both servers (FE + BE) | `npm run dev` (concurrently boots `uvicorn backend.main:app` on :8000 + `next dev` on :3000) |
| Or via script | `./run_app.sh` |
| Production build | `npm run build` (Next.js) |
| Lint | `npm run lint` (`next lint`) — **also runs in Vercel CI as a hard gate** |
| Jest (FE) | `npm test` / `npm run test:watch` / `npm run test:coverage` |
| Pytest (BE) | `pytest backend/tests/` from repo root |
| Single pytest test | `pytest backend/tests/test_warehouse.py::test_migration_is_idempotent -v` |
| A11y audit | `npm run a11y` (axe against http://localhost:3000) |
| Validate historical data | `npm run data:quality` |
| Settle prediction backlog | `python -m backend.scripts.fetch_outcomes` |
| Generate predictions for next 7 days | `python -m backend.scripts.predict_upcoming --days 7` |
| Full warehouse rebuild | `python -m backend.scripts.build_warehouse --full` |
| Retrain unified model | `python -m backend.scripts.train_unified --gender M\|F` |

**Vercel/local divergence:** `next build` locally treats most ESLint findings as warnings; Vercel escalates `prefer-const`, `no-unused-vars`, etc. to **errors** that fail the deploy. Always run `npx next lint` before pushing to `main` — `npm run build` is not enough.

## Architecture

Two streams that share one repo:

### Backend (`backend/`)
- **FastAPI app** at `backend/main.py` exposes `/api/v1/*` routes from `backend/api/v1/{predictions,tracking,matches,leagues,teams,...}.py` plus a few legacy unscoped routes (`/api/todays_matches`, etc.).
- **Services** in `backend/services/`:
  - `prediction/` — `unified_inference.py` loads the PyTorch artefacts (`unified_men.pt`, `unified_women.pt`) and serves `MatchPrediction`. `model.py` is the legacy ELO-Poisson fallback. `tracker.py` writes `PredictionRecord` JSON to `backend/data/predictions/predictions_YYYY-MM.json` and computes accuracy metrics (gender-aware).
  - `data/` — the **SQLite match warehouse** at `backend/data/warehouse.sqlite` plus seven ingestion loaders (ESPN, football-data.co.uk, ClubElo, OpenFootball, FBref, Understat, Open-Meteo) and the cross-source `team_resolver.py`. Schema in `warehouse.py`.
  - `espn/`, `fotmob/` — third-party API clients (men's-leaning). Women's data goes through ESPN women's league IDs (`usa.nwsl`, `eng.w.1`, etc.) — see `WOMEN_COMPETITIONS` in `backend/services/data/espn_loader.py`.
- **Models** under `backend/models/` are Pydantic schemas (`MatchPrediction`, `OutcomeProbabilities`, `PredictionFactors`, …) shared between routes and the inference layer.
- **Scripts** in `backend/scripts/` are CLI entry points: ETL (`build_warehouse.py`), training (`train_unified.py`, `train_models.py`), pipeline ops (`fetch_outcomes.py`, `predict_upcoming.py`, `train_feedback.py`), audit (`model_audit.py`, `validate_data_quality.py`).

### Frontend (`src/`)
- Next.js 15 App Router. Every user-facing page is under `src/app/`: `page.tsx` (home Match Centre), `predict/`, `accuracy/`, `diagnostics/`, `matches/`, `matches/[id]/`, `leagues/[leagueId]/`, `news/`, `simulator/`, `tracking/` (redirects to `/accuracy`).
- **Node-runtime API routes** in `src/app/api/` proxy ESPN/FotMob and read the committed prediction JSON files for Vercel (the FastAPI backend isn't deployed there). Notably `/api/todays_matches`, `/api/v1/tracking/accuracy`, `/api/v1/tracking/recent`.
- **Components** in `src/components/`:
  - `ui/` — shadcn primitives (Card, Button, Tabs, Dialog, Tooltip, etc.).
  - `match/` — `MatchRow`, `LeagueSection`, `MatchCenterHeader`, `LeagueBadge`, `TeamFormPill`, `ConfidenceIndicator`, `SplitStatBar`.
  - `prediction/PredictionResult.tsx` — the showcase outcome+xG+scoreline+factors viz used on `/predict` and the match-detail "AI Prediction" tab.
  - `accuracy/` — public-facing /accuracy components (AccuracyHero, CalibrationPlot, ConfusionHeatmap, RecentPicksFeed, ModelExplainer).
  - `home/`, `league/`, `tournament/`, `worldcup/`, `tracking/` — page-specific.
- **Hooks** in `src/hooks/`: `useGenderQuery` (canonical wrapper around `useGenderPreference` — every fetch call should append `?gender=${asQueryParam}`).
- **`src/lib/leagueAccents.ts`** — `competition_id` → `{ displayName, country, gender, accent, accentBg }`. Single source of truth for league brand colours.

### Gender universes (cross-cutting)
Two parallel ML models. The `GenderToggle` component (`src/components/GenderToggle.tsx`) persists choice via `localStorage` (`fotpredict.gender`). Default is `'men'`. **When toggled to women's, the experience is strictly single-universe** — only women's leagues / matches / accuracy. Every data-fetching call site must thread `?gender=` via `useGenderQuery`; missing the param means the women's toggle is cosmetic for that surface.

The warehouse and backend tracker are fully gender-aware (`PredictionRecord.gender`, `Warehouse.iter_matches(gender=)`, `/api/v1/tracking/accuracy?gender=`); the legacy `/api/standings`, `/api/news`, `/api/tournament` Next.js routes accept the param but currently ignore it — they route to ESPN's women's league IDs implicitly via the league_id encoded in their URL.

## ML pipeline & data flow

Three GitHub Actions workflows:

1. **`prediction_pipeline.yml`** runs **3× daily** (06:00, 14:00, 22:00 UTC). Settles pending predictions (`fetch_outcomes`), generates next-7-day picks (`predict_upcoming`), runs online learning (`train_feedback`), then auto-commits `backend/data/predictions/*.json` and `backend/data/league_params.json` back to `main` as `chore: update predictions [automated]`. **Don't fight the bot** — when working on a feature branch, always be ready to rebase against fresh pipeline commits.
2. **`test_backend.yml`** runs `pytest backend/tests/` on every backend or `requirements.txt` change.
3. **`data_warehouse.yml`** weekly warehouse refresh.

The unified PyTorch model artefacts (`unified_*.pt`, `*_scaler.pkl`, `*_calibrator.pkl`, `*_metadata.json`) are **gitignored** — train them locally via `python -m backend.scripts.train_unified` and the FastAPI inference layer picks them up automatically from `backend/data/models/`.

`PredictionRecord` JSON files **are** committed (under `backend/data/predictions/`) and that's what the Vercel-deployed `/api/v1/tracking/*` Node routes read. So `/accuracy` works on Vercel even though FastAPI doesn't.

## Key conventions

- **Data-provenance honesty**: never fabricate data — no synthesized match rows, no placeholder fills for missing provider fields. `DataSourceBadge` no longer exists: provenance and methodology are documented in README/`docs/methodology.md` and MUST NOT appear in the website UI (provider names, algorithm/method names, pipeline details) outside a short plain-language note on `/about`.
- **Accuracy disclaimers**: predictions are educational only; the README pins this explicitly. Don't add betting language.
- **No bot attribution in commits**: the user explicitly doesn't want "Co-Authored-By: Claude" or "Generated with Claude Code" trailers in this repo.
- **CSS variables over Tailwind colours**: use `text-[var(--text-primary)]`, `bg-[var(--card-bg)]`, `border-[var(--border-color)]`, etc. Hardcoded `text-white` / `bg-black` / `text-gray-400` will break light mode — tokens are defined in `src/app/globals.css` under `:root` (light) and `.dark` (dark).
- **Feature branches**: long-lived rebuild work goes on `feat/*` branches with descriptive names; small bug fixes go straight to `main`. The 3×/day prediction pipeline only runs on `main`.
- **Backend tests live under `backend/tests/`** and use absolute imports like `from backend.services.data.warehouse import ...`. The root `conftest.py` makes that work without an editable install.
