# Scraper startup and failure contract

The lineup and injury CLIs require only the dependencies installed by
`.github/workflows/scrape_lineups.yml`: `httpx`, `pydantic`, `pydantic-settings`,
and `email-validator`. Importing `backend.services` loads its public exports
lazily, so ingestion does not import prediction or numerical libraries.

An unavailable injury provider raises `ProviderUnavailable`, preserves the
last-good injury cache bytes, filesystem modification time, and `fetched_at`,
and records the failed attempt in `<team_id>.status.json`. That sidecar has
`availability`, `checked_at`, and `last_good_fetched_at`; its timestamp is not a
new injury observation. An explicit, validated empty injuries list is a
successful report and can replace the previous observation. Successful writes
use a temporary file and atomic replacement. Stale refresh honors the cached
provider and league and excludes availability sidecars from its inputs.

Nested squad rows are validated before healthy players are filtered out. Every
player requires a usable ID or name, and supplied identity fields must have the
expected scalar type. Present non-null `injuryInfo` must contain usable injury
details; a malformed block cannot establish that a player is healthy. Empty
squad lists and identified healthy players with absent/null `injuryInfo` remain
successful empty injury reports.

Lineup fetches distinguish an unavailable or malformed scoreboard/summary from
a valid summary whose lineup has not yet been announced. ESPN event IDs are
never retried as FotMob match IDs; FotMob requires explicit source selection.
Individual successful refreshes may update their own caches, but any requested
refresh failure makes the CLI exit nonzero. Both CLIs close clients in `finally`
and propagate the result to the process exit status.

Present ESPN roster containers must be lists and every athlete must have a
valid identity. A side may omit its roster key only when the summary contains
one matching event/competition ID, an aware kickoff timestamp, an explicit
`pre` / `STATUS_SCHEDULED` / `completed: false` status, and exactly one home
and away team with matching distinct IDs in the competition and roster sides.
That response is unpublished, including when only one side is announced: all
supplied players are still validated, and no empty/partial cache or new
`fetched_at` replaces the last-good observation. Present null, object, string
and boolean roster values remain unavailable; live, completed, postponed,
unknown and inconsistent contexts cannot justify a missing key.

FotMob starter rows and benches are validated instead of silently
skipping malformed entries. Missing announcements and explicit empty lineup
lists remain successful unpublished responses; malformed nested structures
raise without replacing the last-good lineup cache.

The workflow runs injury refresh even after a lineup failure, keeps both errors
visible, and commits scrape changes only when all provider steps succeeded.
Provider steps do not use `continue-on-error`; staging failures are not swallowed.

Injury request/schema failures now have sanitized reason codes and bounded
current-run metadata. An always-run, best-effort artifact step retains only
that metadata outside the data cache, including failed refreshes; the provider
steps and successful-run publication gate remain strict. See
[injury diagnostic fields, retention and limits](INJURY_FAILURE_DIAGNOSTICS.md).

Offline checks:

```sh
python -m pytest backend/tests/test_scraper_failures.py backend/tests/test_espn_unpublished_rosters.py -q
```

The tests also block all numerical and prediction imports in subprocesses.
An actual fresh virtual environment with only the workflow dependencies was
used to run both modules' `--help` startup paths.

The missing-roster regressions include a [real-derived MLS event `761660`
excerpt](../backend/tests/fixtures/espn/761660_scheduled_excerpt.json) supplied
by the independent reviewer, alongside synthetic structural variations. The
excerpt preserves all fields used by this parser path; it is not the full
ESPN response. The reviewer reports an HTTP 200 JSON capture at
2026-10-06 05:47:01 UTC, originally 194,751 bytes, with full-response SHA-256
`4f6f27e50c003addfb40baf2f3329b415a627124305616e294404f69a4101d8b`.
That hash belongs to the original full capture, not the excerpt, and was not
recomputed here. See [fixture provenance](../backend/tests/fixtures/espn/README.md).

The original main parser at `99e6f67ee20b36e639fd9901f15262f24d8aaf37`
rejects this excerpt with `ProviderUnavailable: Invalid ESPN roster list`.
The offline runtime replay now returns unpublished from the excerpt through both
the parser and fetch/cache path, preserves last-good bytes, modification time
and `fetched_at`, and creates no empty cache on a cache miss. Deliberate
malformed-value and anonymous-athlete mutations remain unavailable on either
side and preserve the cache. No new provider request was needed. These checks
verify this missing-roster case; they do not validate the omitted response
fields, current provider availability, or broader MLS/provider coverage.

This contract does not establish provider coverage. Existing team API callers
still catch unavailable injuries and use their existing empty-list response;
UI availability display is outside this CLI/cache fix. Cache paths remain
compatible, while cache freshness now also checks the requested source.
