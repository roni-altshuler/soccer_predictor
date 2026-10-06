# Injury failure diagnostics and retention

## Observed failure and scope

[Normal run 37507669472, job 112420358280](https://github.com/roni-altshuler/soccer_predictor/actions/runs/37507669472/job/112420358280)
ran on main `ea3dd6a3eb691422ed97cbf2b975d5776c8a7160`. Its lineup step
succeeded; injury refresh failed, and both the data commit and post-job cache
save were skipped. The independent reviewer reports 42 HTTP 200 injury
requests: 21 configured league paths for each legacy cached team, 364 and 360,
without a league key. The response schema is unknown. No response capture or
new provider request was used to develop this change.

Previously, the shared ESPN client returned `None` for HTTP, transport and JSON
errors. The injury lookup then lost their distinction, and availability
sidecars lived in the cache whose post-job save was skipped after failure.
This change retains sanitized failure metadata without interpreting unknown
provider schemas, guessing endpoints or changing request scope.

## Failure contract

The injury caller opts into `ESPNClient._request(..., raise_errors=True)`.
Other callers retain their existing `None` behavior. Opt-in failures contain
fixed reason codes and optional HTTP status only; no exception text, response
body, headers or URL enters the diagnostic record. Opt-in errors add no retries.
Existing configured league iteration and explicit provider selection remain.

| Reason | Meaning |
| --- | --- |
| `http_error` | Non-success HTTP response; actual status retained (including 403/429/5xx) |
| `timeout` / `transport_error` | Request failed; exception text omitted |
| `invalid_json` | Response JSON decoding failed; actual status retained |
| `missing_injury_content` | Decoded object has no top-level `injuries` field |
| `invalid_schema` | Non-object root, null injuries or a non-list injuries field |
| `malformed_entries` | Invalid athlete identity or entry/nested-field types |
| `available` | Complete explicit list validated, including a genuine empty list |
| `unavailable` / `unexpected_error` | Source lost its cause upstream, or an unclassified failure; no guessed cause |

Static `detail` codes distinguish the relevant schema cases. HTTP status is
unknown for decoded payload validation and in-memory cache hits; it is not
invented as 200. FotMob remains explicit-only; failures already collapsed by
its client cannot acquire a more specific HTTP cause here. No source fallback
is added, and a malformed list never establishes a fresh partial/empty report.

Failed injury observations preserve `<team_id>.json` bytes, modification time
and `fetched_at`. Availability sidecars use fixed error codes and diagnostic
rows. `last_good_fetched_at` is a validated observation time, not a new one;
invalid timestamp content is omitted. Only a validated explicit empty or
nonempty report can update the normal injury observation.

## Current-run artifact

The CLI accepts `--diagnostics-path`, which the workflow points to
`$RUNNER_TEMP/injury-diagnostics.json`, outside the injury/lineup cache and git
staging paths. Each CLI invocation starts its own ledger, capped at 128 rows;
`dropped_records` reports truncation. A record contains only:

```text
provider, team_id, league_key, league_slug,
reason, detail, http_status, checked_at
```

Provider/league values and reason/detail codes are allowlisted. Team IDs must
be bounded positive numeric strings. `checked_at` is diagnostic timing, not
an injury observation. Player names, IDs, medical details, payloads, request
headers, credentials and URLs are excluded. No old status sidecars or injury
cache files are uploaded.

The ledger checkpoints atomically after completed attempts and is exported on
CLI completion, including refresh, initialization or cleanup failure. Cache
and sidecar write errors get fixed metadata codes. Diagnostic write failures
are best effort and cannot turn a failed refresh into success. A ledger with
zero rows means no completed attempts were recorded; it does not establish
healthy teams or provider coverage.

The workflow uploads this file using `always()`, tolerates artifact-delivery
failure, warns if the file is missing, and retains it for seven days. Injury
refresh still exits nonzero on failure; scrape steps have no
`continue-on-error`, and the data commit still requires `success()`. The
artifact step runs after that gate. Failed runs are not forced into a cache
save or data commit. Hard runner termination, startup failure before CLI
initialization, or denied artifact delivery can still prevent retention.

## Verification and limits

The tests use `httpx.MockTransport`, small synthetic reports and temporary
cache files. They cover missing/null/non-list content, invalid JSON, malformed
entries and nested fields, timeout/transport failures, 403/429/5xx, valid
explicit empty/nonempty lists, request count, namespaces, privacy, cache bytes,
mtime/observation time, bounded checkpoints, initialization/cleanup and write
failures, and workflow retention/publication conditions.

The two-team 42-attempt replay supplies **synthetic HTTP 200 objects without an
injuries field**. It verifies category retention and unchanged caches; it is
not a capture or diagnosis of the original run's unknown response schema.
Provider recovery and live injury coverage remain unverified. No live
collection, workflow dispatch, access-denial workaround or model work was used.
The separate team API's unavailable-to-empty serving behavior remains outside
this patch.

Local validation after correcting the CLI artifact assertions passed. Runtime
code is unchanged from implementation commit
`b9c103e7d6fc7fe35174d407fb28469c1a3ff3b1`; the replay summary identifies the
corrected test source by its SHA-256:

| Check | Result |
| --- | --- |
| Focused diagnostic, scraper-failure and ESPN-client tests | 121 passed; 3 existing warnings |
| Full backend suite | 1,542 passed; 25 skipped; 24 existing warnings |
| Workflow YAML and all four shell steps (`bash -n`) | Passed |
| Workflow artifact/failure/publication contract tests | Passed within the focused suite |

The [sanitized synthetic replay summary](fixtures/injury-diagnostics/legacy_42_mock_summary.json)
records 21 retained attempts per team, 42 `missing_injury_content` records and
zero dropped records per replay. Both replay cases inspect the actual CLI
output without exporting or repairing it in a test helper. One uses normal
checkpoints; the other disables checkpoints to isolate the CLI's final export.
The write-failure test patches the newly constructed ledger's class method,
uses a spy to verify that it ran, and checks the final-export failure warning.
Isolated in-memory mutations removing the final export or writing an empty
ledger caused both targeted tests to fail in each case. Tracked runtime files
were not modified for these checks.

Cache preservation and zero FotMob calls are assertions of the named passing
replays. Diagnostic HTTP status remains unknown even though the mock returned
200: decoded schema validation does not retain transport status. The summary
is evidence from these offline tests, not live provider data.

```sh
python -m pytest backend/tests/test_injury_diagnostics.py \
  backend/tests/test_scraper_failures.py backend/tests/test_espn_client.py -q
python -m pytest backend/tests/ -q
```

Saved executor usability was reverified by a command and read/write probe at
2026-10-06 18:21:50 UTC, after the 18:20 disconnect notice. Work continued in
the same environment; no environment switch was used.
