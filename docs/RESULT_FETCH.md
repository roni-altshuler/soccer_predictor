# Prediction outcome fetch failure contract

`python -m backend.scripts.fetch_outcomes` requests only the distinct league/UTC
calendar dates with past-due pending predictions. Daily ESPN scoreboard queries
avoid the rejected date-range contract; ISO timestamps and offsets are normalized
to a UTC date. Future dates are skipped. Requests use an explicit event limit.

HTTP, transport, JSON, or schema failures make the CLI exit 1 and stop the
prediction workflow before generation, feedback, or artifact commits. Valid empty
scoreboards and unfinished matches succeed without settling anything. A finished
match requires an event ID, one home and away side, and explicit nonnegative
integer scores. Missing scores never become zero. Conflicting duplicate final
scores fail the batch.

Settlement requires the exact ESPN event ID within the requested competition and
date. Home-team substrings are not evidence of fixture identity and are no longer
used. Existing recorded outcomes are not rewritten. All requested dates and
prediction files must validate before publication. Modified files are staged and
atomically replaced; publication exceptions restore earlier replacements. Sudden
process termination across several file replacements is not a filesystem-wide
transaction. The workflow commits only after successful execution.

Offline checks:

```sh
python -m pytest backend/tests/test_fetch_outcomes_failures.py -q
```

This script settles the prediction JSON files. It does not refresh the SQLite
warehouse, rebuild canonical results, or regenerate the separate live evaluation
artifact. Those paths still require investigation: `HistoricalDataCollector`
ignores failed range requests and can save an empty/partial season cache;
`espn_loader` turns collector exceptions into error statistics; the current-season
warehouse step in the prediction workflow still uses `continue-on-error`.
No warehouse was available in the saved environment for real-corpus validation.
No historical predictions, results or evaluation artifacts were regenerated.
