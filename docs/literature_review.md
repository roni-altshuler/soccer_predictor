# Literature review

Compiled 2026-08-11. Scope: methods that could plausibly change what this
repository serves, judged against the data it actually has. A method that needs
inputs we cannot collect is recorded as such rather than aspirationally listed.

The organising fact: **published state of the art on 1X2 is RPS ≈ 0.19–0.21,
and the closing line is at or below the bottom of that range.** Nothing in this
literature suggests a large win is available. It suggests where the small ones
are.

---

## Goal models

### Dixon & Coles (1997), *Modelling Association Football Scores and
Inefficiencies in the Football Betting Market*

- **Predicts:** joint scoreline distribution → 1X2 by summation.
- **Needs:** results only.
- **Idea:** independent Poisson underestimates 0-0/1-0/0-1/1-1; a τ correction
  reweights the four low-score cells. Adds exponential time decay so recent
  matches dominate.
- **Strength:** minimal data, gives scorelines (which the season and tournament
  simulators need), and the draw correction is exactly where independent
  Poisson fails.
- **Weakness:** attack/defence parameters are static within a fit window.
- **Status here: the serving default, and re-validated in this pass.** Measured
  independently on the canonical layer at Brier .59580 over 44,185 Wave A
  matches, significantly ahead of Elo (Δ −.00524, 95% CI [−.00662, −.00395]).

### Karlis & Ntzoufras (2003) — bivariate Poisson

- Models the covariance between the two scores directly rather than patching
  the low-score cells.
- **Status here: tested, not adopted.** `bakeoff_goal_models.py` found all six
  penaltyblog families within .0017 Brier of one another and **every blend worse
  than Dixon-Coles alone** — errors too correlated for ensembling to help.
  Hubáček et al. report the same clustering: Bivariate Poisson, Double Poisson
  and Double Weibull all land at RPS 0.2103.

### Rue & Salvesen (2000); Koopman & Lit (2015) — dynamic / state-space strength

- Team strength as a latent process evolving between matches (Bayesian
  dynamic model; state-space with Kalman filtering).
- **Needs:** results only. **Cost:** MCMC or filtering per league.
- **Relevance: high, and untested here.** This is the principled version of
  "refit on a trailing window", which is what the DC baseline currently does
  every 30 days. It replaces a refit cadence with an actual model of drift, and
  it produces *uncertainty* on strength — which is what a tournament simulator
  should be propagating instead of a point estimate.
- **Verdict: test.** Highest-value untried model family.

### Groll et al. (2018) — sparse bivariate Poisson with boosted covariate
selection

- Boosting to select covariates inside the goal model rather than bolting a
  classifier alongside it.
- **Relevance:** it is the principled route to "use FBref columns", because it
  keeps the scoreline output the simulators need instead of trading it for a
  bare 1X2 vector. **Verdict: test after the layered ablation.**

---

## Rating systems

### Elo, and Hvattum & Arntzen (2010)

- Their finding — Elo beats simpler ratings but loses to market odds — is the
  shape every result in this repository has taken.
- **Margin-of-victory Elo is worse here.** Measured this pass: Δ +.00714 Brier
  against plain Elo, 95% CI [+.00621, +.00807], n=46,789. A significant
  *negative* result on a widely recommended enhancement. It also nearly doubles
  calibration error (ECE .0466 vs .0218) — the damped-MOV multiplier makes
  large updates on lopsided results and the ratings overshoot.

### Constantinou & Fenton — pi-ratings; *Dolores*

- Ratings learned from goal differences, separating home and away ability.
- **Status here: tested, parity.** `benchmark_pi_ratings.py`.
- But see below: pi-ratings are the *feature set* under the best published
  result, not a standalone forecaster.

### Berrar, Lopes & Dubitzky (2019) — feature engineering for the 2017 Soccer
Prediction Challenge

- Two feature families (recency-weighted rating features, and rating features
  derived from goal expectancy) fed to k-NN and XGBoost.
- **Published: best RPS 0.2101 in Hubáček et al.'s comparison** — ahead of
  Bivariate Poisson / Double Poisson / pi-ratings, all at 0.2103.
- **Relevance: direct.** The margin between the best rating system and the
  best goal model in the published record is *0.0002 RPS*. That is the single
  most important number in this review: it says the model family is not where
  the remaining signal is.

---

## Machine learning on tabular features

### Hubáček, Šourek & Železný (2019)

- Systematic comparison over the Soccer Prediction Challenge corpus.
- **CatBoost on pi-ratings features: RPS 0.1925** — the best figure in the
  comparison, ahead of every pure statistical model.
- **Interpretation that matters:** the win came from *gradient boosting applied
  to rating features*, not from replacing ratings with raw statistics. The
  ratings are the compression; the booster reads them.
- **Verdict: test.** This is the closest published analogue to what this repo's
  neural stack attempts, and it suggests the right architecture is
  ratings → booster, not 75 raw columns → net.

### Deep learning (arXiv 2309.14807 and the ML-for-soccer survey, arXiv 2403.07669)

- Deep approaches evaluated against feature-optimised gradient-boosted trees.
- **Consistent finding across the field: no reliable advantage for deep
  learning on this problem at this data scale.** Matches this repo's own
  result — the 75-feature neural stack sits .0028 behind Dixon-Coles with a
  bootstrap interval straddling zero.
- **Verdict: do not pursue.** Record the finding; spend the budget elsewhere.

---

## The market as benchmark

### Pinnacle closing odds

- Widely treated as the sharpest available probability.
- **This repo measures its own market corpus at Brier .5793 (ECE .0030) over
  37,981 fixtures** — better than anything else it has built.

### FiveThirtyEight SPI, evaluated against Pinnacle closing

- The most instructive external result found. SPI was **well calibrated** —
  60% calls landed near 60% over large samples — and betting it against
  Pinnacle closing returned **about −6%**, i.e. no predictive value *relative
  to the closing line*.
- **This is precisely what `benchmark_edge_buckets` found here**: every
  positive-edge bucket loses money, and loses more the more confident the model
  is (>5pp edge: home −6.2%, draw −4.7%, away −7.1%).
- **Consequence for this project:** a well-calibrated model that cannot beat
  the closing line is the *expected* outcome, not a failure. It also means
  "beat the market" is the wrong success criterion, and the user's reframe —
  measure forward predictive performance and calibration — is the right one.
- **Caveat this repo must keep stating:** our stored `odds_home` is the
  *pre-kickoff* price, not the closing price. `odds_close_*` exist as columns
  and nothing populates them.

### De-vigging

- Shin (1993) is implemented in `services/prediction/market.py` and
  cross-validated against penaltyblog. Basic normalisation overstates favourites;
  Shin accounts for insider trading and is the defensible default.

---

## Tournament simulation

- Monte Carlo over a match model, with tournament rules applied exactly, is the
  standard and uncontroversial approach; the modelling content is entirely in
  the match model and in how strength *uncertainty* is propagated.
- **The open question worth testing here** is whether propagating parameter
  uncertainty (drawing strengths from a posterior per simulation) changes the
  champion distribution materially versus using point estimates. Point-estimate
  simulation is known to be overconfident, and this repo's season simulator is
  measurably overconfident in exactly the 70–90% band (says 80%, happens 69.8%).
- Groll et al.'s Euro/World Cup work and the UEFA qualification-threshold paper
  (arXiv 2508.20075) are the closest published analogues to the group-stage
  probability problem.

---

## What this review changes

| decision | basis |
|---|---|
| Keep Dixon-Coles as the goal model | re-validated, significantly ahead of Elo |
| Do not pursue deep learning | field-wide null result + this repo's own |
| Do not add MOV to Elo | significant negative here (+.00714) |
| Test dynamic/state-space strength next | only untried family with a strong prior |
| Test boosting on *rating* features, not raw columns | Hubáček's 0.1925 came from exactly that |
| Stop treating "beat the closing line" as the goal | SPI was calibrated and still −6% |
| Propagate strength uncertainty into simulations | the 70–90% overconfidence is the symptom |

---

## Sources

- [Machine Learning for Soccer Match Result Prediction (survey)](https://arxiv.org/pdf/2403.07669)
- [Evaluating Soccer Match Prediction Models: A Deep Learning Approach and Feature Optimization for Gradient-Boosted Trees](https://arxiv.org/html/2309.14807)
- [A Bivariate Poisson Model for the UEFA European Football Championship](https://epub.ub.uni-muenchen.de/29028/1/TR_EM2016.pdf)
- [Generalised Joint Regression for Count Data with a Focus on Modelling Football Matches](https://arxiv.org/pdf/1908.00823)
- [Predicting Qualification Thresholds in UEFA's incomplete round-robin tournaments](https://arxiv.org/pdf/2508.20075)
- [Real-time forecasting within soccer matches through a Bayesian lens](https://arxiv.org/pdf/2303.12401)
- [Predicting Football Results With Statistical Modelling: Dixon-Coles and Time-Weighting](https://dashee87.github.io/football/python/predicting-football-results-with-statistical-modelling-dixon-coles-and-time-weighting/)
- [How Good Really Was FiveThirtyEight's Soccer Power Index?](https://www.transferscience.com/p/how-good-really-was-fivethirtyeights)
- [Pinnacle versus FiveThirtyEight: A comparison of predictive success](https://www.sportstradingnetwork.com/article/pinnacle-versus-fivethirtyeight-a-comparison-of-predictive-success/)
- [Bivariate Dixon and Coles Model in Football](https://www.emergentmind.com/topics/bivariate-dixon-and-coles-model)
