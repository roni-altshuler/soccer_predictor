# Resumable weekly training ingestion

The [October 11 failed training run](https://github.com/roni-altshuler/soccer_predictor/actions/runs/38124831635/job/114426926987)
restored the last released warehouse, then requested ESPN `eng.1/2025` with
`dates=20250801-20250831`. HTTP 400 triggered the existing daily fallback;
covering its complete season window required 365 requests against a 93-request
budget. The builder refused partial coverage and retained the last-good
warehouse. Neither gender trained or promoted a model.

## Scope retained

The restored-warehouse branch now uses:

```bash
python -m backend.scripts.build_warehouse --espn --resume-espn --football-data --min-season 2025
```

The men's ESPN selection remains `MEN_COMPETITIONS` × `AVAILABLE_SEASONS`,
filtered by the existing minimum/maximum season arguments. On October 11 this
is **35 league-seasons across 18 competitions**: 2025 and 2026 for the big five,
Eredivisie, Primeira Liga, MLS, Champions League, Europa League, each big-five
second division, Süper Lig and Brasileirão, plus World Cup 2026. Euro and Copa
América remain registered but their latest configured editions are 2024, below
this existing minimum. No five-league restriction was introduced.

Football-data refresh, Understat enrichment, retained older history and women's
training inputs remain as before. The incremental weekly branch did not refresh
women's ESPN sources before this repair and still does not claim to. The cold
`--full` reconstruction branch remains the existing gated loader; the new resume
flag explicitly refuses `--full`, women's ingest, `--force` and current-only
mode. This repairs the reported restored-warehouse path, not a complete cold
reconstruction of every historical source.

## Coverage and freshness

`TrainingSeasonRefresh` reuses current-season receipt validation, final-result
parsing and complete-scope assembly. The loader shares the existing identity,
alias, no-loss and observation-time reconciliation. It requests single dates
from `site.web.api.espn.com`; it does not retry rejected monthly ranges.

- A validated complete day whitelist with the exact competition, season and
  full season window may exclude dates. Missing or unsuitable historical
  calendar metadata requires **every past day** of the existing season window.
  Metadata for today's season cannot exclude dates from an older season.
- Europe retains August–July windows; MLS/Brazil retain January–December;
  international tournaments retain their configured edition windows. Future
  dates are never ingested as results. Local MLS/Brazil dates can cross UTC
  midnight; repeated event IDs contribute one result.
- The **93-attempt global cap**, pacing and bounded retries include discovery
  requests and failed attempts. Each validated dated response is committed
  separately, even when a later date, competition or budget fails. No incomplete
  selected scope reaches the candidate warehouse.
- Finished-season calendars and empty daily receipts are archival progress.
  They remain reusable across weekly invocations, preventing repeated work on
  the same empty prefix. Their original observation timestamps are retained.
  This does **not** certify detection of later historical corrections.
- Current-season calendars are discovered afresh each invocation. Recent finals,
  pending and empty current dates retain the existing one-hour expiry. Cached
  older observations cannot roll back a newer released correction, remove a
  known final, change its identity or manufacture fresh observation times.

Historical progress runs first. A fixed finite historical scope can complete
over several capped attempts. This is not a guarantee that the changing broad
weekly selection will fit the cap: absent calendars, retries or fresh current
coverage can still exceed it. In that case training stays blocked. No budget,
freshness requirement, competition selection or integrity gate is weakened to
force a green run.

## Durable progress is separate from released data

The workflow restores receipts from the separate `warehouse-ingestion-progress`
release. Assets are named `espn_training_receipts-<run-id>-<attempt>.sqlite.gz`.
They contain receipts, calendar observations and invalidation markers only;
they are never a warehouse or model asset. This avoids relying on a weekly
Actions cache, which GitHub [removes after seven days without access](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#usage-limits-and-eviction-policy).

The latest uploaded matching asset is restored and validated offline. SQLite
integrity, schema, scope, digests, event/date identities and observation clocks
must pass. Invalid or inaccessible existing checkpoints block the job; they
are not silently treated as a cache miss. After a successful restore/bootstrap,
an `always()` step validates and uploads accumulated progress even when refresh
failed. Each upload has a new name, so failed/interrupted uploads retain the
previous checkpoint. No new credentials or repository permissions are added.

Invalid checkpoints and upload failures remain blocking. Runner termination
before checkpointing can lose that invocation's new progress; the previous
uploaded checkpoint survives. This PR does not prune previous progress assets.

Only the builder's complete, reconciled, integrity-checked candidate can replace
the local warehouse. Fixpoint repair, blocking Wave A integrity, both training
steps and independent model-promotion gates remain unchanged. A failed refresh
does not publish warehouse/model assets to `models-latest`.

## Offline verification and limits

```bash
python -m pytest backend/tests/test_training_season_refresh.py backend/tests/test_current_season_refresh.py -q
python -m backend.scripts.validate_espn_training_progress --db /path/to/receipts.sqlite
```

The deterministic HTTP fixture reproduces the original monthly 400 and refusal
of a 365-day fallback. The repair covers that same historical window in four
simulated weekly invocations: **93, 93, 93, 86 attempts**, retaining 365 dated
receipts and one unique fictional final. Its empty dates stay reusable across
weeks, and its first observation time is retained. This proves progress and
assembly mechanics; one fictional result cannot pass a real Premier League
season's approximately 380-result integrity floor.

Additional fixtures cover multiple scopes, tournament/calendar-year boundaries,
duplicate event observations, newer warehouse corrections, retry caps, damaged
receipts/calendars, future clocks and failed checkpoint transport/uploads. Real
workflow shell, SQLite validation and gzip run against a mocked GitHub CLI.
Both capped coverage and a fully fetched but structurally short closed season
leave last-good warehouse bytes, modification time and inode unchanged.

No provider workflow, production ingestion, training, promotion or release
upload was dispatched to verify this repair. Live provider compatibility, full
35-season completion and resumed training remain unverified until a subsequent
authorized run supplies that evidence. The held-back recency challenger and
legacy `train_feedback` loop are outside this ingestion repair.
