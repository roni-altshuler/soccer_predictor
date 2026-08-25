# Pitchverse design language — Floodlight (Bugatti grammar, night-pitch material)

**This file is authored FROM [`src/app/globals.css`](src/app/globals.css).** That file is
the single source of truth; this one explains it. If the two disagree, the CSS is right and
this document is the bug.

That is not a formality. It replaces `docs/design-tokens.md` and `docs/design-language.md`,
which between them published **six hexes that existed nowhere in the product** (`#22c55e`,
`#06b6d4`, `#22d3ee`, `#f5f7fb`, `#07101f`, `#ef4444`), eight table rows of a light mode
that had been deleted, and a rule mandating cyan for AI data in a product with no cyan in
it. An agent that trusted them would faithfully rebuild the theme this one replaced — which
is worse than having no spec at all.

The grammar (Bugatti) is shared with two sibling repos: **RaceIQ** (`../f1_predictions`),
where it originated, and **Hardwood** (`../nba_predictor`) — structure, typography, the
four-accent meaning system, and the one-ambient-layer exception are family law. The
*material* is per sport: Pitchverse's neutrals are night-pitch greens (Floodlight,
2026-08-25); the siblings keep their own casts. A grammar change here is a change to a
family; a material change is this repo's own.

---

## The palette

**Floodlight: a night-pitch canvas, Bugatti's grammar.** The canvas is a deep pitch-green
(`#071009`), surfaces and hairlines carry the same green cast (`#0c1a10`, `#20402a`), and
every neutral sits at the luminance step its old grey equivalent did — so all contrast
relationships hold. Hairline borders, **no shadows, no glassmorphism, no chrome**; the only
gradients on the site live inside the sanctioned ambient layer below. Colour still carries
meaning only — live state, positive/negative, positional tier — never decoration: the green
of the canvas is a *cast* on the neutrals, not a fifth accent, and `--accent-primary` green
still means exactly one thing.

**The one exception is the ambient layer.** The canvas reads as a floodlit pitch at night
with a match being played on it: static mowing stripes (white, ≤2% alpha), pitch markings
(white, ≤8%), two accent-green light pools (≤11%) drifting on 90s+ cycles, and the
**tactics-board match** — chalk circles vs X-marks passing, pressing, shooting and scoring
in a simulated game (`PitchMatchAnimation`: one canvas, ~23 entities, 30fps cap, marks ≤25%,
ball ≤40%) — all rendered once by `PitchBackdrop` behind everything at `z-index: -1`
(2026-08-25 product decisions). Its bounds are load-bearing: reduced motion stills
everything (pools via `animation: none`, the match by drawing one static frame); alphas low
enough that no text anywhere loses contrast; **the match never renders a score, clock, name
or anything readable as data** — it is decoration in a product whose grammar is real
numbers; and **nothing else on the site may pick up a gradient or glow because this
exists** — one layer, defined once, consumed once.

**Dark only.** `<html class="dark">` is hardcoded in [layout.tsx](src/app/layout.tsx) and
there is no theme provider. `:root` is the single source of truth and the `.dark` block is
intentionally empty.

> Because the class is always on, **any `.dark X` rule beats its unprefixed twin
> unconditionally.** `.dark .skeleton-shimmer` painted `#161b22` over the token-built
> default, so every loading state on the site rendered in retired navy-charcoal rather than
> on the black surface — visible in a screenshot, invisible to every test. If a rule seems
> to need a `.dark` prefix, it is a rule that only ever runs. Write it once, unprefixed.

### Surfaces

| Token | Value | Use |
|---|---|---|
| `--background` | `#071009` | page canvas — night pitch |
| `--background-secondary` | `#0c1a10` | section surfaces |
| `--background-tertiary` | `#122417` | subtle elevation |
| `--card-bg` / `--match-card-bg` | `#0c1a10` | cards, list containers |
| `--card-hover` | `#122417` | row hover |
| `--input-bg` | `#122417` | form fields |
| `--muted-bg` | `#1d3023` | muted containers |
| `--nav-bg` | `#071009` | sidebar / topbar (opaque — see below) |
| `--overlay-bg` | `rgba(4,10,6,0.74)` | modal scrim |

`--nav-bg` is **fully opaque**, so the `backdrop-blur-*` utilities still sitting on the
topbar, footer and date strip paint nothing. They are inert, not load-bearing; `--glass-blur`
is `none` for the same reason.

### Text

| Token | Value | Use |
|---|---|---|
| `--text-primary` | `#ffffff` | headlines, winner's score, key figures |
| `--text-secondary` | `#cccccc` | body copy |
| `--text-tertiary` | `#999999` | labels, captions, loser's score |
| `--accent-on-primary` | `#000000` | text on a filled accent |

### Accents — four signals, and what each one means

| Token | Value | Means, and ONLY this |
|---|---|---|
| `--accent-primary` | `#5fa657` | positive · win · model-favoured · active state |
| `--accent-warn` | `#d4a017` | draw · uncertainty |
| `--accent-loss` | `#c1443c` | negative · loss · **live** |
| `--accent-info` | `#c3d9f3` | links, informational — the ice-blue |

Each has a `-soft` twin one step lighter. **There is no cyan.** `--accent-ai`,
`--accent-market` and `--accent-women` are aliases pointing at `--accent-info`, kept so
legacy consumers render calm rather than neon. Do not read `--accent-ai` as "a cyan for AI
things" — that rule belonged to the retired v3 palette.

### Structure

| Token | Value | Note |
|---|---|---|
| `--border-color` | `#20402a` | the hairline that carries all structure — chalk-line green |
| `--border-hover` | `#305c3d` | hover hairline |
| `--shadow-sm/md/lg` | `none` | **all three.** Depth is surface steps + hairlines, never bloom |
| `--radius` | `0.75rem` | shadcn radius base |

`--logo-plate` is `#ffffff` **in a dark-only product, deliberately.** Competition marks are
authored for light backgrounds — Premier League purple `#37003c`, Ligue 1 navy and the MLS
mark all vanish on black. FotMob and ESPN seat them on a light tile for exactly this reason;
`--logo-plate-ring` is what separates the tile from the card.

---

## Typography

- **Display (`h1`–`h3`)** — `--font-display`, white, uppercase, `letter-spacing: 0.08em`.
  The tracking is **positive**; the retired theme used `-0.02em`, the opposite instinct.
- **Body** — `--font-sans`, `--text-secondary`.
- **Monospace** — `nav`, `button`, `.caption`, `th`, `[role='tab']` all run
  `--font-mono-numeric`. Tabular figures keep score columns and probability tables from
  shifting as digits change. Use `.tabular` for numerics elsewhere.

---

## Hard rules

1. **The scores list IS the page.** App routes open with data — a date strip and fixture
   rows, a scoreboard, a table. Never a hero, tagline, or CTA banner. The product has no
   marketing surface.
2. **Tokens only.** `var(--*)` for every colour: `text-[var(--text-primary)]`,
   `bg-[var(--card-bg)]`. A hardcoded `text-white` / `bg-black` / `text-gray-400` bypasses
   the token layer and is a lint-visible defect.
3. **One accent per meaning.** See the table above. Green is not "the brand colour to
   decorate with" — it means positive.
4. **Never surface internal telemetry.** No prediction counts, model/version chips, pipeline
   or job names, cache/refresh timestamps, countdown timers, "committed picks". Consumer
   surfaces show football: scores, kickoff, form, position, H2H, xG, scorers, venue. Model
   *quality* belongs on `/accuracy` and `/evaluation`.
5. **No fabricated data.** A missing prediction renders nothing — never a flat placeholder.
   An empty accuracy window is hidden, never shown as 0%. A pre-match score reads `vs`, not
   `– - –`, because two dashes where a scoreline belongs read as data we failed to load.
6. **No emoji in chrome; real crests and flags.** Clubs get ESPN crest URLs, national teams
   get flagcdn flags via `FlagBadge`. A confidently wrong badge is worse than an honest
   placeholder — `afc.asian` ships with no logo rather than a guessed one.
7. **44px+ tap targets, and `useReducedMotion` honoured on every animation.**
   `scripts/responsive_audit.mjs` fails the build on tap targets under 24px and on any
   horizontal overflow.
8. **Every probability is rendered as text, never colour alone.**

### Why the previous theme failed — do not re-import it

Kept because it is the failure this design exists to prevent, and because the pull back
toward it is constant:

- Marketing hero + CTA banners on top of app pages.
- Neon green/cyan on blue-navy, aurora radial washes, glow shadows, gradient wordmarks,
  border-beam effects — reads "AI dashboard template", not sports.
- Fixture rows ~110px tall. FotMob fits three rows in that space.
- Internal telemetry dressed as consumer data: "FIXTURES TRACKED 18", "AI PICKS GENERATED",
  "Models live · v2.3".

**This is why component catalogues are a poor fit here.** Evaluated 2026-08-15: 21st.dev's
centre of gravity is 1,152 animated heroes, 501 CTAs, plus dedicated Gradients, Shaders and
ASCII sections — the list above, itemised. getdesign.md sells DESIGN.md specs scraped from
other products, which is the right *idea* (this file) and the wrong *source*: importing
Stripe's or Discord's visual language into a product that has a converged one of its own
trades a decision for a default. Take structure and interaction patterns if they help; do
not take visual treatments.

---

## Anatomy

### MatchRow — FotMob grammar, stacked teams

```text
| 52px time/status | crest 20px  Team A            1 |  [1 62][X 23][2 15]  AI 2-1 |
|  (HH:MM, 74',    | crest 20px  Team B            0 |   1X2 boxes · pick chip      |
|   FT, HT)        |                                 |   (only if a forecast exists)|
```

- Height 56–64px. The whole row is the link. Winner's score `--text-primary`, loser's
  `--text-tertiary`.
- Live: red minute in the time column, scores in primary text.
- The right zone renders **only when a forecast exists**: three fixed 1X2 boxes (bet365
  grammar — the argmax box tinted, the others muted) plus an optional scoreline chip. Below
  640px it collapses to the argmax box + chip.

### League group

32px header: 18px crest/flag + league name (semibold 13px) + country (tertiary 12px) + match
count right + chevron. Flat hairline between groups — no coloured left-edge bars.

### Date strip

Sticky under the topbar. Seven buttons (−3…+3 days), compact (`Wed 12` / `Today`), active =
green underline bar + primary text. Tab grammar, not pill grammar.

### Shell

- **Desktop sidebar** — fixed 220px, always-labelled 13px text links with 18px icons,
  grouped **Watch** (Today) · **Forecast** (Leagues, Tournaments) · **Evidence** (Evaluation,
  Accuracy, How it works). Active = soft green wash + green text. Flat `--card-bg`, hairline
  right.
- **Topbar** — 56px flat bar: mobile brand mark and the account control. **There is no
  search field and no ⌘K palette.** Both were removed deliberately: they searched nine
  leagues and fourteen competitions that are each one tap away, and a shortcut printed in a
  chip advertises a product bigger than this one.
- **Mobile** — bottom tab bar flush to the screen edge, **four** slots (Today, Leagues,
  Cups, Record), safe-area padded, top hairline.

### Tables

13px, `tabular-nums`, right-aligned numerics, zebra-free, hairline rows. Position-change
arrows coloured by token. The projected table sorts from the keyboard with `aria-sort`.

### Cards

Flat: 1px hairline, 12–14px radius, **no elevation gradient**. Depth is the surface step
(`--background` → `--card-bg` → `--card-hover`), never a shadow.

---

## What lives in CSS, and what does not

`globals.css` is **340 lines** and holds tokens, base typography, and the eight utility
classes that have live consumers: `.fm-card`, `.match-card`, `.shimmer`, `.skeleton-shimmer`,
`.animate-pulse`, `.prob-segment`, `.tabular`, `.border-accent`.

It was 1,011 lines. **Sixty-four selectors had zero consumers** — `.btn-primary`,
`.btn-secondary`, `.btn-ai`, `.fm-surface`, `.fm-hero`, `.fm-chip`, `.fm-input`, `.fm-select`,
`.stats-card`, `.bento-card`, `.cine-card`, `.gradient-border`, `.aurora-bg`, `.grain`,
`.spotlight`, `.glow-*`, `.live-hero`, `.live-aura`, `.mkt-headline-gradient`, `.kbd`, the
`.badge-*` family and the rest — and they carried the gradients, glows and hover-lift that
this design exists to remove. `.btn-primary` had a `linear-gradient` **and** a hardcoded
`box-shadow: 0 8px 16px` that bypassed `--shadow-sm: none` entirely; `.fm-select`'s chevron
hardcoded `#16a34a`, an accent from two palettes ago.

Dead CSS is not harmless. It is what the next person writing a button copies.

Everything new should be Tailwind utilities reading `var(--*)`, or a component in
`src/components/primitives/`. Add to this file only when a rule genuinely cannot be
expressed as a utility.

### "No gradients" means no gradients

Resolved 2026-08-16. Two inline gradients survived the CSS sweep because they lived in
components rather than `globals.css`; both are now flat:

- **FeaturedMatchCarousel** painted a 100° two-club wash across the card, which made the
  featured strip the most gradient-looking thing on the site — a Sevilla/Rayo card read as
  a maroon panel. The clubs' colours stay, carried by the solid per-side bars. Identity
  survives without a painted background.
- **FormationDisplay** washed the pitch vertically, contradicting `--pitch-bg`'s own
  documented "flat, hairline-drawn". The mowing stripes stay: they depict a real property
  of a real pitch rather than decorating a surface, and that is the line. They were
  retokenised off `bg-black/10` at the same time.

The **only** remaining gradients are the two shimmer keyframes in `globals.css`, and they
are not an exception: a shimmer is a moving gradient by definition, and it marks a loading
state rather than decorating a surface.

If a third one appears, record it here rather than tolerating it quietly — an unrecorded
exception is how a rule stops meaning anything.

---

## Primitives

`src/components/primitives/` and `src/components/match/` are the only sources for
`MatchRow`, `LeagueSection`, `DateStrip`, `Prob1X2`, `ProbBar` (detail pages only — never in
list rows), `FlagBadge`, `LeagueChip`, `StatusChip`, `LiveBadge`, `SectionHeader`,
`StatCard`, `MetaChip`, `TeamCrest`, `EmptyState`. New surfaces compose these; do not fork
row or section markup per page.

Chart surfaces compose `src/components/viz/` and `src/components/motion/` rather than
hand-rolling recharts or divs, and must be retokenised to `var(--*)` — no source-project
palettes.

**`MatchDetail` is ONE component and all three match surfaces render it** —
`/matches/[id]`, `/season/fixture/[uid]` and `/tournaments/tie/[...key]`. A second copy of
that layout is what `matchDetail.test.tsx` exists to prevent.

---

## Copy

**No provenance or methodology in the UI.** Data-provider names and how-it's-calculated
language — providers, algorithms, training/calibration/pipeline terms — live in `README.md`,
`docs/methodology.md` and `docs/handbook/` only. `/about` may carry a plain-language note of
two to four sentences. Numbers are fine ("simulated 20,000 times"); method names are not.

**Register:** sentence case, terse, football-first — "Fixtures", "Table", "Form", "AI pick".
Never "committed", "pipeline" or "unified model" on a consumer surface. The disclaimer stays
in the footer, small, not a banner.

**The evidence panel is deliberately not a tab.** Every percentage on this site is
unfalsifiable without it, and a tab is a place things go to be unread. It renders below the
numbers it justifies, on every page that shows a forecast, and a test asserts it is present.
