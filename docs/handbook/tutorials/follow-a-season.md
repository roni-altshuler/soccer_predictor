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

A projection is not a preseason snapshot. Every day the pipeline pulls new
results, retrains through yesterday and re-simulates. Points already banked seed
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

**A league that is not there.** Nine leagues are projected. Others are held out
for stated reasons — Liga MX and Argentina because they are not a single round
robin, several second tiers because a Championship table next to the Premier
League made the page harder to read. Neither is a claim that the model cannot
handle them.

## 5. The Simulator tab

The same Monte Carlo, with the assumptions exposed. Change a club's strength or
force a result and re-run; the delta against the unmodified run is what the tab
is for. It is a what-if lab, not a second forecast — the published projection is
always the unmodified run.

## Next

- [Read a bracket](read-a-bracket.md) — the other shape a season comes in
- [Models § season projection](../concepts/models.md#2-season-projection--monte-carlo)
