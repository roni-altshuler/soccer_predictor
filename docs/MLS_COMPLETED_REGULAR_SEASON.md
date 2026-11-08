# Completed MLS regular season

MLS's 2026 regular season ended on November 7. The MLS Cup playoffs are a
separate phase. A league with no upcoming regular-season fixtures must retain
an honest observed record without turning known results into predictions.

The completion path is deliberately scoped to the reviewed 2026 format:
30 clubs, 34 games per club, 510 matches, and nine playoff qualifiers per
conference. Unknown future formats remain unavailable until reviewed. The
[official MLS schedule](https://www.mlssoccer.com/news/audi-2026-mls-cup-playoffs-key-dates-schedule-information)
supplies the regular-season endpoint, independently of the MLS Cup final.

## Evidence required

The existing conference refresh retains an optional standings observation
from its single ESPN request. Missing statistics, wrong season/phase,
duplicate identities or malformed ranks cannot create that observation.
The observation is timestamped after the response is parsed.

Before generating a completed record, the forecast requires:

- Positively identified regular-season results. Playoffs cannot add points.
- The existing non-participant filter, then exactly 30 identified clubs and
  510 unique result and schedule identities.
- Exact agreement for every club's played count, wins, draws, losses, points,
  goals for, goals against and goal difference against observed standings.
- Authoritative conference positions, with no invented combined final rank.
- One-to-one fixture reconciliation: exact dates first, then unambiguous
  next-UTC-day matches, then a single remaining schedule/result pair for the
  same ordered home/away clubs. Multiple residual candidates are refused.
- Aware, non-future observation timestamps and actual result kickoff times
  preceding the standings observation. A date alone cannot establish this.

Residual date discrepancies keep the original schedule row key/date, result
date/UID and matching method. They do not certify a rescheduling decision or a
fresh calendar. The retained schedule verification timestamp is unchanged.

## Output and history

`state: regular_season_completed` has an empty forecast `table` and a separate
`observed_table`. Observed rows contain no `p_*` or `exp_*` fields. Standings
observation, result cutoff, proof check, artifact generation and retained
schedule verification are separate timestamps.

The directory, league page and club comparison label these as observed
regular-season results. Existing non-forecast league tabs remain available;
season simulations are suppressed. Past forecast evaluation and recorded
prediction history remain separate. Capture skips completed records, even if
a malformed record carries stray forecast fields.

The missing-league guard is unchanged. An incomplete completion proof returns
failure before artifact writes and retains the previous complete forecast.
Publication can still report degraded schedule coverage; this feature does
not certify provider access or current kickoff times.

## Verification

Run the `test_completed_mls*` backend tests, full repository checks and
`scripts/mls_completed_ui_audit.mjs` against an isolated completed artifact
replay. The replay is test evidence, not a production publication. Verify a
subsequent authorized publication's generated timestamp and observed MLS state
before claiming that the served forecast recovered. Do not manufacture fixture
dates, copy old probabilities under a new timestamp or bypass the league guard.
