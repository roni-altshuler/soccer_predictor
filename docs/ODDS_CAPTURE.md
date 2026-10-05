# Odds capture failure contract

`python -m backend.scripts.capture_odds_snapshots --no-warehouse` captures
observed ESPN bookmaker prices. A rejected date range (HTTP 400) is retried
using every date in the inclusive window. Other HTTP errors, transport errors,
invalid JSON, and invalid schedule structures fail the command with exit 1.
The CLI bounds the daily fallback to 0–31 days ahead.

All requested leagues and days are collected and validated before writing
observations. Event IDs and bookmaker keys are deduplicated within the batch.
Completed, in-play, and already-started fixtures are excluded. A valid empty
schedule or unpriced fixture succeeds without creating a price. Nonfinite and
missing moneylines are not observations; a bookmaker name is required for a
priced row.

Existing JSONL bytes are retained and new rows are published with a temporary
file and atomic replacement. Optional SQLite writes use one transaction; a
failed write or commit rolls back that batch, restoring JSONL if needed. The
workflow's existing concurrency group serializes writers. This is exception
atomicity, not a distributed transaction: sudden termination between file
replacement and SQLite commit can leave the optional local database behind the
durable JSONL record. CI uses `--no-warehouse`, so only JSONL is persistent.

Offline checks:

```sh
python -m pytest backend/tests/test_capture_odds_snapshots.py -q
```

This change does not recreate missed historical snapshots or establish
provider pricing coverage. Missing prices remain missing.
