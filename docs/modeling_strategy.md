# Modeling strategy

Written 2026-08-11, after the audit and the first walk-forward baseline. This
is the plan of record; deviations belong in
[`research_log.md`](research_log.md) with a reason.

## The question, stated so it can be answered

> Given only information genuinely available immediately before kickoff, what
> is the best-calibrated probability distribution we can estimate for the match
> outcome — and, given those, for a whole season and a whole tournament?

Two consequences follow immediately and constrain everything below.

**Calibration is the objective; accuracy is a diagnostic.** A season projection
is an integral over 38 match probabilities and a bracket is a product over four
or five. Both consume probabilities, not picks. A model that is 1pp more
accurate and 2pp overconfident makes the downstream products *worse*.

**"Beat the closing line" is the wrong target.** FiveThirtyEight's SPI was
well-calibrated and still returned about −6% against Pinnacle closing; this
repo's own `benchmark_edge_buckets` found every positive-edge bucket losing
money and losing *more* the more confident the model was. Being unable to beat
the market is the expected state of a good model, not a failure of one.

## Split protocol — frozen before anything is fitted

**Primary evaluation is match-by-match walk-forward**, implemented in
`baseline_walkforward.py`. Not season folds: a fold still lets a July-trained
model see a whole prior season at once. The harness predicts each match from
running state, then reveals the result, in played order.

**Same-day fixtures are predicted as a block before any of that day is
observed.** This is the rule that a naive "sort by date and loop" gets wrong,
and it is enforced in code and pinned by
`test_same_day_fixtures_cannot_see_each_other`.

**Final holdout: season 2026-27 onward.** Not inspected while feature
engineering. Every reported development number uses `--max-season 2025`.
The 2026-27 season is now underway, which makes it a genuine forward test
rather than a reserved slice of the past.

**Promotion gate:** paired bootstrap on Brier, resampling matches so both arms
always score the same fixtures. An interval that straddles zero is not a
result. Baselines are never deleted.

## Substrate

```
warehouse.sqlite ─┐
                  ├─→ canonical.duckdb + data/processed/matches/*.parquet
fbref.sqlite     ─┘
```

`build_canonical.py` produces **219,770 matches, 45 competitions, 1888–2026**,
rebuilt from scratch each run. It stores **facts only — no aggregates**. A
stored season-to-date column is the cheapest way to leak a May value into a
March prediction; the cheapest defence is not to have the column.

Entity resolution is by **fixture-graph alignment, not string similarity**:
within a competition-season both sources describe the same matches, so aligning
on (date, scoreline) proposes name pairs, and a mapping is accepted only when
it is mutual-best, clears 5 votes, and beats its runner-up 3×. 395 accepted,
**22,491 proposed and refused**. All five Wave A leagues now link 100%.

## Measured baseline (this is what anything new must beat)

Walk-forward, Wave A, 2000–2026, 46,789 matches:

| model | log loss | Brier | accuracy | ECE |
|---|---|---|---|---|
| uniform | 1.09861 | .66667 | 45.6% | .0000 |
| base rate (per competition) | 1.06601 | .64395 | 45.6% | .0098 |
| Elo | 1.01504 | .60226 | 51.5% | .0218 |
| Elo + margin of victory | 1.02867 | .60940 | 51.2% | .0466 |
| **Dixon-Coles** | **0.99823** | **.59580** | 51.6% | **.0102** |

All 45 competitions, 1990–2026, 180,058 matches: Elo .60846, MOV .61244.

**Two findings, both significant.** Dixon-Coles beats Elo by .00524 Brier
(95% CI [−.00662, −.00395]) — an independent re-validation of the serving
default. And **margin-of-victory Elo is significantly worse than plain Elo** on
both corpora (+.00714 and +.00398), while nearly doubling calibration error.
MOV is widely recommended; it does not survive measurement here.

## The layered experiment — the one that decides everything else

Each layer added to the one above, same protocol, paired bootstrap at every
step. The point is the *increments*, not the final number.

| layer | status |
|---|---|
| A results only (base rate) | **done** — .64395 |
| B + Elo | **done** — .60226 |
| C + goal model (Dixon-Coles) | **done** — .59580 |
| D + FBref referee | ready — 0% → 67–100% coverage in four new leagues |
| E + FBref venue / attendance / kickoff time | ready |
| F + rolling form on the expanded corpus | next to build |
| G + xG | **blocked** — needs the match tier, ~29h for Wave A 2017+ |
| H + player / squad strength | blocked on the same tier |
| I + market odds | available, but cannot serve — record separately |

Layers G and H are gated on whether D–F pay. If ratings plus form plus referee
land where the literature says they will (RPS ≈ 0.21), 29 hours of scraping for
xG is justified; if not, it is not.

## Model families, in the order they will be tried

1. **Dynamic / state-space strength** (Rue & Salvesen; Koopman & Lit). The only
   untried family with a strong prior. It replaces the DC refit cadence with an
   actual model of drift *and* yields strength uncertainty — which is what the
   tournament simulator should propagate instead of point estimates.
2. **Gradient boosting on rating features** (Hubáček's CatBoost/pi-ratings at
   RPS 0.1925). Note *rating* features, not 75 raw columns — that distinction
   is the result.
3. **Boosted sparse bivariate Poisson** (Groll et al.) if FBref columns earn
   their place, because it keeps the scoreline output the simulators need.

Explicitly **not** pursuing deep learning: field-wide null result, and this
repo's own 75-feature net sits behind Dixon-Coles with an interval straddling
zero.

## Downstream heads

Season title and relegation are Monte Carlo integrals over the match head, and
knockout progression is a product over it. They need no separate model — they
need the match head to be calibrated, and they need **uncertainty propagated**.
The season simulator's known overconfidence in the 70–90% band (says 80%,
happens 69.8%) is the visible symptom of simulating from point estimates, and
is the first thing item 1 above should fix.

## What would falsify this plan

If layers D–F produce no significant improvement over Dixon-Coles, then the
data layer is not the bottleneck either, and the honest conclusion is that this
corpus supports Brier ≈ .59 on 1X2 and the remaining work belongs entirely in
calibration and in the tournament/season heads. That is a publishable answer
and it will be recorded as one rather than worked around.
