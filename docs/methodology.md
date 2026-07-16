# Data & methodology

This document is the canonical description of where Pitchwise's data comes from and how its
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
- **Reference metrics** (holdout at last release): men's ~60.5% outcome accuracy across an
  11,661-match holdout; women's ~51.45% across 482 matches.

## Match Engine v0 (minute process, research stage — not in production)

The first VISION_2030 "world model" experiment: instead of predicting a final-score
distribution directly, model the match as a discrete-time goal process over 90 regulation
minute bins (added time folds into the 45'/90' bins; knockout extra time folds into 90').

- **Model** (`backend/services/prediction/match_engine.py`, pure/no-I/O like
  `dixon_coles.py`): per-minute scoring intensity `λ_DC(home, away) · f_θ(state)/90` per
  side. The engine is *Dixon-Coles-nested*: λ/μ anchors come from the committed DC
  machinery, and the residual network `f_θ` (shared MLP, ~21k params, output
  `exp(net(state))` with a zero-initialised last layer) multiplies them. With zero residual
  the engine reproduces DC's score matrix exactly (unit-tested to 1e-6), because per-minute
  goal increments are Poisson-thinned: 90 × Poisson(λ/90) sums to Poisson(λ). State
  features: 5-minute bucket, added-time-folded flag, side-relative score and red-card
  differences (one-hot, clipped), home flag, gender flag — team identity enters *only*
  through the DC anchors. 1X2 probabilities come from an exact forward dynamic program over
  the (0..10 × 0..10) score lattice; `rollout_from_state(minute, score, reds)` runs the
  same kernel from any mid-match state (the live/counterfactual seed). Red cards in v0 are
  an observed training covariate only: pre-match rollouts hold the red-card difference
  fixed at 0.
- **Data** (`backend/scripts/build_event_dataset.py`): all `match_event_coverage` timelines
  (35,463 covered matches; verified-empty 0-0 grids included), deduplicated to one covered
  source per competition-season (31,701 grids), with a hard reconciliation guard — a grid
  whose implied final score disagrees with the warehouse final score is excluded loudly
  (0 exclusions at build time). DC anchors are fitted *walk-forward* per
  (competition, source, season) on matches strictly before each season's first kickoff.
- **Training** (`backend/scripts/train_match_engine.py`): teacher-forced Bernoulli-hazard
  likelihood (`P(goal in bin) = 1 − exp(−ν)`) over ~4.2M (minute, side) cells, CPU-only,
  minutes of wall clock; per-epoch checkpointing. Committed summary:
  `backend/data/diagnostics/match_engine_v0_summary.json`. The trained engine beats both a
  homogeneous-hazard control and the pure DC-anchor control on held-out per-minute NLL.
- **Evaluation** (`backend/scripts/backtest.py` on the pluggable harness
  `backend/scripts/_backtest_core.py`): Dixon-Coles and the engine are scored by one
  walk-forward loop on byte-identical fixtures — same matchday blocks, same training cuts,
  same skip rules — with per-block DC refits shared between the two and per-block
  warm-start fine-tuning for the engine. `backend/scripts/backtest_dixon_coles.py` remains
  as a thin shim (byte-identical historical report). Committed artifact:
  `backend/data/diagnostics/engine_v0_vs_dc.json` (per-competition Brier vs DC vs de-vigged
  market, pooled ΔBrier with a paired block-bootstrap CI).
- **Status & honesty note**: on the 2025 held-out season across
  eng.1/esp.1/ita.1/fra.1/ger.1/usa.1.w (1,866 fixtures), the v0 engine's pooled Brier is
  statistically indistinguishable from Dixon-Coles (ΔBrier +0.00035, 95% CI
  [−0.00064, +0.00136]) — it did **not** beat the yardstick, so Dixon-Coles remains the
  production baseline and the engine ships nowhere user-facing. The artifact records the
  failed gate deliberately: pre-match 1X2 was always the *hardest* place for a
  minute-process model to add value (its state dynamics integrate out at kickoff); its
  in-match rollout surface is the asset the next iteration builds on.

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
