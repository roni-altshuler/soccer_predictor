# Season schedule refresh reliability

The [October 9 Season Forecast run](https://github.com/roni-altshuler/soccer_predictor/actions/runs/37944913016)
was green while its optional schedule step raised `ModuleNotFoundError: ScraperFC`
at 14:33:22 UTC. Forecast generation continued. Installing that package alone
would enable the historical scraper's broad default scope and browser transport;
it would not establish access from CI. The [upstream FBref module](https://github.com/oseymour/ScraperFC/blob/v4.0.1/src/ScraperFC/fbref.py)
imports both its competition registry and botasaurus browser stack.

The [October 9 Event Backfill](https://github.com/roni-altshuler/soccer_predictor/actions/runs/37952088928)
already recovered (six requests, 33 MLS additions). This change does not repeat
that repair, expand provider scope, or change the 93-attempt ESPN cap. European
verified results remain September 20; later MLS results and build timestamps do
not establish European recovery.

## Bounded schedule check

`ingest_fbref_schedules --routine --report /tmp/schedule-refresh.json` reads
the downloaded `fbref.sqlite` in read-only mode, looks up exactly the current
season for the big five plus MLS, and reuses `parse_schedule`. European seasons
roll in July; MLS uses its calendar year. Missing current metadata fails before
any request. No competition-history discovery, historical scrape, new provider,
browser installation, or challenge bypass is performed.

Ordinary HTTP makes at most six requests, sequentially, with the existing
six-second minimum and 20-second timeout. Redirects, 403/429, timeouts, challenge
shells and missing/invalid schedule rows stop the check without retries. Provider
access remains unverified and may still be denied; this is a visible degradation,
not evidence that the schedule refreshed.

Candidate pages must parse, have unique fixture keys and valid current-season
dates, and retain the known home/away fixture multiplicities. Postponed date keys
are replaced rather than added alongside old rows. All six checks precede one
atomic replacement of a SQLite backup; any earlier failure leaves the original
bytes intact. Other seasons and competitions remain untouched. These checks
protect known coverage; they cannot prove that the provider lists every fixture.
Existing corpus, missing-league and forecast publication gates remain required.

## Published status and workflow outcome

`record_schedule_refresh` writes `season_refresh_status.json` atomically. Its
states are `checked` or `degraded`, with attempt time, request count/cap, scope,
season and last verified schedule dates. A missing/inconsistent report is degraded,
with unknown request count; prior valid verification dates survive. The status
is committed with the forecast when the required publication steps succeed.
Required failures still stop publication and preserve the previous forecast.

The optional check can continue so that last-good schedules support the forecast.
Its outcome is recorded in the step summary, and a final `always()` step fails
the workflow if either the check or status recording failed. A green forecast
build therefore cannot hide this failure. Other optional refresh steps are outside
this fix.

The directory, league page and club comparison show schedule status independently
of live standings. A missing or unreadable status stays **unknown**, not fresh.
Checked labels quote their date rather than asserting freshness now. Degraded
labels warn about kickoff times and postponements. Unsupported competitions and
women's preferences do not receive this men's six-league record. Schedule checks,
artifact build times and latest verified result dates remain separate facts.

## Reproduce without provider access

```sh
python -m pytest backend/tests/test_routine_schedule_refresh.py -q
npm test -- --runInBand src/__tests__/api/scheduleRefresh.test.ts src/__tests__/components/scheduleRefresh.test.tsx
npm run build
QA_CHROMIUM=/usr/bin/chromium npm run test:schedule
```

The browser replay uses synthetic check outcomes only, the real production status
writer and API, and existing committed forecast numbers. It temporarily writes
only the status artifact, restores it in `finally`, and verifies forecast hashes
remain unchanged. Provider routes are blocked. Screenshots cover unknown,
degraded, checked and unreadable states at 390/768/1440px in Light/Dark; only the
new notice receives the scoped accessibility audit. No clean full-page accessibility
claim is made. External images are blocked; this is not a crest rendering audit.
A successful synthetic check is not a live provider check.

No model, training loop, calibration, promotion gate or serving probabilities
change. Scheduled recovery and forecasting improvement require later evidence;
this PR does not dispatch production jobs or claim either result.

## Review evidence (October 10)

Local checks: **1,608 backend tests passed / 25 skipped**, **907 frontend tests
passed**, lint/typecheck/production build passed with existing warnings. The final
workflow regression suite passed **29 cases**. The full product replay passed,
including **48 schedule states** and **96 existing Evaluation states**; the serial
theme replay passed **124 states**. A stricter focused replay also passed all 48
schedule states with exactly the two deliberately failed status reads per context.

[The compact report](reviews/2026-10-10-season-refresh/schedule-refresh-report.json)
records widths, themes, states and unchanged forecast hashes.
[Read-only release metadata](reviews/2026-10-10-season-refresh/source-metadata.json)
pins asset 510130709 and its gzip digest, confirms the six current-season URLs,
and records their August 11 scrape dates. A [synthetic first-page rejection](reviews/2026-10-10-season-refresh/published-input-rejection.json)
against that existing input stops after one request and preserves the database
hash. Neither check accesses FBref.

Screenshots: [original comparison](reviews/2026-10-10-season-refresh/before-comparison-light-390.png),
[synthetic degraded comparison](reviews/2026-10-10-season-refresh/schedule-degraded-comparison-light-390.png),
[synthetic degraded directory](reviews/2026-10-10-season-refresh/schedule-degraded-directory-dark-1440.png),
[unknown directory](reviews/2026-10-10-season-refresh/schedule-unknown-directory-dark-768.png),
[synthetic checked comparison](reviews/2026-10-10-season-refresh/schedule-checked-comparison-light-1440.png).
The checked screenshot is a test fixture, not operational recovery.

Baseline page source came from `ff73b961`. Two baseline images were captured
before the first new runner stopped on service-worker setup. One initial full
replay later caught a hydration mismatch. The final runner uses the existing
seed-once storage, mounted theme control and service-worker isolation protocol;
its full and focused replays passed without suppressing hydration errors or
changing production theme code. The screenshots cover the new status notice;
existing full-page accessibility debt remains outside this patch.
