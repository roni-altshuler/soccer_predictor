# Models

Four forecasters. Each answers a different question, each is measured
separately, and none of them is allowed to speak for another.

| layer | question | model | serving since |
|---|---|---|---|
| Match | who wins, and what is the score | Dixon-Coles | 2026-08 |
| Season | who wins the league, who goes down | Monte Carlo over remaining fixtures | 2026-08 |
| Knockout tie | who advances | random forest over tie features | 2026-08-11 |
| Trophy | who lifts it | bracket simulation over the tie model | 2026-08-11 |

---

## 1. Match outcome — Dixon-Coles

A Poisson goal model with the classic Dixon-Coles low-score correction. Each
club carries an attack and a defence coefficient; the pair of fitted scoring
rates for a fixture generates a full scoreline grid, and the 1X2 probabilities
are read off that grid.

**Why this and not the neural network.** A 75-feature neural stack was trained,
retrained on a repaired corpus, and scored against Dixon-Coles on 5,320 paired
fixtures (2026-08-10):

| forecaster | Brier | log loss | accuracy |
|---|---|---|---|
| Market (closing line) | **.5757** | .9680 | .5387 |
| Dixon-Coles | .5897 | .9896 | .5226 |
| Neural stack, 75 features | .5925 | .9924 | .5205 |
| Constant base rate | .6526 | 1.0777 | .4312 |

The difference between the two challengers is +.0028 in Dixon-Coles' favour,
95% CI [−.0015, +.0070]. **Promotion requires significance, not the sign of a
difference**, so Dixon-Coles keeps serving.

### The 1X2 and the scoreline grid are reconciled

The two Dixon-Coles rates are solved so that the grid reproduces the
measured-best 1X2 numbers. Worst disagreement across 2,346 fixtures: **0.00000**,
and a gap above 1e-3 aborts the publish. A site that shows "Home 47%" beside a
scoreline distribution summing to 44% home wins is showing two models and
calling them one.

### What the model looks at

`elo_*` and `form_*` features only.

Measured and **dropped**, each scored on unseen matches: referee, rest days,
head-to-head history, venue records, attendance, kickoff time. Referee was the
expensive one — it required a 207,000-fixture scrape to make the question
askable outside England — and the answer was still no.

Market features (the odds themselves) *do* help, by −.0102 Brier, and **cannot
serve**: the live inference path has no closing price at prediction time. A
feature in the trained vector that the serving path cannot populate is the
single most dangerous bug in this codebase — it once took live Brier from .5801
to .6561, below a constant base rate, while every holdout number looked fine.

**Adding all 53 candidate features degraded Brier by .0052.** Feature count is
not quality.

---

## 2. Season projection — Monte Carlo

Every remaining fixture in a league is simulated 20,000 times from the match
model, points are accumulated on top of what has already been banked, and every
probability on a league page is the share of simulations in which it happened.

Three decisions that must not be casually changed:

**One strength offset per club, held for the whole season.** Simulating from
point estimates and compounding them 34 times gave Bayern 93.3%, PSG 88.1%,
Inter 83.4% — against market prices near 70/70/30. Within-season Elo drift over
3,583 team-seasons has **sd 45.3 points**, and that error is *correlated across
all of a club's fixtures*, so more simulations cannot average it away. Drawing
the offset once per club per simulation fixes it: Bayern 71.3%, City 38.6%,
Barcelona 48.7%. Per-match probabilities stay unperturbed.

**No season-boundary regression to the mean.** Tested and rejected: +.00150
Brier at 0.25 shrinkage, +.00394 at 0.40, +.00796 at 0.60 — significantly worse
at every level. A surprising ordering is the measured model's output. Ratings
are not tuned because a table looks wrong.

**Every competition seeds its own RNG** from `sha256(competition_id)`. One
shared generator consumed in dictionary order meant that adding a league moved
Manchester City by a point with nothing about the Premier League having
changed. Two full runs are now byte-identical.

### It re-syncs every matchday

Nothing about a projection is a preseason snapshot. Each daily run pulls new
results, rebuilds the canonical layer, retrains through yesterday and
re-simulates. Points already banked seed the simulation, so the projection
tightens as the season runs and played fixtures leave the remaining set.

### Grouped leagues are not the same object

MLS is grouped, and that changes what every number means: `p_title` is the
Supporters' Shield, and a club's actual season is `p_group_title` (wins its
conference) and `p_qualify` (reaches the playoffs). Conference membership *and*
the playoff cut line are read from ESPN's own standings rather than hard-coded,
because a literal cut of 9 stops being true the year the format changes and
nothing would say so.

Passing the match gate does not earn a projected table. A single-table
simulation assumes a double round robin; Liga MX runs at 50% of one
(Apertura/Clausura) and Argentina at 57%. Both are held with that reason
recorded — the model is fine, the competition is not a single table.

---

## 3. Knockout tie — random forest

**A knockout tie has two outcomes, and that is the whole point.** Every
three-way number in this project is capped by the fact that a quarter of league
matches are drawn; the closing line itself only reaches 54.0% on 1X2. Extra
time, penalties and away goals exist so that exactly one team advances, so a
tie is where football asks a binary question.

Measured 2026-08-11 across **14 competitions**, 2,141 test ties, 2013–2026,
rolling origin — train on every previous season, test on the season played:

| | accuracy | Brier (binary) |
|---|---|---|
| Coin flip | 50.0% | .2500 |
| Higher-rated side advances | 64.3% | .2381 |
| **Random forest over tie features** | **64.9%** | **.2175** |

Logistic .2182, HGB .2195, XGBoost .2281 — the forest wins. Read the ladder as
a *gap*, not as levels: adding nine minnow-heavy competitions raised absolute
Brier for everything (the baseline moved .2308 → .2381) while the model's edge
over "back the better-rated side" grew from .0175 to **.0206**.

**Calibration is the result worth quoting, not the accuracy** — see
[Scoring](scoring.md#calibration).

### Rules this layer lives by

- **Bracket depth is counted, never parsed.** `second-round` is the round of 32
  in the Europa League and the round of 16 at the 1998 World Cup. The round is
  derived from `2 × (ties in it)`. Any code mapping a phase string to a bracket
  position is wrong in the seasons nobody checks.
- **Ratings are post-match values timestamped at kickoff**, and a tie reads the
  last entry strictly earlier. Storing pre-match values instead looks
  equivalent and silently runs every feature one game stale.
- **A one-legged tie inside a two-legged round is a hole, not a format.**
  Resolved on the single scoreline it names the wrong team about half the time,
  so it is flagged and dropped.
- **Whether a tournament is live is a question about fixtures, never about
  resolution.** A tie is also winner-less when a leg is missing from the data —
  six such holes once made a finished Champions League report as still running
  with live-looking title odds.
- **`validate_progression` is the integrity gate**: does the team the resolver
  says advanced actually appear in the next round? Currently 99.6% over 2,442
  ties. A wrong away-goals branch trains the model on the losing side and is
  otherwise invisible.

---

## 4. Trophy — bracket simulation

The tie model run forward over a whole bracket, 20,000 times, to a champion.
Getting a tie right and getting the champion right are different achievements: a
side the model likes at 70% per round is only a 24% champion.

Measured over **85 reconstructed tournaments** (2026-08-11):

| | log loss on the actual champion | picked the winner outright |
|---|---|---|
| Uniform over the field | 2.5606 | — |
| Elo simulation (unfitted) | 2.1453 | 22.4% |
| **This model** | **1.9686** | **31.8%** (top 3: 63.5%) |

**Only the drawn round is a bracket.** When the round of 16 is published and the
quarter-finals do not exist yet, the tree is genuinely unknown; later rounds are
paired at random and that assumption is printed on the page. CONMEBOL in fact
seeds from the round of 16, so the real spread there is slightly tighter than
the simulation's.

---

## Versioning

`services/forecast/version.py`. Two halves: `2026.08.1` is human-facing and
bumped deliberately, `+27734fb2` is a hash of the configuration that
*determines* a forecast — features, shock sd, simulation count, league scope,
Elo settings. A release string someone has to remember to bump fails silently;
the hash cannot. Reordering features is not a change; adding one is.

## See also

- [Scoring](scoring.md) — what the numbers above mean
- [Evaluation](evaluation.md) — how they are checked
- [Data](data.md) — what the models are fitted on
