# ADR 0004 — Arq over Celery / RQ / Dramatiq for async background jobs

**Status:** Accepted (2026-05-24)
**Owners:** `ingestion-svc` team
**Related:** ADR-0005 (Temporal for stateful workflows — orthogonal concern)

## Context

`ingestion-svc` runs hundreds of async jobs/hour: 30s live-score polls per in-play match, hourly fixture syncs, weather pulls, prediction recompute triggers, dead-letter quarantine writes. The whole I/O surface is async (httpx for scrapes, SQLAlchemy 2 async, Redis async client). The job runner has to: be redis-backed (we already have ElastiCache), play nicely with FastAPI lifespan, support cron + dedup, and not fight our async stack.

## Decision

**Arq 0.26+** as the asyncio job runner. Long-running, multi-step, stateful flows (settle → predict → publish) are handed off to Temporal (ADR-0005). Arq is for the per-task workers that Temporal activities invoke.

## Alternatives considered

- **Celery**: thread-pool default makes our async HTTP/DB stack fight itself; broker can be Redis but config sprawl is real; nontrivial in K8s. Workers can't natively await coroutines without `asgiref.sync_to_async`-style hacks.
- **RQ**: sync only.
- **Dramatiq**: good, but the async story is less mature than Arq's.
- **Arq**: pure asyncio, Redis-backed, deduplication and cron built in, small footprint, FastAPI-friendly lifecycle.

## Consequences

**Positive**
- One coroutine syntax across HTTP handlers and background jobs.
- Native cron via `WorkerSettings.cron_jobs`.
- Built-in `unique_job_id` dedup.
- Redis as the only broker → no Kafka/RabbitMQ to operate.

**Negative**
- Smaller community than Celery; less Stack Overflow surface.
- No native priority queues — emulated via separate queue names (`women_live`, `women_fixtures`, `men_live`, etc.) so men's matchday surges can't starve women's updates.

## Implementation notes

- Worker entrypoint: `apps/ingestion-svc/src/ingestion/main.py`.
- Job inventory: see blueprint §11 table.
- Retry policy: exponential backoff 1s/5s/30s/5m, max 5; final failure → `audit_log` + Sentry.
- Dedup: Redis bloom filter `bf:events:{source}:{date}` + Postgres unique constraint as ground truth.
- Scaling: KEDA on Arq queue length per priority — `women_live > 10 OR men_live > 20`.

## References

- Blueprint §10 — Data Ingestion Pipeline (`~/.claude/plans/act-as-a-senior-iterative-corbato.md`)
- Blueprint §11 — Cron / Scheduled Jobs
