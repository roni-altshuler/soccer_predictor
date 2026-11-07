# Inspectable published match record

`/accuracy` reads `backend/data/evaluation/track_record.json` through
`/api/v1/tracking/record`. Its percentage is the exact number of correct picks
divided by eligible settled games, multiplied by 100. It is an observed
three-outcome result (home win, draw, away win), not a confidence score, a price
comparison, or a claim about future performance. Probability ties use H, D, A
order, as the existing evaluator does. Historical backtests stay separate.

## Selection and verification

The canonical rule is **last saved forecast strictly before the authoritative
real kickoff, across versions**. The exporter joins all snapshots to a unique
competition, season and home/away event before selecting the final forecast.
It parses timezone-aware instants, rather than comparing timestamp strings.
A snapshot's date can locate a candidate, but its synthetic noon, missing clock,
or malformed clock never proves the cutoff. The event kickoff supplies that
cutoff. A later invalid final snapshot is withheld rather than replaced by an
earlier snapshot with better evidence. Same-time conflicting final forecasts,
unknown forecast timestamps and ambiguous identities are withheld.

A scored event must have a unique numeric ESPN identity bound to the same
warehouse match and competition, valid original result-period evidence, integer
scores, and dated observations after kickoff and no later than the audit.
A provider alias is necessary but does not by itself prove a real kickoff or
finality. A normalized warehouse timestamp could have originated as a naive or
date-only value; only the original receipt can establish its clock and scope.
Shared provider IDs across multiple warehouse games are withheld.
The model version and normalized three-way probabilities must be valid; the
recorded training cutoff must precede both the forecast day and event day.
These checks are conservative: lacking evidence excludes a record even when the
prediction may in fact have been prospective.

## Match periods and stored score forecasts (schema 2)

The evaluation target is **90 minutes plus stoppage time**. It is not the
extra-time result, penalty shootout or knockout advancement. Each selected
snapshot must explicitly retain `outcome_period=regulation`; missing declarations
stay unknown. A phase or competition name never supplies the declaration.

Warehouse scores and normalized ISO timestamps alone are not result-period
proof. A source adapter must retain `regulation_receipt` with provider,
competition and event identity, original `observed_at`, original encoded `body`
and SHA-256 `digest`, and explicit invalidation/expiry validation for this exact
audit clock (`validated_at`). The consumer never fetches, renews or relabels a
receipt. Missing or stale validation, invalidation, expiry or digest failure
withholds the result.

The raw body must identify the same competition and exact provider event,
contain one competition with a valid originally aware kickoff matching both
event and competition timestamps, `timeValid=true`, two regulation periods,
completed/post `STATUS_FULL_TIME` at period 2 and the provider's 5400-second
regulation clock. Home/away sides must be distinct and scores must be actual
nonnegative integers, agreeing with the stored result. Extra-time/shootout
receipts and unsupported period-line-score fields remain unscored. No
regulation score is reconstructed from an extra-time total. Original receipt
observation time, not newer warehouse metadata, determines result freshness.

Existing warehouse/ledger inputs do not carry these declarations and receipts.
Their historical data is not upgraded by inference: rebuilding produces
unscored rows until trustworthy source metadata is available. No producer,
ledger schema, provider access or ingestion workflow is changed by this
consumer correction. A future receipt adapter still needs independent review;
passing synthetic contract tests does not establish a real positive cohort.
Schema-1 artifacts are rejected rather than displaying their old percentage.

`cohort=immutable_snapshot_history` explicitly names this ledger selection.
The separate `predictions_*.json` match-pick archive and legacy `live.json`
aggregate are not substituted or pooled. A CSV rebuild validates a private copy
of one input byte snapshot so optional declarations cannot come from a different
CSV revision than the forecast itself.

The selected snapshot's original `top_scoreline` is exported as `scoreForecast`,
with recorded/missing/invalid/ambiguous status, independently of outcome
eligibility. It is never recreated by rounding expected goals or taking an
earlier forecast. Equal-time score conflicts withhold only score assessment
when the outcome forecast is consistent. `scoreline_period` must separately be
declared regulation time before exact-score grading. Exact-score correct /
assessed counts use only eligible outcome records with a usable stored score
forecast for that same period. Missing, invalid, conflicting or unknown-period
score forecasts do not change the outcome denominator. Other records remain
unassessed, and an empty exact-score sample displays no percentage.

The interface leads with home/draw/away correctness. Scores and their separate
assessment are in optional advanced details. Verified lead hours are shown only
for eligible aware pre-event records; naive timestamps never acquire a guessed
timezone. Past outcome success does not guarantee an exact future score.

Only scored rows enter the percentage, chart or probability metrics. The other
statuses are pending, unverified, retrospective (known at/after kickoff) and
missing forecast. A verified actual result can still be displayed for an
ineligible forecast: excluding a pick from accuracy does not erase what happened.
Counts of unverified saved records and unmatched known games
are different units and are not added into a global football coverage rate.
The whole-record view includes undated records; date filters exclude them.
The artifact discloses the audit, latest forecast and result-observation times.
A recent rebuild does not make an older observation fresh.

## Calendar chart

The card, chart and scored history use the same filters. No default date cutoff
selects a favourable period. UTC day or Monday–Sunday week buckets add correct
and settled counts; weekly percentages are never averaged. Calendar spacing is
real, including empty weeks and year/season boundaries. Partial calendar periods
are labelled. Each point includes all eligible games in its period.

Recent form uses the last **20 settled games within the selected scope**, or all
available games until there are 20. Equal-time games use stable event ID order
for that window. Exact denominators, dates, recorded versions and period counts
are exposed through touch/keyboard controls and an equivalent data table.
Lines are linear, without smoothing or invented version-change markers. A dip
remains a dip; version metadata does not establish causality. Different sports
and forecast horizons are not directly comparable.

## Rebuilding without source writes

The normal `evaluate_live` path writes this independent artifact after its
legacy aggregate. The existing scheduled workflow already stages the evaluation
directory; no workflow or credentials are added here. If verification fails, the
last complete record is retained with its original audit date; the API does not
substitute the legacy aggregate. This change does not repair the older evaluator
or make its historical `n` trustworthy under the stricter cutoff.

For a read-only rebuild using an existing warehouse and complete exported history:

```sh
python -m backend.scripts.build_track_record \
  --database /path/to/warehouse.sqlite \
  --snapshots /path/to/prediction_snapshots.csv.gz \
  --output backend/data/evaluation/track_record.json
```

The builder opens SQLite with `mode=ro`, neither trains nor changes the source
ledger, and atomically replaces only a complete JSON export. Missing databases
are not created. The API rejects the entire export if any scored row fails its
independent timing/result/probability checks. Missing, unreadable and valid-empty
records are distinct states. Synthetic unit fixtures never enter browser evidence
or the generated record.

`npm run test:record` exercises the generated real-data export in a production
browser at 320, 390, 768 and 1440 pixels in both themes, including point taps,
keyboard inspection, every history page, scope filters, source errors, retry,
navigation/Back and accessibility. It requires a production build. `QA_CHROMIUM`
can explicitly select an installed browser for diagnostic coverage; that does
not certify a different, absent CI-pinned browser.

## Availability UI and positive-record certification

`npm run test:accuracy:ui` is the release contract for the current recorded-data
UI. It uses the actual exported artifact and route. When there are no eligible
settled rows it requires “Not yet scored”, zero correct/eligible counts, no
invented percentage or timeline points, coverage/freshness disclosures and
immediately inspectable unscored history. It verifies shared league/season/date
filters, stored picks and score forecasts without grading unsupported records,
source failure/retry, responsive layout, accessibility and navigation. Browser
availability faults may remove data; no synthetic scored cohort is substituted.

When the real artifact contains eligible settled rows, `test:accuracy:ui`
delegates to the unchanged `test:record` audit instead of substituting a zero
cohort or synthetic model data. The existing audit still requires genuine
eligible positive history before its chart/positive-certification journey can
run. Shipping truthful availability states does not certify that missing
positive journey or make any record eligible. Synthetic positive unit fixtures
test rendering and arithmetic only; they never enter the artifact or browser
evidence. Historical backtests and older aggregates remain separate.

Local QA may use the scripts' supported `QA_CHROMIUM` override for an already
installed browser. CI installs the Chromium selected by the locked Playwright
version and must pass on the exact PR commit before merge. Local system-browser
results do not certify that other runtime. No denied browser download is retried
to acquire a local pin. No CI assertion, timeout or data-eligibility rule is
relaxed for this availability release.
