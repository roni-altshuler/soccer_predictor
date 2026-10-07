# Tutorial — follow a season

**You will need:** `/leagues`, then any competition.

**By the end** you will be able to read a projected table, know what its
probabilities are a share *of*, and know which of them the project itself does
not fully trust.

---

## 1. The five tabs

A league page is the competition, not the model. Everything about how well the
model does lives on `/evaluation`.

| tab | what it is |
|---|---|
| **Overview** | next fixtures, current shape, the projection headline |
| **Standings** | the live table for the selected season |
| **Top Scorers** | the season's scorers, same season selector |
| **Fixtures** | every remaining fixture, six matchdays at a time |
| **Simulator** | run the season yourself under different assumptions |

The season selector at the top drives Standings and Top Scorers together. It
opens on the season being played — derived from the date, rolling over in July,
so Champions League qualifiers and the Community Shield count as the new season
— and previous seasons are in the dropdown.

## 2. Reading the projected table

Every probability in a projection is **the share of 20,000 simulated seasons in
which it happened**. Not a confidence, not a rating, not an opinion: a count.

- `p_title` — won the league. In MLS this is the Supporters' Shield, and a
  club's real season is `p_group_title` (won its conference) and `p_qualify`
  (reached the playoffs).
- `p_top_cut` — finished in the band that matters for that competition. The
  band is per league, because fourth is a Champions League place in a top flight
  and the Supporters' Shield is a single position in MLS. It is never hard-coded
  as "Top 4".
- `p_relegation` — finished in the drop zone, where the competition has one.

The projected points column is the **mean** across simulations, which is why it
carries decimals and why the ordering can differ from the title-probability
ordering. Those are two different questions.

## 3. It tightens as the season runs

A projection is not a preseason snapshot. The pipeline replays available
verified results, refits and re-simulates. Successful result refreshes determine
its cutoff; a new build does not imply results through yesterday. Points already banked seed
the simulation and played fixtures leave the remaining set, so the same page in
March is a much narrower claim than in August.

If a league shows a mid-season table in what looks like preseason, check the
calendar rather than the code — Brazil runs a summer season and is often 215
matches in when Europe is at zero.

## 4. What not to over-read

**The 70–90% band.** The season simulation is overconfident there: it says 80%
and it happens about 69.8%. This is measured, recorded, and the reason raw
simulation probabilities in that band are not printed as-is.

**A surprising ordering.** Season-boundary regression to the mean was tested
and rejected — it made things significantly worse at every shrinkage level
tried. So an ordering that looks wrong is the measured model's output, not a
bug to be tuned away.

**A league that is not there.** The current snapshot covers the big five and MLS. Others are held out
for stated reasons — Liga MX and Argentina because they are not a single round
robin, several second tiers because a Championship table next to the Premier
League made the page harder to read. Neither is a claim that the model cannot
handle them.

## 5. The Simulator tab

The same Monte Carlo, with the assumptions exposed. Change a club's strength or
force a result and re-run; the delta against the unmodified run is what the tab
is for. It is a what-if lab, not a second forecast — the published projection is
always the unmodified run.

## Compare two clubs

From a league page, open **Compare clubs · Season snapshot**. Both selectors
use the same competition and season in the committed `season_projections.json`
artifact. Selecting a club already on the other side swaps the pair.

**Recorded points / games played** describes the snapshot's results sample.
Points per game divides those two values, including any recorded deduction.
Different opponents, schedules and small samples limit this comparison. Zero
games gives an unavailable rate; missing fields stay unavailable, not zero.
The adjacent **projected final points** is the existing model's mean across
season simulations, explicitly a forecast. It is not a prediction of a match
between the selected clubs or evidence that one model is better.

The source link opens the exact existing serving artifact. Its build time is
shown separately from the latest result date, which this artifact does not
supply per league. A later build does not establish fresh results: the verified
European results in the October 7 audit still end September 20, 2026.
This view uses the published men's snapshot and withholds it for a women's
preference. It adds no ingestion, training or injury refresh.

Goals, shot-level xG, injuries and player values are absent here. **Shot-level
xG** estimates the chance an individual shot becomes a goal, using shot
characteristics; goals scored and a match forecast's expected-goal totals are
different measures. Missing shot data cannot be reconstructed from points.
The MIT-licensed [educational xG project](https://github.com/grandngom/xG-model-football)
illustrates logistic regression with distance/angle and contextual features on
only 50 matches (1,390 shots). It is a learning reference; none of its data,
assets or model is imported into Pitchverse.

## Next steps

- [Read a bracket](read-a-bracket.md) — the other shape a season comes in
- [Models § season projection](../concepts/models.md#2-season-projection--monte-carlo)
