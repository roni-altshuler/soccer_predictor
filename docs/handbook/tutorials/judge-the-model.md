# Tutorial — judge the model

**You will need:** `/evaluation` and `/accuracy`.

**By the end** you will be able to check this project's claims without taking
its word for anything — including catching it overstating itself.

---

## 1. Start with the competition, not the headline

`/evaluation` is organised per competition because that is the unit the evidence
exists in. Pick a league or a tournament and you get *that* competition's
record: what the model believed, the baselines it had to beat, and how it has
scored.

The pooled headline (Brier .59303 over 43,433 matches) is an average over the
top five leagues, and the spread underneath it is wide — por.1 .56873 through
usa.1 .62101. A single figure hides that, which is why the page leads with the
picker rather than the average.

## 2. Ask the three questions

For any number on either page:

**What is the sample?** Printed next to every rate. A rate without an `n` is not
a claim; a rate with `n=12` is noise. Below the minimum sample the site drops
the verdict and keeps the context, rather than the other way round.

**What is the floor?** Every rate is shown against one. The gap to the floor is
the information, never the level. Two floors matter most:

- three-way match outcomes: a blind guess is 33%, and the *closing line itself*
  only reaches 54%
- knockout ties: a coin flip is 50%, and backing the better-rated side is 64.3%

**Retrospective or live?** The page keeps them in separate columns with a
divider. The walk-forward is large and honest and was never public in advance;
the live record is small and was. Adding them together would describe neither.

## 3. Check the calibration, not the hit rate

Sort forecasts by what they claimed and compare with what happened. The site
does this for you as paired bars: a calibrated band has two bars the same
length.

This is where a model is caught being overconfident, and it is why the site
refuses to draw a reliability chart below 200 scored matches — forty points do
not have a shape.

## 4. Look for the refusals

A trustworthy evidence page is mostly readable by what it *declines* to show.
On these pages:

- an empty live record stays empty and says why, rather than being filled with
  the backtest
- a section whose data is missing renders nothing rather than a zero
- a competition with no measured block gets no number
- unmatched clubs are counted and named, so a shrinking sample cannot hide as a
  small one

If you find a place where a missing number has been replaced by a plausible
one, that is a bug worth reporting.

## 5. The claim this project makes against itself

Look for these, because a page that only carries good news is not evidence:

- **The model trails the market.** Market Brier .5793 against the model's .5930
  (2026-08-13, 37,981 priced fixtures).
- **Backing it against the price loses money** — in every disagreement bucket,
  and more in the confident ones. That measurement is `benchmark_edge_buckets`
  and it is published.
- **The neural network did not beat Dixon-Coles**, so it was not promoted, even
  though it was newer and more expensive.
- **Lineups had no measurable effect** (−.00095, CI straddling zero) after
  759,920 rows of them were ingested.
- **The season simulation is overconfident at 70–90%** — says 80%, happens
  69.8%.

## 6. Reproduce it

Everything above is regenerable. The evidence artifacts live in
`backend/data/diagnostics/` and the commands that write them are in
[Commands](../reference/cli.md):

```bash
python3 -m backend.scripts.benchmark_market          # model vs closing line
python3 -m backend.scripts.baseline_walkforward      # the floors
python3 -m backend.scripts.benchmark_knockout        # ties, vs coin flip and Elo
python3 -m backend.scripts.backtest_brackets --sims 20000
python3 -m backend.scripts.benchmark_edge_buckets    # the money question
```

Each writes a JSON artifact with its own sample sizes and method block, and the
site reads those files rather than any number typed into a page.

## Next

- [Scoring](../concepts/scoring.md) — the metric definitions in full
- [Evaluation](../concepts/evaluation.md) — how the live record is kept honest
- [Artifacts](../reference/artifacts.md) — what each file contains
