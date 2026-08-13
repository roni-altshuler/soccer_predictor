# Evaluation

Two records, never merged, and the provenance trail that makes the second one
possible at all.

---

## The two records

| | historical walk-forward | live published |
|---|---|---|
| what it is | the model refit as the corpus advanced, predicting each match before seeing it | the last forecast published *before* kickoff, scored after the result |
| sample | 43,433 matches (2026-08-13) | grows from 0 |
| honest? | yes | yes |
| was it public first? | **no** | **yes** |

Both are real measurements. They answer different questions:

- The walk-forward answers *"is this modelling approach any good?"* on a large
  sample, with the discipline that nothing is fitted on data after the match it
  predicts.
- The live record answers *"did this website tell you the truth before
  kickoff?"* — a much smaller sample, and the only one where the number was
  visible to a reader in advance.

**They are never added together, and the layout of `/evaluation` is what
enforces that** — two columns with a divider, not one stack of grey boxes. A
combined figure would describe neither sample.

A live `n` of 40 is reported as 40. A live `n` of 0 is reported as 0, with the
reason. It is never quietly backfilled with the walk-forward number.

### Why the live record can be legitimately empty

The live column is scoped to the *serving* model in the *covered* competitions.
When either changes — a new default model, a re-scoped league list, a season
boundary — the intersection can be empty, and that is the correct state rather
than a failure. The site says so explicitly and shows what has been recorded
and is waiting to be scored.

---

## Prediction snapshots — the provenance record

`services/forecast/snapshots.py`, table `prediction_snapshots`.

**Append-only.** Keyed `(fixture_uid, generated_at, model_version)`, written
with `INSERT OR IGNORE`. A test reads the module's own source to assert it
contains no `UPDATE`, no `DELETE` and no `INSERT OR REPLACE`. Without that, a
forecast that moved would quietly become the forecast we claim to have made.

`final_before_kickoff()` is the canonical evaluation record: strictly the last
forecast generated **before** kickoff.

- Not the first — that would be stale.
- Never one generated after the match — that is not a forecast, and it would
  flatter the model.

As of 2026-08-13 the store held 75,663 snapshot rows over 5,041 fixtures across
3 model versions.

The warehouse is gitignored, so the snapshot table is exported to a release
asset each run **and restored from that same asset at the start of every run**.
The artifact each run downloads is republished by jobs that know nothing about
forecasts, so without the restore an export would replace the whole history with
one run's, and the append-only table would be one run deep forever.

---

## The join is by team id, not by name

A snapshot's club name comes from the schedule source ("Wolves", "Gladbach",
"Man Utd"); a result's comes from the warehouse ("Wolverhampton Wanderers",
"Borussia Mönchengladbach", "Manchester United").

Rehearsed against a full season, a **name** join scored 68.9% of fixtures —
Bundesliga 23.4%, Premier League 41.1% — and dropped the rest silently. The live
sample would merely have looked small. Resolving both sides through canonical
names, a curated alias table and the canonical layer's fixture-graph aliases:
same rehearsal, **99.6%**.

Unmatched clubs are **counted and named** in the payload and on the page.
"Not played yet" and "we no longer recognise this club" both shrink the sample
and only one of them means something is broken.

---

## What `/evaluation` shows, per competition

The page is organised by competition because that is the unit the evidence
exists in. For each one:

- **What it believed** — the walk-forward record for that competition alone,
  with the baselines it had to beat to appear on the site at all.
- **What it has published** — the live record for that competition, or an
  honest empty state.
- **Where the error is** — calibration bands, once the sample is large enough
  to have a shape.
- **What it leaned on** — for the knockout layer, permutation importance over
  the tie features.

Competition-level records vary widely and the site shows them per competition
rather than flattening to one headline. Measured 2026-08-13, walk-forward Brier
per league: por.1 .56873, ned.1 .57010, eng.1 .58266 … tur.1 .60377, usa.1
.62101. **Each competition carries its own measured block** rather than
inheriting the .59303 pooled figure, which was measured on the top five only.

---

## What `/accuracy` shows

The published-pick record: every pick this site has made, scored against the
final result, with per-league and per-confidence breakdowns and the recent feed.
Same design language as `/evaluation`, different question — `/evaluation` is
about the *model*, `/accuracy` is about the *picks*.

Rates below their minimum sample lose their verdict chips rather than their
context, and a section whose data is missing renders nothing rather than
rendering a zero.

## See also

- [Scoring](scoring.md) — what Brier, log loss and ECE reward
- [Judge the model](../tutorials/judge-the-model.md) — how to check these claims
  yourself
- [Artifacts](../reference/artifacts.md) — the files behind both pages
