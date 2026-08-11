# Research log

Append-only. One entry per experiment that changed a decision — including the
ones that failed, which are the entries that stop the same idea being tried
twice. Newest last.

Format: **date · hypothesis · method · result · interpretation · decision ·
next**.

---

## 2026-08-11 — Does the FBref scrape contain what the model needs?

**Hypothesis.** The FBref corpus, already collected, contains predictive
information the warehouse lacks.

**Method.** Full audit of both databases and the raw HTML cache;
`audit_fbref_inventory.py` emits `reports/data_inventory.parquet` and
`docs/fbref_data_inventory.md`.

**Result.** 207,517 fixtures, 39 competitions, 1888–2027, **used by nothing**.
Referee populated on 76.9% of rows against 0.0% in the warehouse for esp.1,
ger.1, fra.1. `match_url` on 97.2%. **xG on 0.0%** — verified against raw cached
HTML, not inferred: the Premier League 2023-24 Scores-and-Fixtures page as
served carries no `xg` data-stat at all. The entire match tier (shooting,
passing, possession, defensive, goalkeeping, player, lineups) is uncollected:
13 rows, 0 shots.

**Interpretation.** The largest available improvement needed no scraping — it
needed the loader to be run. xG is not a parsing bug; the schedule tier does
not carry it, and it costs one request per match.

**Decision.** Run `load_fbref_to_warehouse`. Defer the match tier until the
layered ablation says whether xG earns 29 hours for Wave A 2017+.

**Next.** Canonical layer over both databases.

---

## 2026-08-11 — A sweep that reported success had lost three competitions

**Hypothesis.** The completed sweep (`790 league-seasons, error: 0`) covered
what it claimed.

**Method.** Cross-checked the scraped league list against
`ScraperFC.fbref.comps`.

**Result.** France Ligue 1 — a Wave A league — plus the FIFA World Cup and
Women's World Cup produced **zero rows**. Cause: FBref answers a burst with a
well-formed 110KB page titled "Rate Limited Request (429 error)" that parses
cleanly to zero rows, and the client **cached it**. Every later run scored a
cache hit and reported success. Ligue 1 was re-attempted twice and both times
returned `{'fetched': 0, 'cache_hits': 1}`.

**Interpretation.** Caching a rejection converts a transient failure into a
permanent, silent one. The generalisable rule: any cache in front of a
rate-limited source must validate before it writes.

**Decision.** `rejection()` names rate limits, challenges and implausibly short
pages; retries with backoff; never writes them. Swept the cache — 28 of 829
poisoned, purged and re-fetched. 7 regression tests.

**Result after fix.** Ligue 1 32 seasons / 11,510 fixtures; World Cup 23
editions back to 1930. Corpus 194,591 → 207,517.

**Next.** Never trust a scrape's own success line; audit the league list.

---

## 2026-08-11 — Can name normalisation link the two sources?

**Hypothesis.** Accent/punctuation/token normalisation is enough to join FBref
onto the warehouse.

**Method.** Built the canonical layer with conservative `norm_team()` and
joined on (competition, normalised pair, date ±1d).

**Result. No.** eng.1 2019 linked 182 of 198; ger.1 2019 linked **72 of 234**.
The residue is abbreviation and exonym, not punctuation: `Manchester Utd` /
`Manchester United`, `Köln` / `FC Cologne`, `Gladbach` /
`Borussia Monchengladbach`, `PSG` / `Paris Saint-Germain`.

**Interpretation.** No token rule reaches these, and fuzzy string matching is
what put a second `teams` row for "Ath Madrid" in the warehouse and duplicated
every Atletico fixture. The identity evidence had to be something other than
spelling.

**Decision.** Resolve by **fixture-graph alignment**: within a
competition-season both sources describe the same matches, so aligning on
(date, scoreline) proposes a name pair per aligned match. Accept only on
mutual-best + ≥5 votes + 3× dominance over the runner-up.

**Result.** 395 aliases accepted (113 genuine renames), **22,491 proposed and
refused**. Every accepted rename is human-verifiable with 25–30× dominance.
Wave A link rate: eng.1 100%, esp.1 100%, ger.1 100%, ita.1 100%, fra.1 100%.
Canonical rows fell 237,722 → 219,770 as ~18k duplicate matches collapsed.

**Next.** The refused 22,491 are the honest backlog, not a bug.

---

## 2026-08-11 — The true baseline, match-by-match walk-forward

**Hypothesis.** Before any ML, establish what results-only models achieve under
a protocol with no lookahead at all.

**Method.** `baseline_walkforward.py`. Chronological, one match at a time,
predict-then-reveal; same-day fixtures predicted as a block before any of that
day is observed. Paired bootstrap on Brier, resampling matches.

**Result — Wave A, 2000–2026, 46,789 matches:**

| model | log loss | Brier | accuracy | ECE |
|---|---|---|---|---|
| uniform | 1.09861 | .66667 | 45.6% | .0000 |
| base rate | 1.06601 | .64395 | 45.6% | .0098 |
| Elo | 1.01504 | .60226 | 51.5% | .0218 |
| Elo + MOV | 1.02867 | .60940 | 51.2% | .0466 |
| **Dixon-Coles** | **0.99823** | **.59580** | 51.6% | **.0102** |

All 45 competitions, 1990–2026, 180,058 matches: Elo .60846, Elo+MOV .61244.

Paired bootstrap vs Elo: Dixon-Coles **−.00524** [−.00662, −.00395] *better*;
Elo+MOV **+.00714** [+.00621, +.00807] *worse* (and +.00398 [+.00360, +.00436]
on the 180k corpus).

**Interpretation.**

1. Dixon-Coles beats Elo significantly, on an independent implementation and a
   corpus 9× the size of the one the serving decision was originally made on.
   The serving default is re-validated rather than assumed.
2. **Margin-of-victory Elo is significantly worse than plain Elo**, replicated
   on two corpora, while nearly doubling calibration error (.0466 vs .0218).
   The damped-MOV multiplier makes large updates on lopsided results and the
   ratings overshoot. MOV is widely recommended; it does not survive
   measurement here.
3. Sanity: uniform scored log loss 1.09861 = ln(3) and Brier .66667 = 2/3 to
   five decimals, so the metric code is not drifting.

**Decision.** Dixon-Coles is the baseline anything new must beat. Do not add
MOV to Elo. Layers A–C of the layered experiment are now measured.

**Next.** Layer D — the referee group, testable outside England for the first
time (esp.1 91.2%, ita.1 100%, fra.1 89.4%, ger.1 67.6%, all from 0.0%).

---

## 2026-08-11 — Literature check against our own results

**Hypothesis.** Published state of the art indicates where the remaining signal
is.

**Method.** Targeted search; `docs/literature_review.md`.

**Result.** Hubáček et al.: best rating system RPS 0.2101, best goal models
0.2103 — a gap of **0.0002**. Best overall in that comparison is CatBoost on
**pi-ratings features**, RPS 0.1925. Deep learning shows no reliable advantage
at this data scale. FiveThirtyEight's SPI was well-calibrated and still
returned **about −6%** against Pinnacle closing.

**Interpretation.** Two independent confirmations of this repo's own findings:
nine challenger families landing within noise of each other is what the
literature predicts, and a calibrated model losing to the closing line is the
*expected* outcome rather than a defect. The one actionable difference is that
the best published result comes from boosting over **rating** features, not raw
statistics — which is not what the 75-feature neural stack here does.

**Decision.** Do not pursue deep learning. Next model families: dynamic /
state-space strength (untried, strong prior, yields uncertainty), then boosting
over rating features. Stop using "beat the closing line" as the success
criterion.

**Next.** Layer D, then state-space strength.
