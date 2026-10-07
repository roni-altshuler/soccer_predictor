# Season club comparison — scope and evidence

The bounded addition is `/leagues/[leagueId]/compare`, linked from the league
page even while live league data is loading. A reader chooses two clubs from
one committed competition/season and compares recorded points per game, its
game count, recorded points, and the existing projected final points.

## Reuse and scope

The repository already has arbitrary-team match predictions, head-to-head/form
views, match expected-goal outputs, league projections, a what-if lab and team
overview pages. This change adds a season snapshot reading of two clubs rather
than another prediction model or a replacement for those views. It uses the
existing `/api/v1/season/projections` route and `season_projections.json`, native
selectors, and shared `Panel`, `StatTile`, `SectionHeader`, `StatusChip`,
`DocsLink` and shell styling. No dependencies or Python model code change.

The requested scouting/comparison idea is narrowed to clubs because the served
season artifact has no player valuation or reliable shot dataset. FotMob's
exploration pattern informs the simple league → selection → comparison flow;
no FotMob assets, images, data or interface code are copied.
The [MIT educational xG example](https://github.com/grandngom/xG-model-football)
is a learning reference on 50 matches, not a production model or imported
dataset. Its scope and the distinction between shot-level xG, goals and match
expected-goal forecasts are explained in the
[season handbook](handbook/tutorials/follow-a-season.md#compare-two-clubs).

## Source and limits

The browser's normal state calls the real local serving API; its response is
checked against the committed artifact. Build time is **2026-10-06
14:27:31.131740 UTC**. SHA-256:
`18cbd512284e9443f33f21912692564d387e770754c1a901d5eeca50514181d9`.
The snapshot contains six leagues: 20 English, 20 Spanish, 18 French, 18 German,
20 Italian and 30 MLS clubs. Both selectors stay inside one of those snapshots.
MLS uses its calendar-year label and actual 26–28-game samples; no conference
rank or playoff probability is inferred.

The source supplies no latest-result date per league. The UI explicitly says
so; neither the artifact build time nor the global `trained_through` field is
treated as a results cutoff. The verified European results in the October 7
audit still end **September 20, 2026**. Live standings may differ. Goals,
shot-level xG, injuries and player values remain unavailable in this view.

The checked example is Arsenal **12 points / 5 games = 2.40 points per game**
and Manchester City **15 / 5 = 3.00**. Their projected final points, **76.9** and
**83.7**, are existing forecasts, labelled as such. These are snapshot readings,
not statistical evidence of model improvement or a forecast of their matchup.
Different schedules and small samples limit comparisons.

Missing fields and zero games never become a zero rate. Invalid/duplicate
club identities are excluded instead of resolving a correction by guesswork.
Negative recorded points can represent deductions. Only the published men's
snapshot is supported: a women's preference withholds it and sends no request
for the men's artifact. Aborted/late responses cannot restore a previous
competition, gender or selection.

Injury unknowns, legacy injury routing/failure retention, the serving model,
the held-back recency challenger and the legacy `train_feedback` loop are
untouched. No provider collection, training, paid service, access change or
production workflow dispatch is required.

## Actual browser shipping gate

The saved cloud Chromium 151 browser inspected the running Next production
frontend at **390, 768 and 1440 × 960**. The comparison's ready state used the
real local API and authorized artifact. Other API/provider/image requests
were fulfilled locally; no provider data was ingested. Error, empty and missing
metric variants deliberately fail transport or remove fields and are UI
contracts, not observed provider facts.

The existing `npm run test:product` suite now also verifies:

- League entry, native selector keyboard use, visible focus and keyboard Swap.
- Three repeated selection/swap cycles and two repeated league-return and
  browser Back/Forward cycles at each width.
- Loading with no stale cards, failed transport and keyboard retry, empty
  snapshot and retry, missing metrics, unsupported gender, and MLS season scope.
- Reduced motion, no horizontal overflow, controls at least 24 px, one active
  navigation destination and zero scoped WCAG A/AA axe violations.
- No unexpected page/console errors; one deliberate failed-transport console
  message at each width is recorded separately.

Screenshots are visually inspected, including desktop/mobile card layout,
source/freshness language, complete keyboard focus rings and scroll viewports
above the mobile bottom navigation. This is local frontend QA. Public deployment
behavior and provider recovery remain unverified.

Reproduce without providers or model execution:

```bash
npm run build
QA_CHROMIUM=/usr/bin/chromium QA_PORT=3121 npm run test:product
```

CI uses its installed Playwright Chromium and uploads all screenshots and
`report.json` as `product-quality-evidence`. Selected reviewed images and the
comparison report are committed under
[`reviews/2026-10-07-team-comparison/`](reviews/2026-10-07-team-comparison/README.md).

Local checks passed: **744 frontend tests** (including 16 focused comparison
tests), **1,579 backend tests / 25 skipped**, lint, typecheck, build, and the full
responsive product contract suite. Existing lint and backend deprecation
warnings remain. Automatic PR checks are reported separately on the exact head.

## Follow-up: delayed context changes and sequential keyboard traversal

Independent review requested actual delayed-response and sequential Tab QA.
At 390 and 1440 px, the browser holds the original men's response, then changes
gender through the existing canonical preference event (the public switch is
intentionally hidden) or navigates through the real Leagues → MLS → Compare
links. The old response is released while the current context is still waiting.
DOM mutation and painted-frame observers find **zero transient stale cards**.
The former request is aborted. A women’s view remains unavailable; switching
back to men and navigating to MLS wait for the independently held new response
before showing only that context's clubs. These are controlled UI races using
the authorized artifact, not provider-freshness measurements.

Tab and Shift+Tab traverse the shell and all comparison controls without any
force-focus calls: **Back → First club → Second club → Swap → Source →
Handbook**, with the reverse order on return. Selectors precede Swap in the
logical order at both widths. The shared retry control is also reached by
sequential Tab and activated with Enter in the empty state. Every inspected
control has a visible focus ring, is unobscured by fixed chrome and allows
leaving the comparison in both directions.

This found one real issue on the original `9c9689ef` head: mobile reverse
traversal placed the focused Back link at y=20–64 behind the 56 px sticky
header. The only product fix adds a comparison-control scroll margin of the
header height plus 12 px. Production browser replay now places that focused
link at y=68–112 on mobile (y=88–132 on desktop), fully visible. Serving,
selection, gender, date/cutoff and model logic are unchanged.

The checks run in the existing product suite and save
`comparison-targeted-review.json`, all sequential focus screenshots and delayed
context screenshots in the usual CI artifact. The
[follow-up record](reviews/2026-10-07-team-comparison/targeted-review.md) contains
the before/fixed evidence and outcomes. The same saved executor was verified
usable after the lifecycle notice: filesystem read/write/fsync at
**2026-10-07 12:13:51 UTC**, a local HTTP 200 and Chromium 151 rendering the
comparison; no environment switch was made.
