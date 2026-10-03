# Pitchverse quality priorities — October 2026

This is a proposed sequence, not a new accuracy claim. The app already has
competition navigation, match/team drilldowns, recorded forecasts, season
simulations, tournament brackets, a Forecast Lab and per-competition evidence.

Reference: [FotMob](https://www.fotmob.com/) keeps match discovery, search,
filtering and league navigation close together. Apply that hierarchy within
Pitchverse's Floodlight design and retain original assets.

1. **Restore result freshness.** This pass fixes upcoming-fixture contract
   failures and distinguishes report dates from scored-result dates. Next,
   test warehouse/result refresh contracts, count failures/unmatched fixtures
   and expose source status. Acceptance: an outage cannot publish a current
   label; a valid off-season empty schedule stays distinct from an error.
2. **Measure challengers temporally.** Freeze pre-kickoff forecasts by version;
   score Brier/log loss/calibration by league and horizon. Pair baselines and
   verified prices on identical fixtures. Fit calibration on training data,
   use ablations and keep a final season untouched during tuning. Promote only
   with a predeclared paired improvement and no material calibration regression.
3. **Tighten match browsing.** Preserve date/league/scroll across drilldown and
   back. Lead with teams, score/status, kickoff and dated probabilities; place
   explanations and measured evidence one action away. Acceptance: 390px and
   keyboard flows work without horizontal overflow; loading, missing forecasts
   and outages have distinct states; direct links show the recorded forecast.

Browser timings and accessibility measurements are future acceptance criteria.
No feature or model family earns promotion without measured evidence.
