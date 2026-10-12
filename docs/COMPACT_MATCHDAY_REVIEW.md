# Compact Matchday review — 2026-10-12

Matchday now opens on the competition/status filters and grouped fixture list.
The existing spotlight and club panel come after the list. This reduces the
first-screen analytics while retaining the match-centre selector, local club
following and separate season/match accuracy records. The probability chart
opens through a native **Forecast details** disclosure, initially closed and
reset when selecting another fixture. A **Follow clubs** shortcut jumps to the
existing club tools without changing the date or filters.

Homepage rows use the existing valid-probability guard and supplied scoreline
under **Pre-match AI**. A missing scoreline uses the existing compact outcome
probability cell; invalid/missing probabilities render no AI pick. Actual live
and final scores remain beside the teams. This is presentation only: no model,
prediction computation, source ingestion, polling, season logic or promotion
changes. Provider warnings/retry and evidence fetching remain in place.

## Actual before/after browser pixels

Baseline: main `2aaaf3636ba1821f2f1cffb4a36abaaf4ab22d55`. Both builds use the
same 23 committed September 19 pre-match forecasts, replayed as upcoming UI
fixtures with a September 20 browser clock. Missing kickoff times remain
TBD/Time TBC. Provider requests are blocked in the browser and server.

First canonical fixture row's top edge, at an 800px viewport height (both themes
had the same geometry):

| Width | Before | After |
| --- | ---: | ---: |
| 320px | 1200px | 597px |
| 390px | 1100px | 521px |
| 768px | 1092px | 533px |
| 1440px | 1003px | 494px |

These measurements demonstrate that fixtures become reachable in the initial
viewport for this replay. They are not a usability study or a forecasting score.
The 320px layout still truncates long club names; the row opens the full match.

| View | Before | After |
| --- | --- | --- |
| 390px light | [Pixels](reviews/2026-10-12-compact-matchday/before-light-390-ready.png) | [Pixels](reviews/2026-10-12-compact-matchday/after-light-390-ready.png) |
| 390px dark | [Pixels](reviews/2026-10-12-compact-matchday/before-dark-390-ready.png) | [Pixels](reviews/2026-10-12-compact-matchday/after-dark-390-ready.png) |
| 1440px light | [Pixels](reviews/2026-10-12-compact-matchday/before-light-1440-ready.png) | [Pixels](reviews/2026-10-12-compact-matchday/after-light-1440-ready.png) |
| 1440px dark | [Pixels](reviews/2026-10-12-compact-matchday/before-dark-1440-ready.png) | [Pixels](reviews/2026-10-12-compact-matchday/after-dark-1440-ready.png) |

[Before measurements](reviews/2026-10-12-compact-matchday/before-report.json) and
[after measurements](reviews/2026-10-12-compact-matchday/after-report.json) retain
the exact positions and interaction results. After runtime: Node v24.19.0,
Chromium 151.0.7922.173. The baseline report predates the runtime metadata field;
it used the same local runtime.
The [opened forecast disclosure](reviews/2026-10-12-compact-matchday/after-light-390-forecast.png)
shows the retained chart and visible keyboard focus.

## Reproduce and limits

After `npm run build`, run `npm run test:matchday:compact`.
`QA_CHROMIUM`, `QA_PORT` and `QA_OUT` select the installed browser, unused local
port and evidence directory. `QA_BEFORE=1` captures the old layout without the
new hierarchy/interaction assertions. For a baseline, run this script against
the baseline production build. CI runs the new bounded check and uploads its
screenshots/report alongside all existing product, theme, background and fatal
hydration checks. It also prints count/geometry/runtime fields and the report's
SHA-256 in the text job log.

The eight after views cover 320/390/768/1440px in light/dark: no horizontal
overflow; keyboard open/close of details and navigation to club tools;
follow/unfollow and filtered-list recovery; three repeated date changes;
interruption of a held request; loading, empty, provider error and retry;
accuracy destinations; zero main-region WCAG A/AA axe violations. Uncaught
browser errors remain fatal. Unit tests check compact forecast honesty beside
actual scores, invalid/missing model data and list-before-context order. Existing
product/theme contracts cover broader navigation and availability states.

This deterministic UI replay does not establish live provider coverage, hosted
rendering, prediction improvement or player-data quality. European verified
results still end September 20 even when artifacts were generated later. The
recency challenger is not promoted. The production hydration investigation and
training/provider recovery remain separate work; passing local browser checks
do not resolve them. No background, model, provider or training code is changed.
