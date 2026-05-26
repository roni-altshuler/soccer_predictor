# Status

What is wired up vs stubbed in this scaffold. The canonical blueprint is at `~/.claude/plans/act-as-a-senior-iterative-corbato.md` (machine-local, not committed to git).

This subdirectory (`soccer_predictor/v2/`) is **purely additive** to the v1 code in `soccer_predictor/{backend,src,migrations,...}` — nothing in v2/ mutates v1 files. v1's 3×/day GitHub Actions pipeline keeps running on `main`; v2 work happens on `feat/v2-*` branches.

## Wired (real, testable)

- **Monorepo layout** matching blueprint §6: every `apps/*` and `packages/*` directory exists with the conventional Python src/tests split.
- **`packages/fotpredict-db`** — Alembic baseline `0001_initial` containing every DDL block from blueprint §3 (extensions, enums, tenancy, football domain, live-ticker hypertable, gender-partitioned predictions hypertable, simulations, user meta, audit hypertable). 7 blocks, 65 statements.
- **Offline SQL validator** — `scripts/validate_schema.py` parses every DDL block through libpg_query (pglast), so syntax errors are caught without a running Postgres. Passing.
- **Pytest invariants** — `packages/fotpredict-db/tests/test_baseline_ddl.py` (20 tests, all passing):
  - Each DDL block grammar-roundtrips via the real PostgreSQL parser.
  - Every gender-bearing entity (`competitions`, `teams`, `players`, `matches`, `predictions`, `simulations`, `prediction_models`) has `NOT NULL gender_t`.
  - `predictions` hypertable is gender-partitioned.
  - Every hypertable PK includes the time column and (when set) the partition column.
  - Symmetry: every `CREATE TABLE`/`CREATE TYPE` has a matching `DROP` in the downgrade.
  - `users.email` is `CITEXT`; `team_source_aliases` PK is `(source, source_team_id)`.
- **Local dev stack** — `infra/local/docker-compose.yml` boots Postgres 16 + TimescaleDB 2.17, Redis 7, MinIO (S3 stand-in), Centrifugo 5. Needs `make dev` (requires Docker).
- **ADRs** — six initial decision records in `docs/adr/` for the contested calls: Triton, Centrifugo, Clerk, Arq, Temporal Cloud, Aurora.
- **Memory + plan** — Claude memory file `project_fotpredict_v2.md` keeps the v2 context across sessions; canonical plan at `~/.claude/plans/act-as-a-senior-iterative-corbato.md`.

## Stubbed (skeleton only, business logic NOT yet implemented)

Each `apps/*` has a `pyproject.toml`, package, and entrypoint stub so `uv pip install -e` works and imports resolve. None of the services have business logic yet — that's the next phase.

- `apps/api-gateway-svc/` — FastAPI BFF stub
- `apps/prediction-svc/` — Triton client + selector stubs
- `apps/simulation-svc/` — Ray actor stubs
- `apps/realtime-svc/` — Centrifugo connect-token + subscriber stubs
- `apps/ingestion-svc/` — source-protocol stub + Arq worker stub
- `apps/admin-svc/` — model promotion + ingestion ops stubs
- `apps/training-jobs/` — train + promote stubs
- `apps/web/` — Next.js 15 App Router skeleton with `(marketing)`/`(app)`/`(admin)` route groups
- `infra/terraform/`, `infra/helm/`, `infra/argocd/` — empty module trees (filled in once we provision a real AWS account)

## Verification commands

```bash
make validate-schema    # parses every DDL block through libpg_query (no DB needed)
python3 -m pytest packages/fotpredict-db/tests -v   # 20 invariants, ~0.1s
make dev                # boots Postgres+Timescale, Redis, MinIO, Centrifugo (needs Docker)
make migrate            # applies baseline to local Postgres (after `make dev`)
```

## Open items

- Docker is not installed in the dev environment used to author this scaffold, so the live `alembic upgrade head` step against Postgres+TimescaleDB is documented but unrun. The pglast validator + invariant tests should catch ~95% of issues; the remaining ~5% (TimescaleDB function semantics: chunk creation, retention/compression policy registration) only show up at apply time.
- Per-service business logic — feature builder, Triton client, Centrifugo publisher, Arq jobs, MC simulators — is in the next implementation phase.
- Frontend skeleton needs `pnpm install` once `apps/web/package.json` and `next.config.mjs` are populated with the real dependency set.
