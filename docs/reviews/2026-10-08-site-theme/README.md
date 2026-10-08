# Site theme browser evidence

Captured in the saved cloud environment with local production builds, Chromium
151.0.7922.173 and provider requests blocked. The main baseline is
`97c0128f90d1b9cdfbea505a34c8952b26319c41`; the after build contains the frontend
theme consistency change. See [scope, protocol and limitations](../../SITE_THEME_REVIEW.md).

[Before report](before-report.json) contains 78 captured states.
[After report](after-report.json) contains 124 states with no recorded errors or
horizontal overflow. [SHA-256 manifest](sha256.json) identifies the reports and
28 selected screenshots. Every after capture records and asserts its expected
destination URL. The 24 modal action measurements include default/hover login
and register submits in both themes. Full local screenshot sets remain under
`/tmp/soccer-theme-before-evidence-final` and `/tmp/soccer-theme-auth-complete-evidence`.

| View | Before saved light | After light | After dark |
|---|---|---|---|
| Phone homepage | [Before](before-light-390-home.png) | [Light](after-light-390-home.png) | [Dark](after-dark-390-home.png) |
| Phone league | [Before](before-light-390-league.png) | [Light](after-light-390-league.png) | [Dark](after-dark-390-league.png) |
| Phone profile | [Before](before-light-390-team.png) | [Light](after-light-390-team.png) | [Dark](after-dark-390-team.png) |
| Desktop homepage | [Before](before-light-1440-home.png) | [Light](after-light-1440-home.png) | [Dark](after-dark-1440-home.png) |
| Desktop league | [Before](before-light-1440-league.png) | [Light](after-light-1440-league.png) | [Dark](after-dark-1440-league.png) |
| Desktop profile | [Before](before-light-1440-team.png) | [Light](after-light-1440-team.png) | [Dark](after-dark-1440-team.png) |
| Phone auth modal | — | [Light](after-light-390-auth-login.png) | [Dark](after-dark-390-auth-login.png) |
| Desktop auth modal | — | [Light](after-light-1440-auth-login.png) | [Dark](after-dark-1440-auth-login.png) |

Other selected after views cover match, comparison and evidence at phone and
desktop widths. They use the same sparse inputs as their before replay. Blank
crest images are local placeholders for intercepted external images; no assets
or provider data were collected. This evidence makes no forecasting claim.
