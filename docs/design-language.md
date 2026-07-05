# Pitchwise "Broadcast" design language

The bar: a premium sports-analytics product (FotMob × Linear × a broadcast
scoreboard) — data-forward, disciplined, cinematic where it earns it.
Every page must read as one product. This document is the contract; any
surface that deviates is a bug.

## Hard rules (violations are bugs)

1. **No emoji in chrome.** No 📅/🏴/🇪🇸 as icons or league markers. Use
   lucide icons, league crests (`LeagueBadge`), or country flags via
   `flagcdn.com` (already whitelisted in `next.config.js`).
2. **Real identities, not letter-avatars.** Club matches use ESPN/FotMob
   crests (`TeamBadge`); national teams use country flags. A gray circle
   with an initial is a last resort, never the default for known teams.
3. **No fabricated data, no shameful zeros.** Metrics render only when the
   sample supports them: any rate with `n < 10` in its window shows the
   larger-window or holdout value with an honest caption ("holdout" /
   "all-time"), or hides. `0.0%` from an empty window must never render.
4. **Tokens only.** `var(--*)` colors; no `text-white`/`bg-black`/hex.
5. **Accent discipline.** green `--accent-primary` = results/positive;
   cyan `--accent-ai` = model/AI outputs; amber `--accent-warn` = draws /
   pending; red `--accent-loss` = losses/live; purple `--accent-market` =
   markets. One accent per element — never rainbow a card.
6. **Numbers are data.** `tabular-nums` on every numeric column/stat;
   percentages to one decimal only when < 10 samples ambiguity matters,
   else whole numbers on display surfaces.
7. **Interactive targets ≥ 40px** on touch surfaces (44px for primary).
8. **Reduced motion respected** for any animation added.

## Surface system (depth instead of flat sameness)

Three levels, already tokenized:
- **Canvas** `--background` — page.
- **Card** `--card-bg` + `border-[var(--border-color)]` + `rounded-xl`.
- **Elevated / featured** — card + `shadow-lg` + a 1px inner top highlight
  (`.surface-elevated` utility in globals.css) + optional accent gradient
  gloss for hero/featured only.

Rhythm: cards in one grid share equal heights; section spacing is
`space-y-10` on pages, `gap-4` inside grids. Page content lives in the
shell's max width; hero surfaces may bleed full-width.

## Shared primitives (in `src/components/primitives/` — USE, don't fork)

- **`SectionHeader`** — kicker (11px uppercase tracking-wide tertiary) +
  title (`text-xl font-bold`) + optional description + optional action
  slot (right-aligned link/button). Every section on every page uses it.
- **`StatCard`** — label, big tabular value (`text-3xl font-black`),
  optional delta/sub-caption, optional accent. Replaces the ad-hoc
  bordered stat boxes; supports `size="sm"` for dense rows.
- **`ProbBar`** — inline horizontal stacked W/D/L probability bar
  (green/amber/red at 100% total width, 6px tall, rounded, with optional
  % labels). The signature element: every fixture row that has a
  prediction shows one.
- **`LeagueChip`** — crest/flag + name pill (no emoji), league accent as
  left rail or ring on active. Wraps `getLeagueAccent`.
- **`StatusChip`** — settled/pending/live/correct/incorrect in one
  component: dot + lowercase-caps label, subtle bg tint, never full-sat.
- **`EmptyState`** (exists) for empty; **`AsyncSection`** (exists) for
  loading/error. No bespoke spinners.

## Page anatomy

Every page: compact hero band (kicker + title + one-line description +
right-aligned key stat or action) → sections via `SectionHeader`. Hero
uses the elevated surface with a *subtle* league/AI accent gradient (8-12%
opacity), not a solid color block. Match-centre home keeps its cinematic
hero; other pages use the compact band — no page opens with a bare `<h1>`.

## Fixture rows (consistent EVERYWHERE)

Crest/flag + team names (weight 600, winner-tinted when settled) ·
kickoff/status · venue (tertiary, truncates) · `ProbBar` when a prediction
exists · predicted score chip (cyan tint) when available. Settled rows:
actual score bold + `StatusChip` correct/incorrect. Rows hover:
`bg-[var(--card-hover)]`, no translate jumps in dense lists.

## Tables (history/diagnostics/standings)

Sticky header row, `tabular-nums`, zebra via `--muted-bg` at 40%,
grouped by date with day dividers, paginated or "load more" past 25 rows,
filters as segmented controls (not pill soup). Status via `StatusChip`.

## What premium looks like per accent moment

- AI/model outputs get the cyan treatment + the model chip
  (`unified-multitask…` → display "Unified v2").
- Live gets the red pulse dot (existing `LiveBadge`).
- League context uses `leagueAccents.ts` rails (4px left border) on
  league-scoped sections.

## Known baseline defects to eliminate (from the 2026-07-02 audit)

- Home: `0.0%` 30-day hit-rate rendered twice (empty window) — apply rule 3.
- Home: hero says 3 upcoming while Match Centre chips say 0 — one source
  of truth for today's counts.
- Home fixture rows: no probabilities, letter avatars for national teams.
- Upcoming: emoji calendar icon, emoji flag chips, empty-box calendar,
  Premier League default in July (default to the league with matches
  today; during the World Cup that's `fifa.world`).
- History: 100 identical PENDING rows, no grouping/pagination; add the
  fixture-row treatment + settled coloring + date grouping.
- News: fine bones; featured overlay needs a gradient scrim for contrast.
- Tiny targets: simulator (17), history (15), welcome (14), home (7).
- Console 404s on world-cup + team-detail; league page fetches ESPN
  client-side and hits CORS — move to a Next API route.
