# Scoring

How a forecast is graded here, what each metric rewards, and the floors every
number on the site is read against.

A forecast is not "right" or "wrong". It is a probability, and the only way to
grade a probability is over many of them at once. Everything below is a way of
doing that, each answering a slightly different question.

---

## The metrics

### Brier score

Mean squared error between what was said and what happened, summed over the
possible outcomes. **Lower is better. Zero is perfect.**

For a three-way match forecast (home / draw / away), a perfectly ignorant
forecaster saying 1/3 to everything scores **0.6667**. That is the ceiling of
uselessness for 1X2, and it is why a Brier near .59 is a real result rather
than a bad-looking one.

```text
brier = mean over fixtures of  Σ_outcomes (p_outcome − actual_outcome)²
```

Brier is the site's primary metric because it is *proper* — it cannot be gamed
by shading probabilities toward the middle or toward the extremes. Stating
anything other than your true belief scores worse in expectation.

**Scales are not comparable across question types.** A three-way Brier and a
two-way (knockout tie) Brier live on different ranges: the ignorant floor is
.6667 for three outcomes and .2500 for two. A tie Brier of .2175 is not "better
than" a match Brier of .5930 — it is a different question with a different
floor. The site never places them side by side without both floors.

### Log loss

The negative log of the probability assigned to what actually happened,
averaged. **Lower is better.**

Log loss punishes confident mistakes far harder than Brier does — a 1% assigned
to something that happens contributes 4.6, where Brier contributes at most 1.
It is the metric used for the bracket simulation, where the whole question is
"how much probability did you put on the team that actually lifted it".

### Accuracy (hit rate)

The share of fixtures where the highest-probability outcome was the one that
happened. **Higher is better**, and it is the weakest metric on this site.

Accuracy throws away everything about confidence. A forecaster who says 90% and
one who says 34% score identically when both pick the winner. It is reported
because readers expect it, always with its sample size and its floor, and never
as the headline claim.

### Expected calibration error (ECE)

Take every forecast, bucket them by stated probability, and compare the stated
average with the observed rate in each bucket. ECE is the weighted mean of the
gaps. **Lower is better. It is a measure of honesty, not of skill.**

A forecaster who says 50% to every match in the Premier League has terrible
Brier and near-perfect ECE. A forecaster with excellent Brier and an ECE of .08
is skilled but overconfident, and their 80% means 72%.

---

## Calibration

**Calibration is the claim this project cares about most**, because it is the
one that makes a probability usable for anything downstream.

The test: gather every forecast that said 60–70%, and check what share of them
happened. If it is around 65%, the forecaster is calibrated in that band. Do it
per band and you have a reliability curve.

Two reasons it matters more here than the hit rate:

1. **A bracket simulation consumes probabilities, not picks.** A trophy is four
   or five rounds compounded, so a model that is 3 points overconfident per tie
   is wildly overconfident about a champion.
2. **Overconfidence is invisible in accuracy.** It shows up only when you sort
   by stated probability, which is exactly what a reliability panel does.

The measured record, per layer:

| layer | stated | happened | measured on |
|---|---|---|---|
| knockout ties | 55.1% | 55.7% | 2,141 test ties, 2013–2026 (2026-08-11) |
| knockout ties | 64.7% | 64.8% | ” |
| knockout ties | 74.3% | 74.3% | ” |
| knockout ties | 83.9% | 86.3% | ” |
| match 1X2 | — | ECE **.0099** | 43,433 walk-forward matches (2026-08-13) |

**A reliability chart is not drawn below 200 scored matches.** Forty points do
not have a shape, and drawing a curve through them shows a pattern that is not
there. The site says the sample is too small instead — that is a deliberate
refusal, not a loading state.

### The one place the season model is known to be overconfident

The league Monte Carlo is overconfident in the 70–90% band: it says 80% and it
happens about 69.8%. That is recorded, it is why raw simulation probabilities
in that band are not printed as-is, and it is the kind of thing this section
exists to make findable.

The correction is an isotonic map fitted from that same backtest
(`fit_projection_calibrator` → `projection_calibrator.json`): every published
projection percentage is passed through the measured curve, then rescaled so a
league's column still sums to one champion and the right number of relegations.
The backtest deliberately keeps scoring the **uncorrected** simulator, so the
overconfidence number stays a live measure of the error being corrected rather
than a score of the correction itself.

---

## The floors

**A number without a floor is not information.** Every rate on the site is
shown against at least one of these.

| floor | what it is | where it applies |
|---|---|---|
| **Uniform** | 1/3 to each outcome — a blind three-way guess | match 1X2 |
| **Coin flip** | 50%, Brier .2500 | knockout ties |
| **Base rate** | the competition's own historical outcome frequencies | match 1X2 |
| **Always home** | back the home side every time | match 1X2 |
| **Higher-rated side** | back whoever has the better Elo — what an informed fan does for free | knockout ties |
| **Elo simulation** | an unfitted Elo run through the same bracket | trophy odds |
| **Closing line** | the bookmaker's final price, de-vigged | the five Wave A leagues |

A league only appears on the site once it has beaten *three* of these — a
one-in-three guess, its own base rate, and always-home — on a walk-forward that
never saw a match before predicting it. That gate is
`backend/scripts/league_gate.py`, and its output is committed in
`reports/baselines/league_gate.json`.

### The market is the yardstick, not the opponent

The closing line is the strongest public forecaster of a football match. Being
measured against it is the hardest honest test available, so it is the
benchmark — on identical fixtures, paired, with both scores printed.

Measured 2026-08-13 on 37,981 priced fixtures: **market Brier .5793, ECE
.0030**. The serving model trails it. The site says so.

It is emphatically **not** a profit target. The repository carries
`benchmark_edge_buckets`, which asks whether backing this model where it
disagrees with the price makes money. It does not: it loses money in every
disagreement bucket, and loses more the more confident the model is. That
measurement is published rather than buried, and it is why nothing on the site
frames a probability as a bet.

---

## Reading a number on this site

Three questions, in order:

1. **What is the sample?** `n` is printed next to every rate. A 100% hit rate on
   4 picks is noise.
2. **What is the floor?** See the table above. The gap to the floor is the
   information, not the level.
3. **Retrospective or live?** A backtest and a published record are different
   claims — see [Evaluation](evaluation.md).

## See also

- [Models](models.md) — what is producing these probabilities
- [Evaluation](evaluation.md) — the two records and why they stay apart
- [Glossary](../glossary.md)
