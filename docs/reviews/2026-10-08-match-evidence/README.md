# October 8 match evidence review

These are actual Chromium 151.0.7922.173 captures of the local production UI.
The isolated build copied the feature's tracked/new files in this same saved
cloud environment; relevant code/config inputs were byte-checked against the
working tree. Existing dev servers and unpublished work were preserved.

The complete product browser run passed at 390, 768 and 1440px, including the
previous matchday/detail, portrait and comparison contracts. For this explorer,
[browser-report.json](browser-report.json) records **19 natural Tab stops and
19 reverse stops at each width**, including native date subcontrols, with zero
force-focus calls, accessibility violations, overflow, unexpected errors or
transient stale cards. Club selection, three comparison returns, browser
back/forward, loading/error/empty/sparse/retry states and independently held
date/gender responses all passed. Other APIs and external hosts were intercepted.

| View | Evidence |
| --- | --- |
| Before: comparison without match history | [October 7 view](../2026-10-07-team-comparison/after-390.png) |
| Mobile explorer | [mobile.png](mobile.png) |
| Desktop explorer | [desktop.png](desktop.png) |
| Per-match timing/source | [timing-mobile.png](timing-mobile.png) |
| Calibration | [calibration-desktop.png](calibration-desktop.png) |
| Loading | [loading-desktop.png](loading-desktop.png) |
| Empty | [empty-mobile.png](empty-mobile.png) |
| Error | [error-mobile.png](error-mobile.png) |
| Missing fields | [missing-mobile.png](missing-mobile.png) |
| September knowledge cutoff | [cutoff-mobile.png](cutoff-mobile.png) |
| Native calendar keyboard focus | [mobile](evidence-calendar-focus-390.png), [desktop](evidence-calendar-focus-1440.png), [report](calendar-focus-report.json) |

The empty/sparse/error images deliberately remove evidence or fail transport;
they are state checks, not measurements of a newly collected dataset. Full-page
captures retain fixed navigation; viewport focus captures show its actual bounds.
All selected screenshots were visually inspected.

## Reproducible data and limitations

[data-audit.json](data-audit.json) and [cutoff-audit.json](cutoff-audit.json) store
the same source file hashes with different cutoff days. Premier League: 50
distinct pre-day forecasts; **47** known results at October 8 and **38** at
September 20. The difference comes from later current-file outcome timestamps,
not nine newly played matches. Latest European match date remains September 20.
The score panel is a descriptive selected archive, not proof of training cutoff,
immutable publication, causal drivers or accuracy improvement.

Validation: **816 frontend tests / 65 suites**, **1,579 backend tests / 25
skipped**, lint and typecheck pass; existing warnings remain. Production build
passes and the new API bundle trace includes all nine monthly prediction files.
The only Matchday harness adjustment waits for asynchronous URL navigation
before inspecting the filter; its production behavior is unchanged.

Independent review found that forecast rejection could hide a known result
correction. The fix indexes result corrections separately after fixture/scope
validation. Twenty-six added regressions cover valid and invalid corrections
with rejected forecasts, permutation invariance, unrelated fixtures and future
knowledge cutoffs. The reviewer’s corrected result changes the deterministic
fixture's Brier from .245 to 1.145; an inconsistent latest winner withholds its
score. Both committed data audits remain exactly unchanged, including hashes.

Read the [scope and source review](../../MATCH_EVIDENCE_REVIEW.md) for the software
versus data license boundary and why player valuation, shot-level xG, scouting
rankings and fantasy forecasts remain unavailable. Public preview access was
not bypassed. CI uploads the full product evidence separately.
