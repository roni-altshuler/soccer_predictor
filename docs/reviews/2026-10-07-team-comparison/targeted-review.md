# Follow-up browser review

Independent review of PR #39 requested delayed context changes and actual
sequential Tab navigation. The saved executor remained usable after its
lifecycle notice: filesystem read/write/fsync succeeded at **12:13:51 UTC**,
the local server returned HTTP 200, and Chromium **151.0.7922.173** rendered
the comparison. All work stayed in that environment.

## Reproduced issue and scoped fix

On the original `9c9689ef7bbc4e8b28ceff526e4f44e330f8bc95` production
frontend, forward Tab passed. Reverse Shift+Tab from the source section put
the focused mobile **Back to league** link at **y=20–64**, partly behind the
56 px sticky header. The outline existed but the control was obscured.

The only product change is `scroll-margin-top: calc(var(--shell-topbar-h) +
12px)` on the comparison's shared controls. Native keyboard scrolling now
places that link at **y=68–112** on mobile, fully below the header; desktop is
**y=88–132**. Selection, source dates, gender and serving/model logic are
unchanged. No result cutoff is hardcoded into the UI.

| Evidence | Screenshot |
|---|---|
| Original reverse focus obscured on mobile | [Before](reverse-before-390.png) |
| Corrected ready-state reverse focus, production mobile | [Fixed](reverse-fixed-390.png) |
| Corrected ready-state reverse focus, production desktop | [Fixed](reverse-fixed-1440.png) |
| Handbook reached with sequential Tab | [Focus](sequential-handbook-390.png) |
| Old men's response released after switching to women | [No stale cards](delayed-women-390.png) |
| Old English response released while MLS response is held | [Loading current league](delayed-league-1440.png) |

## Actual outcomes

The production browser passed **10 targeted scenarios** at 390 and 1440 px:

- Natural Tab from the document through the shell and **Back → First club →
  Second club → Swap → Source → Handbook**, then the complete reverse order.
  All controls have visible focus and are unobscured. Tab/Shift+Tab can leave
  the comparison in either direction. No force-focus API is used.
- The shared empty/error **Try again** control is reached by sequential Tab,
  inspected in both directions and activated with Enter to recover. Native
  End selection and keyboard Swap are also operated without force-focus.
- A held men's request is cancelled when switching to women. Releasing its
  response still leaves the unsupported women's view without cards or a new
  men's request.
- Switching **men → women → men** holds the fresh request separately. Releasing
  the old response shows no cards while the fresh request remains pending.
- Clicking actual **Leagues → MLS → Compare** links changes league before the
  old response is released. Only the newly released MLS response supplies its
  clubs. No English cards appear while it is pending.

All six delayed cases record **zero transient stale cards** using both DOM
mutation and painted-frame observers, not just final-state assertions. Each
former request records `net::ERR_ABORTED`; the fresh context waits for its own
independently released response. No unexpected browser console/page errors
occurred. The gender change uses the hook's existing canonical preference
event because the public gender switch is intentionally hidden; league changes
use real app navigation. Responses use the already authorized artifact only.

[`targeted-review.json`](targeted-review.json) records the focus order, geometry,
reverse traversal, request cancellation and frame/DOM observations. Screenshots
were viewed in the saved cloud. The committed fixed ready-state Back images
come from the first corrected production run; the same product code passed
again when the shared retry case was added. Other selected images and the JSON
come from that final full-suite production run. CI saves uniquely named images
for ready and empty reverse traversal and all sequential focus steps.

The full product suite, **744 frontend tests**, lint, typecheck and production
build passed after the fix. No backend code changed. PR #39 remains draft for
final parent review; public deployment QA and provider recovery are unverified.
