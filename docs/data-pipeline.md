# Data pipeline — ops guide

Everything under [backend/pipeline/](../backend/pipeline/) is the new Postgres + Redis + WebSocket pipeline described in [act-as-a-senior-stateless-wind.md](../../.claude/plans/act-as-a-senior-stateless-wind.md). This guide is the day-to-day reference: how to set it up locally, deploy each piece, flip feature flags, and verify it's working.

## TL;DR

- Existing SQLite path keeps working unchanged. Set **no env vars** and the new pipeline is fully dormant.
- Flip `PIPELINE_DUAL_WRITE=true` + `DATABASE_URL=...` and every loader now mirrors writes into Postgres while still writing SQLite.
- Add `REDIS_URL=...` and the cache + Streams + WebSocket gateway light up.
- Each phase has its own env switch — see the **Feature flags** table below.

## Feature flags

| Env var | Default | Effect |
|---|---|---|
| `DATABASE_URL` | unset | Postgres DSN. Required for any Postgres write. |
| `PIPELINE_DUAL_WRITE` | `false` | When `true` + `DATABASE_URL` set, legacy loaders also write to Postgres. |
| `PIPELINE_READ_FROM` | `sqlite` | Set to `pg` to have API endpoints read from Postgres. |
| `REDIS_URL` | unset | Redis connection. Enables cache, streams, websocket fan-out. |
| `PIPELINE_PUBLISH_LIVE` | `false` | Live pollers publish to `stream:live.events`. |
| `PIPELINE_STREAM_MAXLEN` | `100000` | XADD MAXLEN cap on streams. |
| `PIPELINE_CONSUMER_GROUP` | `pipeline` | Default consumer group name. |
| `JWT_SECRET` | unset | Required for gateway user channels. |
| `GATEWAY_PORT` | `8001` | Port for the websocket gateway service. |
| `WS_HEARTBEAT_SEC` | `25` | Server-side ping interval. |
| `WS_QUEUE_SIZE` | `256` | Per-connection outbound queue cap. |
| `R2_ENDPOINT_URL` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` | unset | Cloudflare R2 for archive (Phase 6). |
| `API_FOOTBALL_KEY` | unset | Free-tier key for API-Football loader. |
| `API_FOOTBALL_DAILY_BUDGET` | `100` | Daily request cap, enforced via `core.pipeline_meta`. |
| `TRANSFERMARKT_ENABLED` | `false` | Opt-in to scrape Transfermarkt (rate-limited to 1 req/5s). |

## Local stack — bring it up

```bash
# Postgres + Redis only (Phase 1/2 development)
docker compose up postgres redis

# Plus workers + gateway (Phase 3/4 development)
docker compose --profile workers up
```

Postgres lands on `localhost:5432` (user/db: `soccer`/`soccer_predictor`), Redis on `localhost:6379`, gateway on `localhost:8001/health`.

## First-time setup

```bash
# 1. New deps
pip install -r requirements.txt

# 2. Spin up local Postgres + Redis
docker compose up -d postgres redis

# 3. Run migrations
DATABASE_URL=postgresql://soccer:soccer@localhost:5432/soccer_predictor \
    alembic upgrade head

# 4. Backfill from the existing SQLite warehouse
DATABASE_URL=postgresql://soccer:soccer@localhost:5432/soccer_predictor \
    python -m backend.pipeline.pg.backfill

# 5. Smoke-test the integration suite
DATABASE_URL=postgresql://soccer:soccer@localhost:5432/soccer_predictor \
    pytest backend/tests/pipeline/ -v
```

You should see 36 tests pass (8 of which previously skipped because no Postgres was around).

## Phase rollout

The migration is incremental — flip one flag, validate, move on.

1. **Phase 1 — Postgres dual-write.** Set `DATABASE_URL` + `PIPELINE_DUAL_WRITE=true`. Run the loaders (`build_warehouse.py`); rows land in both warehouses. Compare counts with `python -m backend.pipeline.pg.backfill --dry-run`.
2. **Phase 2 — Redis cache.** Set `REDIS_URL`. The `RedisCache` is now used by Phase 7 loaders and Phase 4 gateway. Existing FotMob `SimpleCache` continues to work.
3. **Phase 3 — Streams.** Start the writer: `python -m backend.pipeline.workers.postgres_writer`. Publish a test event:
   ```python
   from datetime import datetime, timezone
   from backend.pipeline.streams.producer import get_producer
   from backend.pipeline.streams import topics
   from backend.pipeline.streams.envelope import EventEnvelope, EventType

   get_producer().publish(
       topics.LIVE_EVENTS,
       EventEnvelope(
           event_type=EventType.MATCH_STARTED,
           source="manual",
           source_ts=datetime.now(timezone.utc),
           match_id="m-test",
           payload={
               "competition_id": "eng.1",
               "kickoff_utc": "2026-05-24T15:00:00+00:00",
               "home_team_id": 1, "away_team_id": 2,
           },
       ),
   )
   ```
   You should see a row land in `core.fact_matches`.
4. **Phase 4 — Gateway.** Start the gateway: `uvicorn backend.pipeline.gateway.app:app --port 8001`. Connect with `wscat -c ws://localhost:8001/ws/match/m-test`. Publish an event as in Phase 3 — the message reaches the client through the broadcast channel once the recomputer (Phase 5) or another worker writes to `ws:broadcast`.
5. **Phase 5 — Recomputer.** `python -m backend.pipeline.workers.prediction_recomputer`. Any `match.event.added` triggers re-inference and pushes a `prediction` frame to subscribed clients.
6. **Phase 6 — Archive.** Configure R2 env vars. Dry-run first: `python -m backend.pipeline.workers.archiver --dry-run`. When happy, run without `--dry-run`. Monthly cron suggested.
7. **Phase 7 — New sources.** Each loader is one-shot:
   ```bash
   python -c "from backend.pipeline.pg.warehouse import open_pg_warehouse; \
              from backend.pipeline.loaders.statsbomb import StatsBombLoader, iter_women_competitions; \
              with open_pg_warehouse() as pg: \
                  loader = StatsBombLoader(pg); \
                  for c in iter_women_competitions(loader): \
                      loader.load_competition_matches(c, with_events=False)"
   ```

## Production deployment (free tier)

See the design doc §1 for the host map. Concrete steps:

- **Neon Postgres**: sign up for free tier → copy DSN → set `DATABASE_URL` on workers + gateway.
- **Oracle Cloud Always Free** (ARM ampere): provision one VM, install Redis + run workers via systemd. Open port 6379 to your other tenants only.
- **Fly.io free**: `fly launch --dockerfile backend/pipeline/Dockerfile.gateway` → `fly deploy`. Free allowance covers 3 shared-cpu-1x machines.
- **Cloudflare R2**: create bucket, generate S3-compatible token, set the 4 `R2_*` env vars.

## Verification

Quick local smoke test (no Postgres needed):

```bash
pytest backend/tests/pipeline/ -v
```

Full integration sweep with a running Postgres:

```bash
docker compose up -d postgres redis
DATABASE_URL=postgresql://soccer:soccer@localhost:5432/soccer_predictor \
    REDIS_URL=redis://localhost:6379/0 \
    pytest backend/tests/pipeline/ -v
```

End-to-end live flow:

```bash
# terminal 1
DATABASE_URL=... REDIS_URL=... uvicorn backend.pipeline.gateway.app:app --port 8001
# terminal 2
DATABASE_URL=... REDIS_URL=... python -m backend.pipeline.workers.postgres_writer
# terminal 3
DATABASE_URL=... REDIS_URL=... python -m backend.pipeline.workers.prediction_recomputer
# terminal 4
wscat -c ws://localhost:8001/ws/match/m-test
# terminal 5: publish an event via the Phase 3 snippet
```

Within 5 s of publishing the event the client should see a `snapshot` → `event` → `prediction` sequence.

## Troubleshooting

- **`alembic upgrade head` fails with `relation "core.foo" does not exist`** — the migration applies DDL from `backend/pipeline/pg/schema.ALL_DDL` in order. Drop the schemas (`DROP SCHEMA ... CASCADE` for raw, staging, core, features, archive) and retry.
- **Backfill skips matches** — usually a team referenced in `matches` has no corresponding row in `teams`. The script logs the count under `matches_skipped`. Inspect and fix in SQLite first.
- **Gateway `/health` shows `redis_configured: false`** — `REDIS_URL` is unset in the container. Check `docker compose config` and your env.
- **Free-tier budget on API-Football hit zero** — `SELECT value FROM core.pipeline_meta WHERE key = 'api_football.budget';` shows the daily counter. Resets next UTC day.
