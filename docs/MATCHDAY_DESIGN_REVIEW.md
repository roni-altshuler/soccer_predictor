# Matchday → match detail design review

The October 6 product direction asks for an original, professional interface
with the clarity and restraint of Google, Apple and OpenAI: neutral colors,
cream rather than pure-white surfaces, deliberate spacing, readable typography
and explicit actions. This update applies that direction to one complete flow.
The subsequent clarification preserves each product's subject and identity:
soccer uses deep forest-green actions and restrained football status accents,
alongside the original Pitchverse mark and club/competition assets. The design
does not copy a company's branding or impose cream on every route or product.

## Scope and behavior

`/` and `/matches/[id]` use `.match-flow-shell`: canvas `#f5f3ee`, cards
`#fcfaf6`, charcoal text and muted action/status colors. The shared sidebar,
top bar and mobile navigation inherit those tokens on these routes. Other
routes retain Floodlight. There is no theme switch or site-wide redesign.

Matchday separates the featured fixture from the match list, makes Match centre
a filled action, adds visible row arrows (View match on desktop), and labels
exploration links with their destinations. Featured-match selection and club
following remain interactive. Detail shows complete club names on phones,
keeps Matchday active in navigation, and uses the same surfaces and typography.

PR #31's date, competition, status and Following URL state, return links,
history and scroll restoration are retained. The shared detail tabs now have
roving keyboard focus, arrow/Home/End controls and labeled panels. Loading
states announce their purpose; failures offer retry and a filtered Matchday
return. A date-only publication displays a date without implying midnight.
The condensed score bar also removes its exit transition for reduced motion.

Prediction adapters, models, ingestion and providers are unchanged. Missing
inputs, markets, confidence, xG and exact-score probabilities stay unavailable;
genuine published confidence and xG remain visible. No field is added to make
the UI look complete. European verified results still end September 20 even
when an artifact was generated later. This UI review proves no model accuracy
or current provider coverage.

## Reproduce the browser review

```bash
npm run build
QA_CHROMIUM=/usr/bin/chromium npm run test:product
```

Omit `QA_CHROMIUM` when using Playwright's installed Chromium. To test a running
development server, set `QA_BASE=http://127.0.0.1:3000`. The runner writes all
screenshots and a JSON report to `/tmp/pitchverse-product-quality` by default;
`QA_OUT` selects a different evidence directory. Existing frontend PR CI runs
the same contract and uploads `product-quality-evidence` automatically.

The replay reads committed September 19 predictions and the existing evaluation
artifact. It freezes the date to September 20 and intercepts API and external
requests. It removes optional fields for sparse/null cases, gates responses for
loading, returns empty fixtures and the proxy failure contract, and deliberately
injects a detail HTTP 503. Only that failure's expected console messages are
allowed. No provider or model request is sent.

Actual Chromium pages are exercised at **390, 768 and 1440 × 960**, including
keyboard selection, featured-fixture exploration, three repeated detail return
cycles per width, browser back/forward, reload, Following, direct return links
and scroll restoration. Axe WCAG 2 A/AA covers the flow shell in populated,
sparse, null, published-xG, loading, empty and error states. The runner also
checks visible focus, text/action/focus token contrast, no horizontal overflow,
reduced-motion animations and retry recovery. Unit tests exercise multi-tab
arrow navigation and date-only truthfulness.

## Review evidence

Before/after captures are included below for mobile and desktop, using the same
committed fixture and filtered Matchday. The before captures use the development
server and include its Next.js indicator. After captures use the production
build. Full-page browser captures place fixed navigation at the viewport edge;
the CI evidence also contains loading, empty, error, sparse and published cases.

| View | Before | After |
|---|---|---|
| Mobile Matchday | [390px](images/matchday-design/before-matchday-390.png) | [390px](images/matchday-design/after-matchday-390.png) |
| Desktop Matchday | [1440px](images/matchday-design/before-matchday-1440.png) | [1440px](images/matchday-design/after-matchday-1440.png) |
| Mobile detail | [390px](images/matchday-design/before-prediction-390.png) | [390px](images/matchday-design/after-prediction-390.png) |
| Desktop detail | [1440px](images/matchday-design/before-prediction-1440.png) | [1440px](images/matchday-design/after-prediction-1440.png) |

The replay measured a minimum **5.17:1** contrast for the three text tokens
against canvas/card/muted surfaces, **11.06:1** for filled actions and **7.99:1**
for focus against cards. Axe reported zero violations in the tested states,
with zero horizontal overflow or unexpected browser errors at all three widths.
See [the machine-readable report](data/matchday-design-qa.json).

Local checks passed: lint (existing warnings), TypeScript, production build,
**683 frontend tests in 54 suites**, and **1,405 backend tests** (25 skipped,
24 existing warnings). Exact-head CI results are recorded with the draft PR.

These are Chromium viewport checks, not physical-device or cross-browser tests.
Authentication, populated lineups/timelines and unrelated routes are outside
this replay. Automated accessibility checks and screenshots support review;
they do not establish usability for every assistive technology.
