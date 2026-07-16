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
- **Reference metrics** (holdout at last release): men's ~60.5% outcome accuracy across an
  11,661-match holdout; women's ~51.45% across 482 matches.

## Match Engine v0 (minute process — in-match production surface; pre-match stays Dixon-Coles)

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

### In-match gate (2026-07-16): PASSED

The engine's real test — state-conditional prediction — ran on the same held-out 2025
season and the same walk-forward harness (per-block DC refits shared with the baseline,
per-block engine warm-start fine-tuning, `trained_until` leakage guard). At checkpoint
minutes {15, 30, 45, 60, 75}, using each covered fixture's *actual* score and red cards
(read from the reconciled per-minute event grids), three predictors produced 1X2
probabilities for the final outcome: the engine's exact DP from the state; the exact-count
empirical baseline at (gender, clamped score diff, minute bucket) — the rarity function,
**rebuilt from covered matches strictly before the earliest scored fixture** so it is
leakage-clean and conditions on byte-identical states; and frozen kickoff Dixon-Coles
(state ignored). 1,587 fixtures × 5 checkpoints; multiclass Brier; paired
matchday-block bootstrap on Δ(engine − counts).

| minute | engine | counts | frozen DC | Δ(engine − counts) | 95% CI |
|---|---|---|---|---|---|
| 15' | 0.5753 | 0.6200 | 0.6024 | −0.0447 | [−0.0567, −0.0322] |
| 30' | 0.5368 | 0.5706 | 0.6024 | −0.0339 | [−0.0439, −0.0233] |
| 45' | 0.4904 | 0.5123 | 0.6024 | −0.0219 | [−0.0303, −0.0132] |
| 60' | 0.4199 | 0.4322 | 0.6024 | −0.0122 | [−0.0190, −0.0053] |
| 75' | 0.3404 | 0.3457 | 0.6024 | −0.0053 | [−0.0098, −0.0007] |

The gate (beat the counts pooled at a majority of checkpoints, including 60' and 75')
passed 5/5 with every bootstrap CI entirely below zero. The engine also beats the
*committed* rarity artifact (whose counts include the test season — leakage in the
baseline's favour) at all five checkpoints, so the verdict is unambiguous in both
directions. Per gender: men's deltas are significant at every checkpoint; women's point
estimates favour the engine at every checkpoint but the CIs cross zero at n=263 —
directionally consistent, underpowered. The engine's edge is exactly the designed one:
the counts know only the state, the engine also knows *who* is playing through its
walk-forward DC anchors. Full artifact:
`backend/data/diagnostics/engine_v0_inmatch_gate.json`.

### Exported kernel (the in-match/counterfactual serving path)

Because the gate passed, the kernel ships to the frontend as a committed artifact
(`backend/data/engine/kernel.json`, ~3.3 MB): the residual network's exact float32
weights, the DP configuration, and walk-forward anchors `match_id → (λ, μ, ρ, gender)`
(~31.6k ids). Anchor fits run only on the dominant covered source per
(competition, season) — the population the gate scored; minority-source ids (cross-source
twins, and fixtures the dominant source never listed) inherit the dominant fit evaluated
at their teams via cross-source name resolution (ambiguity refused), so live match-page
ids resolve directly without thin-history fits. Every anchor must pass a sanity gate
calibrated on the dominant-fit population (λ+μ ∈ [0.5, 7.0], components ∈ [0.02, 6.0]);
out-of-bounds fits — continental-cup groups where a qualifying-round minnow's near-empty
history explodes the MLE — are dropped, so those matches honestly report no fork rather
than a nonsense one. `backend/scripts/export_engine_kernel.py`
regenerates it — torch-free on the CI path (weights re-used from the committed artifact,
anchors refreshed daily by `event_backfill.yml`) — and a TypeScript port
(`src/lib/engine/kernel.ts` + `src/lib/engine/params.ts`, served by
`POST /api/v1/engine/fork`) executes the same DP on Vercel. Parity is pinned by a
committed 21-case fixture: the TS port must match the Python reference within 1e-6 per
probability (measured agreement ~1e-9), and pytest pins the reference against the
production torch engine on the same cases. Pre-match production remains Dixon-Coles —
the engine serves *state-conditional* surfaces only.

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
