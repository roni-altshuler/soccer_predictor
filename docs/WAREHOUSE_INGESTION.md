# Warehouse provider failures and publication

The October 5, 2026 refresh [run 37306588779](https://github.com/roni-altshuler/soccer_predictor/actions/runs/37306588779)
finished green after 1,817 HTTP 400 log entries and 154 zero-result ESPN season
fetches. Its uploaded summary contained only 380 Premier League results ending
May 12, 2019. The collector swallowed failed requests, and the build ignored
loader error statistics, including football-data competition refusals.

`build_warehouse` now returns a nonzero exit code for a failed core source, an
empty season selection, refused club rows, an empty candidate, or failed
integrity/coverage checks. It copies the existing database through SQLite's
backup API, builds a temporary candidate, closes its candidate connections and
validates it. Publication to an existing database is one SQLite transaction;
it keeps the existing file in place. Failed requests, later source failures and
validation errors leave the last-good database intact. Publication SQL failures
and interruptions roll back the schema and rows together. An active WAL at
startup or a concurrent committed change blocks publication. `--stats`
opens an existing database read-only; it cannot create a missing warehouse.

## Writer coordination and publication

The earlier fingerprint/WAL check followed by `os.replace` was unsafe: a writer
could commit during candidate fsync, after the check, and have its rows replaced.
File replacement can also strand already-open writers on the old inode. Existing
databases are now published in place through SQLite rather than file replacement.

One live connection captures `PRAGMA data_version` before the backup and stays
open through publication. Providers and candidate construction run without a
live writer lock. After candidate fsync, `BEGIN IMMEDIATE` acquires SQLite's writer
lock, and the same connection checks the generation again **under that lock**.
If another connection committed since the snapshot, the candidate is refused.
Otherwise the candidate's schema, rows, indexes, views, triggers and
autoincrement sequences are copied within that transaction, foreign keys are
checked, and `COMMIT` publishes the complete change. No `executescript` is used:
its implicit commit would break the lock boundary. SQL failures and interrupts
roll back the entire transaction. Virtual tables are refused for a separate
reviewed migration rather than attempting an incomplete copy of shadow tables.

All writers must use SQLite connections/transactions. This includes the existing
`Warehouse` wrapper and scripts using `sqlite3` directly; no advisory sidecar
lock or special wrapper is required. SQLite serializes a writer arriving after
the final check until commit/rollback. A writer that exceeds its busy timeout
must retry its **whole transaction from a fresh snapshot**. Connections opened
before publication continue to use the same database file. A read transaction
can retain its old snapshot until it ends, as normal for SQLite.

Direct filesystem replacement, truncation or unlink of an existing warehouse
requires stopping all database users first; it does not participate in SQLite
locking. Downloads/restores must occur before starting refreshes or writers.
Artifact jobs run after the refresh connection closes. If exporting from a live
database with other readers/writers, use SQLite backup rather than copying only
the main file and omitting potentially committed WAL contents.

A cold build fsyncs its closed candidate and uses `os.link` for atomic
create-if-absent publication on the same filesystem. If a concurrent creator
has already made the target, publication fails with `EEXIST` and preserves that
file. There is no fallback to replacement if hard links are unavailable.

Deterministic regressions replay a commit during candidate fsync, a write attempt
after the locked final check followed by retry through the original connection,
a concurrent creator at cold publication, and SQL/commit failure after copying
rows. They also check legacy schema, trigger behavior and sequence preservation.

## Provider and cache validation

Core warehouse loaders read caches but do not publish them. This keeps all
existing historical cache bytes, mtimes and `fetched_at` values unchanged if any
later source or season fails. Standalone collector calls can still publish a
validated season cache using atomic replacement. Legacy caches without coverage
metadata are revalidated rather than treated as evidence of a successful fetch.
The explicitly registered Euro 2000 curated archive retains its separate
provenance and is not relabelled as a fresh provider observation.

ESPN requests cover every past date in the existing season windows, through
today in UTC. Only an HTTP 400 range rejection enables inclusive daily fallback.
Before probing individual days, the collector reserves the entire remaining
season against a shared budget of 93 daily requests per collector. An oversized
historical season fails before daily probes; a narrower current-season or
tournament selection can fit. Other HTTP failures, invalid JSON, absent event
lists, malformed finals, conflicting event IDs and a saturated event limit fail
the season. Missing scores cannot become zero. A valid empty current-season
response is distinct from failure; an empty completed season is refused.
Refreshes cannot lose IDs already observed in a valid cache or in the ESPN
warehouse rows for that season.

football-data CSVs require date, team and score headers. Invalid played rows fail
the whole response instead of being skipped. Both absent scores with no final
result can represent an unplayed fixture; absent scores with a declared final
result fail validation. Missing or nonfinite optional prices stay missing.
Competition and alias guards remain in force; this change does not weaken them
or automatically pin provider spellings.

The staged core build runs the existing Wave A integrity guard. It also checks
completed Wave A fixture counts against the UTC clock, since the existing guard
deliberately judges an old snapshot by its own latest date. Its documented
truncated-season exceptions remain in force. The warehouse workflow validates
again before either artifact upload. Forecast, prediction and training workflows
stop after a failed attempted core refresh.

## Bounded operation and remaining coverage gaps

Use `--competitions`, `--min-season` and `--max-season` to select a bounded core
refresh. `--db PATH` allows an isolated candidate run. This patch does not raise
the daily budget automatically, run a backfill, change released data, or claim
that the missing warehouse history is recovered. A cold broad refresh can now
fail visibly when ESPN rejects ranges. Current seasons with longer elapsed
windows can also exceed the fallback budget.

Schema validation and successful date requests cannot prove that a provider
returned every fixture. Completed Wave A counts, existing ID baselines and the
integrity checks supply additional evidence, but current seasons and other
competitions do not have a new authoritative completeness oracle here. Existing
football-data competition/alias refusals still need an independently verified
resolution. Optional enrichment loaders retain their existing reporting
semantics; this fix makes the core provider failures and publication gates
truthful without changing model training or evaluation policy.

Offline validation:

```sh
python -m pytest backend/tests/test_warehouse_provider_failures.py \
  backend/tests/test_result_ingestion.py backend/tests/test_footballdata_loader.py -q
python -m pytest backend/tests -q
```

## Routine current-season recovery

`--espn --current-season --resume-current --competitions ...` selects a separate
routine path for the five served prediction leagues and MLS. Cold historical
reconstruction retains the strict range/daily behavior above. The routine CLI
requires an explicit supported scope and cannot be combined with `--force` or
other loaders. Each competition computes its own season label, including the
January difference between European leagues and MLS.

Every invocation first reads each league's current ESPN scoreboard calendar.
The league slug, integer season year, `calendarType: day`, explicit
`calendarIsWhitelist: true`, unique ISO dates and calendar bounds must match the
selected past season window. Only this provider-declared whitelist permits
excluding dates; the latest stored result never stands in for date coverage.
Each required past fixture date then needs a successfully validated daily
response. A calendar revision during collection refuses the candidate. Future
fixtures are excluded; valid empty or pending fixture days remain distinguishable
from unavailable responses. MLS's local fixture-day labels can have next-day UTC
kickoffs, so dated events allow a one-day offset but finals must still fall
inside the selected past season window.

The hard cap remains **93 actual HTTP attempts per invocation**, including
calendar discovery and retries. Requests are sequential with 250 ms pacing.
Transport errors, HTTP 429 and 5xx get at most three attempts with bounded
backoff. A `Retry-After` longer than ten seconds refuses the run for a later
retry rather than ignoring it. This is a local operational limit, not a claim
about ESPN's unpublished quota.

Validated daily bodies, SHA-256 digests and observation timestamps are committed
one date at a time to a **separate** SQLite receipt store, by default
`backend/data/ingestion/espn_receipts.sqlite`. Receipt transactions use FULL
synchronous durability. They are evidence of individual source observations,
not published season caches. Budget exhaustion, interruption, HTTP/schema
failure or incomplete selected coverage returns nonzero, retains validated
progress and preserves the live warehouse. Failed refreshes never replace the
last-good receipt for that date. Digest/schema failures force a refetch.
Conflicting event IDs refuse publication and mark the implicated receipts for
revalidation without deleting their evidence. Recent fixture days (seven-day
overlap), pending events and listed-but-empty days are rechecked after one hour.
Reused results keep the receipt observation timestamp in warehouse rows and
provider aliases rather than stamping them as freshly fetched. Older completed
days are reused; a fresh calendar can still introduce a new
historical date requiring an observation.

All selected competitions must finish before reconciliation starts. Existing
fixtures from every source must be accounted for, and prior ESPN event IDs,
including verified aliases, cannot disappear. A cross-source match requires the
same competition, season, canonical teams, UTC date and agreeing final scores.
Ambiguity or conflicting scores fails closed. An ESPN event alias is recorded
in schema-v6 `provider_match_ids` while retaining a football-data fixture's ID
and source. In-place updates retain existing prices, xG and references, and leave absent
enrichment intact;
missing attendance is not stadium capacity, and absent card details are not
zero-card observations. The candidate still passes the existing integrity guard
and uses the native transaction publication boundary described above.

### Observation ordering and unpublished progress

Receipt, match and provider-alias observation times must be valid timezone-aware
ISO timestamps. They are compared as UTC instants, including offset/Z variants.
Missing, invalid or naive times refuse reconciliation; no missing receipt time
is replaced with the current process time.

For an already verified event identity, an older receipt counts toward known
fixture coverage but cannot change any warehouse fact, enrichment or freshness.
The entire newer row and its related records remain intact. The age boundary
uses the latest of the match and its verified provider alias. An unaliased
cross-source fixture still requires the same canonical teams/day and agreeing
scores before an alias can be established. Provider IDs cannot be remapped from
another season. Alias times only advance; an older/equal observation cannot
rewrite a newer alias or relabel its stored time representation.

Only a strictly newer observation can update an existing match. Equal-time
score, kickoff or overlapping enrichment contradictions refuse the candidate;
agreeing equal-time observations leave the complete row unchanged, including
missing enrichments. Unknown existing match/alias times also refuse the run
rather than guessing which source is newer. The warehouse helper enforces this
boundary inside a transaction even when called directly. SQL failures,
contradictory batches and interruptions roll back all its writes.

Receipt refreshes acquire SQLite's writer lock before comparing the previous
observation and replacing it. An earlier-started writer cannot overwrite a
later receipt; equal-time conflicting responses are refused. Every previously
validated final ID for the date must remain finalized with the same provider
team identity. A fresh HTTP 200 empty/pending response that loses a known final
is unavailable evidence, and its previous body/digest/timestamp remain intact.
These checks protect durable progress before its first warehouse publication.
A selected scope also checks final IDs from all its prior validated receipts,
so removing a fixture date from a fresh calendar cannot silently hide an
unpublished final. Duplicate observations of one event on adjacent MLS dates
use their newest timestamp regardless of iteration order.

Deterministic regressions cover the reviewer's October 4 warehouse correction
versus September 1 receipt, plus the two-run budget-limited bootstrap whose
first final disappears in a later empty response. They also replay changed
calendars, final-to-pending loss, same-time contradictions, unknown times,
newer aliases, stale cross-source evidence, two receipt writers and interrupted
warehouse batches. Both refusals preserve last-good data; production workflows
are not run to validate these failure paths.

Prediction, forecast and daily Event Backfill restore and save receipts with Actions cache, including
`if: always()` after a failed refresh. Cache keys include the run ID and attempt;
restore prefixes are versioned and separate for each workflow.
Prediction refreshes exactly `eng.1,esp.1,ger.1,ita.1,fra.1`; forecast and Event
Backfill add `usa.1`. Event Backfill can restore the forecast receipt cache as a
fallback because it validates the same six competitions. It previously asked
for two complete men's/women's seasons plus football-data; its October 8 run
failed when the daily fallback needed 365 requests against the 93-attempt cap.
The daily ingest now uses the existing bounded current-season path. Older
history and competitions outside that scope remain in the released warehouse;
this routine does not certify their freshness. See the
[failure evidence and offline checks](EVENT_BACKFILL_RELIABILITY.md).
No required refresh has `continue-on-error`. Receipts are cached progress;
they do not replace the released warehouse or export production data. Cache
misses, eviction or concurrent cache snapshots can require another bootstrap;
they cannot certify incomplete coverage. Cancellation before cache save can
lose that runner's new progress, while its completed SQLite receipts remain
valid locally. Cold reconstruction and broad weekly backfills are not made
resumable by this change.

### October 5 isolated rehearsal

The `models-latest` warehouse asset downloaded read-only had SHA-256
`208e185dac3fdf9df2f520c79ece1854b139d5d8774b3e3651d333f1a22d75b6`
(compressed), 82,532 matches and no date receipt ledger. The five current
European seasons held 250 known fixtures, with football-data supplementing
ESPN rows; their latest result dates were September 20. The fresh ESPN calendars
listed 94 past fixture dates: England 17, Spain 31, Germany 12, Italy 18, France
16. Bootstrap requires 99 successful calls including discovery, so two capped
runs are intentional:

| Rehearsal | HTTP attempts | Result |
| --- | ---: | --- |
| Five leagues, cold receipts | 93 | Nonzero; 88 date receipts retained, live candidate refused |
| Five leagues, resumed | 11 | Complete selected coverage; 250 known fixtures reconciled |
| Forecast scope with those receipts | 62 | Six complete calendars; MLS 373 → 405 finals |

The rehearsal used only an isolated SQLite backup and local receipt store.
MLS contributed 32 verified finals, ending October 2 UTC; the five European
leagues acquired no newer results because the provider's calendars still ended
September 20. The final isolated warehouse had 82,564 rows, retained every
original match ID and all existing prices, xG and referee values, and preserved
104,352 events, 36,334 event-coverage markers, 688,791 lineups, 714,975 player-stat
rows, 60,450 prediction snapshots and 784,779 Elo ratings exactly. All nine
Wave A integrity checks passed both before and after recovery. No production
workflow was dispatched, no release asset was replaced, and no predictions or
training data were generated.

Offline tests replay the five-league workload (93 then 11 calls), separate
six-league cold bootstrap (93 then 69), subsequent calendar-only refreshes,
January season labels, interruption/resume, retry exhaustion, malformed daily
responses, changed calendars, corrupt receipts, stale pending/empty days,
cross-source conflicts, reference preservation and final publication refusal.
The calendar is provider evidence, not an independent fixture-count oracle.
Older completed receipts can miss a later provider correction unless that date
is revisited; disappeared known fixtures and conflicting identities refuse the
candidate for review. Existing football-data alias/competition refusals,
broad reconstruction budgets and legacy event loaders that only understand
ESPN-prefixed primary IDs remain separate gaps.
