# Evaluation hydration failure remains open

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
asserts the prior notice remains visible, releases them and waits for the exact
updated notice before asserting retained metrics. It uses one retry click and
preserves every existing assertion; this does not establish a #418 fix.

On a production product-gate failure, CI makes one additional development-mode
Evaluation replay so unminified React can report a component stack and markup
diff. It reuses all 96 existing states, artifacts, faults and assertions. This
diagnostic runs after the failed production gate and cannot change its result;
it has a five-minute limit. Uploaded evidence includes both runs. There is no
automatic retry that can turn the production failure green.

## Current findings and limits

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
```

`QA_BASE` can point to an already-running development or production server.
`QA_OUT` selects the evidence directory. The default development evidence path
is `/tmp/pitchverse-evaluation-hydration`; production retains its existing path.
No provider workflow is dispatched and no test filters hydration errors.
