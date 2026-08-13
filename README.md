<div align="center">

<img src="public/brand/pitchverse-logo-dark.png" alt="Pitchverse" width="380" />

# Pitchverse

**A soccer prediction dashboard that publishes every number it can be judged on.**

Match outcomes and season projections for the five big European leagues, plus
knockout forecasts for fourteen tournaments — who advances a tie, and who lifts
the trophy. Every model is trained on the seasons before the one it predicts,
and every claim here is a measured number with its sample printed next to it.

[![CI](https://github.com/roni-altshuler/soccer_predictor/actions/workflows/ci.yml/badge.svg)](https://github.com/roni-altshuler/soccer_predictor/actions/workflows/ci.yml)
[![Backend tests](https://github.com/roni-altshuler/soccer_predictor/actions/workflows/test_backend.yml/badge.svg)](https://github.com/roni-altshuler/soccer_predictor/actions/workflows/test_backend.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e.svg)](LICENSE)
![Next.js](https://img.shields.io/badge/Next.js-15-000000?logo=next.js)
![FastAPI](https://img.shields.io/badge/FastAPI-Python-009688?logo=fastapi)

</div>

> [!IMPORTANT]
> **The goal is forecasting accuracy, not betting.** The market price is used as
> a yardstick — it is the best public forecaster of a football match, so being
> measured against it is the hardest honest test available. It is not a target
> to beat for profit, and the repo carries the measurement that settles the
> question: backing this model against the price loses money in **every**
> disagreement bucket, and loses more the more confident the model is
> (`benchmark_edge_buckets`). That result is published rather than buried.

---

## What it does

Four things.

**1. Predicts match outcomes.** 1X2 and scoreline for the five big European
leagues, calibrated and scored against the bookmaker's price on identical
fixtures.

**2. Projects the season.** Title, relegation and final table via Monte Carlo,
updated as each matchday resolves — with a published convergence curve saying
how many matchdays it takes before the projection is trustworthy.

**3. Forecasts tournaments.** Who advances a knockout tie, and who lifts the
trophy — fourteen competitions, from the Champions League to the Africa Cup of
Nations. Pick a tournament and the model gives its title odds for the edition
being played, or, for a finished one, the call it made *before* the knockout
stage next to what actually happened.

**4. Shows the evidence for all three.** Every headline sits on a ladder that
starts at a yardstick anyone can check — a coin flip, always picking home,
backing the better-rated side — never at a floor chosen to flatter.

Anything that is none of those was deleted on 2026-08-08. See
[docs/PIVOT_2026-08.md](docs/PIVOT_2026-08.md) for what went and why. The
tournament layer was added on 2026-08-11.

## Where the model actually stands

### Match outcome, 1X2 — the weakest surface, stated plainly

Rolling origin over 17,933 priced Wave A fixtures (2016–2025), multiclass Brier
where uniform ⅓ = .6667:

| forecaster | Brier | accuracy |
|---|---|---|
| **The bookmaker's price** (Shin de-vig) | **.5728** | **54.0%** |
| Dixon-Coles (serving) | .5890 | 52.3% |
| Ratings only (pi-ratings + Elo, boosted) | .5858 | — |
| Back the higher-rated team | — | 51.9% |
| Always pick home | — | 43.0% |
| Constant base rate | .6526 | 43.1% |

The price is the best forecaster here and adding our features to it makes it
**worse** (`benchmark_market_blend`: +.00154, 95% CI [+.0009, +.0022]). This is
the honest ceiling of a three-way problem where a quarter of matches end level.

Nine independent challenger families have now landed in the same place — six
goal models within .003, two Bayesian models within .001, pi-ratings plus a
booster at parity, sixteen swept tree configurations, and a lineup block that
came in at −.00095 with a confidence interval straddling zero. The permutation
importance says why: one feature carries an order of magnitude more than every
other, and one candidate is an exact algebraic duplicate of it. **The model
family was never the bottleneck.**

### Season projections — the stronger half

The simulator beats a carry-forward-the-table baseline at every matchday:

| | simulator | naive carry-forward |
|---|---|---|
| Champion picked | **79.4%** | 73.5% |
| Title Brier | **.0149** | .0273 |
| Title log loss | **.613** | 3.665 |

The log-loss gap is the real story — the naive baseline puts p=1 on today's
leader and is destroyed when it is wrong.

### Tournaments — see below

The binary layer, and where the sharpest numbers live.

## The tournament layer

A league match has three outcomes and a quarter of them end level, which is why
every 1X2 number above is capped near the market's 54%. **A knockout tie has
two** — extra time, penalties and away goals exist to guarantee it. That is a
different question, and it is asked separately.

Measured over 2,141 ties across fourteen competitions, 2013–2026, training on
every previous season and testing on the one being played:

| | accuracy | Brier (binary) |
|---|---|---|
| Coin flip | 50.0% | .2500 |
| Back the better-rated side | 64.3% | .2381 |
| **This model** | **64.9%** | **.2175** |

The accuracy gap is small; the probability gap is not, and a bracket is decided
by probabilities compounded over four or five rounds. Calibration is close to
exact — says 64.7%, happens 64.8%; says 74.3%, happens 74.3%.

Simulating whole brackets, 85 tournaments at 20,000 runs each:

| | log loss on the champion | called the winner |
|---|---|---|
| Uniform over the field | 2.5606 | — |
| Rating-only simulation | 2.1453 | 22.4% (highest-rated team) |
| **This model** | **1.9686** | **31.8%** (top 3: 63.5%) |

**Integrity gate:** the team recorded as advancing turns up in the next round in
2,433 of 2,442 ties (99.6%). That check is what catches a wrong away-goals
branch or a mis-paired second leg — which would otherwise silently train the
model on the losing side.

### Pick a tournament, get the winner

Four states are reported and never merged, because a power ranking read as a
forecast is the easiest lie to tell here:

| state | what is shown |
|---|---|
| `upcoming` | the draw is made, none of it played — title odds on something undecided |
| `in_progress` | decided ties held at their real winner; only the rest simulated |
| `completed` | the forecast made **before** the knockout stage, next to the result |
| `awaiting_draw` | **no odds at all** — a rating table, labelled a power ranking |

Which state a competition is in comes from the **fixture list**, never from
whether a past tie could be resolved. That distinction is not pedantic: an
earlier version called a tournament live whenever some tie had no recorded
winner, and six missing legs made the 2025-26 Champions League — decided on
30 May — report as still running, with live-looking odds for a trophy that had
already been lifted.

On 2026-08-11 nothing is mid-flight. The Copa Libertadores and Copa Sudamericana
round of 16 are drawn and kick off today (Flamengo 23.4%, Botafogo 17.7%);
everything else is a record. The most recent of those records is the 48-team
2026 World Cup: the model made **Argentina** favourite at 19.0%, and **Spain**
won it from 11.6%, third on its list.

## The season ahead — what the site serves now

**Fourteen leagues, 4,800 remaining fixtures, refreshed daily as results land.**

Not a preseason snapshot. Every day the pipeline pulls the previous night's
results, retrains through them, and re-simulates: ratings and form advance,
points already banked seed the season simulation, and played fixtures leave the
remaining set. The Brasileirão is the visible proof — 215 played, 160 to go,
and a mid-season table rather than an August one. Everything else starts moving
from 14 August.

A league appears here only if it beats three baselines on its own history — a
one-in-three guess, its own base rate, and picking the home side every time.
Seventeen of eighteen candidates did. Fourteen get a projected table; MLS, Liga
MX and Argentina do not, because they are not single-table competitions and a
confident 30-team MLS table would describe a competition that does not exist.

The spread between leagues is real and each page states its own number rather
than borrowing the headline: Primeira Liga .56873 at the top, Ligue 2 .64736 at
the bottom.

| route | what it answers |
|---|---|
| [`/season`](src/app/(app)/season/page.tsx) | pick a league, then who wins it, where everyone finishes, and every fixture left |
| `/season/fixture/[uid]` | one match: 1X2, expected goals, scoreline distribution, team strength |
| [`/evaluation`](src/app/(app)/evaluation/page.tsx) | how accurate it has actually been |
| `/tournaments` | knockout ties and trophy odds |

### Three things worth knowing about the numbers

**Season probabilities carry strength uncertainty, and that changed them a
lot.** Simulating from point-estimate ratings gave Bayern 93.3% for the
Bundesliga. Within-season Elo drift, measured over 3,583 team-seasons, has a
standard deviation of 45.3 points — and that error is *correlated across all of
a club's fixtures*, so more simulations do not wash it out. Each run now draws
one strength offset per club and holds it for the season: Bayern 71.3%, City
38.6%, Barcelona 48.7%. Per-match probabilities are unchanged by this; the
correlation only matters when you compound 34 of them.

**The 1X2 and the scoreline grid cannot disagree.** They come from different
model families, so the goal model's two rates are solved until its scoreline
grid reproduces the outcome probabilities exactly. Worst disagreement across
2,346 fixtures: 0.00000. A gap above 1e-3 aborts the publish.

**Every forecast is written down before kickoff and never rewritten.**
`prediction_snapshots` is append-only. That is what makes it possible to ask
later what users were actually shown before a match, rather than what the model
says now — and it is what the live evaluation scores.

### Historical and live evidence are never merged

| | matches | what it is |
|---|---|---|
| Historical walk-forward | 43,433 | Brier .59303, ECE .0099. Retrospective — nobody saw these before those kickoffs. |
| Live published | grows from 0 | The final pre-kickoff forecast, scored once the result lands. |

The live sample is currently zero and the site says so, rather than showing a
`0.00000` that would read as a perfect model. Below 200 scored matches
`/evaluation` refuses to draw a reliability chart, because a chart implies a
shape and a handful of points does not have one.

It also says *why* the sample is the size it is. A forecast names its clubs the
way FBref does ("Gladbach"); a result names them the way the warehouse does
("Borussia Mönchengladbach"). Rehearsing last season through the scoring path
before the first kickoff, a name-based join matched 68.9% of fixtures and
dropped the rest without a word — the live record would simply have looked
small. Clubs are resolved to ids now, which takes the same rehearsal to 99.6%,
and anything still unmatched is counted and named on the page.

### On a phone

`/season` shows one league at a time, chosen from a picker that becomes a
bottom sheet below the `sm` breakpoint, and splits the races, the projected
table and the fixture list into three tabs. The projected table is a different
layout on a narrow screen rather than the same one squeezed: a 20x6 grid is
unusable at 375px however small the text gets, and scrolling it sideways hides
the club name, which is the column you navigate by.

`node scripts/responsive_audit.mjs` drives real device profiles at 320, 375,
390, 768 and 1440 and fails the run on horizontal overflow or a tap target
under 24px. It is what caught the picker being clipped by the tab bar, and the
709 fixtures whose kickoff rendered as "Invalid Date".

**Measured and dropped:** referee, rest, head-to-head, venue, attendance,
kickoff time. Each was added, scored on unseen matches, and removed. Referee was
the expensive one — it needed a 207,000-fixture scrape to make the question
askable outside England — and the answer was still no.

## Supported competitions

**Leagues (live):** Premier League · La Liga · Bundesliga · Serie A · Ligue 1

**Tournaments (live):** Champions League · Europa League · Conference League ·
Euros · Nations League · World Cup · Club World Cup · Copa América ·
Libertadores · Sudamericana · Africa Cup of Nations · AFC Asian Cup · Gold Cup ·
CONCACAF Champions Cup

**Next:** MLS, once Wave A holds for a full season.

Each wave advances on measured evidence, not on a calendar.

## Data

Four layers, and each exists because the one above it cannot do its job.

| layer | what it is | why |
|---|---|---|
| raw HTML, gzipped | `backend/data/cache/` | six seconds a page — a parser bug must cost a re-parse, never a re-scrape |
| `fbref.sqlite` | typed landing zone, **source of truth** | has a PRIMARY KEY, so re-scraping a season *replaces* it |
| Parquet | `league=<x>/season=<y>/` | portable, typed, ~10× smaller than CSV; a new season adds a file |
| `warehouse.sqlite` | serving | filled by a separate re-runnable loader that **cannot create a team or a fixture** |

**Why not CSV as the store.** A keyless file can only be appended to, and
appending the same season twice silently doubles it. This warehouse has been
there: 18,547 duplicate fixtures, and a club that "won" the Bundesliga because
a 7-0 was counted twice.

| source | provides |
|---|---|
| ESPN | fixtures, results, lineups, knockout winners **and shootout scores**, live odds movement |
| football-data.co.uk | historical 1X2 prices — the yardstick |
| FBref | referees, shot-level xG, league history |
| Understat | match xG |
| ClubElo | club strength ratings |
| Open-Meteo | match-day weather |

Known gaps are documented rather than papered over. Features built on absent
data are reported as **untestable**, never as "no signal", and are never
imputed — the difference matters, because referee coverage outside England was
called a source limitation for months and turned out to be a column nobody had
read.

**One price is not the other.** `historical_data.py` reads football-data's
`PSH`/`B365H`, which are collected *before* kickoff. The closing columns are
`PSCH`/`B365CH`. Both are now captured, in separate warehouse columns, because
only the first exists at serve time — and any older document in this repo
calling the benchmark "the closing line" is describing the softer number.

> **FBref needs a real browser.** It answers plain HTTP with 403 —
> `server: cloudflare`, `cf-mitigated: challenge`. Measured three ways on
> 2026-08-11: `requests.get()` 403 with 0 tables, curl with full browser headers
> 403, headless Chromium 403 with the challenge unsolved. Only a real headed
> browser gets through, which means **CI can never run it**. It is a local bake:
> `backend/scripts/run_fbref_scrape.sh schedules` (wrapped in `xvfb-run`, so no
> windows appear), and the output is the artefact.

## How accuracy is measured

Every number above comes from a script in this repo, runnable against a locally
built warehouse:

```bash
# Score the model and the market on identical fixtures
python3 -m backend.scripts.benchmark_market

# The Dixon-Coles floor, walk-forward out-of-sample
python3 -m backend.scripts.benchmark_dc_challenger

# All six goal models plus blends, paired on identical fixtures
python3 -m backend.scripts.bakeoff_goal_models

# Which features earn their place (temporal splits, market reference row)
python3 -m backend.scripts.ablate_features

# Season projections, matchday by matchday, vs a naive baseline
python3 -m backend.scripts.backtest_season_projections

# Knockout ties: who advances, against a coin flip and the better-rated side
python3 -m backend.scripts.benchmark_knockout

# Whole brackets simulated to a champion, 84 tournaments
python3 -m backend.scripts.backtest_brackets --sims 20000

# Forward title odds for every covered tournament
python3 -m backend.scripts.predict_tournaments

# Does the model add anything to the price? (it does not — this proves it)
python3 -m backend.scripts.benchmark_market_blend
python3 -m backend.scripts.benchmark_edge_buckets
```

There is no `.venv` in this repo. Use whichever interpreter carries
`penaltyblog`, `torch` and `sklearn`; CI installs into a bare 3.12 and calls
plain `python -m ...`, so a script that only runs under a named venv is a
script CI cannot run.

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

## Documentation

**[docs/handbook/](docs/handbook/README.md)** — the user-facing documentation
the site links to wherever it stops explaining itself. The pages carry the
numbers; the handbook carries the reasoning.

| | |
|---|---|
| [Getting started](docs/handbook/getting-started.md) | What each page answers, in one screen |
| [Read a match forecast](docs/handbook/tutorials/read-a-match-forecast.md) · [Follow a season](docs/handbook/tutorials/follow-a-season.md) · [Read a bracket](docs/handbook/tutorials/read-a-bracket.md) · [Judge the model](docs/handbook/tutorials/judge-the-model.md) | Tutorials |
| [Scoring](docs/handbook/concepts/scoring.md) · [Models](docs/handbook/concepts/models.md) · [Evaluation](docs/handbook/concepts/evaluation.md) · [Data](docs/handbook/concepts/data.md) | Concepts |
| [HTTP API](docs/handbook/reference/api.md) · [Artifacts](docs/handbook/reference/artifacts.md) · [Commands](docs/handbook/reference/cli.md) · [Glossary](docs/handbook/glossary.md) | Reference |

## Design

The interface follows the **Bugatti** language shared with the sibling
[RaceIQ](https://github.com/roni-altshuler/f1_predictions) project: pure black
canvas, hairline borders, white uppercase letterspaced display type, monospace
for navigation and tabular figures. No gradients, no shadows, no glassmorphism.
Colour appears only where it carries meaning. Dark-only.

## License

[MIT](LICENSE). See [SECURITY.md](SECURITY.md) and
[CONTRIBUTING.md](CONTRIBUTING.md) before contributing.
