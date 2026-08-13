# Glossary

One line each. Fuller treatment in [Scoring](concepts/scoring.md),
[Models](concepts/models.md) and [Evaluation](concepts/evaluation.md).

### Metrics

**Brier score** — mean squared error between stated probabilities and what
happened. Lower is better; a blind three-way guess scores .6667, a coin flip on
a two-outcome question scores .2500.

**Log loss** — the negative log of the probability assigned to what actually
happened. Punishes confident mistakes much harder than Brier.

**Accuracy / hit rate** — share of fixtures where the highest-probability
outcome happened. Ignores confidence entirely; the weakest metric here.

**ECE (expected calibration error)** — the average gap between what was claimed
and what occurred, across probability bands. A measure of honesty, not skill.

**Calibration** — the property that forecasts stated at 60% happen about 60% of
the time. The claim this project cares about most.

**Reliability curve** — calibration drawn per band. Not drawn below 200 scored
matches, because forty points do not have a shape.

**Proper scoring rule** — a metric that is optimised by stating your true
belief. Brier and log loss are proper; accuracy is not.

### Baselines

**Uniform** — 1/3 to each outcome of a match. Brier .6667.

**Coin flip** — 50% to each side of a knockout tie. Brier .2500.

**Base rate** — the competition's own historical outcome frequencies.

**Always home** — back the home side in every match.

**Higher-rated side** — back whoever has the better Elo in a knockout tie.
64.3% accuracy over 2,141 test ties: what an informed fan does for free.

**Closing line** — the bookmaker's final price, de-vigged. The strongest public
forecaster of a football match and therefore the hardest honest yardstick.

**De-vig** — removing the bookmaker's margin from a price so it can be read as a
probability. Shin's method here.

### Models

**Dixon-Coles** — a Poisson goal model with a correction for low scores. Serves
match forecasts.

**Elo** — a chronological rating updated after every match. Built here over all
warehouse matches, clubs and national teams, because ClubElo covers 244 clubs
and zero national teams.

**Monte Carlo (season)** — 20,000 simulations of a league's remaining fixtures.
Every probability on a league page is a share of those simulations.

**Strength offset** — one draw per club per simulated season, held for the whole
season, representing correlated within-season drift (sd 45.3 Elo points).
Without it, projections are wildly overconfident.

**Bracket simulation** — the tie model run forward over a whole knockout tree to
a champion.

**Walk-forward** — refitting as the corpus advances, so no match is predicted by
a model that has seen it. The protocol behind every backtest here.

**Rolling origin** — the tournament-layer equivalent: train on every previous
season, test on the season played.

**Permutation importance** — shuffling one feature and measuring how much the
score degrades. What "what did it lean on" means on the evaluation page.

### Data and pipeline

**Warehouse** — the SQLite database of results, fixtures, odds and ratings.
Gitignored and rebuildable.

**Canonical layer** — the deduplicated, identity-resolved view the models train
on.

**Artifact** — a committed JSON file the site is served from. See
[Artifacts](reference/artifacts.md).

**Prediction snapshot** — an append-only record of a forecast, written before
kickoff and never rewritten.

**`final_before_kickoff`** — strictly the last snapshot generated before a
match started. The canonical record for live evaluation.

**Wave A** — the five leagues with a closing price on every fixture: England,
Spain, Germany, Italy, France. Only these can be scored against the market.

**Served leagues** — the nine with a published season projection: Wave A plus
the Netherlands, Portugal, Turkey and MLS.

**League gate** — the per-league walk-forward that admits a competition to the
site: it must beat a blind guess, its own base rate, and always-home.

**Train/serve skew** — a feature present in training that the serving path
cannot populate. Once took live Brier from .5801 to .6561 while every holdout
number looked fine.

### Tournament layer

**Tie** — a knockout matchup, one or two legs, resolved to exactly one
advancing team. Two outcomes, not three.

**Depth** — a round's position in the bracket, **counted** from the number of
ties in it, never parsed from its name.

**Slot** — a tie's position within its round. The tie at slot `s` is fed by
slots `2s` and `2s+1`.

**Progression check** — does the team recorded as advancing actually appear in
the next round? Currently 99.6% over 2,442 ties.

**`awaiting_fixtures`** — fixtures exist, the draw does not. The edition is
published as an empty placeholder with a reason, and no bracket or odds.

**`awaiting_draw`** — this edition is under way but its next round has not been
drawn.

**`not_reconstructed`** — the edition finished but its bracket could not be
rebuilt from the data, so nothing is claimed about it.

**Open draw** — later rounds paired at random in the simulation because they
have not been drawn. Printed on the page, because CONMEBOL in fact seeds from
the round of 16.
