# Matchday — Pitchwise design language (v3)

Reference class: **FotMob** (list-first scores app), **ESPN** (scoreboard hierarchy),
**bet365** (data-grid density). This supersedes "Broadcast" (v2). Every app surface
must read as a professional sports data product — the kind of site B/R Football
would link out to — not as an AI-startup landing page.

## Why v2 failed (learn from it)

v2 fixed emoji/fake-crest/zero-metric problems but kept the *template* feel:

- Marketing hero + CTA banners sat on top of app pages ("Live football. Calibrated AI.").
- Neon green/cyan on blue-navy, aurora radial washes, glow shadows, gradient
  wordmarks, border-beam effects — reads "AI dashboard template", not sports.
- Fixture rows were ~110px tall (side-by-side teams + full-width tricolor bar +
  venue line). FotMob fits three rows in that space.
- Internal telemetry was presented as consumer data: "2 COMMITTED PICKS",
  "FIXTURES TRACKED 18", "AI PICKS GENERATED", "Models live · v2.3", countdown
  timers, refresh timestamps.

## Hard rules

1. **The scores list IS the page.** App routes open with data — a date strip and
   fixture rows, a scoreboard, a table — never a hero, tagline, or CTA banner.
   Marketing copy lives at `/welcome` only.
2. **Neutral surfaces, one accent.** Charcoal (dark) / cool-white (light) neutral
   surfaces with NO blue undertone. Brand green is for interactive/active states
   only. Cyan appears ONLY on AI-pick data (chips, 1X2 boxes, prediction viz).
   Red ONLY for live/loss. Amber ONLY for draws. **No gradients, no glow
   shadows, no aurora washes, no BorderBeam/AnimatedGradientText in app chrome.**
3. **Density.** Fixture row = one 56–64px unit (stacked team lines). A section
   header is one 32–40px line. Nothing above the first data row may exceed
   ~112px of chrome (topbar + date strip).
4. **Data-field policy.** Never surface internal telemetry: prediction counts,
   model/version chips, pipeline or job names, cache/refresh timestamps,
   "committed picks". Consumer surfaces show football facts: scores, kickoff,
   form (W/D/L), standings position, H2H, xG, scorers, venue (detail pages).
   Model *quality* stats live on /accuracy, /ai, /diagnostics — nowhere else.
5. **No fabricated data** (v2 rule, unchanged). A missing prediction renders
   nothing — never flat placeholders. Empty accuracy windows are hidden, never
   shown as 0%.
6. **No emoji in chrome; real crests/flags** (v2 rule, unchanged) — clubs get
   ESPN crest URLs, national teams get flagcdn flags via `FlagBadge`.
7. **44px+ tap targets; `useReducedMotion` honored on every animation** (unchanged).
8. **Tokens only** — `var(--*)` for every color (Vercel lint + light mode).

## Surfaces (token values live in `globals.css`)

v3.1: dark surfaces lifted (v3 was "almost too dark") and given a faint
pitch-green cast (hue ~150, sat 4-6%) — a quiet football identity, never a
colored theme.

| Token | Dark | Light | Use |
|---|---|---|---|
| `--background` | `#171a18` | `#f2f3f5` | page |
| `--card-bg` | `#1f2320` | `#ffffff` | list containers, cards |
| `--card-hover` | `#272b28` | `#f2f4f7` | row hover |
| `--border-color` | `#333835` | `#e3e5e9` | hairlines |
| `--accent-primary` | `#00c060` | `#0a9950` | active nav, links, kickoff time |
| `--accent-ai` | `#27c4f5` | `#0891b2` | AI pick data only |

## Copy policy: no provenance or methodology in the UI (v3.1)

The website is the showcase. Data-provider names and how-it's-calculated
language (providers, algorithms, training/calibration/pipeline terms) live in
`README.md` + `docs/methodology.md` only. `/about` may carry a 2-4 sentence
plain-language note. Numbers are fine ("simulated 20,000 times"); method
names are not. The educational disclaimer stays in the footer.

## Ported viz kit (v3.1)

Production-grade data-viz and motion components ported from the
motorsportverse F1 project (plus FireFly/personal-site picks) live under
`src/components/viz/` and `src/components/motion/` — probability bars,
scoreline heatmap, progression-with-projection chart, factor meters,
animated numbers, club color bars, lazy chart hydration. New chart surfaces
must compose these instead of hand-rolling recharts/divs, and must be
retokenized to `var(--*)` (no source-project palettes).

Cards are **flat**: 1px hairline border, 12px radius, no elevation gradient.
Depth comes from surface steps (bg → card → hover), not shadows.

## Anatomy

### MatchRow (FotMob grammar — stacked teams)

```
| 52px time/status | crest 20px  Team A            1 |  [1  62][X 23][2 15]  AI 2-1 |
|  (HH:MM, 74',    | crest 20px  Team B            0 |   1X2 boxes · pick chip      |
|   FT, HT)        |                                 |   (only if prediction exists)|
```

- Height 56–64px. Whole row is the link. Score column right-aligns within the
  team block; winner's score is `--text-primary`, loser's `--text-tertiary`.
- Live: time column shows red minute (`74'`), scores in primary text.
- The right AI zone renders **only when a committed prediction exists**:
  three fixed 1X2 percentage boxes (bet365 grammar — argmax box tinted cyan,
  others muted) plus optional scoreline chip. On <640px the 1X2 boxes collapse
  to the single argmax box + chip.

### League group

32px header: 18px league crest/flag + league name (semibold 13px) +
country (tertiary 12px) + match count right + chevron. Flat hairline between
groups — no colored left-edge bars. Rows separated by `--border-color` at 40%.

### Date strip

Sticky under the topbar on scores surfaces: 7 buttons (−3…+3 days), compact
(`Wed 3` / `Today`), active = green underline bar + primary text (tab grammar,
not pill grammar).

### Shell

- **Desktop sidebar**: fixed 220px, always-labeled text links (13px, icon 18px),
  grouped: *Scores* (Matches, World Cup, Leagues, News) · *AI* (Predict,
  Accuracy, History, Simulator) · *More* (Tournaments, Diagnostics, About).
  Active = soft green wash + green text. Flat surface `--card-bg`, hairline right.
- **Topbar**: 56px flat bar — mobile brand, search field, gender toggle,
  ghost Sign-in. No glass gradients or glowing hairlines.
- **Mobile**: bottom tab bar flush to the screen edge (not a floating pill),
  5 slots, safe-area padded, top hairline, active = green icon+label.

### Tables (unchanged from v2)

Standings/stat tables: 13px, tabular-nums, right-aligned numerics, zebra-free,
hairline rows, position-change arrows colored by token.

## Primitives

`src/components/primitives/` + `src/components/match/` are the only sources for:
`MatchRow`, `LeagueSection`, `DateStrip`, `Prob1X2` (the 1X2 boxes), `ProbBar`
(detail pages only — never in list rows), `FormPill`, `FlagBadge`, `LeagueChip`,
`StatusChip`, `SectionHeader`, `StatCard`, `EmptyState`. New surfaces compose
these; do not fork row/section markup per page.

## Copy register

Sentence case, terse, football-first ("Fixtures", "Table", "Form", "AI pick").
Never "committed", "pipeline", "unified model" outside /ai + /diagnostics.
Educational disclaimer stays in the footer — small, not a banner.
