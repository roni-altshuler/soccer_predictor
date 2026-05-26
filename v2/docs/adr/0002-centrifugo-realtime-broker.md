# ADR 0002 — Centrifugo (self-hosted) over Ably/Pusher SaaS or native WebSockets

**Status:** Accepted (2026-05-24)
**Owners:** `realtime-svc` team
**Supersedes:** v1 SWR polling

## Context

Live football events fan out to thousands of concurrent viewers per match. A CL final + Liverpool–Arsenal weekend realistically pushes >50k concurrent connections; payloads must arrive within ~1s of the source event. We need: presence (Pro+ tier sees "who's watching"), per-channel history (late-subscriber replay of last 200 events), JWT auth, horizontal scale across pods, and a small ops footprint.

## Decision

**Centrifugo 5.x, self-hosted on EKS**, with the Redis engine for cross-pod fan-out. Channels: `match:{id}`, `competition:{slug}:matches`, `user:{id}:notifications`, `admin:health`.

## Alternatives considered

- **Native `websockets`** (uvicorn-websockets): fine for a single replica. At 10+ pods you build your own pub/sub fan-out, presence tracking, JWT verification, history replay — all of which Centrifugo gives out of the box.
- **Socket.IO**: heavy protocol, fewer non-JS clients (we want Go/Python B2B subscribers eventually), harder ops story.
- **Ably / Pusher SaaS**: gorgeous DX, but at 100K MAU with 50k+ matchday concurrency the bill explodes (Ably's Hobby tier is 200 conn; Production starts at ~$2k/mo and scales steeply per million messages). Centrifugo on three `c7g.xlarge` pods costs us pocket change and we own the data path.

## Consequences

**Positive**
- Free OSS, predictable cost.
- Built-in JWT auth, presence, history, recover-on-reconnect, namespaces.
- Horizontal scale via Redis engine + sticky sessions on ALB (sticky for reconnect-churn reduction, not protocol correctness).

**Negative**
- One more service to operate. Mitigated by: simple deploy (one binary), prebuilt Helm chart, Grafana dashboards for `centrifugo_num_clients`.
- Centrifugo is not as well-known as Socket.IO in JS ecosystems → onboarding tax for new FE engineers. Mitigated by canonical wrapper at `apps/web/src/lib/realtime/centrifugo.ts`.

## Implementation notes

- Connect-token flow: browser → `/v1/realtime/token` (cookie-authed) → 5-min Centrifugo JWT with `sub`, `tier`, `channels` allowlist → browser opens `wss://rt.fotpredict.com/connection/websocket`. `centrifuge-js` handles refresh.
- Channel namespaces declared in `infra/local/centrifugo.json` (mirrored to prod via Helm values).
- Event source-of-truth: `ingestion-svc` writes normalised events to Redis Stream `stream:match-events`; the `cg:realtime` consumer group in `realtime-svc` publishes to Centrifugo HTTP API.
- Scaling target: 8k connections per pod (HPA on `centrifugo_num_clients` Prometheus metric). For >100k concurrent, shard by `hash(match_id)` into multiple Centrifugo clusters — deferred until needed.

## References

- Blueprint §8 — Realtime Architecture (`~/.claude/plans/act-as-a-senior-iterative-corbato.md`)
- Centrifugo namespace config: [`../../infra/local/centrifugo.json`](../../infra/local/centrifugo.json)
