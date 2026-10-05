# Bounded OpenFootball adapter and coverage audit

This is an independently testable candidate fixture/result provider. ESPN remains
the production primary feed. The existing `openfootball_loader.py`, warehouse,
resolver, pipelines, UI, credentials and settings are unchanged. No training or
warehouse replacement was performed.

## Evidence and measured coverage

Observed **2026-10-05T16:41:40.560256+00:00** at upstream commit
[`e6744429ee395bc86f247348c6184bb08d4eb361`](https://github.com/openfootball/football.json/commit/e6744429ee395bc86f247348c6184bb08d4eb361).
Read exactly 11 targeted JSON files (845,074 bytes), plus LICENSE.md and README.md.
No full repository clone, historical bulk download or other-provider ingestion.
[Machine-readable audit](data/openfootball-audit-2026-10-05.json) retains each
full source file's SHA-256, size, selection, observation date and coverage.

| Existing catalog / source file | 2026/27 fixture grid | Results | Missing times | 2025/26 fixtures / results |
| --- | ---: | ---: | ---: | ---: |
| eng.1 / en.1 | 380/380 | 50 | 0 | 380 / 380 |
| esp.1 / es.1 | 380/380 | 69 | 290 | 380 / 380 |
| ger.1 / de.1 | 306/306 | 36 | 198 | 306 / 306 |
| ita.1 / it.1 | 380/380 | 50 | 260 | 380 / 380 |
| fra.1 / fr.1 | 306/306 | 45 | 192 | 306 / 305 + 1 cancellation |

All 11 files have unique ordered home/away pairs, all expected teams and no
missing dates. The additional oldest targeted file, **2010/11 en.1**, has
380 fixtures and 380 results. These are structural pair-grid checks against the
competition format, **not verification against an authoritative fixture list or
warehouse team/match identities**. Completeness and correctness outside these
selections remain unaudited; do not infer pre-2010 support from the legacy loader's
1993 default or 2003 example.

All five current result frontiers are **2026-09-20**, 15 calendar days before the
observation. The next unscored dates in those files are October 9–10, so this
sample alone does not prove missing recent results. The pinned
[README](https://github.com/openfootball/football.json/blob/e6744429ee395bc86f247348c6184bb08d4eb361/README.md)
describes daily JSON generation at 05:00 UTC but explicitly says the upstream
Football.TXT datasets have no automatic daily update. Observation time, regeneration
time and git commit time cannot certify the freshness of the underlying facts.

No native team/match IDs or timezone metadata appear in these samples. All
supplied times remain unzoned local strings; all normalized UTC kickoffs are null.
Historical files have a time on every fixture. Scores occur as both `{"ft": [h,a]}`
and bare `[0,0]` arrays. Ignoring the arrays would discard 27/15/12/36/23 historical
results and 5/5/3/0/4 current results in England/Spain/Germany/Italy/France.
The Ligue 1 cancellation is FC Nantes–Toulouse FC, May 17, 2026 (`status: canceled`).
No explicit postponement occurred in this sample; postponement behavior is covered
by a clearly synthetic contract-test mutation. Dates may be provisional.

## Contract and identities

`backend/services/data/fixture_contract.py` defines frozen, provider-independent
`football-fixtures/v1` snapshots, fixtures, scores, identities, provenance and
coverage. `openfootball_adapter.py` implements the provider protocol using
`httpx.AsyncClient`, with no warehouse or team resolver dependency.

- Every observation includes provider, exact source SHA/path/URL/JSON pointer,
  payload hash, CC0 SPDX ID, pinned license URL/hash and timezone-aware observed
  date. `upstream_updated_at` is null and `upstream_freshness` is `unknown`.
- Competition correspondence is an explicit catalog table, scoped to the five
  men's top domestic leagues. Normalized competition IDs are semantic IDs rather
  than ESPN keys. The catalog table is not a team/fixture warehouse crosswalk.
- Team keys use the exact source spelling **and league**; fixture keys use league,
  season, exact home name and exact away name. SHA-256 synthetic provider IDs and
  UUIDv5 normalized IDs have versioned deterministic derivations. They exclude
  date, round, score and source commit, so rescheduling/corrections/reordering
  preserve IDs. Repeated ordered pairs fail as ambiguous identities. This rule
  is bounded to these single home/away league formats, not cup ties or playoffs.
- Renames, spelling changes and league changes deliberately produce different
  team identities. Every identity mapping is immutable with source evidence and
  `warehouse_id: null`; no fuzzy aliases or warehouse writes exist here. A future
  cutover needs separately verified team and fixture crosswalks.
- Full-time scores yield `result_available`, not a promise of live/final status
  or accuracy. Missing scores remain null/unknown, including past dates; they
  never become 0–0 or confirmed unplayed matches. Half-time-only scores remain
  partial. Explicit scheduled/postponed/cancelled statuses are preserved, and
  score/status conflicts fail. Date-only and undated fixtures remain representable.
- Schema-invalid rows fail the whole observation. Unsupported extra match fields,
  score periods or statuses fail for review instead of silently losing facts.
  Malformed/missing root lists are failures; an explicit empty list is a valid,
  incomplete observation. Missing source files raise `missing_source`.

Snapshots serialize via `to_dict()` into disposable JSON-compatible copies. Frozen
objects, tuples and separate per-commit observations prevent in-place mutation;
changing the derivation or semantic contract requires a new schema version.

## Bounded reads and incremental cache

A full lowercase 40-character source SHA and explicit league/season selection are
required; moving branches and arbitrary paths are rejected. Each reader is capped
at **1–10 HTTP requests** (default six: one license plus five league files),
**256,000 bytes per response**, **512 rows per file**, and a 20-second HTTP timeout.
There is no automatic retry, redirect following, tree discovery, season loop or
live polling. LICENSE.md must match the audited CC0 text before any league read;
license changes fail for review.

The optional isolated cache uses `(commit, source path)` keys. Identical pinned
reads need zero network calls and retain the first actual observed date. New
commits create new observations even when their payload hash is unchanged. Disk
publication uses an atomic hard link that never replaces an existing entry.
Corrupt caches fail without rewriting or refetching them; failed new observations
cannot replace old ones. Cache reuse revalidates hashes, provenance and schema.
No default production cache or warehouse path is selected.

Run a small audit explicitly (at most five unique samples per invocation):

```bash
python -m backend.scripts.audit_openfootball \
  --source-commit e6744429ee395bc86f247348c6184bb08d4eb361 \
  --sample en.1:2026 --sample fr.1:2025 \
  --cache-dir /tmp/openfootball-observations
pytest backend/tests/test_openfootball_adapter.py -q
```

Offline CI uses only small audited CC0 excerpts with original file hashes and
indices, the CC0 license, and synthetic adversarial cases. The focused adapter
workflow also runs separately from the existing backend suite. No CI source
download, model training or provider credentials are needed.

## Remaining cutover work

Freshness/SLA validation and independent schedule/result checks; verified warehouse
identity crosswalks and correction policy; explicit licensing review of the
existing mixed-source corpus; and a reviewed production integration. This source
does not supply FotMob-style live events, lineups, player IDs, xG, odds, injuries,
logos or broad women's/cup/international coverage in the tested adapter. See
[source-rights register](SOURCE_RIGHTS.md). This work establishes an adapter, not a
claim of live coverage or a replacement for ESPN.
