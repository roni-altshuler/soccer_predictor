# Repository Audit — 2026-06-02

A production-readiness review of the Pitchwise repository, with a prioritized action plan.
Scoped to evidence gathered from the codebase; supersedes the high-level
`docs/PROJECT_AUDIT_2026-05-03.md` for repo-hygiene concerns.

## Snapshot

| Metric | Value | Note |
|---|---|---|
| Frontend test files (Jest) | 8 | `src/**/__tests__` |
| Backend test files (pytest) | 16 | `backend/tests/` |
| ESLint warnings | 187 | mostly `@typescript-eslint/no-explicit-any` |
| `any` usages in `src/` | 127 | typing debt, concentrated in `lib/` + hooks |
| TODO/FIXME/HACK markers | 4 | low — healthy |
| Production deps / dev deps | 39 / 12 | reasonable for the surface area |
| Secrets committed | none | ✅ verified via `git ls-files` |

## Strengths

- **Clear two-stream architecture** (Next.js `src/` + FastAPI `backend/`) with documented
  boundaries in `CLAUDE.md` and `docs/ARCHITECTURE_V2.md`.
- **Strong conventions already enforced** — CSS-variable theming, server-first components,
  data-provenance honesty (`DataSourceBadge`), and a canonical gender-threading hook
  (`useGenderQuery`).
- **Real test coverage on both sides** (Jest + pytest) and an existing backend CI workflow.
- **Honest ML governance** — calibration/Brier tracking, model-selection quality gates, and an
  audit-only odds comparison that refuses to give betting advice.
- **No secrets in the repo**; configuration is environment-driven.

## Findings & prioritized action plan

### P0 — addressed in this change

- **Broken icon/OG references (production bug).** Document metadata referenced `favicon-32.png`,
  `favicon-16.png`, `apple-touch-icon.png`, and `brand/og-default.png`, none of which existed →
  404s for tab icons, the iOS icon, and the social/link-preview card. **Fixed:** all assets are
  now generated from brand SVGs via `scripts/generate-icons.mjs` (`npm run icons`) and committed.
- **No open-source/community baseline.** Missing `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`,
  `CHANGELOG.md`, issue/PR templates, and frontend CI. **Fixed:** all added; CI runs lint →
  typecheck → test → build on every PR.

### P1 — high value, do next

1. **Oversized components hurt maintainability.** Several files exceed ~1,300 lines and mix data
   fetching, state, and presentation:
   - `src/app/(app)/matches/[id]/page.tsx` (**1,944**)
   - `src/components/tournament/TournamentHomePage.tsx` (1,640)
   - `src/components/league/LeagueHomePage.tsx` (1,611)
   - `src/components/tracking/AccuracyDashboard.tsx` (1,293)
   - `src/components/tournament/BracketChallengeBoard.tsx` (1,116)

   _Action:_ extract data hooks (`useMatchDetail`, `useTournament*`) and split presentational
   sub-components. Target < ~400 lines per file. Do this incrementally, one surface per PR, with
   screenshots to prove parity.
2. **Typing debt (127 `any`, 187 lint warnings).** Concentrated in `src/lib/api.ts`,
   `src/hooks/useMatches.ts`, `usePredictions.ts`. _Action:_ introduce typed response models
   (extend `src/lib/types/`), replace `any` incrementally, then flip CI lint to
   `--max-warnings=0` once the count reaches zero to lock the gate.
3. **Frontend test coverage is thin vs. backend** (8 vs 16 files) and concentrated on utilities.
   _Action:_ add component/interaction tests for the highest-traffic surfaces (Match Centre,
   PredictionResult, AccuracyDashboard) and the new marketing demos' fallback behavior.

### P2 — strengthen over time

4. **API-route ↔ FastAPI duplication.** Node API routes in `src/app/api/` re-implement slices of
   backend logic for Vercel. _Action:_ extract shared response shapes/contracts into
   `src/lib/types/` (some exist) and document the split in `docs/route-architecture.md` so the two
   implementations can't drift silently.
5. **Dependency hygiene.** Run `npm audit` / `pip-audit` in CI on a schedule; consider Dependabot
   or Renovate for batched updates. Periodically prune unused packages (39 prod deps).
6. **Performance.** The very large client pages ship sizable JS. _Action:_ measure with the
   existing screenshot/Lighthouse harness, then code-split heavy tabs (lazy `import()`), as already
   done for the marketing demos. Measure before optimizing.
7. **Observability.** `src/lib/observability/` exists; ensure error boundaries and structured
   logging cover the new marketing routes and the API proxy routes.

## Security review summary

- ✅ No secrets committed; env-driven config; `NEXT_PUBLIC_` reserved for client-safe values.
- ✅ Provider data never synthesized; odds ingestion is audit-only and disabled without a key.
- ⚠️ Add automated dependency vulnerability scanning to CI (see P2.5).
- ⚠️ Confirm input validation on the Node API routes that accept user input (e.g.
  `/api/predict/any-teams`, bracket-room POSTs) — validate/escape before use. See `SECURITY.md`.

## What "done" looks like

A new engineer can clone, `npm install`, `npm run dev`, and be productive in minutes (README +
CONTRIBUTING); every PR is automatically validated (CI); the project is legally clear (MIT) and
has a private path for vulnerability reports (SECURITY). The remaining P1/P2 items are tracked,
incremental, and individually shippable — no big-bang rewrite required.
