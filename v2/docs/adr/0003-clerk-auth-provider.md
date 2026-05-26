# ADR 0003 — Clerk over Auth.js / Supabase Auth

**Status:** Accepted (2026-05-24)
**Owners:** `api-gateway-svc` + `apps/web` teams
**Supersedes:** v1 no-auth public inference

## Context

v2 is a multi-tenant SaaS with three tiers (Free, Pro, Enterprise), per-organisation API keys, MFA expected by Enterprise, and Next.js 15 App Router throughout. We don't want to be coupled to a specific database flavour for the rest of the stack.

## Decision

**Clerk** as the auth provider. Sessions held in `httpOnly + secure + SameSite=Lax` cookies (`__session`). Cross-origin API calls mint a separate JWT via `getToken({ template: 'fotpredict-api' })`.

## Alternatives considered

| Need | Clerk | Auth.js | Supabase Auth |
|---|---|---|---|
| Multi-tenant orgs out of the box | yes | manual | yes |
| Next.js 15 App Router SDK | yes | yes | yes |
| MFA / SSO / SAML | yes (paid) | manual | yes |
| Hosted user mgmt UI | yes | no | yes |
| Decoupled from DB | yes | yes | NO (forces Supabase Postgres) |
| Webhooks for user lifecycle | yes | manual | yes |
| Cost at 100K MAU | reasonable | free but ops cost | reasonable |

## Consequences

**Positive**
- Orgs, RBAC, MFA, social, SAML SSO ship with the platform — saves quarters of build time.
- Decoupled from Aurora; we mirror Clerk identities into our `users` and `organizations` tables for foreign keys + analytics.
- Hosted user-management UI is good enough for Enterprise self-service.

**Negative**
- Per-MAU pricing past the free tier. Mitigated by negotiating an annual at our SaaS scale; this is the single largest "buy" decision and it's worth it vs the engineering time to build/operate Auth.js.
- Vendor lock for the identity layer. Mitigated by keeping Clerk identifiers (`clerk_user_id`, `clerk_org_id`) as side columns — `users.id` and `organizations.id` are our own and migration is possible if necessary.

## Implementation notes

- DB mirror: `users.clerk_user_id` (UNIQUE), `organizations.clerk_org_id` (UNIQUE). Lifecycle webhook from Clerk → `apps/api-gateway-svc/src/api_gateway/routes/users.py` keeps these in sync.
- B2B keys are separate from Clerk JWTs: `fpk_live_<base32>` (32-byte entropy), SHA-256 hashed in `api_keys.key_hash`, prefix-searchable.
- Tiered access matrix and rate limits: see blueprint §12.4 and §12.5 (`~/.claude/plans/act-as-a-senior-iterative-corbato.md`).

## References

- Schema: [`../../packages/fotpredict-db/src/fotpredict_db/ddl/baseline.py`](../../packages/fotpredict-db/src/fotpredict_db/ddl/baseline.py) (TENANCY block)
