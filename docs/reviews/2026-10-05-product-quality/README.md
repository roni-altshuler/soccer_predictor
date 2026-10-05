# Product quality evidence — 2026-10-05

This is a deterministic UI contract replay, not a current prediction or a live
provider review. Both versions receive the same committed 2026-09-19 forecast
for Tottenham Hotspur / Aston Villa, with optional confidence, markets, inputs
and attribution removed. Match detail contains empty provider content; no
results, standings, lineup, or kickoff time are invented. The date-only card
is a test scaffold, not evidence of a midnight kickoff.

The baseline is reviewed main `73a14eac6296f2e462e8378b64c70424d10aeb61`.
Its sparse response displays invented neutral inputs, squad health, markets and
an exact-score chance. The fixed version retains the published 1X2 and score
pick while keeping absent evidence unavailable.

| Width | Before | After |
| --- | --- | --- |
| 390px | [Before](before-390.png) | [After](after-390.png) |
| 1440px | [Before](before-1440.png) | [After](after-1440.png) |

The same baseline replay reproduced Yesterday → match detail → Back selecting
Today at both widths. The automated fixed-version browser contract verifies
390/768/1440px, keyboard activation, three repeated detail returns, browser
Back/Forward, filter history, reload, Following, direct-detail fallback and
scroll restoration. It checks horizontal overflow, control sizes, browser
errors and WCAG 2 A/AA violations within the main content. Provider, analytics
and PWA cache activity are isolated so responses stay deterministic.

The browser contract also verifies fully null score/confidence/goal evidence
and restores the same recorded forecast's actual confidence and xG. The real
`GET /api/match/[id]` Jest contract mocks only upstream responses: missing,
null and nonnumeric fields stay unknown through serialization and the adapter;
published zeros, markets, scoreline distributions and attribution survive.
v1's mode remains separate from expected goals; the fallback's contract-defined
xG pair and its valid sum remain available. Provider selection and fetching,
backend model logic, and committed data are unchanged.

Run `npm run build && npm run test:product`. To use an existing local server:
`QA_BASE=http://127.0.0.1:3000 npm run test:product`. An installed system browser
can be selected with `QA_CHROMIUM=/usr/bin/chromium`.

Each frontend CI run uploads all twelve responsive screenshots plus `report.json`
in the `product-quality-evidence` artifact, tied to that PR head. This evidence
checks UI contracts; it makes no new claim about model quality or coverage.
