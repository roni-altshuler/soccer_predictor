# Actual browser evidence — club comparison

Baseline main is `91a6c6256e33e58cf2dc2d4ca300bfbadce5a879`.
Before images show the existing league page in the local dev browser before
implementation; unrelated live/provider data is empty, and the Next dev
indicator is visible. The comparison did not exist then. After and state images
show the actual local **production** frontend, using the existing serving API
and committed season snapshot for the ready comparison. No external provider
data or assets were collected.

| Width | Existing league before | New comparison after | Complete focus ring |
|---|---|---|---|
| 390 | [Before](before-league-390.png) | [After](after-390.png) | [Focus](focus-390.png) |
| 1440 | [Before](before-league-1440.png) | [After](after-1440.png) | [Focus](focus-1440.png) |

The full-page mobile screenshot includes fixed bottom navigation at the
capture viewport. The [scrolled source viewport](source-mobile.png) shows the
actual reading position and accessible source controls above that navigation.
Reviewed [loading](loading-desktop.png), [empty](empty-mobile.png) and
[error](error-mobile.png) images retain the surrounding league context and
recovery controls. These failure states are deliberate UI injections, not
evidence of a current provider incident.

[`report.json`](report.json) records passing actual browser interactions at
390, 768 and 1440 px, source/sample values, keyboard selection and Swap,
repeated selections/navigation, retries, unsupported gender and calendar-year
league scope. No unexpected page/console errors, horizontal overflow or scoped
axe A/AA violations occurred. One deliberately failed transport at each width
produced an expected resource-error message, recorded separately.

Images were viewed and visually inspected in the saved cloud environment,
including the complete focus ring and scrolled mobile source panel. The full
existing product suite also passed its Matchday, detail, race and portrait
contracts. CI uploads the remaining images and complete suite report as
`product-quality-evidence`.

See the [scope and source review](../../TEAM_COMPARISON_REVIEW.md) for commands,
limits and the distinction between built-at and results-through dates.

The [targeted follow-up review](targeted-review.md) records delayed gender/league
responses and sequential Tab/Shift+Tab. It found and fixed a mobile reverse-focus
control hidden behind the sticky header; new production replay covers all
comparison controls and the shared retry control without force-focus.
