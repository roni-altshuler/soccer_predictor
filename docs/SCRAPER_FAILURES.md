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

Lineup fetches distinguish an unavailable or malformed scoreboard/summary from
a valid summary whose lineup has not yet been announced. ESPN event IDs are
never retried as FotMob match IDs; FotMob requires explicit source selection.
Individual successful refreshes may update their own caches, but any requested
refresh failure makes the CLI exit nonzero. Both CLIs close clients in `finally`
and propagate the result to the process exit status.

The workflow runs injury refresh even after a lineup failure, keeps both errors
visible, and commits scrape changes only when all steps succeeded. It no longer
uses `continue-on-error` or swallows staging failures.

Offline checks:

```sh
python -m pytest backend/tests/test_scraper_failures.py -q
```

The tests also block all numerical and prediction imports in subprocesses.
An actual fresh virtual environment with only the workflow dependencies was
used to run both modules' `--help` startup paths.

This contract does not establish provider coverage. Existing team API callers
still catch unavailable injuries and use their existing empty-list response;
UI availability display is outside this CLI/cache fix. Cache paths remain
compatible, while cache freshness now also checks the requested source.
