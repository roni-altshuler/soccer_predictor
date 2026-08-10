# Data & methodology

This document is the canonical description of where Pitchverse's data comes from and how its
predictions are computed. **By policy, none of these details appear in the website UI** — the
product speaks in plain outcomes language, `/about` carries a short plain-language explainer,
and the Accuracy page shows results only. Keep it that way; update this file instead.

## Data sources

All ingestion loaders live in `backend/services/data/` and feed a single SQLite match
warehouse (`backend/data/warehouse.sqlite`), reconciled across sources by `team_resolver.py`.

| Source | What it provides |
|---|---|
| ESPN | Live scores, fixtures, standings, scorers, and news (men's + women's league APIs) |
| FotMob | Match detail and lineup enrichment |
| Understat | Expected-goals (xG) histories |
| ClubElo | Long-run team strength (Elo) ratings |
| FBref | Advanced team statistics |
| football-data.co.uk | Historical results archive (decades of matches) |
| OpenFootball | Open fixture and season data |
| Open-Meteo | Matchday weather conditions |

Provenance rule: missing provider fields are never back-filled with placeholders, and match
rows are never synthesized.

## Modeling

- **Unified multi-task PyTorch model, per gender** — `unified_men.pt` and `unified_women.pt`
  (trained via `python -m backend.scripts.train_unified --gender M|F`). Each model has an
  outcome softmax head (home/draw/away) and a bivariate-Poisson scoreline head, trained
  jointly over ~80 engineered features (Elo, form, head-to-head, rest, weather, referee,
  market-implied, availability, travel, motivation, …).
- **Calibration** — temperature scaling plus per-league blend weights and draw thresholds,
  re-tuned by the online-learning step; artefacts (`*_scaler.pkl`, `*_calibrator.pkl`,
  `*_metadata.json`) sit alongside the model weights in `backend/data/models/` (gitignored).
- **Legacy fallback** — an Elo-Poisson (Dixon-Coles-flavoured) baseline
  (`backend/services/prediction/model.py`) serves when unified artefacts are unavailable;
  a Bradley-Terry-style strength model powers the client-side league/tournament
  Monte Carlo simulators.
- **Reference metrics.** Stated against the closing line on named fixtures, or not stated —
  see the standing rules in [CLAUDE.md](../CLAUDE.md). The market scores **Brier .5793**
  (ECE .0030) over 37,981 Wave A fixtures, 2005-2026; off-the-shelf Dixon-Coles walk-forward
  reaches **.5958** over 31,247, i.e. **+.0177 behind the close**. Those are the live numbers.

  The figure this line used to carry — "men's ~60.5% outcome accuracy across an 11,661-match
  holdout" — was an artifact of the train/serve market-feature skew found on 2026-08-08, not a
  result. The model was trained with market features and served them as zeros; the holdout saw
  the real values and live did not. Live was 46%. It is recorded here rather than deleted
  because the number circulated widely enough to be worth explicitly retracting.

## Match Engine v0 — REMOVED

The minute-process in-match model was removed with the rest of the VISION_2030 surfaces. Its
serving routes (`/api/v1/engine/live`, `/api/v1/engine/fork`) went in the 2026-08-08 pivot; the
frontend that called them survived until 2026-08-10, fetching two endpoints that 404'd on every
live match. `src/lib/engine/`, `engineClient.ts` and `LiveWinProbabilityPanel` are gone with it.

Recoverable from git history if in-match prediction returns as a scoped goal.

## Pipeline & public tracking

- `prediction_pipeline.yml` runs **3× daily** (06:00 / 14:00 / 22:00 UTC): settles pending
  predictions (`fetch_outcomes`), generates picks for the next 7 days (`predict_upcoming`),
  runs online learning (`train_feedback`), and commits `backend/data/predictions/*.json` +
  `backend/data/league_params.json` back to `main`.
- Every prediction is recorded before kick-off and settled against the final result; the
  committed JSON record is what the deployed `/api/v1/tracking/*` routes read, so the
  public Accuracy page (hit rates, Brier score, calibration bins, recent picks) works on
  Vercel without the FastAPI backend.
- Weekly warehouse refresh via `data_warehouse.yml`; data quality gate via
  `npm run data:quality`.

## Disclaimer

Educational project only — never betting advice. Even a well-calibrated model loses
regularly.
