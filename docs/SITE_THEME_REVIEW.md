# Site theme consistency review — 2026-10-08

The homepage, match, club comparison and match evidence pages previously used
route-scoped cream overrides. League directories, league pages and team
profiles inherited a hardcoded dark document. Moving between them changed the
canvas, header, button colors and heading case, regardless of saved preferences.
This was reproduced from main `97c0128f90d1b9cdfbea505a34c8952b26319c41` in an
isolated production build in the saved cloud environment.

## Resulting behavior

Every product route now inherits document-level tokens: cream/off-white light
surfaces with forest accents, or the existing floodlit dark soccer greens.
Sentence-case headings, navigation labels and control typography remain
consistent. Root tokens also reach portalled dialogs and native controls.
Filled buttons and result chips use palette-appropriate foreground tokens.

The header's **Color theme** selector offers Light, Dark and System. A blocking
head script resolves the choice before paint, independently of client bundles.
The current key is `pitchverse-theme`; the verified earlier `theme` key is
honored when no current preference exists. OS changes affect System only.
Other tabs synchronize preferences, and browser chrome follows the resolved
palette. With storage blocked, a choice works until reload; system preference
supplies the next load's fallback. Signed-out auth initialization tolerates
blocked storage so it cannot interrupt that fallback.

Dark mode retains the optional pitch backdrop and its saved ambient setting.
The canvas animation stops while light mode hides it. The mobile pitch dial is
inside a compact disclosure to keep the same header usable at 320px.

No model, evaluator, ingestion, provider mapping, prediction/outcome archive,
forecast policy or publication workflow is changed.

## Browser evidence

[Before/after reports and 28 selected screenshots](reviews/2026-10-08-site-theme/README.md)
include SHA-256 hashes. The before replay captured **78 states**; the fixed
replay captured **124 states** using production Next.js and Chromium
151.0.7922.173 in this saved environment.

| Check | Evidence |
|---|---|
| Homepage → league directory → Premier League → comparison → evidence → match | Real links, both palettes, 390/768/1440px |
| Team profile | Real SSR team adapter, exact committed provider subject, deep link, reload and back/forward |
| Shared canvas/header/button tokens and heading case | Every captured route uses its resolved document palette; sentence case; no horizontal overflow |
| Destination URLs | All 124 captures assert the expected complete URL, including match/club identity and the encoded Matchday return destination |
| Auth modal actions | Real header Sign In opens login/register; default and hover submit colors measured in both palettes at three widths, without submitting credentials |
| Saved Light/Dark with opposite OS preference | Correct initial paint, navigation, reload and toggle persistence |
| System and cross-tab changes | Real media emulation and storage events repaint the open pages |
| First paint/hydration | Animation-frame canvas sampling on initial and profile/toggle reloads; delayed bundles for fresh System/legacy/storage-failure cases |
| Loading, empty and request failure | Both palettes and three widths; explicit local transport/availability faults |
| Narrow headers/native controls | 320px fresh System light/dark, legacy dark and storage-blocked/session cases |
| Reduced-motion pitch | Switching from a hidden light-mode canvas to dark refits its backing dimensions and draws a still |
| Accessibility | Zero header WCAG A/AA violations in the theme audit; existing broader product audit passes |

Theme replay recorded no browser exceptions or unexpected console errors in
the full journeys. All 124 recorded browser-chrome colors match the resolved
palette. Frame sampling detects wrong canvas paint during tested loads; it is
not an exhaustive pixel-level flicker measurement on every browser/device.

The test stays local. Comparisons and match evidence read existing local serving
APIs and committed artifacts. Match/team identity comes from the already
committed sparse ESPN excerpt; missing scores, roster, record and prediction
fields remain absent. Provider requests are intercepted in both browser and
server. The shared sparse match card has no club link, so the exact team subject
is tested through its existing profile deep link. This proves theme and rendering
behavior, not live provider completeness, rich-profile content or new results.
Public hosted runtime behavior and Safari/Firefox are not verified here.

The auth submit button now pairs `--accent-primary` with
`--accent-on-primary`. Its former white foreground against the unchanged dark
green fill gives a calculated contrast of **2.97**. The live modal measurements
below include hover opacity composited against the actual modal card:

| Palette | Default contrast (6 measurements) | Hover contrast (6 measurements) |
|---|---:|---:|
| Light | 11.06 | 8.19 |
| Dark | 6.42 | 5.42 |

All 24 active submit measurements exceed 4.5. This covers login and register
actions in the actual modal; it does not assert whole-modal WCAG compliance or
exercise authentication. AuthModal's only implementation change is its
foreground class; submission, OAuth and mode behavior remain unchanged.

## Validation and reproduction

- Frontend: **860 tests, 66 suites**, including **14 theme contracts**.
- Lint and TypeScript checks passed; existing repository lint warnings remain.
- Isolated production build passed.
- Existing full responsive product audit passed, including navigation races,
  portrait guards, comparison/evidence contracts, keyboard/history/reload and
  loading/empty/error recovery at 390/768/1440px.
- Relevant existing backend player API/identity contracts: **38 passed** with
  four existing warnings. No backend implementation changed.

```bash
npm run lint
npm run typecheck
npm test -- --ci --runInBand
npm run build
QA_CHROMIUM=/usr/bin/chromium QA_PORT=3110 npm run test:theme
QA_CHROMIUM=/usr/bin/chromium QA_PORT=3100 npm run test:product
.venv/bin/python -m pytest backend/tests/test_players_api.py backend/tests/test_team_resolver.py -q
```

Both browser commands own and stop their local production server. Choose free
ports. `QA_THEME_SERVER_ROOT` can point theme QA at an isolated build;
`QA_OUT` selects its evidence directory. `QA_THEME_PROBE=1` captures a baseline
without asserting the new palette contract. CI now runs theme journeys and
uploads their evidence alongside the existing product audit. No production
workflow was dispatched.
