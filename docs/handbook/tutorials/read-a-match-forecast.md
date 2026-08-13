# Tutorial — read a match forecast

**You will need:** any fixture on the site. Start at `/` (Today) and open a
match, or go straight to `/season/fixture/<uid>`.

**By the end** you will be able to read the three numbers, the scoreline grid
and the ratings, and know which of them to distrust.

---

## 1. The three numbers

```
Arsenal            Draw            Chelsea
  47%              27%              26%
```

These are the model's probabilities for the three outcomes of 90 minutes. They
sum to 100% — always, by construction — and they are **not** a pick. The
highest one is the outcome the model would name if forced, and on this site
that has been right about 52% of the time over 43,433 walk-forward matches.

Two things to hold on to:

- **27% for a draw is not a low number.** About a quarter of league matches end
  level. A model that never gives the draw meaningful probability is not being
  bold, it is being wrong.
- **A 47% favourite loses more often than not.** That is what 47% means. Over a
  season, favourites at that level should win a little under half the time, and
  if they win 70% of the time the model is *under*confident, which is also an
  error.

## 2. The scoreline grid

Below the three numbers is a distribution over exact scores — 1-0, 2-1, 0-0 and
so on. The top scoreline is usually somewhere between 8% and 15%, which is
worth sitting with: the single most likely exact result of a football match is
an event that happens about one time in eight.

**The grid and the three numbers are the same model.** The 1X2 probabilities are
read off the grid, and the publish aborts if they disagree by more than 1e-3.
Worst disagreement measured across 2,346 fixtures: 0.00000. If you sum every
home-win cell in the grid you will get the home number to five decimal places.

## 3. The ratings

Each side carries an Elo rating, computed chronologically over every match in
the warehouse and read **strictly before** the fixture it is used for. A gap of
100 points is roughly a 64% expectation for the stronger side before home
advantage.

Ratings are post-match values timestamped at kickoff. This matters more than it
sounds: reading the rating "at" kickoff without the strict inequality would
include the result of the match being predicted.

## 4. What to distrust

**Anything with a small sample behind it.** The site prints `n` next to every
rate for this reason.

**Confidence in the 70–90% band on season projections.** The league Monte Carlo
is measurably overconfident there — says 80%, happens 69.8%. Match-level
probabilities do not have this problem (ECE .0099), but the derived
season-level ones do.

**Any implied comparison to a bookmaker.** The model trails the closing line:
market Brier .5793 against the model's .5930 on comparable fixtures (2026-08-13).
Where the model disagrees with the price, the price has been the better
forecaster in every disagreement bucket measured.

---

## Where the numbers came from

1. Dixon-Coles fits an attack and defence coefficient per club on years of
   results.
2. Those give two scoring rates for this fixture.
3. The rates generate the scoreline grid, with the Dixon-Coles correction for
   low scores.
4. The grid is summed into the three outcome probabilities.

Full detail: [Models § match outcome](../concepts/models.md#1-match-outcome--dixon-coles).

## Next

- [Follow a season](follow-a-season.md) — what happens when you aggregate 380
  of these
- [Judge the model](judge-the-model.md) — checking the claims above yourself
