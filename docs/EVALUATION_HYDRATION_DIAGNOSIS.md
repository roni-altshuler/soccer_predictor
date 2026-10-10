# Production hydration failure remains open

The exact PR #44 merge, main `0e17d75486fa343ed765efa32ca9c2d6f0e2d9ad`,
[failed its production product gate](https://github.com/roni-altshuler/soccer_predictor/actions/runs/38065134074)
with React #418 on
`/leagues/eng.1/evidence?team=Arsenal&from=2026-07-12&asOf=2026-10-10&gender=M`,
before Evaluation ran. Its later development Evaluation diagnostic passed;
the production result remains failed. The Match evidence error reported
`state=ready, hold=true`. Both the held-date and held-gender hard navigations
share that state and URL, so the old log cannot identify which document failed.
The original helper wrote screenshots during the replay, but no failure JSON.
Artifact `11675217233` has SHA-256
`f7984beac49fe8c1da42b1e095bb20f15c334ec27a025c86d20aa8e529e0b54a`;
its ZIP contents could not be inspected in the saved environment because the
download endpoint returned HTTP 403. The decoded job log was inspected.

Match evidence now uses the same browser observer as Evaluation, with explicit
replay phases and distinct held-navigation labels. Fatal assertions and both
original `domcontentloaded` waits are unchanged. A failure writes
`evidence-failed-<width>.json` with the assertion stack and original browser
events, plus a recovery-time screenshot. Each viewport also writes its browser
events on teardown. The final screenshot is not proof of the original mismatch.

The production browser gate on main `e44641f08b2f98fe5efeacd95eda1e5a929c2223`
failed with React #418 on `/evaluation`, 768px, stored Dark with a Light OS
preference. The replay reported the all-artifact read-failure state when it timed
out waiting for the Color theme selector; its accumulated error list did not
establish the state or document where #418 first occurred. See the
[failed CI run](https://github.com/roni-altshuler/soccer_predictor/actions/runs/38059604188).
An earlier local production run also failed in a per-artifact initial-failure
state at 390px Dark. Passing repeats do not establish a fix.

This change adds evidence capture to the existing replay. Browser errors remain
fatal under the existing policy. Every error records its original stack or
console arguments, document head, root attributes, theme control values, both
theme storage keys and OS preference. Error-time timestamps, replay state,
navigation request identity and the document's performance time origin retain
the chronology separately from the later assertion failure. DOM reads start
inside error handlers, before asynchronous console-argument reads; React may
already have recovered the root when Playwright delivers the event. Expected injected HTTP 503 errors are
also recorded. Snapshot failure during document teardown retains the original
error and uses a null snapshot. No auth storage or body content is collected.

The [first diagnostic PR run](https://github.com/roni-altshuler/soccer_predictor/actions/runs/38062591640)
failed on an independent harness race at 390px Light: the retained-state check
read the prior Tournament-only notice before the retry responses completed.
Its browser error list was empty; the later capture already showed the updated
three-source notice. Its focused development replay passed all 96 states.
The retained transition now deliberately holds all three retry responses,
asserts the existing loading state hides the prior notice, releases them and waits for the exact
updated notice before asserting retained metrics. It uses one retry click and
preserves every existing assertion; this does not establish a #418 fix.

On a production product-gate failure, CI makes one development-mode Match
evidence replay and one Evaluation replay so unminified React can report a
component stack and markup diff. These reuse the existing three evidence
viewports and all 96 Evaluation states, artifacts, faults and assertions. Each
diagnostic has a five-minute limit and cannot change the failed production
result. Uploaded evidence includes the production and diagnostic runs. There is no
automatic retry that can turn the production failure green.

## Current findings and limits

- The unchanged Match evidence replay passed at 390, 768 and 1440px locally in
  development, including both held hard navigations at their original timing.
- A separate temporary diagnostic copy of the bundled development renderer
  observed the real Match evidence replay at the same three widths. It logged
  mismatch candidates, DOM parents and suspension/replay chronology. There were
  zero hydration mismatches and no `head` fiber replays; the observed hydration
  replays were at `ServerRoot`. It did not reproduce the specific upstream
  head-cursor signature. The renderer copy and webpack override are outside
  this change and were neither committed nor deployed. Instrumentation and the
  local browser can alter timing, so passing probes do not resolve #418.
- The unchanged standalone replay passed all 96 states in local development
  and production. Its passing results are evidence of those runs only.
- Dark mode leaves two theme-color tags after hydration: the boot script changes
  the first to `#071009`, then Next adds its declared `#f5f3ee` metadata. This is
  observable head mutation, but has not been linked to #418.
- The inline theme script exactly matches the corresponding hydration payload
  within both local builds. Function serialization has not been shown to cause
  this failure.
- Local Chromium is 151.0.7922.173; the installed Playwright package requests
  Chromium 148.0.7778.96 for CI. Both official download endpoints were blocked
  by the saved environment's network proxy. Local browser parity is incomplete.
- The original #418 cause, including app-versus-harness attribution, is
  unresolved. No application, theme,
  provider, data, forecast or model code is changed by this diagnostic.
- Next 15.5.7 aliases the App Router renderer to bundled React
  `19.2.0-canary-0bdb9206-20250818`, despite top-level React 18.3.1. A controlled
  thenable probe against that bundled renderer confirms a concurrent hydration
  suspension hazard. [React #37551](https://github.com/react/react/issues/37551)
  and its [proposed fix #37630](https://github.com/react/react/pull/37630) are
  diagnostic leads. The sampled custom root-head children are inline values,
  so that issue's specific client-reference trigger is not shown in the app.

Run the existing production gate after building, then the focused development
diagnostic, using free ports:

```bash
npm run build
QA_CHROMIUM=/usr/bin/chromium npm run test:product
QA_CHROMIUM=/usr/bin/chromium npm run test:hydration
QA_CHROMIUM=/usr/bin/chromium npm run test:hydration:evidence
```

`QA_BASE` can point to an already-running development or production server.
`QA_OUT` selects the evidence directory. The default development evidence path
is `/tmp/pitchverse-evaluation-hydration`; production retains its existing path.
Match evidence defaults to port 3134 and
`/tmp/pitchverse-match-evidence-hydration`.
No provider workflow is dispatched and no test filters hydration errors.
