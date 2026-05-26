# Screenshot comparison

How visual regression is captured across the FotMob-inspired redesign sprint.

## Harness

[`scripts/screenshot.ts`](../scripts/screenshot.ts) (run via `npm run shoot -- <phase-label>`) boots a private `next dev` on port **3002**, then iterates every route × universe × viewport variant and writes PNGs to `scripts/screenshots/<phase-label>/`. The phase label scopes one capture session — directories accumulate, never overwrite — so any two phases can be diffed side-by-side.

Source of truth for routes lives at the top of [`scripts/screenshot.ts`](../scripts/screenshot.ts). The harness intentionally **does not** start the FastAPI backend on `:8000`; pages that depend on it render their honest empty/error state. This is the right thing for visual regression — we want to see what users see when a surface degrades.

## Variants per route

| Variant | Viewport | reduce-motion |
|---|---|---|
| `desktop` | 1440 × 900 | no |
| `mobile` | 375 × 812 | no |
| `reduced` | 1440 × 900 | yes |

Plus per-route universe variants:
| Universe | Query string | Applies to |
|---|---|---|
| `men` | none (default) | all routes |
| `women` | `?gender=women` | gendered routes only — home, matches, predict, accuracy, simulator, upcoming, news |

## File naming

`<route-slug>__<universe>__<variant>.png`

Example: `match-detail__men__mobile.png`, `accuracy__women__reduced.png`.

## Phase 0 baseline (committed as `scripts/screenshots/phase-0-baseline/` — gitignored)

Captured on `feat/fotmob-redesign-2026` at the start of the redesign sprint, before any visual changes. **54 of 57 expected screenshots succeeded.**

### What succeeded — 18 route×universe combos × 3 variants each, minus 3

| Route slug | Men | Women | Notes |
|---|---|---|---|
| `home` | 1 of 3 ⚠ | 2 of 3 ⚠ | 3 variants timed out on `ECONNREFUSED 127.0.0.1:8000` — home hits FastAPI for live tickers and the harness deliberately doesn't boot uvicorn. Acceptable degradation; the captured frames still show the failure mode users would see. |
| `matches` | ✓✓✓ | ✓✓✓ | |
| `match-detail` (id=746662) | ✓✓✓ | n/a | Non-gendered route; PSG vs Toulouse fixture from `predictions_2026-04.json` |
| `league-eng1` | ✓✓✓ | n/a | |
| `league-eng-w1` | ✓✓✓ | n/a | Women's league rendered under "men" universe slug because the league_id encodes gender |
| `predict` | ✓✓✓ | ✓✓✓ | |
| `accuracy` | ✓✓✓ | ✓✓✓ | |
| `simulator` | ✓✓✓ | ✓✓✓ | |
| `upcoming` | ✓✓✓ | ✓✓✓ | |
| `news` | ✓✓✓ | ✓✓✓ | |
| `design-system` | ✓✓✓ | n/a | Currently a 404 — route doesn't exist yet. Captured to lock in the 404 baseline so we can see the route appear in Phase 0.E. |
| `about` | ✓✓✓ | n/a | |

Where ✓✓✓ = desktop + mobile + reduced succeeded.

### What the baseline captures (i.e. what we want to *replace*)

This is the visual debt to measure against:

1. **Dense uppercase tracking labels** at 10–11px — visible on hero eyebrows ([`home/HeroSpotlight.tsx`](../src/components/home/HeroSpotlight.tsx) line ~70), league section headers ([`.league-header`](../src/app/globals.css) class), and match list captions. The replacement: `text-meta` (13px, non-uppercase) reserves `text-caption` for chip labels only.
2. **⚽ emoji decoration** at multiple sizes — visible in:
   - Footer brand mark
   - LeagueStats placeholder hero
   - MLMetricsVisualizations background watermark (text-7xl / 8xl / 9xl)
   - MatchMomentum goal markers inside SVG
   - Several status states inside `matches/[id]/page.tsx`
3. **Unthemed Recharts** in `GoalsDistributionChart.tsx` (hardcoded `#82ca9d`) and `ResultDistributionChart.tsx` (hardcoded `{ win: '#00C853', draw: '#FFD700', loss: '#FF5252' }`) — visible on `/predict` and a few stat surfaces. The replacement: route through [`useChartTheme()`](../src/components/charts/theme.ts).
4. **No sticky scoreline** on `/matches/[id]` — score header scrolls away with the rest of the hero. The replacement: `StickyScoreBar` appears below the topbar when the user scrolls past the hero (z-stack: topbar 50, StickyScoreBar 40, tab bar 30).
5. **Pill-style tab indicators** instead of FotMob's underline style — `/matches/[id]` and `/matches` both. The shadcn `Tabs` primitive already supports underline via `data-state=active` border-bottom; we just need to apply it.
6. **/design-system route 404** — the gallery doesn't exist yet, so contributors have nothing to point at when adding a new primitive.

### What we do NOT change

To prevent regressions on surfaces that are working well:

- AppShell sidebar/topbar/mobile bottom nav geometry — keep current proportions, only refine groupings.
- CalibrationPlot and ConfusionHeatmap visual encoding — already token-aware, custom SVG. Only refresh accent colours via tokens.
- FormationDisplay SVG pitch geometry — only add team-tint props, PlayerAvatar overlay, RatingPill, and pitch-line tokens. Don't redesign the pitch itself.
- 16 shadcn primitives — keep as-is; they're a known surface area.

## Per-phase capture cadence (planned)

The plan calls for a baseline before any change, then a checkpoint after each phase, and a final pass against the baseline at Phase 5:

| Phase | Capture label | What changed since previous |
|---|---|---|
| 0 (start) | `phase-0-baseline` | ✅ Captured (this commit) |
| 0 (end) | `phase-0-foundation` | Token deltas, typography (`meta` + `numeric`), emoji cleanup, `/design-system` route live. Visual changes should be subtle — labels less uppercase, no emoji, JetBrains Mono on scorelines. |
| 1 (end) | `phase-1-data-pipelines` | Backend-only — visual diff should be ≈ zero. Captured for safety. |
| 2 (mid) | `phase-2-decompose-checkpoint` | After extracting FotmobStatsCard / DuelStatRow / PredictionInsightPanel / LiveWinProbabilityPanel from `matches/[id]/page.tsx` but before adding new sections. Diff should be **exactly zero** on `match-detail__*` — this is the regression-detection gate for the decomposition. |
| 2 (end) | `phase-2-match-detail` | StickyScoreBar, six-tab layout, MetaChipRow, EventTimeline, ShotMap, FormationDisplay v2 visible. Largest diff of the sprint. |
| 3 (end) | `phase-3-home` | Hero / LiveTicker / AIInsightsBento / NewsStrip refresh. `home__*` should be dramatically different. |
| 4 (end) | `phase-4-rest` | /predict, /accuracy, /simulator, /upcoming, /leagues/[id] all polished. |
| 5 (end) | `phase-5-final` | a11y + reduced-motion + chart token migration done. Diff vs baseline tells the full sprint story. |

## How to diff two phases

The output PNGs are full-page (`fullPage: true`), so simple side-by-side review is enough for most checks. For pixel-level diffing, a one-line tool like `compare -metric AE phase-0-baseline/match-detail__men__desktop.png phase-2-match-detail/match-detail__men__desktop.png diff.png` (ImageMagick) or `pixelmatch` against the two files works without any harness changes.

For the Phase-2 decomposition gate specifically, **diff should be byte-equivalent** on `match-detail__*` after extraction-only commits. Any visual delta there means a CSS regression slipped in with the move — fix before moving on.

## Limitations of the baseline

1. **No FastAPI = no live data on the home page.** Three home variants failed entirely; some sub-surfaces on /accuracy, /matches, /predict render their empty states (where data depends on uvicorn). This is honest but means certain visual elements (live ticker, model accuracy headline) aren't captured.
2. **Match ID `746662` is a finished fixture from 2026-04-03.** The page renders fine but won't exercise live-state visuals (StickyScoreBar's BorderBeam, live-pulse on the score). Phase 2 verification will need a separate live-fixture capture during a live match window.
3. **Universe screenshots use `?gender=women` query param only.** Some routes' women's universe falls back to default behaviour if the page doesn't thread `useGenderQuery` (legacy surfaces). That gap is visible in the captures and is itself a Phase 4 to-do.
4. **Light mode is not captured.** The harness always shoots dark mode (the user's default, like FotMob). A future enhancement could add a `theme` axis. Not needed for the FotMob-inspired direction since dark is the design target.
