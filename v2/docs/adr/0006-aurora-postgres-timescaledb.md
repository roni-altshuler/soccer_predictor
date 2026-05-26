# ADR 0006 — AWS Aurora PostgreSQL 16 + TimescaleDB extension over Neon / Supabase / single-AZ RDS

**Status:** Accepted (2026-05-24)
**Owners:** `packages/fotpredict-db` + all service teams
**Supersedes:** v1 SQLite warehouse

## Context

The hot tables are time-series in shape: `match_events` (live ticker), `predictions` (versioned per match per snapshot), `audit_log` (privileged-write trail). Naive `match_events` traffic on a busy Saturday is ~108k events / 90min; a season of `predictions` across both gender universes runs into tens of millions of rows with `features_hash`-keyed dedupe. We also need multi-region read replicas (us-east-1 + eu-west-1) and predictable IOPS during matchday peaks.

## Decision

**Aurora PostgreSQL 16, Global cluster (writer in us-east-1, readers in us-east-1 + eu-west-1), with the TimescaleDB community extension** enabled on the cluster. Hypertables on `match_events`, `predictions` (partitioned by `gender`), `audit_log`. PgBouncer sidecar per service pod, transaction mode, default pool size 25.

## Alternatives considered

- **Neon**: branching is brilliant for dev/PR envs; cold starts hurt live traffic; Global-cluster equivalent (Neon read replicas) is newer and still warming up.
- **Supabase**: couples us to Supabase Auth (rejected in ADR-0003) and the Supabase Postgres flavour. No TimescaleDB guarantee.
- **Single-AZ RDS Postgres**: cheapest, but the failover/Global-cluster story isn't there. Acceptable for `dev`, not for `prod`.
- **Aurora**: writer + replica failover in seconds, Global DB for cross-region reads, predictable IOPS, supported TimescaleDB community edition. Picked.

## Key schema decisions driven by this choice

1. **`predictions` PK = `(id, generated_at, gender)`** (not `(id, generated_at)` as the prose blueprint reads). TimescaleDB requires unique indexes — including the PK — to contain every partitioning column when `set_number_partitions` is used. The blueprint's `partitioning_column => 'gender'` ⇒ PK must include `gender`. This is enforced by [`../../packages/fotpredict-db/tests/test_baseline_ddl.py`](../../packages/fotpredict-db/tests/test_baseline_ddl.py) (`test_hypertable_pks_include_time_and_partition_columns`).
2. **Denormalised `gender_t` on hot tables** (`matches`, `predictions`, `simulations`) so the hottest queries (`WHERE gender = $1 AND kickoff_utc::date = $2`) hit a single composite index without joining `competitions`.
3. **Two-partition gender split on `predictions`**: men's and women's writes land in separate chunks ⇒ women's traffic doesn't contend with men's for the same chunk lock.
4. **CITEXT on `users.email` and `*.slug`**: case-insensitive uniqueness via the `citext` extension; necessary for Clerk emails.
5. **`gin_trgm_ops` on `teams.canonical_name` and `players.full_name`**: trigram-indexed fuzzy search via `pg_trgm`.

## Consequences

**Positive**
- Hypertable retention + compression policies handle the time-series lifecycle (`match_events` retains 24 months, compresses after 14 days; `audit_log` retains 13 months).
- Multi-region reads via Aurora Global DB.
- Read replicas absorb the long-tail of fixture/standings reads.

**Negative**
- AWS lock-in. Mitigated by the fact that we're already EKS + S3 + Secrets Manager — escape would be expensive regardless.
- TimescaleDB community edition lacks some enterprise compression features. Acceptable at our data volumes.
- Aurora Serverless v2 was considered and rejected: matchday IOPS spikes need predictable provisioned IOPS, and the v2 cold-start charge during the prelive minute is unacceptable.

## Operational notes

- Per-day chunk pre-creation for `predictions` via Temporal (ADR-0005) — avoids on-write chunk creation latency at midnight UTC rollover.
- Connection pool: PgBouncer sidecar `pool_mode = transaction`, `default_pool_size = 25`. Aurora `max_connections` held at 300 with safety margin.
- Backups: Aurora automated snapshot (35-day window) + point-in-time recovery.
- TimescaleDB extension is installed by the baseline migration's `EXTENSIONS` block.

## References

- Blueprint §3 — DDL (`~/.claude/plans/act-as-a-senior-iterative-corbato.md`)
- Blueprint §14.4 — DB scaling
- Baseline migration: [`../../packages/fotpredict-db/src/fotpredict_db/migrations/versions/0001_initial.py`](../../packages/fotpredict-db/src/fotpredict_db/migrations/versions/0001_initial.py)
