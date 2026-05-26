# Design tokens

Every CSS variable defined in [src/app/globals.css](../src/app/globals.css), grouped by purpose. Both light (`:root`) and dark (`.dark`) values shown. **Components should never hard-code hex** — read these tokens via Tailwind arbitrary syntax (`text-[var(--text-primary)]`) or through [charts/theme.ts](../src/components/charts/theme.ts).

## Phase-0 status

The token system already covers most of what the FotMob-inspired redesign needs (50+ tokens). Phase 0.A adds **only the 7 small deltas** flagged in the second column.

## Surfaces

| Token | Light | Dark | Use |
|---|---|---|---|
| `--background` | `#f5f7fb` | `#07101f` | App canvas |
| `--background-secondary` | `#fafcff` | `#0c182a` | Section surfaces |
| `--background-tertiary` | `#e9eef7` | `#14223a` | Subtle elevation |
| `--card-bg` | `#ffffff` | `#111e36` | Cards |
| `--card-hover` | `#f3f6fc` | `#182944` | Card hover state |
| `--input-bg` | `#f4f7fc` | `#0d1a30` | Form fields |
| `--muted-bg` | `#eef2f9` | `#182944` | Muted containers |
| `--nav-bg` | `rgba(250,252,255,0.86)` | `rgba(11,22,39,0.82)` | Glass header / sidebar |
| `--nav-border` | `rgba(176,192,215,0.55)` | `rgba(52,78,117,0.5)` | Glass divider |
| `--overlay-bg` | `rgba(15,26,44,0.45)` | `rgba(0,0,0,0.55)` | Modal scrim, page loader |

## Text

| Token | Light | Dark | Use |
|---|---|---|---|
| `--text-primary` | `#0f1a2c` | `#f1f5fb` | Body, headlines |
| `--text-secondary` | `#3a4b66` | `#a8bcdb` | Sub-copy |
| `--text-tertiary` | `#5d7290` | `#7d92b3` | Labels, captions |
| `--accent-on-primary` | `#04120a` | `#04120a` | Text on green/cyan CTAs |
| `--pitch-text` | `#f1f5fb` | `#f1f5fb` | Lineup pitch text |

## Brand accents

| Token | Light | Dark | Use |
|---|---|---|---|
| `--accent-primary` | `#16a34a` | `#22c55e` | Green — wins, primary CTA |
| `--accent-primary-soft` | `#4ade80` | `#4ade80` | Lighter green for gradients |
| `--accent-ai` | `#06b6d4` | `#22d3ee` | Cyan — AI, predictions |
| `--accent-ai-soft` | `#67e8f9` | `#67e8f9` | Lighter cyan |
| `--accent-warn` | `#f59e0b` | `#fbbf24` | Amber — draws, uncertainty |
| `--accent-warn-soft` | `#fbbf24` | `#fde047` | Lighter amber |
| `--accent-loss` | `#ef4444` | `#f87171` | Red — losses |
| `--accent-loss-soft` | `#f87171` | `#fca5a5` | Lighter red |
| `--accent-secondary` (alias) | → primary-soft | → primary-soft | Backwards compat |
| `--accent-ai-light` (alias) | → ai-soft | → ai-soft | Backwards compat |

## Semantic status

| Token | Resolves to | Use |
|---|---|---|
| `--success` | `--accent-primary` | Positive states |
| `--warning` | `--accent-warn` | Caution states |
| `--danger` | `--accent-loss` | Errors |
| `--info` | `--accent-ai` | Informational |

## Live state

| Token | Light | Dark | Use |
|---|---|---|---|
| `--live-bg` | `rgba(239,68,68,0.08)` | `rgba(248,113,113,0.12)` | Live match background |
| `--live-border` | `rgba(239,68,68,0.25)` | `rgba(248,113,113,0.32)` | Live match border |
| `--live-text` | `#dc2626` | `#fca5a5` | Live match text |

## Pitch (lineup formation surface)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--pitch-bg` | `#0d2918` | `#0a1e10` | Dark green pitch background |
| `--pitch-text` | `#f1f5fb` | `#f1f5fb` | Text on pitch |

## Borders & shadows

| Token | Light | Dark | Use |
|---|---|---|---|
| `--border-color` | `#d8e0ee` | `#243954` | Default borders |
| `--border-hover` | `#b2bfd5` | `#38567e` | Hover borders |
| `--shadow-sm` | `0 1px 2px rgba(15,26,44,0.06)` | `0 1px 2px rgba(2,7,16,0.55)` | Resting cards |
| `--shadow-md` | `0 8px 18px rgba(15,26,44,0.09)` | `0 10px 22px rgba(2,7,16,0.5)` | Hover / focus |
| `--shadow-lg` | `0 18px 34px rgba(15,26,44,0.14)` | `0 24px 44px rgba(2,7,16,0.62)` | Lifted / sticky |

## Glass / bento

| Token | Light | Dark | Use |
|---|---|---|---|
| `--glass-bg` | `rgba(255,255,255,0.62)` | `rgba(12,24,42,0.62)` | Glass containers |
| `--glass-border` | `rgba(176,192,215,0.42)` | `rgba(52,78,117,0.4)` | Glass border |
| `--glass-blur` | `saturate(160%) blur(14px)` | (same) | backdrop-filter |
| `--bento-hl` | `color-mix(in srgb, var(--accent-ai) 16%, transparent)` | `... 22% ...` | Bento card halo (cyan) |
| `--bento-hl-primary` | `... var(--accent-primary) 16% ...` | `... 22% ...` | Bento card halo (green) |

## Computed surfaces

| Token | Value |
|---|---|
| `--tab-active-bg` | `color-mix(in srgb, var(--accent-primary) 14%, transparent)` (light) / 18% (dark) |
| `--surface-highlight` | `color-mix(in srgb, var(--accent-ai) 10%, transparent)` (light) / 14% (dark) |
| `--surface-glow` | `color-mix(in srgb, var(--accent-primary) 18%, transparent)` (light) / 22% (dark) |
| `--match-card-bg` | → `--card-bg` |
| `--ticker-bg` | `linear-gradient(to right, #14223a, #1c2c4d)` (light) / `#07101f → #14223a` (dark) |

## Shell layout

| Token | Value | Use |
|---|---|---|
| `--shell-sidebar-w` | `68px` | Icon-rail width |
| `--shell-sidebar-w-expanded` | `232px` | Hover-expanded width |
| `--shell-topbar-h` | `60px` | Sticky topbar height |
| `--shell-content-max` | `1320px` | Main content max-width |
| `--radius` | `0.75rem` | Default border-radius (shadcn) |

## Phase 0.A deltas (to be added in this sprint)

These seven tokens are **new** — added on top of the existing 50+. They unblock the FotMob-style visual moves the redesign requires.

| Token | Light | Dark | Purpose |
|---|---|---|---|
| `--accent-pitch-line` | `rgba(241,245,251,0.18)` | `rgba(241,245,251,0.18)` | Visible pitch markings on `--pitch-bg` |
| `--accent-pitch-line-strong` | `rgba(241,245,251,0.32)` | `rgba(241,245,251,0.32)` | Centre circle, penalty arc, halfway line |
| `--rating-bg-high` | `color-mix(in srgb, var(--accent-primary) 22%, transparent)` | `... 28% ...` | AI impact pill — top tier (8–10) |
| `--rating-bg-mid` | `color-mix(in srgb, var(--accent-warn) 22%, transparent)` | `... 28% ...` | AI impact pill — mid tier (5–7) |
| `--rating-bg-low` | `color-mix(in srgb, var(--muted-bg) 80%, var(--text-tertiary) 20%)` | (same) | AI impact pill — low tier (0–4) |
| `--team-tint-home` | (overridden inline per-match) | (same) | Default `#22c55e` slot; inline `style={{ '--team-tint-home': '#…' }}` per match |
| `--team-tint-away` | (overridden inline per-match) | (same) | Default `#f87171` slot |
| `--headshot-ring` | `rgba(15,26,44,0.18)` | `rgba(241,245,251,0.22)` | 2px ring around PlayerAvatar |
| `--score-numeric-shadow` | `none` | `0 0 22px color-mix(in srgb, var(--accent-primary) 38%, transparent)` | Glow under StickyScoreBar scoreline |
| `--meta-chip-bg` | `color-mix(in srgb, var(--muted-bg) 70%, transparent)` | `color-mix(in srgb, var(--muted-bg) 60%, transparent)` | Venue / referee / attendance chips |

## Typography tokens

| Tailwind class | Size | Line | Tracking | Weight | Use |
|---|---|---|---|---|---|
| `text-display` | `clamp(2.5rem, 5vw, 4rem)` | 1.05 | -0.04em | 800 | Hero only |
| `text-h1` | `clamp(2rem, 3.5vw, 2.75rem)` | 1.10 | -0.03em | 700 | Page titles |
| `text-h2` | `clamp(1.5rem, 2.5vw, 2rem)` | 1.20 | -0.025em | 700 | Section heads |
| `text-h3` | `1.25rem` | 1.30 | -0.02em | 600 | Card titles |
| `text-h4` | `1.125rem` | 1.40 | -0.015em | 600 | Sub-card |
| `text-body` | `0.9375rem` (15px) | 1.55 | -0.005em | — | Default body |
| `text-small` | `0.8125rem` (13px) | 1.50 | 0 | — | Helper text |
| `text-caption` | `0.6875rem` (11px) | 1.40 | 0.06em | — | Uppercase chip labels only |
| `text-meta` | **NEW** `0.8125rem` (13px) | 1.45 | 0 | 500 | Chips / dates / venues (non-uppercase) |
| `font-numeric` | **NEW** JetBrains Mono via next/font | — | tabular-nums | — | Scoreboard digits, minute counters |

Phase 0.B will:
1. Add `meta` and `numeric` entries to [`tailwind.config.js`](../tailwind.config.js) `theme.extend.fontSize` / `fontFamily`.
2. Wire JetBrains Mono via `next/font` in [`src/app/layout.tsx`](../src/app/layout.tsx), exposed as `--font-mono-numeric`.
3. Document the `caption`-is-for-uppercase-chips-only rule in the `/design-system` route.

## Spacing rhythm

Allowed gap/padding values across the codebase:

```
gap-1  (0.25rem · 4px)
gap-2  (0.50rem · 8px)
gap-3  (0.75rem · 12px)
gap-4  (1.00rem · 16px)
gap-6  (1.50rem · 24px)
gap-8  (2.00rem · 32px)
```

Odd intermediates (`gap-5`, `gap-7`, `gap-10`) should not appear in new code. The `/design-system` route will display these as physical rhythm chips so the discipline stays visible.

## Animation tokens

Tailwind animation utilities provided in [`tailwind.config.js`](../tailwind.config.js):

| Utility | Source | Use |
|---|---|---|
| `animate-fade-in` | local | Mount fade |
| `animate-slide-in` | local | Side-slide entry |
| `animate-scale-in` | local | Scale-up entry |
| `animate-shimmer` | local | Skeleton shimmer |
| `animate-live-pulse` | local | Live-state ring pulse |
| `animate-shimmer-slide` | magic-ui | Used by ShimmerButton |
| `animate-spin-around` | magic-ui | Used by PulsatingButton |
| `animate-marquee` | magic-ui | Used by Marquee (horizontal) |
| `animate-marquee-vertical` | magic-ui | Used by Marquee (vertical) |
| `animate-gradient` | magic-ui | Used by AnimatedGradientText |
| `animate-pulse-ring` | magic-ui | Used by PulsatingButton ring |
| `animate-orbit` | magic-ui | Used by OrbitingCircles |

There is a global `@media (prefers-reduced-motion: reduce)` block at the bottom of `globals.css` that collapses animation/transition durations to 0.001ms — every magic-ui primitive inherits this without extra wiring.

## Hard rules

1. **Never use `text-white`, `bg-black`, or `text-gray-*`.** Use `text-[var(--text-primary)]`, `bg-[var(--card-bg)]`, `text-[var(--text-tertiary)]`.
2. **Never hardcode a hex in a chart.** Use [`useChartTheme()`](../src/components/charts/theme.ts) — it re-evaluates on `class` mutation so dark/light flips repaint correctly.
3. **Never use inline `dark:*` Tailwind classes** when a token exists. The token system flips automatically.
4. **`caption` (11px uppercase) is for chip labels only**, never body text. Use `meta` (13px) for dates/venues/sources.
5. **For team-color tinting** on a per-match component, set inline style: `style={{ '--team-tint-home': home.brand, '--team-tint-away': away.brand }}` and read with `bg-[var(--team-tint-home)]`.
