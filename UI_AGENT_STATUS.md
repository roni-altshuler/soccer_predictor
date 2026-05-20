# UI Agent — Phase 2 status

Status notes from the Phase 2 UI Overhaul background job.
Working tree: branch `worktree-agent-a3dec5e075b702f3d`
(linked worktree of `feat/unified-model-and-ui-overhaul`).

## Critical environment blockers (open)

The agent runs in a sandbox that **denies execution of `npm`, `npx`, `node`,
`git add`, and `git commit`**. Read-only git (`git status`, `git diff`,
`git log`, `git branch`) is allowed. File edits via the harness are allowed.

Concrete consequences:

1. **Cannot `npm install`.** All new dependencies are declared in
   `package.json` but not yet present in `node_modules`. None of the new
   shadcn primitives, framer-motion, lucide-react, cmdk, @vercel/og,
   tailwindcss-animate, class-variance-authority, clsx, tailwind-merge,
   sharp, or @axe-core/cli will resolve until the user runs
   `npm install`.
2. **Cannot create per-milestone commits.** The brief asks for one
   commit per milestone (six total). Because `git add` and `git commit`
   are sandbox-denied, *all* changes sit in the working tree uncommitted.
   The user must stage and commit them manually. A suggested commit
   layout is given in the "Commit plan" section below so the user can
   replay the per-milestone history.
3. **Cannot run `npm run build`, `npm run dev`, `npx axe`, or
   `npx lighthouse`.** No before/after Lighthouse comparison, no a11y
   audit. Once `npm install` succeeds locally the user should run all
   four for verification.
4. **Cannot generate raster (PNG) brand assets.** The agent created the
   SVG sources of truth (`public/favicon.svg`, `public/brand/logo*.svg`,
   `public/brand/og-default.svg`) and a `scripts/generate-brand-assets.mjs`
   Node script. After `npm install --save-dev sharp` the user should
   `node scripts/generate-brand-assets.mjs` to emit
   `favicon-16/32/192/512.png`, `apple-touch-icon.png`, and
   `brand/og-default.png`.

## What ships in this worktree

### Milestone 1 — Foundation (complete in files)

- `package.json` — declares shadcn deps, framer-motion, lucide-react,
  cmdk, radix primitives, class-variance-authority, clsx,
  tailwind-merge, tailwindcss-animate, @vercel/og, @axe-core/cli.
- `components.json` — shadcn metadata (new-york style, slate base,
  CSS variables, alias to `@/components/ui` and `@/lib/utils`).
- `src/lib/utils.ts` — `cn`, `clamp`, `formatPct` helpers.
- `src/components/ui/` — hand-authored shadcn primitives:
  `button`, `card`, `badge`, `skeleton`, `separator`, `progress`,
  `avatar`, `tabs`, `tooltip`, `dialog`, `dropdown-menu`,
  `scroll-area`, `sheet`, `toast`, `command`, plus
  `animated-counter` (Framer Motion KPI counter).
- `tailwind.config.js` — full typography scale (`display`, `h1`–`h4`,
  `body`, `small`, `caption`), shadcn token bridge,
  `tailwindcss-animate` plugin, new shadow/keyframe utilities.
- `src/app/globals.css` — new brand tokens
  (`--accent-primary` = green, `--accent-ai` = cyan,
  `--accent-warn` = amber, `--accent-loss` = red), refreshed light +
  dark palettes, `prefers-reduced-motion` honoured, shimmer animation
  for Skeletons. Backwards-compatible legacy classes preserved.
- `src/app/layout.tsx` — Inter via `next/font/google` as the sole
  typeface (Sora + Source Sans 3 dropped). Real OG/Twitter metadata
  with `metadataBase`, title template, OG image reference. `viewport`
  export carries `themeColor`. Legacy `--font-body`/`--font-heading`
  aliased to Inter for transitional compatibility.

### Milestone 2 — Branding & Layout (complete in files)

- `public/brand/logo.svg` — full wordmark (mark + "FotPredict" +
  cyan "AI" pill), uses `currentColor` for the wordmark so it adapts
  to dark/light mode automatically.
- `public/brand/logo-mark.svg` — mark only (48×48 viewBox).
- `public/brand/logo-light.svg` — wordmark with fixed dark text.
- `public/brand/logo-dark.svg` — wordmark with fixed light text.
- `public/favicon.svg` — mark-only favicon (modern browsers).
- `public/brand/og-default.svg` — 1200×630 default OG image source.
- `scripts/generate-brand-assets.mjs` — Node script that rasterises
  the SVGs to PNG (favicon-16/32/192/512, apple-touch-icon-180,
  og-default-1200x630). Requires `sharp` (added to devDeps via the
  npm-install step).
- `src/app/api/og/[matchId]/route.tsx` — Edge-runtime dynamic OG
  image route. Reads `?home=`, `?away=`, `?league=`, `?hg=`, `?ag=`,
  `?hp=`, `?dp=`, `?ap=` query params and renders a 1200×630
  prediction share card. Falls back to a generic FotPredict card when
  probs are not provided.
- `src/components/Navbar.tsx` — soccer-ball emoji swapped for
  `/brand/logo-mark.svg` in both desktop and mobile headers, with
  proper `aria-label`. GenderToggle added to both layouts.
- `public/manifest.json` — name, description, and theme colours
  updated to FotPredict AI palette (#22c55e theme color, #07101f bg).

### Milestone 3 — Toolkit additions (partial)

The big page rewrites (`src/app/page.tsx` hero, MatchCard refactor,
predict-page wizard) were **not done** — see "Why I stopped" below.
What did ship is the supporting toolkit so a future pass can wire it up
quickly:

- `src/hooks/useGenderPreference.ts` — localStorage-backed
  `gender: 'men' | 'women'` hook with cross-tab sync via the
  `storage` event. Consumers should pass `?gender=${gender}` to
  prediction APIs (see UI_AGENT_BACKEND_REQUESTS.md).
- `src/components/GenderToggle.tsx` — segmented control used by
  the navbar in both desktop and mobile layouts.

### Milestone 5 — Chart theme (partial)

- `src/components/charts/theme.ts` — `useChartTheme()` hook that
  reads CSS variables and re-evaluates on `.dark` class flip. Static
  `fallbackChartTheme` exported for SSR / non-React modules. Includes
  a `series` palette and `home`/`draw`/`away` named channels.
- Existing `*Chart.tsx` wrappers were **not** ported to consume the
  theme (would require touching every chart in the codebase — best done
  with verification, see "Why I stopped").

### Milestone 6 — Empty states (partial)

- `src/components/EmptyState.tsx` — reusable Framer-Motion empty
  state with illustration / title / description / action slots.
- `public/illustrations/` — six brand-aligned SVG illustrations:
  - `no-matches.svg` (no fixtures today)
  - `no-predictions.svg` (no AI predictions yet)
  - `no-tracked.svg` (empty watchlist)
  - `data-error.svg` (fetch failure)
  - `celebrate.svg` (correct prediction / milestone reached)
  - `searching.svg` (search returned nothing)

## What did NOT ship

Big-surface refactors require verification (TypeScript compile, render
test, screenshot diff) which the sandbox cannot provide. Doing them
blind risked breaking pages the user already uses. The following pieces
were deliberately deferred:

- `src/app/page.tsx` — hero section + animated KPI strip (the
  `AnimatedCounter` primitive is in place to plug in).
- `src/components/match/MatchCard.tsx` — shadcn `Card` refactor,
  form sparkline, league crest, ML-pick probability bar.
- `src/components/prediction/PredictionCard.tsx` — three-bar
  probability viz, circular confidence gauge, top-4 scoreline grid,
  factors panel.
- `src/app/predict/page.tsx` — 3-step wizard using shadcn `Command`.
- `src/components/tracking/AccuracyDashboard.tsx` — KPI cards,
  calibration plot, confusion-matrix heatmap, per-league mini cards.
- Porting every `*Chart.tsx` to consume `useChartTheme()`.
- Replacing every `Loading...` string with `<Skeleton/>` patterns.

## Why I stopped

The brief says: "If something is genuinely blocked (e.g., shadcn
install fails), commit what you have, note the blocker in
UI_AGENT_STATUS.md, and move on to the next independent milestone
rather than retrying in a loop."

Three blockers compounded: (1) no `npm install`, so I cannot verify
the TS compiles; (2) no `git commit`, so I cannot checkpoint per
milestone — the brief's whole structure depends on this; (3) no
browser, no axe, no Lighthouse, so I cannot self-verify the visual
result. Rewriting four large existing components on top of those three
constraints would land as a single un-checkpointed blob that the user
might have to throw away. The right move is to deliver a clean
foundation, document what's blocking, and stop before introducing
regressions.

## Suggested commit layout for the user

Once back on a shell that has `git add`/`git commit` permission:

```bash
# Milestone 1
git add package.json components.json src/lib/utils.ts \
        src/components/ui/ tailwind.config.js \
        src/app/globals.css src/app/layout.tsx
git commit -m "feat(ui): scaffold shadcn/ui, framer-motion, lucide-react, typography scale"

# Milestone 2
git add public/brand/ public/favicon.svg public/manifest.json \
        scripts/generate-brand-assets.mjs \
        src/app/api/og/ src/components/Navbar.tsx
git commit -m "feat(ui): brand identity, logo, favicons, dynamic OG images"

# Toolkit for milestones 3/5/6 (the parts that DID ship)
git add src/hooks/useGenderPreference.ts src/components/GenderToggle.tsx \
        src/components/charts/theme.ts \
        src/components/EmptyState.tsx public/illustrations/
git commit -m "feat(ui): gender toggle, chart theme hook, empty-state kit"

# Status & backend handoff
git add UI_AGENT_STATUS.md UI_AGENT_BACKEND_REQUESTS.md
git commit -m "docs(ui): phase 2 progress notes and backend handoff"
```

## Lighthouse / a11y / build verification

Could not run from inside the sandbox. To capture before/after locally:

```bash
npm install
npm run build           # MUST succeed before merging
npm run dev             # smoke
npx axe http://localhost:3000           # a11y (devDep already added)
npx lighthouse http://localhost:3000 \
   --output html --output-path lighthouse-after.html --view
```

For a before/after Lighthouse, capture the same command on `main`
first, then re-run on this branch.
