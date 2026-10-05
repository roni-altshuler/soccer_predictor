# Warehouse provider failures and publication

The October 5, 2026 refresh [run 37306588779](https://github.com/roni-altshuler/soccer_predictor/actions/runs/37306588779)
finished green after 1,817 HTTP 400 log entries and 154 zero-result ESPN season
fetches. Its uploaded summary contained only 380 Premier League results ending
May 12, 2019. The collector swallowed failed requests, and the build ignored
loader error statistics, including football-data competition refusals.

`build_warehouse` now returns a nonzero exit code for a failed core source, an
empty season selection, refused club rows, an empty candidate, or failed
integrity/coverage checks. It copies the existing database through SQLite's
backup API, builds a temporary candidate, closes its connections, validates it,
and replaces the target only on success. Failed requests, later source failures,
validation errors, interrupted runs and failed replacements leave the target
file intact. An active WAL or a concurrent change blocks replacement. `--stats`
opens an existing database read-only; it cannot create a missing warehouse.

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
