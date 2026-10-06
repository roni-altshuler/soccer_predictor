# Evaluating season-serving adaptation

The season engine already adapts. This change makes a bounded, reproducible
comparison possible; it does not establish that adaptation improves real-world
forecasting accuracy or authorize a model promotion.

## What already changes during a season

[`forecast_season.py`](../backend/scripts/forecast_season.py) rebuilds Elo and
rolling form from played results, fits the same `C=0.5` logistic head on
`elo_*`/`form_*`, and freezes that state while forecasting remaining fixtures.
It reconciles the head's 1X2 probabilities into the existing scoreline model.
The season simulator receives known points, goal difference and goals scored;
played matches leave the remaining schedule. Team strength uncertainty is
drawn once per club per simulation, as before.

Elo has no season-boundary regression in this serving configuration, and rolling
form carries across seasons. Standings restart for each league-season. This
change extracts the existing day-blocked feature walk into `replay_features`
and uses it in serving and evaluation. It changes no model settings, fixture
selection, fit policy, league scope or publication workflow.

The legacy [`train_feedback.py`](../backend/scripts/train_feedback.py) loop is
separate: its neural `partial_fit` calls repeatedly consume the latest 80 league
and 240 global samples. This evaluation does not validate or change that loop.
The [earlier recency challenger](FORECAST_LAB_AND_MODEL_SAFETY.md#recency-weighting-tested-and-held-back)
worsened paired Brier/log loss and remains held back.

## Why an observation journal is a prerequisite

The saved environment has aggregate reports and published prediction JSON but
no local `warehouse.sqlite` or `canonical.duckdb`. A final result table alone
also cannot establish when each schedule, result or correction was known.
The [existing provider audit](data/openfootball-audit-2026-10-05.json) records
October observations with European result frontiers at **September 20, 2026**.
It does not supply preseason schedule observations or historical result receipt
times. Downloading another current snapshot would not fill that gap.

Consequently the first measured run here uses explicitly fictional contract
input. The smallest useful prerequisite implemented is an offline evaluator
with explicit schedule knowledge and result-revision timestamps. It performs
no source ingestion, database writes, model export or training promotion. A
verified archived journal and reviewed club/fixture identity mapping remain
necessary before measuring real adaptation. Never backdate a current snapshot's
`observed_at` to its fixture date.

## Paired protocol

[`evaluate_season_adaptation.py`](../backend/scripts/evaluate_season_adaptation.py)
uses the production feature replay, `fit_head`, `reconcile`, `score_matrix` and
`simulate_season`. Existing season scoring/table helpers supply metrics and
standings; the older `backtest_season_projections` simulator is not used.

At each declared midnight UTC forecast cut:

1. Select only results with both match date and observation time strictly before
   the cut. Exclude the entire cut's fixture date. Canonicalize exact identities
   and choose the latest visible correction per fixture; rebuild state and
   training arrays once per unique result, in deterministic date blocks.
2. Fit the production head through those visible results. Training rows are
   reconstructed using the results/corrections available at this fit cut, as
   serving rebuilds them; they are not archived historical training features.
3. Emit adaptive Elo/form and Elo/form frozen at that season's preseason cut.
   Both arms share this cut's head, imputer/scaler and competition goal scale.
   This isolates strength-feature updates; it does not isolate head refitting
   or represent a fully frozen preseason forecasting pipeline.
4. Use identical known standings and remaining fixtures for both arms, removing
   the same unique played matches. All future fixtures use the cut's frozen
   state; simulated future results never update features.
5. Reconcile probabilities with the publisher's existing coherence guard. Run
   both arms with identical seeds, simulation counts and strength uncertainty.
   Failures refuse the comparison instead of scoring one arm on a smaller set.
6. Score both against the same final truth visible at the separate score cut.
   That truth never enters forecast features or fitting. Report each horizon,
   its training/played/remaining counts, known standings and paired probabilities.

Duplicate records and alternative provider IDs for the same exact fixture do
not multiply its effect. Simultaneous contradictory scores, changed identities
or dates, unresolved past fixtures, partial final truth and unknown observation
times fail closed. Results are never deduplicated by fuzzy club similarity.

## Input and bounds

The JSON schema identifier is `season-adaptation-journal/v1`. The
[fixture generator](../backend/tests/fixtures/make_season_adaptation_journal.py)
provides a complete example. Required fields:

| Field | Meaning |
| --- | --- |
| `basis`, `source_notes` | `synthetic_fixture` or `archived_observations`, with evidence notes; the tool does not verify those assertions |
| `fixtures` | Stable `fixture_id`, `competition_id`, integer `season`, `local_date`, distinct competition-scoped `home_key`/`away_key`, schedule `known_at` |
| `observations` | `fixture_id`, `observed_at`, explicit final nonnegative integer `home_score`/`away_score`; corrections retain earlier observations |
| `evaluations` | Unique league-seasons, each with `preseason_as_of` and unique `cuts` beginning at preseason |
| `score_as_of` | Separate horizon after every forecast cut, with complete final season results visible |

All timestamps require explicit UTC; horizon times must be midnight. Match dates
must use a consistent calendar convention. This conservative day protocol does
not evaluate intraday availability or repair missing timezone metadata.
Only unchanged complete double round-robin schedules, with every fixture known
strictly before preseason, are supported. Grouped leagues, reschedules and
cancellations require a separately reviewed extension. Unknown promoted clubs
retain serving's default Elo and missing form before the head's existing imputer.

Limits are 2 MB JSON, 3,000 input fixture rows, 12,000 result observations,
12 forecast cuts and 100–5,000 simulations per arm/cut (default 1,000). Each fit
requires at least 30 earlier unique results covering H/D/A. These are execution
bounds, not a statistical adequacy test. CLI output must be outside production
`backend/data` and cannot overwrite the input. Validation failure retains an
existing report. The report hashes the parsed input using sorted-key JSON,
records Python/NumPy/SciPy/scikit-learn versions, and has no wall-clock timestamp.

## Reproduce the contract run

```bash
python backend/tests/fixtures/make_season_adaptation_journal.py /tmp/season-journal.json
python -m backend.scripts.evaluate_season_adaptation \
  --input /tmp/season-journal.json --output /tmp/season-adaptation.json \
  --sims 1000 --seed 17
python -m pytest backend/tests/test_season_adaptation_evaluation.py -q
```

The fixture has six fictional clubs, 300 warmup results and two evaluated
30-match seasons. Outcomes are seeded with NumPy RNG 42 and deliberately contain
H/D/A. A shorter initial warmup failed the serving coherence guard; the larger
fixture exercises the full guarded path. Its artificial outcome generation is
not a model or source of football evidence.

The [committed summary](data/season-adaptation-demo-summary.json) records input
hash `79e1ee2a3a0a0cf248ece535df970dc6f6c7afa0c61310caf93595a85a10b344`;
Python 3.12.14, NumPy 2.5.3, SciPy 1.18.1, scikit-learn 1.9.1. Repeat runs in
this environment produced identical JSON. Other numerical-library versions
can change fitted probabilities or solver/simulation output.

| Synthetic surface | Adaptive | Frozen preseason strength | Sample |
| --- | ---: | ---: | --- |
| Match multiclass Brier | 0.705469 | 0.699215 | 138 forecast rows, 60 unique fixtures |
| Match log loss | 1.161672 | 1.154535 | Same paired rows |
| Match ECE | 0.085952 | 0.079978 | 414 match-outcome calibration entries |
| Title Brier, mean over clubs | 0.114869 | 0.113237 | Six horizons, two seasons |
| Title log loss | 1.238829 | 1.194193 | Same season outcomes, epsilon 1e-6 |
| Title ECE | 0.090444 | 0.173889 | 36 club-horizon calibration entries |

Adaptive minus frozen is **+0.006254 Brier / +0.007136 log loss** on matches and
**+0.001632 Brier / +0.044637 log loss** on titles. Adaptive probability scores
are worse on this contract fixture. Lower title ECE on this tiny sample does
not override those scores or establish calibration quality.

Forecast rows repeat fixtures at different horizons; title forecasts repeat the
same season outcomes. None are independent sample counts. Bin counts and
stated/observed rates are printed in the JSON; no significance interval or
promotion decision is produced. Title simulation has finite Monte Carlo error
and uses serving's points/GD/GF/stable-key ordering, not every league's official
head-to-head or playoff rules. Relegation/top-cut quality, real-world adaptation
gains, current-season completeness and live publication remain unverified.
