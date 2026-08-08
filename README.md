<div align="center">

<img src="public/brand/pitchverse-logo-dark.png" alt="Pitchverse" width="380" />

# Pitchverse

**A soccer prediction dashboard that scores itself against the closing line.**

Match outcomes, season projections, and a value surface — for the five big
European leagues. Every accuracy claim on this page is a measured number
against the bookmaker close, or it is not made.

[![CI](https://github.com/roni-altshuler/soccer_predictor/actions/workflows/ci.yml/badge.svg)](https://github.com/roni-altshuler/soccer_predictor/actions/workflows/ci.yml)
[![Backend tests](https://github.com/roni-altshuler/soccer_predictor/actions/workflows/test_backend.yml/badge.svg)](https://github.com/roni-altshuler/soccer_predictor/actions/workflows/test_backend.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e.svg)](LICENSE)
![Next.js](https://img.shields.io/badge/Next.js-15-000000?logo=next.js)
![FastAPI](https://img.shields.io/badge/FastAPI-Python-009688?logo=fastapi)

</div>

> [!WARNING]
> **This project surfaces betting information.** Model probabilities are compared
> against no-vig market prices to compute expected value and Kelly stakes.
> Sports betting is not legal everywhere and carries real financial risk. Nothing
> here is financial advice. A well-calibrated model still loses constantly, and
> a model that cannot beat the closing line has no edge at all — which is why
> **no league ships value flags until it has demonstrably earned them.**

---

## What it does

Three things.

**1. Predicts match outcomes.** 1X2 and scoreline for the five big European
leagues, calibrated and scored against closing odds on identical fixtures.

**2. Projects the season.** Title, relegation and final table via Monte Carlo,
updated as each matchday resolves — with a published convergence curve saying
how many matchdays it takes before the projection is trustworthy.

**3. Surfaces value.** Model probability vs no-vig implied probability, with
expected value and Kelly staking — gated per league on measured calibration.

Anything that is none of those three was deleted on 2026-08-08. See
[docs/PIVOT_2026-08.md](docs/PIVOT_2026-08.md) for what went and why.

## Where the model actually stands

Measured 2026-08-08 over 25,746 settled fixtures carrying closing odds
(2015–2026), scored with multiclass Brier where uniform ⅓ = .6667:

| forecaster | Brier | log loss | accuracy | ECE |
|---|---|---|---|---|
| **Bookmaker closing line** (Shin de-vig) | **.5666** | .9552 | **.5456** | .0049 |
| Dixon-Coles (`penaltyblog`, untuned) | .5977 | 1.0026 | .5138 | — |
| 30-feature logistic regression | .5876 | — | — | — |
| Constant base rate | .6468 | 1.0693 | .4427 | — |
| Uniform ⅓ | .6667 | 1.0986 | .4427 | — |
| In-house neural ensemble | .6396 | 1.0601 | .4427 | .0273 |

Read honestly: **the closing line is still the best forecaster here.** Our
Dixon-Coles floor sits +.0207 behind it and captures roughly 70% of the distance
from "knows nothing" to the market. The neural ensemble captures about 17% and
does not currently serve.

The market's own ECE of .0049 is the sanity check on the whole harness —
closing odds are almost perfectly calibrated, exactly as theory predicts.

**Season projections are the stronger half.** The simulator beats a
carry-forward-the-table baseline at every matchday from 0 to 35. Title Brier
holds ≤.02 from matchday 10 and ≤.01 from matchday 32; relegation ≤.05 from
matchday 26. It is overconfident in the 70–90% band and is being recalibrated.

## Supported competitions

**Wave A (live):** Premier League · La Liga · Bundesliga · Serie A · Ligue 1

**Wave B:** MLS — once Wave A holds for a full season.
**Wave C:** Champions League · Europa League · Euros · World Cup · Copa América.

Each wave advances on measured evidence, not on a calendar.

## How accuracy is measured

Every number above comes from a script in this repo, runnable against a locally
built warehouse:

```bash
# Score the model and the market on identical fixtures
.venv/bin/python -m backend.scripts.benchmark_market

# The Dixon-Coles floor, walk-forward out-of-sample
.venv/bin/python -m backend.scripts.benchmark_dc_challenger

# All six goal models plus blends, paired on identical fixtures
.venv/bin/python -m backend.scripts.bakeoff_goal_models

# Which features earn their place (temporal splits, market reference row)
.venv/bin/python -m backend.scripts.ablate_features

# Season projections, matchday by matchday, vs a naive baseline
.venv/bin/python -m backend.scripts.backtest_season_projections
```

Results land in `backend/data/diagnostics/` as committed JSON artifacts.

The rules these scripts enforce:

- **Strictly temporal splits.** Train before a cutoff, test after — never random
  k-fold over fixtures.
- **Paired scoring.** A fixture counts only when every forecaster priced it.
- **The market row is always shown**, so no result is read in isolation.
- **Coverage is reported, not hidden.** If a join drops half the rows, the
  number of rows is printed.
- **A label-permutation control** refits on shuffled labels and must collapse to
  the base rate.

## Getting started

```bash
git clone https://github.com/roni-altshuler/soccer_predictor.git
cd soccer_predictor

python -m venv .venv && .venv/bin/pip install -r requirements.txt
npm install

# Build the warehouse with closing odds (~10 min)
.venv/bin/python -m backend.scripts.build_warehouse --espn --football-data

npm run dev   # frontend :3000 + backend :8000
```

The warehouse (`backend/data/warehouse.sqlite`) and trained model artifacts are
gitignored — build and train them locally. Committed prediction JSON under
`backend/data/predictions/` is what the Vercel deployment reads, which is why
`/accuracy` works without the Python backend.

## Data

| source | provides |
|---|---|
| football-data.co.uk | results **and closing 1X2 / over-2.5 odds** — the benchmark |
| ESPN | fixtures, live scores, standings |
| ClubElo | team strength ratings |
| Understat | shot-level xG |
| Open-Meteo | match-day weather |

Known gaps are documented rather than papered over — see PIVOT §4c. The
`weather` table is currently empty, `referee_id` covers the Premier League only,
and venues are not yet geocoded. Features built on absent data are reported as
untestable, never as "no signal", and are **never imputed**.

## Design

The interface follows the **Bugatti** language shared with the sibling
[RaceIQ](https://github.com/roni-altshuler/f1_predictions) project: pure black
canvas, hairline borders, white uppercase letterspaced display type, monospace
for navigation and tabular figures. No gradients, no shadows, no glassmorphism.
Colour appears only where it carries meaning. Dark-only.

## License

[MIT](LICENSE). See [SECURITY.md](SECURITY.md) and
[CONTRIBUTING.md](CONTRIBUTING.md) before contributing.
