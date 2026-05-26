# Architectural Decision Records

Each ADR captures a single design choice that proved contentious during blueprint review. Follow the [MADR template](https://adr.github.io/madr/) for new entries; numbering is sequential and immutable.

| # | Title | Status |
|---|---|---|
| [0001](0001-triton-inference-server.md) | NVIDIA Triton over Ray Serve / BentoML | Accepted |
| [0002](0002-centrifugo-realtime-broker.md) | Centrifugo over Ably/Pusher / native WebSockets | Accepted |
| [0003](0003-clerk-auth-provider.md) | Clerk over Auth.js / Supabase Auth | Accepted |
| [0004](0004-arq-async-jobs.md) | Arq over Celery / RQ / Dramatiq | Accepted |
| [0005](0005-temporal-cloud-workflows.md) | Temporal Cloud over GitHub Actions cron / APScheduler / Airflow | Accepted |
| [0006](0006-aurora-postgres-timescaledb.md) | Aurora Postgres 16 + TimescaleDB over Neon / Supabase / single-AZ RDS | Accepted |

When you add an ADR:

1. Pick the next sequential number.
2. Use one of `Proposed`, `Accepted`, `Superseded`, `Deprecated`.
3. State the trade-off you're making — not just what you picked, but what you gave up.
4. Add a row to this README.
