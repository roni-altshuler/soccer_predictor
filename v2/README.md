# FotPredict v2

Production-SaaS rebuild of FotPredict AI. Lives in the same repo as v1 (one directory up: [../backend/](../backend/), [../src/](../src/)) so the redesign can land incrementally without a fork. FotMob-class live football tracking layered with a deep predictive-analytics product (match outcomes, scorelines, league/bracket Monte Carlo simulations, season-progression forecasts, AI confidence, dynamic in-play updates).

**Status:** scaffolding — see [`docs/STATUS.md`](docs/STATUS.md) for what's wired vs stubbed.

**Blueprint:** `~/.claude/plans/act-as-a-senior-iterative-corbato.md` (canonical, machine-local).

## Relationship to v1 (sibling directories)

`v2/` is additive — nothing here mutates the v1 codebase one directory up. The v1 GitHub Actions automation in `../.github/workflows/prediction_pipeline.yml` keeps running on `main`; v2 work happens on `feat/v2-*` branches and lands in this subdirectory only. The intent is incremental migration: stand up the v2 services, dual-write where possible, then cut over per blueprint §16.9. v1 model artefacts at `../backend/data/models/unified_{men,women}.pt` should load into the v2 MLflow registry without retrain (parity test: same input → same output ±1e-6).

## Layout

```
apps/        # one deployable per service
  web/                # Next.js 15 App Router (Vercel)
  api-gateway-svc/    # FastAPI BFF (auth, rate limit, composes others)
  prediction-svc/     # features -> Triton -> calibrator -> MatchPrediction
  simulation-svc/     # Ray-batched Monte Carlo league + bracket sims
  realtime-svc/       # Centrifugo connect-token + Redis Streams subscribers
  ingestion-svc/      # Arq workers + Temporal activities pulling ESPN/FBref/etc.
  admin-svc/          # internal ops (model promote, ingestion runs)
  training-jobs/      # one-shot K8s GPU Jobs for retraining
packages/    # shared Python libraries (uv workspace)
  fotpredict-core/          # Pydantic schemas, enums, error types
  fotpredict-db/            # SQLAlchemy 2.x models + Alembic migrations
  fotpredict-ml/            # Feast feature defs + inference utilities
  fotpredict-clients/       # typed gRPC + HTTP clients between services
  fotpredict-observability/ # OTel + structlog config
  fotpredict-testing/       # shared pytest fixtures, fakes
infra/
  terraform/   # AWS infra (EKS, Aurora Global, ElastiCache, etc.)
  helm/        # in-cluster apps
  argocd/      # GitOps app-of-apps
  local/       # docker-compose for `make dev`
  triton-model-repo/        # config.pbtxt templates
docs/
  adr/         # Architectural Decision Records
```

## Quickstart

```bash
make install            # installs Python (uv) + Node (pnpm) workspaces
make dev                # boots local stack: Postgres+Timescale, Redis, MinIO, Centrifugo
make migrate            # applies Alembic baseline to local Postgres
make validate-schema    # syntax-validates the migration via pglast (no DB needed)
make test               # runs every pytest + vitest suite
```

## Two-universe (men's + women's) is a top-level concern

Every entity carrying gender semantics has a `gender_t ENUM('M','F')` column. "Barcelona" (M) and "Barcelona Femení" (F) are separate `teams` rows. `predictions` hypertable is partitioned by `gender` so women's writes don't fight men's. Triton serves two ensemble models (`unified_M`, `unified_F`). Women's-specific source modules live in `apps/ingestion-svc/src/ingestion/sources/women/` with their own priority queues so men's matchday surges can't starve women's updates.

## License

All rights reserved. Personal project; no commercial use, no betting guarantees.
