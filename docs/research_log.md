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

---

## 2026-08-11 — The layered experiment: which data layer actually earns its place?

**Hypothesis.** The expanded corpus and the newly-loaded FBref columns —
referee above all — improve on the Dixon-Coles baseline.

**Method.** `train_layered.py`. Two passes: chronological day-blocked
featurisation, then expanding-window refits (train on seasons < T, predict T).
Layers added cumulatively, each scored against the previous on identical rows
with a paired bootstrap. Wave A, 2000–2025, 46,789 matches, 43,433 scored.
2026-27 untouched.

**A wrong turn worth recording.** The first run used LightGBM at 400 trees and
scored Brier **.6249** against plain Elo's .6023, with three times the
calibration error. That is a model too large for a ~5k-row training window, and
reading "the FBref layers do not help" off it would have blamed the data for
the estimator. Re-run with a multinomial logistic and with a small,
early-stopped LightGBM. **Do not let an unregularised model deliver a negative
result about data.**

**Result — Wave A, 43,433 scored rows, both estimators on identical rows:**

| layer | logistic Brier | Δ | LightGBM Brier | Δ |
|---|---|---|---|---|
| *(ref)* base rate | .64760 | | | |
| *(ref)* Elo formula | .60108 | | | |
| ratings (4 feats) | **.59366** | −.00742 vs Elo, **sig** | .59479 | −.00629, **sig** |
| + form (28) | **.59303** | **−.00063, sig** | .59443 | −.00036, ns |
| + rest (33) | .59331 | +.00027, ns | .59415 | −.00028, sig |
| + h2h (35) | .59343 | +.00012, ns | .59429 | +.00014, ns |
| + **referee** (39) | .59376 | **+.00033, worse** | .59428 | **−.00001, ns** |
| + context (43) | .59459 | +.00083, worse | .59406 | −.00022, ns |

Calibration: logistic ratings+form ECE **.0099**; Elo formula .0233.

**Interpretation.**

1. **Four Elo features under a logistic beat the Elo formula by .00742** — a
   significant, free win. The rating carries the signal; the *mapping* from
   rating difference to a three-way distribution is worth learning rather than
   assuming. It also cuts calibration error from .0233 to .0084.
2. **Form helps, and only once there is enough data.** On eng.1 alone (7,980
   matches) form was +.00119 and not significant; on Wave A (46,789) it is
   −.00063 and significant. This is the single piece of direct evidence in this
   repo for "more data helps" — and note how small the payoff is.
3. **The referee layer does not help.** Logistic +.00033 (worse); LightGBM
   −.00001 (literally nothing). This is the answer to a question the repo could
   not previously ask: the earlier "+.0015, harmful" verdict was England-only
   because England was the only league with the column. With esp.1 at 91%,
   ita.1 at 100%, fra.1 at 89% and ger.1 at 68%, the answer is unchanged.
   **"Untestable" and "no effect" are different answers, and this is now the
   second one.**
4. Rest, h2h and context add nothing either. Two independent model families
   agree on the whole ordering.
5. Best model overall: **logistic on ratings + form, Brier .59303** — ahead of
   the Dixon-Coles walk-forward baseline (.59580 on 44,185 rows; masks differ
   slightly, so treat as comparable rather than paired).

**Decision.** Ratings + form is the feature set. Do not add referee, rest, h2h,
venue, attendance or kickoff time. Do not run the match-tier scrape for xG on
the strength of a hoped-for effect — every non-rating layer tested so far has
landed at zero, and xG must be argued for on stronger grounds than "it is more
data".

**Next.** The remaining ceiling is not in the feature list. It is in (a) the
strength model — dynamic/state-space, which yields uncertainty rather than a
point estimate — and (b) propagating that uncertainty into the season and
tournament heads, where the 70–90% overconfidence lives.

---

## 2026-08-11 — Shipping: production forecast for 2026-27

**Hypothesis.** The measured-best model can serve the upcoming season directly.

**Method.** `forecast_season.py`. Trains the winning head (logistic on Elo +
form) on all 62,504 played matches, freezes the feature state, featurises the
2,346 upcoming fixtures already in the FBref schedule tier, and Monte Carlos
each league 20,000 times.

**Result 1 — coherence.** The 1X2 head and the goal model are different
families and do not agree by accident. Solving Dixon-Coles' two lambdas so the
scoreline grid reproduces the logistic's 1X2 makes them agree to **0.00000**.
One object: expected goals, scorelines and outcome probabilities, all
consistent, with the 1X2 equal to the forecast that was actually measured.

**Result 2 — the first run was not shippable.** Point-estimate simulation gave
Bayern **93.3%**, PSG 88.1%, Inter 83.4% for their titles, against bookmaker
prices nearer 70/70/30. A point estimate compounded 34 times is an assumption
repeated, not a forecast.

**Fix, measured not guessed.** Within-season Elo drift over **3,583
team-seasons** in this corpus has sd **45.3 points** (p10 −58, p90 +57). That
is how wrong a start-of-season rating turns out to be, and it is correlated
across all of a club's fixtures. Drawing one strength offset per club per
simulation and holding it for the season gives:

| | before | after | market ballpark |
|---|---|---|---|
| Bayern | 93.3% | **71.3%** | ~70% |
| PSG | 88.1% | 59.3% | ~70% |
| Inter | 83.4% | 54.8% | ~30% |
| Man City | 54.8% | 38.6% | ~35–40% |
| Barcelona | 64.4% | 48.7% | ~45% |

Per-MATCH probabilities are left unperturbed: the head was measured at ECE
.0099 on exactly those inputs. The shock is about season-long correlation,
which is the only place it matters.

**A fix tested and rejected.** The ratings put Bournemouth above Chelsea, which
looks wrong. The standard remedy is regressing ratings toward the mean at each
season boundary. Measured on Wave A 2000–2025: **+.00150 at 0.25 regression,
+.00394 at 0.40, +.00796 at 0.60 — significantly worse at every level.** Not
adopted. The surprising ordering is what the measured-best rating actually
says, and tuning until the table looks right is how a model stops being a
measurement.

**Decision.** Shipped. `/season` serves title, top-four and relegation for
seven leagues plus per-fixture forecasts, with the walk-forward record and the
list of measured-and-dropped feature groups on the same page.

**Next.** Score the forward season against these published numbers as results
land — that is the only test that has not been run because it cannot be yet.
