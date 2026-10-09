# Event Backfill reliability — 9 October 2026

The daily ingest failed before event backfill because it requested two full
seasons across broad sources. The existing collector correctly refused a
365-request daily fallback against its 93-attempt cap. This change routes that
one workflow to the already tested, resumable current-season path for the big
five plus MLS; it introduces no collector or forecasting model.

## Observed boundary

- [Event Backfill run 37803606256](https://github.com/roni-altshuler/soccer_predictor/actions/runs/37803606256)
  failed on `eng.1/2025`: daily fallback needed 365 requests, budget 93.
  Downstream backfill, regeneration and publication were skipped.
- [Season Forecast run 37795361031](https://github.com/roni-altshuler/soccer_predictor/actions/runs/37795361031)
  completed the existing six-league result refresh using eight HTTP attempts.
  It validated 50/69/36/50/45/406 final events for
  `eng.1/esp.1/ger.1/ita.1/fra.1/usa.1`. Its optional FBref schedule refresh
  failed because ScraperFC was missing; successful result refresh does not
  certify schedule refresh.
- [Prediction Pipeline run 37871220809](https://github.com/roni-altshuler/soccer_predictor/actions/runs/37871220809)
  also completed the five-league result refresh using eight HTTP attempts.

The September 20 European result frontier remains a coverage limitation.
The season artifact's global `trained_through: 2026-10-07` includes MLS and
cannot be attributed to every European competition. Injury responses lacking
required content remain blocking in their separate pipeline. No provider
restriction is bypassed by this change.

## What changes

`event_backfill.yml` restores validated date receipts before
`--espn --current-season --resume-current --competitions
eng.1,esp.1,ger.1,ita.1,fra.1,usa.1`, and saves progress even after a failed
refresh. Its own cache prefix can fall back to the forecast prefix, which
covers the same six leagues. Every reused receipt is validated again and
keeps its original observation time. Each league computes its season label.

All required past calendar dates in the selected scope must be validated
before atomic warehouse publication. The 93-attempt cap includes discovery
and retries. Incomplete coverage remains a nonzero exit, with artifact builders,
event backfill and release publication skipped. Existing event-corpus restore,
identity repair, deduplication and coverage regression gates remain in place.
Older seasons, women and other competitions remain retained; this routine
does not claim to refresh them. Cold caches may need multiple failed capped
runs before the selected scope is complete. Eviction, cancellation and stale
old receipts remain limitations described in [warehouse ingestion](WAREHOUSE_INGESTION.md).

Evaluation's three artifact routes now distinguish absent files (HTTP 200,
`available: false`) from read/parse errors (503). The page distinguishes those
failures from a valid empty response, names unreadable sections, and offers
retry. Successful sections remain available; a failed retry retains previous
responses with their existing dates. The page does not invent zero samples
from a failed read. This is session retention, not a new persistent archive.

## Existing artifact observations

These are read-only observations at source commit
`07b5f694a342192ab0fe44ab07f1d59da63182c1`, not regenerated metrics or evidence
that this patch improves forecasting:

[Source hashes and cohort metadata](reviews/2026-10-09-data-reliability/artifact-audit.json)
pin these observations to the already committed files.

| Artifact / cohort | Build time (UTC) | Sample or coverage | Result boundary |
|---|---|---|---|
| Season projections | 2026-10-08 14:51:01 | six leagues | global trained-through Oct 7; per-league freshness is not implied |
| Live evaluation, all recorded scopes | 2026-10-08 14:51:02 | n=812, Brier .62681, log loss 1.04331, ECE .03875 | latest scored kickoff Oct 6 |
| Live evaluation, currently served | same artifact | n=381, Brier .61519, log loss 1.02942, ECE .03473 | latest scored kickoff Oct 6 |
| Live evaluation, European cohort | same artifact | n=246, Brier .58018, log loss .97659 | latest scored kickoff Sep 20 |
| Event coverage | 2026-10-04 14:23:10 | 36,334 / 82,532 matches, 44.02%; 2,305 verified empty | coverage is not a latest-result date |

ECE and scores describe different existing cohorts and cannot be compared as
before/after scores. The optimistic sample-base-rate floor is not a prospective
competitor. No recency challenger is promoted, and the separate legacy
`train_feedback` loop is unchanged.

## Reproduce offline verification

```sh
python -m pytest backend/tests/test_current_season_refresh.py backend/tests/test_warehouse_provider_failures.py backend/tests/test_build_event_coverage.py backend/tests/test_sync_events.py backend/tests/test_fetch_outcomes_failures.py backend/tests/test_forecast_evaluation.py backend/tests/test_forecast_provenance.py -q
npm test -- --ci --runInBand
npm run lint
npm run build
npm run typecheck
npm run test:product
npm run test:theme
```

The targeted backend suite passes 271 tests. It exercises capped bootstrap and
resume, original receipt times, corrections, duplicate results, season labels,
unavailable/malformed providers, preservation of warehouse bytes and related
rows on refusal, verified empty events, and pre-kickoff settlement boundaries.
The deterministic 150-date workload fails at 93 attempts, retains progress,
then completes on a second 69-attempt run; this is a fixture rehearsal, not a
provider completeness claim.

Frontend checks pass 890 tests. Product browser checks reuse the production
server and committed artifacts: home → Evaluation (via Season forecast record
on mobile), ready/loading/empty/failure,
keyboard retry, partial failure, last-good retention and recovery at
390/768/1440px in Light and Dark. They check actual destination, artifact dates,
unchanged numbers, overflow and accessibility, and save screenshots plus
`record-reliability-report.json` in the existing `product-quality-evidence` CI
artifact. External hosts and unrelated APIs are intercepted. The existing
theme/navigation suite runs separately.
The replay seeds the saved theme once against the opposite OS color scheme,
waits for the mounted theme control, and evaluates axe without adding nodes to
React's document head. Hydration and other unexpected browser errors remain
blocking assertions.

The [48-state local production report](reviews/2026-10-09-data-reliability/record-reliability-report.json)
records zero unexpected browser errors, exact source dates and artifact hashes.
Representative screenshots show the [mobile Light read failure](reviews/2026-10-09-data-reliability/evaluation-read-error-light-390.png)
and [Dark last-good retention at 768px](reviews/2026-10-09-data-reliability/evaluation-retained-dark-768.png).
The existing theme journeys also pass all 124 captured states.

The full Evaluation page has existing definition-list markup violations in five
metric groups (div labels/values inside `dl`). The browser report records them
explicitly and asserts that count; all other checked rules and the new read
failure status must pass. This patch does not claim a clean full-page
accessibility audit or broaden into the shared metric components.

No live ingestion, model training, production workflow dispatch or release
publication was used to validate this patch. Its operational recovery still
needs a successful authorized scheduled run after review; offline tests do
not prove provider uptime or newer European results.
