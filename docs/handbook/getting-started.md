# Getting started

One screen: what each page of the site answers, and where to go when you want
the reasoning behind it.

## The site in five destinations

| Page | The question it answers | What it will not do |
|---|---|---|
| **Today** (`/`) | What is on right now, and what does the model make of it | Explain itself; every number links out |
| **Leagues** (`/leagues`) | For one competition: the table, the fixtures, the season projection | Score the model — that is Evaluation |
| **Tournaments** (`/tournaments`) | For one knockout edition: the bracket, who advances, who lifts it | Show a bracket for a draw that has not been made |
| **Evaluation** (`/evaluation`) | For one competition: what the model believed, and why | Merge the retrospective and live records |
| **Accuracy** (`/accuracy`) | The published-pick record, scored after the fact | Quietly fill an empty record with a backtest |

**Leagues and Tournaments are for the football. Evaluation and Accuracy are for
the model.** That split is the organising idea of the whole site: a page about
Arsenal's next six fixtures should not be arguing about Brier scores, and a
page arguing about Brier scores should not be where you go to check a kickoff
time.

## The three things worth knowing before you read any number

**1. A probability is a claim you can check, and every one here has been
checked.** When this model says 60%, the question is whether those matches
happen about 60% of the time. That is calibration, and it is measured — see
[Scoring](concepts/scoring.md#calibration).

**2. Every number is shown against a floor.** A 53% hit rate on three-way match
outcomes sounds poor and is in fact above both a blind guess (33%) and the
league's own base rate. A 64.9% hit rate on knockout ties sounds better and is
worth less, because a tie has two outcomes and a coin flip already gets 50%.
Floors are printed next to the numbers for exactly this reason.

**3. Retrospective and live are different claims.** A walk-forward backtest
over 43,433 matches is honest and large, and nobody saw those numbers before
those kickoffs. The live record is small — it starts at zero every time the
scope changes — and it is the only one where the forecast was published first.
Both are shown. They are never added together. See
[Evaluation](concepts/evaluation.md).

## Running it yourself

```bash
git clone git@github.com:roni-altshuler/soccer_predictor.git
cd soccer_predictor
npm install
npm run dev            # frontend on :3000, API on :8000
```

The site serves committed JSON artifacts, so a fresh checkout renders without a
database. Regenerating those artifacts needs the warehouse — see
[Commands](reference/cli.md).

## Next

- Reading the football: [Read a match forecast](tutorials/read-a-match-forecast.md)
- Reading the evidence: [Judge the model](tutorials/judge-the-model.md)
- Looking a term up: [Glossary](glossary.md)
