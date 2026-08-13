# Pitchverse handbook

Everything the site does not say on the page.

Pitchverse publishes probabilities for football matches, seasons and knockout
tournaments, and publishes the record of how those probabilities have scored.
The site itself is deliberately quiet: a page shows the forecast and the number
behind it, and sends you here for the reasoning. This handbook is that
reasoning — what each model is, what each metric means, where the data comes
from, and what is measured rather than claimed.

> **Not a betting product.** The bookmaker's closing price is used here as a
> yardstick, because it is the best public forecaster of a football match and
> therefore the hardest honest test available. It is not a target to beat for
> profit. The repository carries the measurement that settles it: backing this
> model against the price loses money in every disagreement bucket, and loses
> more the more confident the model is. See [Scoring](concepts/scoring.md#the-market-is-the-yardstick-not-the-opponent).

---

## Start here

| If you want to… | Read |
|---|---|
| Understand a single match forecast | [Read a match forecast](tutorials/read-a-match-forecast.md) |
| Follow a league across a season | [Follow a season](tutorials/follow-a-season.md) |
| Read a knockout bracket | [Read a bracket](tutorials/read-a-bracket.md) |
| Decide whether to trust any of it | [Judge the model](tutorials/judge-the-model.md) |
| Know what "Brier .593" means | [Scoring](concepts/scoring.md) |
| Look up a number's definition fast | [Glossary](glossary.md) |

New to the project entirely? [Getting started](getting-started.md) maps every
page of the site to the question it answers, in one screen.

---

## Tutorials

Task-shaped walkthroughs. Each one starts on a page of the live site and ends
with you able to read it without help.

- **[Read a match forecast](tutorials/read-a-match-forecast.md)** — 1X2, the
  scoreline grid, and why the two always agree.
- **[Follow a season](tutorials/follow-a-season.md)** — projected tables, title
  and relegation odds, and why they tighten as the season runs.
- **[Read a bracket](tutorials/read-a-bracket.md)** — tie probabilities, trophy
  odds, and the four states an edition can be in.
- **[Judge the model](tutorials/judge-the-model.md)** — how to use
  `/evaluation` and `/accuracy` to check the claims for yourself, including how
  to catch this project overstating itself.

## Concepts

The reference explanations. These are what the site's "How it works" page links
into when it stops explaining and hands over.

- **[Scoring](concepts/scoring.md)** — Brier, log loss, accuracy, ECE,
  calibration, and the baselines every number is read against.
- **[Models](concepts/models.md)** — the four forecasters: Dixon-Coles for
  matches, Monte Carlo for seasons, a tie classifier for knockouts, and a
  bracket simulation for trophies.
- **[Evaluation](concepts/evaluation.md)** — walk-forward versus live, why they
  are never merged, and the snapshot record that makes the live column possible.
- **[Data](concepts/data.md)** — sources, coverage, and the gaps that are left
  genuinely empty.

## Reference

- **[HTTP API](reference/api.md)** — every public route, its parameters and its
  response shape.
- **[Artifacts](reference/artifacts.md)** — the JSON files the site is served
  from, field by field.
- **[Commands](reference/cli.md)** — the scripts that produce those artifacts.
- **[Glossary](glossary.md)** — one-line definitions.

---

## The rules this project holds itself to

These are enforced in code and in review, not aspirational.

1. **No fabricated data.** Sparse coverage stays genuinely missing. A plausible
   value is never imputed to fill a column.
2. **Calibration gates the product.** A competition with no evidence ships no
   confidence claim. Displayed confidence never exceeds measured confidence.
3. **Baselines are never deleted.** A coin flip, a one-in-three guess, the
   base rate, always-back-the-home-side and the closing price stay live as
   yardsticks. A model that cannot beat them does not serve.
4. **A regression blocks promotion.** No recording a regression and shipping
   anyway.
5. **Retrospective and live records are never added together.** They are
   different samples measuring different things.

## Where the numbers in this handbook come from

Every figure quoted here is dated and names the artifact it was read from. The
repository re-derives them; a number without a date next to it in this handbook
is a bug. If a figure here disagrees with the live site, the site is right —
it reads the artifact, this file was written by hand.

Measurements live in `backend/data/diagnostics/` and
`backend/data/predictions/`; see [Artifacts](reference/artifacts.md).
