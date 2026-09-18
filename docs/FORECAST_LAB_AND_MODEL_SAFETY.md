# Forecast Lab and model reliability — 18 September 2026

Implemented on `codex/matchday-experience`, based on `cd2f42c`. A fresh remote
fetch found no newer main commit during this implementation. These changes have
not been deployed or used to publish a new production model.

## The fan experience

`/lab` is a new destination for exploring the next 28 days of recorded forecasts.
It is linked from Matchday, the desktop sidebar, and the mobile navigation. It
provides club search, competition filters, persistent club following, shareable
fixture URLs, outcome probabilities, scoreline probabilities including the
unlisted probability mass, and interactive match-level points scenarios.

The selected forecast takes priority on phones; the match picker expands on
demand. Selecting home/draw/away changes the hypothetical points calculation,
not the model's probabilities. Season-race links lead into the existing league
experience. “Any matchup” remains accessible from the lab and desktop navigation.

The page and refresh API read the same validated `season_fixtures.json` artifact.
They do not require live ESPN requests or a working Python prediction server.
Malformed records are withheld; a missing artifact returns an explicit unavailable
state. A failed refresh retains the last loaded forecasts. Old forecasts receive
a freshness notice. Shared fixtures outside the default window are included if
still upcoming. Completed/missing shared fixtures receive an explanatory message.

The interface identifies the model and training cutoff, and explains that it does
not incorporate confirmed lineups, injuries or live events. Kickoff times are not
converted into user-local time while their source timezone remains ambiguous.

Native font stacks replace the build-time Google Fonts dependency. The browser
verification exposed ~40 seconds of font-download retries before fallback. This
change eliminates that dependency without adding another external service.

## Model changes and their evidence

### Recency weighting: tested and held back

`backend/scripts/experiment_recency.py` compares the production-style Elo + form
logistic head with a recency-weighted challenger. The predeclared half-lives are
one, three and six years, plus an unweighted option. For each outer calendar year
2019–2025, the preceding year chooses the half-life; the earlier history trains
that selection model. The chosen setting is refitted using only results before
the outer test year. Features retain day-block predict-before-observe ordering.
Calendar boundaries also avoid overlapping seasons across leagues.

The latest release downloads and PyPI requests failed with TLS/read timeouts.
The completed run therefore uses the existing SQLite warehouse explicitly,
not the missing canonical corpus. It is tagged `warehouse_only` and cannot be
production-eligible, even if its statistical gate passes. The report records the
input SHA-256, package versions, folds, selection scores and per-league results.

| Paired held-out sample: 12,440 big-five matches | Incumbent | Recency challenger |
| --- | ---: | ---: |
| Multiclass Brier (lower is better) | 0.590053 | 0.590204 |
| Log loss (lower is better) | 0.990864 | 0.990925 |
| Accuracy | 52.596% | 52.637% |

The Brier delta is **+0.000151**, with a paired calendar-week bootstrap 95%
interval of **[-0.000368, +0.000680]**, over 265 week clusters and 2,000 draws.
The challenger does **not** pass. The tiny accuracy increase is insufficient
evidence to ship a model whose probability scores got worse. Production weights
and season forecasts remain unchanged.

This is an exploratory comparison on a smaller, older warehouse, not a new
measurement of the published canonical model's accuracy. The experiment can be
rerun against a restored canonical database without `--warehouse-only`.

The existing match bootstrap now processes bounded batches instead of allocating
the full draws-by-matches index matrix. Its default RNG sequence and numerical
results are preserved. The new experiment uses calendar-week clusters instead
of treating every match as independent. Block-length sensitivity remains future
work.

### Training safeguards

- Backup failures stop training before incumbent artifacts are overwritten.
- Rejected first-time models move outside the loader's model directory.
- A failed restore never reinstates the rejected candidate; recovery snapshots
  remain available, and another training attempt cannot overwrite them.
- A candidate manifest includes models without previous artifacts, so exception
  recovery can withdraw those models too.
- Missing, non-finite or failed evaluations hold candidates back. Training cannot
  bypass evaluation or rollback through the old escape-hatch flags.
- The global model is held when no global evaluation exists. Its routing policy
  is restored with its weights, including on abort recovery.
- The weekly job no longer requests an unscored global retrain; it focuses its
  compute on the league heads the gate can assess.
- Held-back candidates without a baseline do not seed their own passing reference.
  Initial baseline collection is an explicit `--eval-only` operation.

These safeguards improve the existing orchestrator; they do **not** turn its
historical backtest into a hash-bound evaluation of a newly trained artifact.
Training still writes candidate weights in place before the gate. Isolated
candidate directories and an atomic, hash-bound champion manifest remain the
next architectural step, especially before running this job beside a model server.

### Forecast history and evaluation

The scheduled forecast now requires its published history download to succeed.
Before export replaces a file, every previous snapshot must survive unchanged
under its immutable key. A versioned release backup is uploaded before the
latest asset is replaced, and history publication precedes the forecast commit.
A failed rebase now stops publication instead of being ignored.

Live evaluation now additionally computes raw-row cohorts for the historical
league scope, currently served leagues, and currently served model version.
It does not average rounded league metrics. Existing aggregate fields remain
compatible. No new live scores were fabricated from the missing release history;
these cohorts will populate on the next successful evaluation run.

Versioned release assets and quarantined model directories require a deliberate
retention policy. Recovery material is not deleted automatically in this change.

## Reproduction and verification

```bash
# Full canonical experiment after restoring matching release inputs:
.venv/bin/python -m backend.scripts.experiment_recency \
  --database backend/data/canonical.duckdb --output reports/baselines/recency.json

# Explicitly exploratory local-warehouse experiment:
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 .venv/bin/python \
  -m backend.scripts.experiment_recency --database backend/data/warehouse.sqlite \
  --warehouse-only --output reports/baselines/recency_warehouse_exploratory.json

npm test -- --runInBand
npm run build
# Against a running Next server; default URL is http://127.0.0.1:3001
node scripts/forecast_lab_audit.mjs
```

The browser script checks real API records against the committed artifact,
fixture URLs, clipboard sharing, persisted following, search recovery, points
scenarios, refresh, four viewport widths, and main-content WCAG A/AA rules.
Only the explicit refresh-failure test injects a failed response.

Validation in this session: all 50 frontend suites (630 tests) passed. The
focused backend run passed 56 tests; the final 15-test promotion-safety run
also passed, including the subsequently added recovery-preservation case.
Production webpack compilation succeeded with the final frontend code. Full
packaging did not finish under concurrent workspace build load, and the final
browser rerun remained incomplete. Earlier real-data browser checks exercised
phone layouts, sharing, following, search and scenarios, but do not constitute
a completed four-width check of the final revision. The isolated preview also
encountered route-discovery/cache problems. These outstanding checks should be
rerun before deployment; no deployment or remote publication was performed.

Next model priorities are timestamped odds benchmarks at the actual forecast
horizon, stable fixture identities through postponements, lineup availability
snapshots, and partially pooled promoted-team priors. Each needs point-in-time
data and paired temporal evidence before it changes the served forecast.

Method references: [rolling-origin evaluation](https://otexts.com/fpp3/tscv.html),
[scikit-learn sample-weight support](https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.LogisticRegression.html),
and [probability calibration](https://scikit-learn.org/stable/modules/calibration.html).
