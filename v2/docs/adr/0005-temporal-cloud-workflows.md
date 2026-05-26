# ADR 0005 — Temporal Cloud for stateful workflows over GitHub Actions cron / APScheduler / Airflow

**Status:** Accepted (2026-05-24)
**Owners:** `ingestion-svc` + `admin-svc` teams
**Supersedes:** v1 `.github/workflows/prediction_pipeline.yml` (3×/day auto-commit)

## Context

The v1 pipeline ran on GitHub Actions cron and **auto-committed prediction JSON to `main` 3×/day**. This caused: bot conflicts whenever a human pushed concurrently; no rollback path (history was littered with `chore: update predictions [automated]`); no observability into multi-step failures; CI minutes burned on retries; and the pipeline could not branch (settle → predict → publish was a linear shell script). v2 needs durable, observable, multi-step workflows with retries, time-travel, and human-in-the-loop steps (model promotion to production).

## Decision

**Temporal Cloud** for any workflow with state, retries, branches, or time-travel needs:

- `fixtures_sync` (hourly)
- `prediction_refresh_daily` (daily)
- `settle_outcomes` (hourly)
- `monte_carlo_league_refresh` (weekly + on-demand)
- `train_unified_men` / `train_unified_women` (monthly → K8s GPU Job)
- `calibration_refresh` (nightly)
- `calibration_drift_check` (daily)
- `audit_snapshot_export` (daily; **replaces the v1 git-commit habit**)

Fire-and-forget short tasks (Open-Meteo hourly pull, team-alias reload) run as **K8s CronJobs**. APScheduler is rejected because it dies with the pod; Airflow is rejected because its ops burden is excessive for our footprint and it's not built for sub-minute work.

## Alternatives considered

| Option | Verdict |
|---|---|
| **GitHub Actions cron** (v1) | Stateless, no rollback, slow start, no branching, no real audit trail. Replaced. |
| **APScheduler in-process** | Dies with pod restart; not durable. Rejected. |
| **Airflow** | Heavy ops, scheduler-DB-worker triad, DAG file pickling pain. Rejected. |
| **Self-hosted Temporal** | Free but Cassandra cluster + several extra pods to operate. Not worth it at our scale. |
| **Temporal Cloud** | Pay-per-action, no infra to run, mature SDKs, durable execution + history + retries + cron. Picked. |

## Consequences

**Positive**
- Workflows survive deploys and restarts.
- Human approval steps for model promotion to production (Workflow waits on a Signal).
- Full execution history in the Temporal UI → real RCA when ingestion drifts.
- Predictions are written to Postgres + S3 audit snapshot, not to git.

**Negative**
- Per-action Cloud bill. Mitigated by batching low-priority work into hourly fan-out workflows rather than per-record workflows.
- Workflow code has constraints (must be deterministic; no random / wall-clock without `workflow.now()`). Mitigated by keeping non-deterministic work in activities, not workflows — same separation as a normal ETL.

## Implementation notes

- Workflow definitions in `apps/ingestion-svc/src/ingestion/temporal/workflows.py`.
- Activities in `apps/ingestion-svc/src/ingestion/temporal/activities.py`. Activities call Arq jobs (ADR-0004) for the actual unit-of-work.
- Audit snapshot: `audit_snapshot_export` workflow writes `predictions_YYYY-MM.json` to `s3://fotpredict-audit/`, SHA-256 tagged. S3 versioning gives us rollback. No git push.

## References

- Blueprint §11 — Cron / Scheduled Jobs (`~/.claude/plans/act-as-a-senior-iterative-corbato.md`)
- v1 anti-pattern: [`../../../.github/workflows/prediction_pipeline.yml`](../../../.github/workflows/prediction_pipeline.yml)
