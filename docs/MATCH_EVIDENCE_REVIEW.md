# Match evidence explorer — 2026-10-08

## User benefit and scope

From a club comparison, open **Explore [club] match evidence**, or use the
league's **Explore match evidence** link. Filter by club and UTC dates to inspect
archived probabilities, match-model goal expectations, recorded scores, timing
and Elo context. Opening calibration shows the actual sample in each confidence
band. This adds a checkable match history to yesterday's season comparison.

The saved cloud checkout has no `warehouse.sqlite`, committed player-match rows
or shot corpus. Player API stats depend on live ESPN and have no reliable
minutes/xG/rating fields. A new player scouting, valuation, fantasy projection or
ranking would therefore need unsupported inputs. This PR builds the outcome
insight that the existing data can support. It reuses the durable monthly
forecast reader, probability bars, Brier function, serving-family allow-list,
league registry, gender preference, evidence panels and existing browser audit.
No new dependency, model, provider ingestion, training or promotion is involved.

## Temporal and identity contract

- Explicit men's gender, a served competition and Dixon–Coles family required.
  Other model families are excluded, never pooled into this record. The stored
  model identifier appears on every match; a family name is not a claim that
  all rows were made by today's artifact.
- Probabilities must be finite, in [0,1], and sum to 1 within .001. Only that
  rounding drift is normalised. Missing goal expectations and Elo stay null.
- Match dates must be real calendar dates. Date-only fixtures have no kickoff
  time, so only forecasts strictly before **start of match day UTC** qualify.
  Same-day and post-day rows are excluded, rather than assuming a kickoff.
- The cutoff is the end of a selected UTC day. Forecasts and matches after it
  are excluded; scores appear only if a valid result timestamp is at or before
  it, after match day begins, and the integer scores agree with the winner.
  Outcome tracker stamps originate in `datetime.utcnow` and are read as UTC.
  Batch forecasts use local `datetime.now` without an offset. Their nominal UTC
  interpretation therefore gets a conservative 12-hour ordering guard (the
  latest possible UTC instant for civil UTC−12); both instants must precede
  match day and the cutoff. Explicit offsets use the recorded instant. The UI
  labels absent offsets; this guard does not recover their original timezone.
- One fixture per competition/gender/date/home/away, with whitespace and case
  normalised for identity. Different event IDs for that fixture cannot double
  the sample. First eligible forecast is selected with deterministic ties;
  conflicting same-time forecasts or reused IDs with different fixtures are
  quarantined. Result corrections pass fixture identity and serving scope checks
  independently of forecast probabilities or prediction timing. A same-day,
  post-day or invalid-probability forecast can still carry a known correction;
  it cannot create or replace the eligible forecast. The latest known result
  correction is joined to the first eligible forecast. Conflicting or invalid
  latest corrections are withheld rather than reviving old scores.
- This is a **current-file observational audit**, not a historical replay of
  publication or training. Overwritten corrections cannot be reconstructed.
  Neither a timestamp nor a later build date proves a training cutoff, result
  freshness or leakage-free performance. A partial/unreadable archive withholds
  the UI metrics. No provider fallback fills a gap.

## Measurement

Reproduce against the committed files, from the repo root:

```sh
npx tsx scripts/audit_match_evidence.ts --as-of 2026-10-08 --from 2026-07-10
```

The [saved audit](reviews/2026-10-08-match-evidence/data-audit.json) includes
SHA256 hashes for every source file, league exclusions, models, metrics and
calibration bands with sample counts. For Premier League, **50** distinct
forecasts survive the window/timing checks; **47** have valid outcomes known
by cutoff and **3** are withheld. Brier **0.66223**, log loss **1.09220**,
five-band top-outcome ECE **0.10151**, goal expectation MAE **0.96436** over
**47** matches with both goal expectations. Brier sums over three classes (0–2);
log loss uses natural logs with a 1e-12 floor; goal MAE averages the two team
absolute errors per match. Calibration uses the largest probability, fixed
five bands and deterministic home/draw/away tie order. Empty bands are omitted.

These are descriptive scores on a small, selected archive, with no paired
closing-market row. They establish neither superiority nor accuracy improvement
and are not pooled with the season snapshot evaluation. Training provenance is
unverified. European included result dates end **September 20**, although some
`outcome_timestamp` values are October 6 because files were updated later.
Selecting a September cutoff withholds those October-recorded outcomes; it
does not invent a historical copy. MLS has a separate, older, sparse archive.
The existing recency challenger remains unpromoted.

The [September 20 cutoff audit](reviews/2026-10-08-match-evidence/cutoff-audit.json)
uses the same source hashes and yields **38** known Premier League outcomes,
versus 47 at October 8. The nine additional rows reflect later outcome-record
timestamps in current files; they do not establish nine newly played matches.

## Reel and source review

The actual reference at revision
[`c992f0335ddecc281c211dda062132808868fb3f`](https://github.com/grandngom/xG-model-football/tree/c992f0335ddecc281c211dda062132808868fb3f)
has a real [MIT software license](https://github.com/grandngom/xG-model-football/blob/c992f0335ddecc281c211dda062132808868fb3f/LICENSE),
copyright 2026 grandngom. Its README describes **50 matches and 1,390 shots**.
[The code](https://github.com/grandngom/xG-model-football/blob/c992f0335ddecc281c211dda062132808868fb3f/main.py)
uses random shot splits and reports summary/bootstrap scores on full-dataset
predictions that include training observations. Those claims cannot establish
held-out future-match performance. Its geometry also needs a unit audit: it
uses StatsBomb's 120×80 coordinates beside a 7.32 goal-width constant. We have
not run or imported its workflow, models, coefficients, outputs or charts.

MIT software permission does not license the underlying StatsBomb data.
The [official data agreement](https://github.com/hudl/open-data/blob/4b73468fc5b0f1950f9f66fada70ad3a4f9327cb/LICENSE.pdf)
was checked: clauses 1.2.1 and 1.2.2 restrict redistribution and commercial
exploitation of data/derived analysis, and 1.4 requires brand accreditation.
No shots CSV, raw data or derived visualization is vendored here. The other
reel's gated bundle was not obtained and supplies no usable assets or model.

## Other sports

The reusable idea is the evidence contract: sport-qualified identity, source
and time window, actual observations versus model expectations, missingness,
sample counts and temporal eligibility. NBA could inspect possession/shot
expectations; F1 could inspect session/lap/finish expectations, using each
project's permitted local data and outcome definitions. Soccer xG coefficients,
Elo scales, three-way draws, player values or this archive must not be transplanted.
No other repository or unpublished laptop work is modified by this soccer PR.

## Review evidence

Focused tests cover ordering, duplicate IDs, corrections (including rejected
forecasts carrying valid/invalid corrections), inconsistent scores,
date/season boundaries, missing metrics, gender and stale responses. Cloud
Chromium checks actual production UI/API at 390, 768 and 1440px: native keyboard
traversal both directions, calibration, club selection, loading/error/empty/sparse
states, retry, three comparison returns, browser back/forward, and independently
held date/gender responses with DOM/frame observers. Other APIs/external hosts
are intercepted. CI runs the same checks and uploads the evidence report.
Browser review also exercises new comparison links and native calendar-icon
tab stops. These flows scroll already-focused controls clear of fixed chrome;
date inputs retain a focus-within outline when Chromium focuses their picker
subcontrol. No focus is programmatically reassigned.

Screenshots and measured results are saved under
[`reviews/2026-10-08-match-evidence`](reviews/2026-10-08-match-evidence/).
The [previous comparison screenshot](reviews/2026-10-07-team-comparison/after-390.png)
is the before view; it had no links to an archived match explorer.
Public preview/browser access remains restricted, so deployment metadata is
reported separately from real browser QA on the local production server.
