# Tutorial — read a bracket

**You will need:** `/tournaments`, then any competition.

**By the end** you will be able to read a tie probability, read trophy odds,
and tell the seven states an edition can be in apart — including the three that
mean "we are deliberately not forecasting this".

---

## 1. Pick a competition, then a season

The picker leads with the competitions most people came for — Champions League,
Europa League, World Cup, Euros, Copa América — and then everything else. Under
it, the seasons of that competition, newest first.

The page opens on the edition the artifact marks as *current*, which is not
always the newest season on file: a competition whose next edition already has
one qualifying tie played would otherwise open on a tournament that has barely
started.

## 2. The seven states

The state is printed next to the season, and it decides what the numbers below
it mean.

| state | on the page | what it means |
|---|---|---|
| `in_progress` | In progress | ties left to play; the odds are live |
| `upcoming` | Starting now | drawn, nothing played yet |
| `awaiting_fixtures` | Next up | fixtures published, **draw not made** — no bracket, no odds, on purpose |
| `awaiting_draw` | Draw not made | this edition's next round is not drawn yet |
| `completed` | Finished | a record of a call already settled |
| `not_reconstructed` | Finished · not forecast | the bracket could not be rebuilt from the data; nothing is claimed |
| `insufficient_history` | Not enough history | too little prior data to fit anything honest |

**Three of these are refusals**, and they are the point. A bracket drawn for a
draw that has not happened would read as a forecast of it, so where the pairing
is unknown the page says so and shows nothing else. Where fixtures exist but the
draw does not, the edition still appears — with the fixture count and start date
behind it — so the site has something true to say in the three months between
one final and the next draw.

## 3. Reading a tie

Each tie shows both sides and, if undecided, a probability that one of them
advances. A settled tie shows the score and the winner and **no probability** —
a percentage next to a finished tie would read as a forecast of something
already known.

The floor here is **50%**, not 33%. A tie has two outcomes; extra time,
penalties and away goals exist to guarantee it. So a 58% is a real lean and a
64.9% overall hit rate is only 0.6 points above simply backing the better-rated
side. The gap to the floor is the information — see
[Scoring § floors](../concepts/scoring.md#the-floors).

**Calibration is the claim worth trusting here.** Measured over 2,141 test ties:
says 55.1% happens 55.7%, says 64.7% happens 64.8%, says 74.3% happens 74.3%,
says 83.9% happens 86.3%.

## 4. Reading trophy odds

Trophy odds come from simulating the whole bracket 20,000 times through the tie
model. They are *not* the tie probabilities multiplied by eye — a side at 70%
per round across four rounds is a 24% champion.

Two honest limits printed on the page:

- **Only the drawn round is a bracket.** Where later rounds are not drawn, they
  are paired at random in the simulation. CONMEBOL in fact seeds from the round
  of 16, so the real spread there is slightly tighter than shown.
- **The favourite usually does not win.** Over 85 backtested tournaments the
  model's favourite lifted it 31.8% of the time — better than backing the
  highest-rated side (22.4%), and still less than a third.

## 5. The bracket fits on your screen

The whole tree is visible without sideways scrolling at any width. On a narrow
screen the two halves stack vertically and each reads inward toward the final,
rather than shrinking twelve-pixel type to three pixels. The shape is the reason
to draw a bracket at all — it tells you who could still meet whom — and a board
that scrolls sideways shows you a third of it.

## Next

- [Models § knockout tie](../concepts/models.md#3-knockout-tie--random-forest)
- [Judge the model](judge-the-model.md)
