# Static backgrounds — October 12, 2026

The owner requested removal of animated backgrounds because they distract from
scores, schedules and browsing. This replaces the former ambient-layer design
exception. All product routes use their existing solid document background:
cream `#f5f3ee` in light mode and pitch-green `#071009` in dark mode.

The change removes the globally mounted pitch backdrop, its canvas match
simulation and animation-frame loop, the two drifting CSS light pools and pitch
stripes, and both desktop/mobile Pitch controls. The ambient preference module,
head startup script and `data-ambient` attribute are removed too. Existing
`pitchverse-ambient` storage values are left unused; they cannot enable a layer.
This deletes the machinery rather than hiding it or relying on reduced motion.

The source inventory found no other decorative animated background in the
product. Static formation/shot-map pitches depict football data and remain.
Chart, bracket and simulator interactions, focus/hover feedback, live-state
markers and useful loading indicators retain their existing code. Static
social-share image gradients also remain; they are generated image content,
not a running page background. Navigation, data, models, providers, auth and
visibility are outside this change.

## Reproducible browser evidence

After a production build, run:

```bash
QA_CHROMIUM=/usr/bin/chromium npm run test:backgrounds
npm run test:theme
npm run test:product
```

Omit `QA_CHROMIUM` to use Playwright's installed Chromium, as CI does. `QA_OUT`
chooses an evidence directory. `QA_BEFORE=1` records the original layer and
requires the dark canvas to actually draw and both CSS light pools to run; use
it against the base checkout/build rather than the removed implementation.
The reviewed base was `48893ef8eca93ba104d3fc8724ffd7807ab19279`.
To reproduce before pixels, run the review checkout's script by absolute path
with the working directory set to a separately built base checkout; its imports
resolve from the review checkout, and its server/fixtures use the base directory.

The dedicated audit captures 48 views: Matchday, league directory, league,
match, team, tournaments, Evaluation and docs, at 390/768/1440px in both themes.
It enables normal motion, seeds the old vivid setting, and measures animation
frames and canvas draws during an idle one-second window after finite entrance
animations settle. After removal it requires zero background nodes, decorative
CSS animations, canvas draws and idle frame callbacks, plus the expected shared
palette, no horizontal overflow and an operable theme selector.
It also operates the match Prediction tab, follows/unfollows the fixture's club,
and opens/closes a tournament in each width/theme combination.

The same committed sparse ESPN excerpt and server replay as the existing theme
journeys block browser/server provider access. Committed forecasts/evaluation
artifacts are replayed; no model, data or provider generation is performed.
These are browser contracts, not evidence of current sports-data completeness.

The existing theme journey now requires background absence after theme changes,
instead of requiring a hidden canvas to refit. Its palette, persistence,
history, auth-modal contrast and accessibility checks remain. Existing product
contracts exercise date/filter navigation, profiles/player dialogs, comparison,
match evidence and Evaluation states. All original fatal browser assertions
remain; an intermittent hydration failure is still a failure, not a background
removal success claim.

CI runs the normal-motion background audit with a five-minute bound and uploads
its report/pixels with the existing product evidence. The diagnostic positive
control and existing product/theme gates stay intact.
The bounded `STATIC_BACKGROUND_AUDIT` log line prints counts, runtime and the
retained report's exact-byte SHA-256 so review does not depend on ZIP access.

## Measured local result

All 48 baseline views passed. Each of the 24 dark views showed two running
decorative CSS animations, 60–61 animation-frame callbacks and 21–23 canvas
clears per idle second. All 48 after views passed with zero background nodes,
decorative/unknown infinite CSS animations, canvas clears and idle callbacks.
The additional match, follow/unfollow, tournament and theme actions passed in
all six width/theme combinations (24 interaction checks).

The 124-state theme journey, full product replay (including its 96 Evaluation
states), diagnostic positive control, 907 frontend tests, lint, types and build
passed locally. Local Chromium 151 / Node 24 differ from CI's installed browser
and Node 20; exact-head CI remains authoritative. Provider/image hosts are
blocked, so screenshots contain sparse/fallback imagery. These checks do not
resolve or waive the separate intermittent hydration/health findings.
