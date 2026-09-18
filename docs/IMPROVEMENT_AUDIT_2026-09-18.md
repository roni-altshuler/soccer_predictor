# Prediction accuracy and the matchday experience

**Follow-up implementation:** [Forecast Lab, model safeguards and the measured
recency experiment](FORECAST_LAB_AND_MODEL_SAFETY.md). The findings below describe
the inspected baseline; several of the listed gaps are now addressed there.

Reviewed 18 September 2026 against `cd2f42c` on `main`, after fetching all remote
branches and fast-forwarding 44 commits from `60e9e1c`. Implementation branch:
`codex/matchday-experience`. No model was retrained or promoted in this review.

## What the evidence actually says

The repo has unusually useful foundations: day-blocked features, expanding-window
backtests, immutable season snapshots, measured simple baselines, coherent 1X2 and
scoreline probabilities, and correlated strength uncertainty in season simulation.
Preserve those. Another neural architecture is not the first priority.

The current artifacts disagree with several old README/CLAUDE statements. In
`backend/data/evaluation/live.json` (generated 2026-09-17):

| Scope | Matches | Brier (lower is better) | Accuracy |
| --- | ---: | ---: | ---: |
| Live season snapshots, all 15 recorded leagues | 706 | 0.63083 | 44.19% |
| Live big five only, reconstructed from per-league aggregates | 191 | approximately 0.59256 | approximately 49.21% |
| Historical big-five walk-forward | 43,433 | 0.59303 | 51.79% |

The second row is a sample-weighted calculation from rounded per-league metrics,
not a new backtest. The first and third rows cover different competitions, periods
and versions. Their gap does **not** establish regression. Even the matched-league
rows are different time samples, with only 191 live fixtures. These are season-model
results, not the record of every match-pick surface. The README's zero-live-sample
claim and fourteen-served-leagues description are stale: `forecast_season.LEAGUES`
currently serves the big five and MLS.

`market_blend.json` measured 17,933 paired historical fixtures: price alone Brier
0.57279, ratings alone 0.58575, ratings plus price 0.57433. Adding features to the
price made it worse by 0.00154 (reported interval 0.00085 to 0.00222). This older
experiment is evidence against indiscriminate feature blending, not a verified
ceiling for future accuracy. A 54% market hit rate is not a mathematical upper bound.

## Priority 0: ensure the claimed model is the model being measured

### 1. Make promotion genuinely fail closed

Evidence: `backend/scripts/continuous_training.py:restore_production_model` returns
`no_prior_artifact` before touching the candidate when no snapshot directory exists.
`enforce_promotion_gate` records that result separately from rollback failure. The
2026-09-13 `last_training_run.json` reports `gate_enforced`, two held-back leagues
(`esp.1`, `ita.1`), **zero restored models**, and both in `no_prior_artifact`.

This does not prove the website served those rejected neural artifacts: the default
statistical path may protect it. It does prove that “held back” alone is insufficient
evidence that a rejected candidate was removed from a serving artifact directory.

Next change: train in a candidate directory, evaluate the candidate hash, then
atomically update an explicit champion manifest only after a passing gate. A failed
first candidate should remain quarantined with the existing statistical fallback;
it must not become champion merely because there is nothing to restore. Test both
first-training and missing-release-download cases. Export only champion artifacts.

### 2. Bind evaluation to the forecast source, version and horizon

Evidence: `/api/todays_matches` reads monthly `predictions_YYYY-MM.json` records
(the current records inspected include `dixon_coles_v1`). `/season` uses
`season_fixtures.json`, whose head is multinomial logistic on Elo and rolling form.
The homepage previously put `/api/v1/evaluation` below monthly picks even though
that endpoint scores season `prediction_snapshots`.

Implemented here: explicitly label that panel as the season forecast record and
link to the match-pick accuracy record. Missing evidence now stays unavailable;
it is not described as a measured zero. This is a presentation correction, not a
unification of the two forecasting systems.

Next change: define a shared forecast envelope containing canonical fixture ID,
source, model/artifact hash, generated-at, trained-through, kickoff, horizon,
probability order and feature availability. Every displayed probability should map
to an immutable record in that source's evaluation cohort. Keep retrospective,
prospective, in-play, 24-hour and lineup-confirmed evaluations separate.

### 3. Preserve a recoverable publication history

Evidence: `.github/workflows/season_forecast.yml` treats *any* failed history
download as “no published history yet”, imports with `--allow-missing`, and later
uploads a new snapshot export with `--clobber`. A transient download failure is
therefore indistinguishable from a legitimate first run and risks replacing the
published history with a shorter record.

Next change: distinguish an absent first artifact from auth/network/service errors;
require monotonic row counts and fixture coverage; retain versioned exports before
updating the latest pointer. Test an interrupted release download explicitly.

## Priority 1: make comparisons harder to fool

- **Evaluate the currently served leagues and each version separately.** Preserve
  the full historical record but add explicit current-scope cohorts. Include per-
  outcome draw recall, multiclass log loss/Brier, classwise reliability, match counts,
  and coverage. Do not optimize accuracy by suppressing draws.
- **Add timestamp-aligned market rows to prospective season evaluation.** The live
  artifact currently includes uniform and an in-sample base rate; it does not include
  a paired market score. Join odds captured no later than the forecast horizon,
  remove the margin consistently, and show missing-price coverage. Closing prices
  belong in a separate final benchmark, never in a 24-hour feature set.
- **Use blocked uncertainty estimates and an untouched final period.**
  `baseline_walkforward.paired_bootstrap` independently resamples matches and
  allocates an `n_bootstrap × n_matches` index matrix. Preserve fixture pairing but
  resample calendar/matchweek blocks (sensitivity-check several lengths) to account
  for shared form and league shocks. Chunk replicates to reduce peak memory. Select
  features/hyperparameters only inside earlier temporal folds; repeated challenger
  selection on one test history can overfit the evaluation itself.
- **Expand availability auditing.** A historical match date is not proof that a
  lineup, revised xG value, injury report or market price was available then. Store
  observation timestamps, canonical team IDs, and source revision times. Rehearse
  postponed fixtures and cross-day kickoff corrections: the snapshot UID currently
  includes calendar date and team strings, so those changes can fork a fixture.

## Priority 2: experiments worth running after those controls

These are hypotheses to test, not claimed improvements. Keep the current champion
until paired unseen-fixture results justify a change.

| Experiment | Repository reason | Measurement and acceptance |
| --- | --- | --- |
| Recency-weighted logistic head; bounded history windows | `fit_head` uses unweighted historical rows, by default back to 2000. Football's scoring environment and home advantage change. | Nested rolling seasons; compare several predeclared decay settings against the exact current head, plus DC and market. Require a negative paired loss interval and no material league regression. |
| Hierarchical league/season effects and promoted-team priors | Unknown clubs start at a base Elo; cold starts and cross-league pooling deserve their own cohort. | Partial pooling with second-tier information only when present, otherwise an explicit uncertain prior. Report promoted teams and first five matchdays separately; test season-title calibration too. |
| Opponent-adjusted non-penalty xG and shot-quality trends | The serving head keeps only `elo_` and `form_`; richer data elsewhere in the repo do not automatically reach this model. | Audit coverage and timestamps first. Compare paired covered fixtures and an explicit missing-data path. Fit provider offsets only on training data; missing xG is not zero xG. |
| Availability-aware player contributions at distinct horizons | Existing starting-XI ablation: delta Brier −0.00095, interval [−0.00219, +0.00029], 11,948 fixtures; no established improvement. | Test a materially different availability/contribution model, not the same feature block renamed. Separate expected-XI uncertainty at 24h from confirmed XI near kickoff. Enforce acquisition-time cutoffs. |
| Out-of-fold calibrated ensemble | Multiple model families already converge closely; naive price blending lost to price alone. | Learn constrained weights from temporal out-of-fold predictions only. Compare with the best single model and price alone. Calibration uses a disjoint earlier window; report classwise reliability as well as proper scores. |
| Joint score distribution and season dynamics | Matching the goal grid to 1X2 ensures consistency but does not prove exact-score accuracy. Future fixtures use a frozen team state. | Score goal distribution log loss, tails and draw frequency separately. Backtest dynamic team-strength drift versus existing fixed per-season offsets, including run-in/title/relegation reliability. |

Pre-register a practical improvement threshold and a compute budget, publish all
attempts, and retain the paired prediction rows so results can be reproduced.
A larger GPU model, an LLM's football narrative, or more Monte Carlo draws does not
by itself provide better pre-match information. LLMs are more plausible for extracting
structured, timestamped reports or explaining verified factors, with predictions
still produced and evaluated by the numerical forecasting pipeline.

Computational priorities: persist feature-state checkpoints and update only new
results; keep full deterministic rebuilds as a parity check. Batch per-fixture heads,
cache immutable source/artifact reads, vectorize repeated simulation work where
profiling identifies a bottleneck, and use common random seeds when comparing
simulation variants. Avoid optimizing code before measuring its runtime and memory.

## The frontend change delivered in this branch

The matchday now has an interactive match spotlight with actual scores, explicit
pre-match probability labels, venue, and a link to the selected match. A local club
follow panel updates the feed immediately, including across tabs; on narrow screens
it collapses to keep the fixtures close to the top. Competition chips and all/live/
to-play/finished controls let a fan narrow the slate without leaving it. Links from
the matchday lead into league races and tournament brackets.

Refreshes keep the current scores visible. Date/gender changes clear the old scope
immediately, cancel obsolete requests and ignore late responses. Hidden tabs stop
minute polling, and resume on return. Timeouts and provider-wide outages have a
retry state instead of pretending no football is scheduled. Invalid probability
triples are omitted at the API and row/spotlight boundaries. Unknown live scores
stay unknown instead of becoming 0–0. The competition link is no longer nested
inside the expand/collapse button, and collapse respects reduced-motion preference.

The pitch palette, existing real club/league marks, compact match rows, and the
reader's ambient controls remain the visual foundation. No new UI dependency or
invented match data was added.

## Next product work, measured rather than assumed

1. **Persistent fan identity:** choose clubs across the entire supported directory,
   not only today's spotlight; sync signed-in preferences while retaining guest use.
   Resolve watchlists to canonical IDs instead of name substrings.
2. **A useful next click:** connect match results to changes in title/top-four/
   relegation probabilities, backed by the existing projection history. Clearly
   distinguish a hypothetical “what if” from the published forecast.
3. **Prediction participation:** a personal, timestamped pick history, locked at
   kickoff, scored against actual results and the model on the same matches. Avoid
   invented community polls or unearned model-confidence badges.
4. **Continuity on mobile:** preserve selected league/date and scroll position on
   return from match detail; provide shareable matchday filters. Keep following and
   match links keyboard accessible, with large touch targets.
5. **Measure usefulness:** opt-in/privacy-appropriate events for fixture-to-detail,
   follow activation, returning followed-club visits, and detail-to-race navigation.
   Pair these with loading/error rates and mobile INP/LCP/CLS. Longer sessions alone
   can mean users are lost. This redesign has not yet demonstrated retention lift.

Remaining feed limitation: a partial ESPN outage can still produce an incomplete
slate without naming the missing competitions. Add per-competition coverage flags,
retain known rows safely, and avoid labeling them live without a freshness contract.

## Verification and boundaries

- Full frontend Jest suite: 49 suites, 626 tests passed after the final changes.
- Backend forecast evaluation, provenance and canonical leakage checks: 70 passed,
  one skipped; existing Pydantic deprecation warnings remain.
- Production build, typecheck and lint passed; lint has pre-existing warnings
  elsewhere in the repository.
- `scripts/matchday_audit.mjs` exercises spotlight selection, following, competition
  filtering, date switching, narrow-screen overflow, and axe WCAG checks. It replays
  committed 2026-09-19 records in the browser only. Monthly records do not contain
  kickoff times, so replay screenshots correctly show “Time TBC”.
- Browser interactions passed in both development and the production build at
  320, 390, 768 and 1440px with no page errors,
  horizontal overflow or axe WCAG A/AA violations in the main content. This also
  caught and fixed the narrow mobile header and a reduced-motion hydration mismatch
  in the shared route transition. Date initialization now respects the client's
  timezone without diverging from the initial server-rendered markup.
- The local `canonical.duckdb` is absent and `warehouse.sqlite` predates the recent
  corpus repairs. No new accuracy claim, training result, or champion promotion is
  inferred from that stale local warehouse. Fresh full-model experiments require
  the matching release inputs and a reproducible manifest.
- Changes are local and reviewable; no production deployment has been performed.

## Technical references

Proper scores assess more than calibration alone; reliability plots and coverage
should accompany Brier/log loss: [scikit-learn probability calibration](https://scikit-learn.org/stable/modules/calibration.html).
Temporal evaluation must train before its test period: [scikit-learn time-series splits](https://scikit-learn.org/stable/modules/cross_validation.html#time-series-split).
Shot-quality values depend on the provider's features and model, motivating source
and revision controls: [StatsBomb on upgrading expected goals](https://blogarchive.statsbomb.com/articles/soccer/upgrading-expected-goals/).
