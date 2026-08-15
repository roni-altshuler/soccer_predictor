# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this app is

**Pitchverse** is a soccer match-prediction dashboard: Next.js 15 frontend, Python/FastAPI backend, ML prediction engine. Deployed on Vercel.

It does **four things**, and nothing else (see [docs/PIVOT_2026-08.md](docs/PIVOT_2026-08.md)):

1. **Match outcome prediction** — 1X2 and scoreline, calibrated, scored against closing odds.
2. **Season projections** — title, relegation and final table, updated as the season runs.
3. **A value surface** — model probability vs no-vig implied probability, with EV and Kelly staking.
4. **Tournament brackets** — who advances a knockout tie, and who lifts the trophy. Added 2026-08-11 (see *The tournament layer* below).

If a proposed feature is none of those four, it does not belong here. The project pivoted on 2026-08-08 away from a sprawling "world model of football" (VISION_2030) that had grown to 26 pages and 131k lines while the prediction engine regressed for nine straight weeks.

**This is a betting-adjacent product.** The former "educational only, no betting recommendations" constraint is retired. That raises the evidentiary bar rather than lowering it — see Standing rules below.

## Standing rules — read before changing anything

- **The market is the benchmark.** Any accuracy claim is stated as paired Brier/log-loss against closing odds on named fixtures, or it is not stated. Measured target on our own corpus: **market Brier .5666** over 25,746 fixtures (ECE .0049).
- **Calibration gates the product.** A league with no evidence ships no value flags. Displayed confidence never exceeds measured confidence.
- **Baselines are never deleted.** Constant base rate, Elo and Dixon-Coles stay live as yardsticks. A model that cannot beat them does not serve.
- **A regression blocks promotion.** No recording a regression and shipping anyway.
- **No fabricated data.** Sparse coverage stays genuinely missing; never impute a plausible value.
- **Features must earn their place** via temporal-split ablation against the market row. Adding all 53 candidate features *degraded* Brier by .0052.

## Current measured state (2026-08-10)

The warehouse was repaired again on 2026-08-10 and the numbers below moved with
it — re-derive rather than copy them forward.

**Repaired again on 2026-08-13 and the corpus SHRANK, so re-derive these before
quoting them.** 22 wrong-competition matches deleted, identities merged to a
fixpoint, and **2,173 duplicate rows collapsed** (1,315 fields coalesced into
the survivors, so no odds were lost) once `find_duplicate_fixtures` stopped
keying on `phase` — see the landmines below. `matches` 83,785 → **81,701**;
`eng.1` 2025 748 → **380**, ESPN-sourced throughout, which is what a 380-match
season should hold.
Anything measured on the pre-2026-08-13 corpus counted most of last season's
top-five matches twice.

| | before repair | after repair |
|---|---|---|
| Market corpus (Wave A, priced fixtures) | 25,746 | **37,981** |
| Market Brier / ECE | .5666 / .0049 | **.5793 / .0030** |
| Dixon-Coles walk-forward, scored fixtures | 12,289 | **31,247** |
| Dixon-Coles gap to close | +.0207 | **+.0177** |

**The data repair alone moved Dixon-Coles .0030 closer to the market on 2.5x the
sample.** No modelling changed. That is the ratio worth remembering when
choosing between a feature idea and a data-integrity fix.

**Live record: none.** `paired_benchmark` is n=0 by construction — it is now
scoped to the serving model (`dixon_coles`) in the five covered leagues, and
that intersection was empty on 2026-08-10 because Dixon-Coles had only just
become the default and Wave A was between seasons. `/accuracy` says so rather
than filling the space with a retired model's number.

### Neural stack vs Dixon-Coles, retrained on the repaired warehouse

Artifacts retrained 2026-08-10 (75 features, no market block, test ECE .0044)
and scored by `benchmark_unified_vs_dc` on 5,320 paired Wave A fixtures:

| forecaster | Brier | log loss | accuracy | gap to close |
|---|---|---|---|---|
| Market (closing line) | **.5757** | .9680 | .5387 | — |
| Dixon-Coles | .5897 | .9896 | .5226 | +.0140 |
| Neural stack, 75 features | .5925 | .9924 | .5205 | +.0168 |
| Constant base rate | .6526 | 1.0777 | .4312 | +.0769 |

**Dixon-Coles keeps serving.** NN−DC is +.0028 in Dixon-Coles' favour, 95% CI
[−.0015, +.0070], p(NN better) = .103. Ahead in 1 of 5 leagues on the point
estimate, 0 of 5 on the bootstrap; eng.1 favours Dixon-Coles significantly.

**Read that table only with the two benchmark bugs in mind — before they were
fixed the same artifacts scored NN−DC at −.0450, "significant in 3 of 5", which
would have promoted the net.** Both bugs handicapped everything except the net:

1. `_chronological_split` re-sorts by `(date_utc, competition_id)` while
   `iter_matches` yields `(date_utc, match_id)`. The warehouse rows were sliced
   positionally against the re-sorted split, so any fixture sharing a date with
   another was scored against a different fixture's closing price and a
   different fixture's team names. The market read .6911 instead of .5757 and
   70% of the corpus was dropped as unpredictable (1,533 scored, not 5,320).
   The old assert compared the *pre-split* lists, so it passed throughout.
2. Dixon-Coles was fitted once at the split date and then used across a
   three-year test window. It now refits every calendar month.

**Whenever a challenger beats the closing line, suspect the harness first.** A
model with no market features cannot out-predict the market by .027 Brier; that
number was the bug announcing itself.

## The tournament layer (2026-08-11)

**A knockout tie has two outcomes, and that is the whole point.** Every
three-way number in this file is capped by the fact that 25.6% of league
matches are drawn — the closing line itself only reaches 54.0% on 1X2. Extra
time, penalties and away goals exist so that exactly one team advances, so the
tie is where soccer asks a binary question, and it is the honest place to look
for the kind of accuracy a binary sport allows. It is a different question,
not a trick for inflating the same one.

Measured 2026-08-11 on **14 competitions** — UCL, UEL, Conference, World Cup
(incl. the 48-team 2026 edition), Euros, Copa América, Libertadores,
Sudamericana, AFCON, Asian Cup, Gold Cup, CONCACAF Champions Cup, Club World
Cup, Nations League.

| | accuracy | Brier (binary) |
|---|---|---|
| Coin flip | 50.0% | .2500 |
| Higher-rated side advances | 64.3% | .2381 |
| **Random forest over tie features** | **64.9%** | **.2175** |

2,141 test ties, 2013–2026, rolling origin (train on every previous season,
test on the season played). Progression check 2,433/2,442 = **99.6%**.

**Calibration is the result worth quoting, not the accuracy.** Says 55.1%,
happens 55.7%. Says 64.7%, happens 64.8%. Says 74.3%, happens 74.3%. Says
83.9%, happens 86.3%. That is what a bracket simulation consumes.

Read the ladder as a gap, not as levels: adding nine minnow-heavy competitions
raised absolute Brier for *everything* (the baseline moved .2308 → .2381), and
the model's edge over "back the better-rated side" grew from .0175 to
**.0206**. Logistic .2182, HGB .2195, XGBoost .2281 — the forest still wins.

Bracket Monte Carlo over **85** reconstructed tournaments:

| | log loss on the actual champion | picked the winner outright |
|---|---|---|
| Uniform over the field | 2.5606 | — |
| Elo simulation (unfitted) | 2.1453 | 22.4% (highest-rated) |
| **This model** | **1.9686** | **31.8%** (top 3: 63.5%) |

Half again as often as taking the highest-rated team, on a sample nearly three
times the first run's.

**Forward forecasts** (`predict_tournaments` → `backend/data/predictions/tournaments.json`)
put every competition in exactly one of four states — `upcoming`,
`in_progress`, `completed`, `awaiting_draw` — and the UI must not flatten them.
As of 2026-08-11 nothing is mid-flight: the Libertadores and Sudamericana round
of 16 are drawn and start today (Flamengo 23.4%, Botafogo 17.7%), and every
other competition is finished. The 2026 World Cup is in as a record: the model
made Argentina favourite at 19.0%, and Spain won it from 11.6%, third on its
list.

### Rules for this layer

- **Bracket depth is COUNTED, never parsed.** `second-round` is the round of 32
  in the Europa League and the round of 16 at the 1998 World Cup;
  `quarter-finals` and `quarterfinals` are the same round in different seasons.
  `_assign_depth` derives the round from `2 x (ties in it)`. Any code that maps
  a phase string to a bracket position will be wrong in the seasons nobody
  checks.
- **`validate_progression` is the integrity gate.** It asks whether the team
  the resolver says advanced actually appears in the next round. Currently
  991/993 = 99.8% with qualifying excluded. **Run it after any change to tie
  resolution** — a wrong away-goals branch or a mis-paired second leg trains
  the model on the losing side and is otherwise invisible.
- **A one-legged tie inside a two-legged round is a hole, not a format.** ESPN
  carries one leg and not the other for some pre-2010 qualifiers; resolved on
  that scoreline they name the wrong team about half the time. `_flag_missing_legs`
  marks them `incomplete` and drops them.
- **Ratings are POST-match values timestamped at kickoff.** `rating_before` then
  takes the last entry strictly earlier. Storing pre-match values instead looks
  equivalent and silently runs every feature one game stale — that was the first
  version, caught by
  `test_rating_is_read_strictly_before_the_match_that_produced_it`.
- **ClubElo cannot serve this layer.** It covers 244 clubs and zero national
  teams. `tournament/ratings.py` builds one Elo over all 60,953 warehouse
  matches so a World Cup tie has a rating on both sides.
- **Enumerate reachable pairings, do not cache lazily.** A 16-team bracket has
  112 possible ties in total; batching them into one `predict` turned a
  twenty-minute backtest into a two-minute one.
- **Whether a tournament is live is a question about FIXTURES, never about
  resolution.** `predict_tournaments` first asked "is any tie winner-less?" —
  but a tie is also winner-less when a leg is *missing from the data*. Six such
  holes made the 2025-26 Champions League, whose final was played on
  2026-05-30, report as still running with live-looking title odds. Liveness
  now comes from `scheduled_matches`: fixtures still to play, or none.
- **`matches` is results-only. Keep it that way.** It has held zero null-score
  rows for the life of the project and every consumer — Elo, Dixon-Coles, the
  feature builder, the integrity checker — reads a row there as a fact about
  something that happened. Drawn-but-unplayed fixtures live in
  `scheduled_matches` (owned by `ingest_scheduled_fixtures.py`), and
  `ties.build(include_scheduled=True)` is the only reader that merges them.
  Pending ties carry no label and are excluded from every fit by construction.
- **A team whose only appearance is a future fixture is not an orphan.**
  `find_orphan_teams` now checks `scheduled_matches` too; without it
  `delete_orphan_teams` would delete Singapore, which entered the warehouse
  with three Asian Cup 2027 fixtures and no result anywhere.
- **Refuse bracket SLOT names at the ingester, not just at the simulator.**
  ESPN publishes undrawn rounds with competitors like "Group A 2nd Place".
  `TeamResolver.resolve` creates a club it cannot match, and it fuzzy-matched
  every such string in the Asian Cup 2027 draw onto **one** invented row —
  producing a tie whose two sides were the same team, a guaranteed advance. A
  junk `teams` row is permanent and competes with every later fuzzy match.
  `is_placeholder` refuses them, and a fixture whose two sides resolve to the
  same id is refused whatever it is called.
- **Only the drawn round is a bracket.** When the round of 16 is published and
  the quarter-finals do not exist yet, `bracket_tree` correctly returns None.
  `simulate_open_draw` handles that case by pairing every later round at
  random — an assumption that is printed on the page, because CONMEBOL in fact
  seeds from the round of 16, so real spread is slightly tighter.

### FBref is not available to this machine

Sports Reference answers datacentre IPs with **HTTP 403**, re-verified
2026-08-11 against the Champions League page with a browser User-Agent. It is
genuinely free in a browser and genuinely unreachable from here and from CI.
ESPN answers the same questions, and carries the shootout scores and
`winner` flags that FBref's match tables do not expose. Where FBref would add
something ESPN cannot — per-match xG before 2017 — that gap stays recorded.

### Lineups: measured, and not significant

`lineups` was an empty table for the life of the project; it now holds 759,920
rows over 18,939 Wave A matches (2015–2025). Scored on the 11,948 fixtures
both arms cover: ratings-only .59471, ratings+lineups .59377, **delta −.00095,
95% CI [−.00219, +.00029], p(better) = .932 — no measurable effect.** The one
feature carrying anything is `xi_output_diff` (+.00275), the gap in recent
goal involvement between the two starting elevens. Every feature is computed
from the XI alone, which the scraper already fetches ~1h before kickoff, so
none of it is unservable the way the market block was.

| Task | Command |
|---|---|
| Knockout tie model | `python3 -m backend.scripts.benchmark_knockout` |
| Bracket Monte Carlo | `python3 -m backend.scripts.backtest_brackets --sims 20000` |
| Resolve knockout winners | `python3 -m backend.scripts.backfill_knockout_results` |
| Ingest new tournaments | `python3 -m backend.scripts.ingest_tournaments --all` |
| Ingest drawn-but-unplayed fixtures | `python3 -m backend.scripts.ingest_scheduled_fixtures --all` |
| Forward title odds | `python3 -m backend.scripts.predict_tournaments` |
| Lineup ablation | `python3 -m backend.scripts.benchmark_lineup_features` |
| Capture a vendor's pre-match odds | `python3 -m backend.scripts.capture_vendor_predictions` |

## Benchmarking a bought forecast (2026-08-15)

`api-football` is wired as a **challenger to measure, never a source to serve**.
`capture_vendor_predictions.py` appends its pre-match 1X2 triple to
`backend/data/predictions/vendor_predictions.jsonl`, and the comparison is
scored later against results, on the same fixtures as ours.

- **It has to be captured FORWARD.** Asking a vendor today about a match played
  last season returns a number computed today, and nothing in the response says
  it could have been acted on. Every row carries `captured_at` and
  `before_kickoff`; the same rule `final_before_kickoff()` enforces on our own
  snapshots. Buying a number does not exempt it.
- **The free plan blocks `season=`, not the data.** `fixtures?league=39&season=2026`
  is refused with "try from 2022 to 2024", but `fixtures?date=<today>` returned
  1,216 fixtures including 18 in our nine leagues at season 2026, and
  `predictions?fixture=<id>` answered for all of them. Query by DATE.
- **It rate-limits per MINUTE as well as per day, and reports it two ways** —
  HTTP 429, or **HTTP 200 carrying `{"errors": {"rateLimit": ...}}` and an empty
  `response`**. Reading only the status code makes a throttled run look like a
  day with no fixtures: a run reported "0 forecasts, 1 request used" and nothing
  about it looked wrong. `get()` treats a non-empty `errors` object as a
  failure. Default pause is 7s between calls.
- Leagues are matched on **(country, league name)**, not a hard-coded id table.
  Five of the nine ids were verified live; the other four were not playing that
  day, and four unchecked ids is how a table goes silently wrong about one
  league.

**First capture, 2026-08-15, 18 fixtures: the vendor's answers were
`45/45/10`, `10/45/45`, `0/50/50` and `50/50/0` — four buckets.** It is matchday
one, their model runs on running-season statistics, and with none it degenerates.
Two of the eighteen put **0%** on a real outcome, which is a claim no result can
justify and an infinite log loss if it lands. Do not read the early sample as
their steady-state quality — and do not discard those rows either, because
scoring them is the measurement.

**`smartbetsAPI` (github.com/Simatwa/smartbetsAPI) cannot be benchmarked this
way, and that is a property of its output, not a judgement of it.** Read
`bet_analyzer.py` and `predictor.finalizer`: it converts last-five form and
league position into ad-hoc percentages (`(wins*100)/5`, `105 - position*5`),
normalises the two teams' strengths to sum to 100, and emits a LABEL from
`{1, 1X, X, X2, 2}`. There is no P(draw) — a draw is inferred from the two
strengths being within one point — so there is no 1X2 triple to score with a
proper scoring rule. Mapping its strength share onto probabilities would
benchmark our mapping, not their model. It also sources data by scraping
Soccerway via a Google search, which this machine cannot reach anyway. Its
README's 55% accuracy would beat the closing line's 54.0% on 1X2 — per the
landmine list, that is the signature of a harness bug, not an edge.

### The decision rule is pre-registered (2026-08-15)

Written into `score_vendor_predictions.py` **before the sample existed**, so
neither side of the argument can move the goalposts once numbers arrive. The
vendor's triple replaces ours only if all three hold:

1. it beats the served model on paired Brier over the scored fixtures,
2. the paired bootstrap CI on that difference excludes zero, and
3. it is closer to the market price than ours, on fixtures where a pre-kickoff
   price exists.

Beating us but not the market makes it a candidate **feature** for
`benchmark_market_blend.py`, not a replacement. Beating *the market* is not a
promotion either — it routes to "audit the harness", because this repo has
already lost months to a benchmark bug that announced itself exactly that way.
Failing (1) or (2) means keep ours, which is the default and needs no argument.

**Both sides are held to the kickoff rule, not just the challenger.** The vendor
row carries `before_kickoff`; our record carries `prediction_timestamp`; a pair
is scored only when both precede that kickoff. Enforcing point-in-time on the
challenger while exempting the incumbent would win the comparison by
construction. (Known asymmetry, not yet fixed: the two forecasts are not made at
the *same* time before kickoff, only both before it.)

**Score ours from `predictions_*.json`, never `season_fixtures.json`.** The
latter is the *remaining* set — a fixture leaves it once played, so by the time
a result exists our forecast for it is gone. Reconstructing one afterwards is
the exact sin this exercise is set up to catch.

**The join needed a uniqueness gate, same as the tie join.** The exact key
missed 4 of 14 joinable fixtures on the first capture, every one cosmetic:
`academico viseu`/`academico de viseu`, `cambuur`/`sc cambuur`,
`dc united`/`d c united`, `new york red bulls`/`red bull new york`.
`relaxed_key()` drops noise tokens anywhere, glues split initials, singularises
and compares as a set — deliberately loose, and therefore **only used when it
matches exactly one fixture on that competition and date**. Two candidates is a
refusal. A wrong join is worse than a missing one: it puts a real number on the
wrong result.

**`required_n()` returns None when the pair never disagrees.** Subtracting two
constant series leaves float dust near 1e-17, not a clean zero, and that dust
divided through to "you need 1 more fixture" — the most dangerous answer the
function could give. Guard is `sd < 1e-9`, not `sd <= 0`.

**Vendor degeneracy is tracked as a running statistic.** The first 18 captures
had two identical legs in **18 of 18** triples and only 5 distinct triples.
P(draw) landing exactly on P(home) every time is a two-way strength comparison
wearing three numbers. If their model warms up once the season gives it data,
`vendor_degeneracy` in `backend/data/diagnostics/vendor_vs_ours.json` is where
that shows up — rather than being assumed either way.

Captured by `.github/workflows/capture_vendor_predictions.yml`, every 6 hours
over today and tomorrow (~25 of the 100 daily requests). It fails loudly on a
missing `API_FOOTBALL` secret, because a scheduled job that captures nothing
looks exactly like a quiet day.

## What we said, and what happened (2026-08-15)

`RecordedForecastPanel` puts the project's central claim on the match itself
rather than only on `/accuracy`: the forecast that was written down, the
timestamp proving it was written down first, and the result. All three match
surfaces render it in `MatchDetail`'s `model` slot.

- **Read from `predictions_*.json`, keyed on the ESPN event id.** The durable
  record keeps a fixture after it is played; `season_fixtures.json` is the
  remaining set and loses it. All three surfaces already hold the event id.
- **A forecast that cannot be shown to predate kickoff is NOT DRAWN.** Not a
  caveat, a refusal — the panel's whole value is the ordering of two events, so
  without the ordering there is no panel. `beforeKickoff` comes from comparing
  the row's `prediction_timestamp` against the card's kickoff.
- **The probability it gave the outcome that happened leads**, with Brier
  beside it. "It gave this 16%" is what a person can reason about.
- **The one-match caveat prints on a hit as well as a miss.** A hit read as
  proof is the same error in the flattering direction. It quotes no specific
  percentage: a hard-coded "62%" sat under a bar reading 40.5% and looked like
  a contradiction.

**`/accuracy` lists `WAVE_A`, not `SERVED` — do not conflate them.**
`/evaluation` lists the six leagues the site PROJECTS, which is right for a
projection. `/accuracy` states distance from the closing line, and only the five
with a paired market price can carry that claim. Listing MLS beside them offers
a league that can never show a number.

**The tracker no longer deletes columns it does not name.** `_save_predictions`
rewrites every row in a month for one outcome update, and `from_dict` filtered
unknown keys — so the first live save deleted `model_selection`,
`draw_min_prob` and `draw_margin` from 1,635 records written by the scheduled
pipeline. Nothing read them, which was luck. They now ride through in `_extra`
and re-merge on the way out, with known columns winning.

## Production forecasting (2026-08-11)

The 2026-27 season is served from `forecast_season.py`. **The model is frozen**
unless a demonstrated implementation bug says otherwise.

### It re-syncs every matchday, by construction

Nothing about the forecast is a preseason snapshot. Each daily run pulls new
results from ESPN, rebuilds the canonical layer, retrains through yesterday,
and re-simulates. Elo and form advance with each result; **points already
banked seed the season simulation**, so the projection tightens as the season
runs; played fixtures leave the remaining set. Brazil is the visible proof —
215 played, 160 to go, and a mid-season table rather than an August one.

`load_upcoming` takes `played` for exactly this reason. The FBref schedule's
`home_goals` column is a release artifact refreshed on a different clock from
results, so it stays NULL all season for matches that have been played; only
the date filter was keeping them out. Any fixture already in the results
corpus is dropped whatever the schedule claims.

### Which leagues serve, and why those

Nine, each admitted by `league_gate.py` — a day-blocked walk-forward over
that competition alone against three baselines: a one-in-three guess, the
league's own running base rate, and picking the home side every time. A league
that does not beat all three does not appear. Results in
`reports/baselines/league_gate.json`.

| | leagues |
|---|---|
| European top flight | eng.1 esp.1 ger.1 ita.1 fra.1 ned.1 por.1 tur.1 |
| North America | **usa.1 (MLS)** |

**Scope is a product decision, not a measurement one.** The five second tiers
and Brazil each cleared the gate and each shipped for a day; they are in `HELD`
with the reason `out of scope`, their gate evidence untouched in
`reports/baselines/league_gate.json`, and turning any of them back on is one
line in `LEAGUES`. Do not re-derive their numbers to "justify" removing them —
they were removed because a Championship table next to the Premier League made
the page harder to read.

**MLS is grouped, and that changes what every number means.** `p_title` is the
Supporters' Shield; a club's season is decided by `p_group_title` (wins its
conference) and `p_qualify` (reaches the playoffs). Conference membership AND
the playoff cut line come from `backend/data/conferences.json`, built by
`build_conferences.py` from ESPN's own standings — the cut is READ from ESPN's
per-team notes ("Qualifies for MLS Cup Playoffs — Wild Card Matches", rank 9)
rather than hard-coded, because a literal 9 stops being true the year the
format changes and nothing would say so. A grouped league skips
`ROUND_ROBIN_MIN` (MLS is 59% of one by design); its structural check is that
every club in the fixture list is placed in a conference, or no table
publishes.

**`league_participants` drops sides that are not in the league.** ESPN files
the All-Star Game under `usa.1`, so `MLS All-Stars` and `Liga MX All-Stars`
arrived as clubs with one match each and made a 30-team league a 32-team table.
Filtered on participation against the season median, not on names.

The spread is wide and the page says so per league: por.1 .56873, ned.1
.57010, eng.1 .58266 … tur.1 .60377, usa.1 .62101. **Each league carries its
own `measured` block** rather than inheriting the .59303 headline, which was
measured on the top five only.

**Passing the match gate does not earn a projected TABLE.** For an ungrouped
league a season simulation assumes a double round robin, and `ROUND_ROBIN_MIN`
checks that against the real fixture list: Liga MX runs at 50% of one
(Apertura/Clausura), Argentina 57% (knockout rounds inside the league). Both
are in `HELD` with the reason — the model is fine, the competition is not a
single table.

`top_cut` is per league, because the band worth naming differs: fourth is a
Champions League place in a top flight and the Supporters' Shield is a single
position in MLS. Never hard-code "Top 4".

**Every competition seeds its own RNG** from `sha256(competition_id)`. One
shared generator consumed in dict-iteration order meant adding the Championship
moved Manchester City by a point with nothing about the Premier League having
changed. Two full runs are now byte-identical.

### The three decisions that must not be casually changed

1. **Season simulation draws one strength offset per club, held for the whole
   season.** Point estimates compounded 34 times gave Bayern 93.3%, PSG 88.1%,
   Inter 83.4% — against market prices near 70/70/30. Within-season Elo drift
   over **3,583 team-seasons has sd 45.3 points**, and that error is
   *correlated across all of a club's fixtures*, which is why it cannot be
   averaged away by more simulations. With it: Bayern 71.3%, City 38.6%,
   Barcelona 48.7%. **Per-match probabilities stay unperturbed** — the head was
   measured at ECE .0099 on exactly those inputs.
2. **The 1X2 and the scoreline grid are reconciled, not merely adjacent.**
   Dixon-Coles' two lambdas are solved so the grid reproduces the measured-best
   1X2. Worst disagreement across 2,346 fixtures: **0.00000**, and a gap above
   1e-3 now aborts the publish.
3. **Season-boundary regression to the mean was tested and rejected**: +.00150
   at 0.25, +.00394 at 0.40, +.00796 at 0.60 — significantly worse at every
   level. Surprising orderings (Bournemouth above Chelsea) are the measured
   model's output. **Do not tune ratings because a table looks wrong.**

### Feature set

`elo_*` and `form_*` only. Measured and dropped, each scored on unseen matches:
**referee, rest, head-to-head, venue, attendance, kickoff time**. Referee was
the expensive one — it needed a 207,000-fixture FBref scrape to make the
question askable outside England — and the answer was still no.

Walk-forward record: **Brier .59303, ECE .0099, 43,433 unseen matches.**

### Model versioning

`services/forecast/version.py`. Two halves: `2026.08.1` is human-facing and
bumped deliberately; `+27734fb2` is a hash of the config that *determines* a
forecast — features, shock sd, sims, league scope, Elo settings. A release
string someone must remember to bump fails silently; the hash cannot. Tests pin
that reordering features is not a change while adding one is.

### Prediction snapshots — provenance

`services/forecast/snapshots.py`, table `prediction_snapshots` in the
warehouse. **Append-only**, keyed `(fixture_uid, generated_at, model_version)`,
`INSERT OR IGNORE`. A test reads the module source to assert it contains no
UPDATE, DELETE or INSERT OR REPLACE.

`final_before_kickoff()` is the canonical evaluation record: strictly the last
forecast generated *before* kickoff. Anything stamped after kickoff is excluded
— it would flatter the model and it is not a forecast.

Exported to `models-latest` as `prediction_snapshots.csv.gz` each run, because
the warehouse is gitignored and a provenance record that dies with the runner
is not one — and **restored from that same asset at the start of every run**.
The warehouse artifact is republished by the training and backfill jobs, which
know nothing about forecasts, so the copy each run downloads has no
`prediction_snapshots`; without the restore the `--clobber` export would replace
the whole history with one run's, and the table would be append-only and one
run deep forever.

### Historical vs live evaluation — never merged

| | sample | what it is |
|---|---|---|
| historical walk-forward | 43,433 | retrospective; nobody saw those numbers before those kickoffs |
| live published | grows from 0 | the final pre-kickoff snapshot, scored after the result |

`services/forecast/evaluate.py` computes them separately, each carries `basis`,
and the UI renders them in separate blocks. A live n of 40 is reported as 40.
`/evaluation` refuses to draw a reliability chart below 200 scored matches.

**The join is by team id, not by name.** A snapshot's club name comes from
FBref ("Wolves", "Gladbach", "Man Utd") and a result's from the warehouse
("Wolverhampton Wanderers", "Borussia Mönchengladbach", "Manchester United").
Rehearsed against last season, a name join scored **68.9%** of fixtures —
Bundesliga 23.4%, Premier League 41.1% — and dropped the rest silently, so the
live sample would merely have looked small. `club_vocabulary()` resolves both
sides through canonical names, the curated alias table and the canonical
layer's fixture-graph aliases: same rehearsal, **99.6%**. Scoped per
competition, and a name meaning two clubs is refused rather than guessed.

Unmatched clubs are **counted and named** in the payload and on `/evaluation`.
"Not played yet" and "we no longer recognise this club" both shrink the sample
and only one of them means something is broken.

### Scheduled refresh

`.github/workflows/season_forecast.yml`, daily 07:30 UTC, `concurrency:
season-forecast`. Separate from `prediction_pipeline.yml` because it needs a
16MB FBref download plus a canonical rebuild.

**The input download has no `continue-on-error`, deliberately.** The forecast
trains on the canonical corpus (75,276 matches across the nine served leagues),
not the warehouse alone; running without FBref would ship a different model
under the same version string. `verify_corpus` then checks every served league
against its own recorded baseline in `reports/baselines/corpus.json` — the
single 60,000 floor it replaced could not see six of nine leagues vanish.

**A league's baseline may only be re-recorded with the arithmetic in hand.**
por.1 went 7,587 → 7,451 on 2026-08-13, past the tolerance of 25, and that was
correct: the new rename alias `B-SAD → Belenenses` removed 4 × 34 = 136
fixtures the canonical layer had been holding *twice*, once per spelling. Every
por.1 season still sits at its structural size. `verify_corpus` cannot tell a
de-duplication from a truncation, so a drop is explained before it is recorded,
never after.

The current-season FBref schedule refresh IS `continue-on-error`: FBref sits
behind Cloudflare and a GitHub runner is the client it exists to turn away.
When it fails the forecast is still correct — a stale schedule costs a wrong
kickoff time on a moved match, not a forecast for a match already played.

Artifacts are published via temp-file + `os.replace`, so a crash mid-write
leaves the previous valid forecast serving rather than a truncated file.

### Frontend routes

| route | what it is |
|---|---|
| `/season` | flagship: league picker, then Overview / Table / Fixtures tabs, with the evidence panel always below them |
| `/season/fixture/[uid]` | one match: 1X2, expected goals, scoreline distribution, both Elo ratings |
| `/evaluation` | the model, one competition at a time: what it believed and what that was worth. Pooled evidence sits below a heading that says it is pooled |
| `/accuracy` | the published-pick record, per competition, same furniture and same layer/picker control as `/evaluation` |
| `/tournaments` | directory of the fourteen knockout competitions, then one in full — the football only |
| `/leagues` | directory of the nine projected leagues, each card carrying its own title race |
| `/about` | "How it works": the floors and the calibration as pictures, read from the artifacts |

**The bracket is COMPUTED, not laid out.** `bracketLayout.ts` returns every
card position and every connector path as arithmetic; the component absolutely
positions from it and draws one `<svg>` underneath. The version before it built
the shape from nested flex boxes with `h-1/2` bordered divs for connectors,
which gets a bracket approximately right and cannot be checked — whether a card
sat on the centre line between the two feeding it was an emergent property of
the box model. It is a test now: **the card at slot `s` sits exactly halfway
between `2s` and `2s+1`**, on both halves of a mirrored board.

That geometry is what makes the rest possible: elbow connectors between real
card edges, an empty slot that reads *Winner of Arsenal / Real Madrid* instead
of being blank, and hover/tap tracing a team's whole route to the final
(`pathToFinal`) with everything else dimmed.

**It is drawn at FULL SIZE and pans; it is never silently shrunk.** The board
before it fitted the viewport by transform — 0.62 on a phone, 0.91 on a desktop
— so the thing a reader came for was rendered at two thirds size. `planBoard`
picks the widest layout that fits at scale 1: mirrored, else a single
left-to-right flow, else flow with panning and a round navigator. Scaling
happens only when the reader presses *Fit on screen*. Cards carry two rows,
crest and club, and the number that settles it on the right — the aggregate
split onto the two clubs (`splitScore`), or the chance to advance, never both.

**A knocked-out club is struck through on the tie that eliminated it, and only
there.** Propagating the strike back over the earlier rounds it won would cross
out the winning side of a match it won. Both the strike and the champion bar are
gated on the winner being **one of the two clubs that played** — read literally,
a `winner_id` matching neither side strikes both names and crowns `team_b`.

**Every tie is a link to the fixture behind it** — `/tournaments/tie/<competition>/<season>/<round>/<aVb>`,
served by `api/v1/tournaments/tie` and rendered from `LegDetail` + `Formation`
(timeline, commentary, both team sheets in shape with the bench, match stats,
head-to-head, recent form). Tapping opens the match; the route trace moved to
hover and keyboard focus alone, because tapping a fixture opens it everywhere
else on the web.

**The tie-to-fixture join is by NAME AND DATE, and it was measured before it was
built on.** `tournaments.json` carries no match id, and this project has already
been burned once by a name join that silently scored 68.9%. Over 520 real ties
across all fourteen competitions:

| rule | resolved |
|---|---|
| pairing + date, our own competition ids | 76.7% |
| + ESPN's slugs (`uefa.europa.conf`, `afc.asian.cup`) | 91.3% |
| + one differing spelling allowed on a unique date | **99.2%** |

The last step exists because our warehouse says `Inter` where ESPN says
`Internazionale` — 42 of 520. It is gated on there being **exactly one** event
in that competition on the tie's own date, since a bare `Inter` also matches
Inter Miami. The four that still fail return null and the page says the match
detail is unavailable; opening whichever fixture was nearest is the failure that
would not announce itself. `ESPN_SLUG` is pinned against `ingest_tournaments.py`
by a test, because two copies of that map drift invisibly.

**Players are shirt numbers, not faces.** Measured: ESPN has a headshot for
**1 of the 46** players in a Champions League final squad list. Portraits are
licensed data (api-football and SportMonks both serve them); a grid of grey
silhouettes is not a lineup, and the number is what is on the actual shirt.
Names on the pitch are ESPN's own `shortName` — deriving one by dropping the
first token turns Vinícius Júnior into "Júnior".

**`MatchDetail` is ONE component and both competitions render it.** A league
fixture and a knockout tie reach the identical card — header, timeline down a
centre line, stats, the two elevens on a pitch, head-to-head, commentary — with
our forecast passed in as `model`. Before it, `/season/fixture` showed four
model panels and no match at all while a tie showed everything, which read as
two products. A second copy of this layout is the thing `matchDetail.test.tsx`
exists to prevent. Its ESPN half is resolved by the SAME join for both: a
league fixture is the easy case (one competition, one date, two clubs).

**Sharing the component was not enough; four things still made the two pages
look unrelated (fixed 2026-08-15).** Every one of them was found by
screenshotting our own pages, not by a test:

1. **The tie page drew a second header.** A one-legged tie IS its match, so the
   page printed the clubs, the score and the date, and the card printed all
   three again immediately below. The league page printed them once. The header
   now renders only when it says something the card cannot — a two-legged
   aggregate, or a tie whose match never resolved. The bracket's strikethrough
   moved onto the card as the optional `eliminated` prop, matched on
   `normTeam` because our artifact and ESPN spell clubs differently.
2. **A pre-match score read `– - –`.** Two dashes where a scoreline belongs
   reads as data we failed to load. It reads `vs` now, on `data-score="pending"`.
3. **Every upcoming fixture opened an empty Lineups tab.** ESPN files both team
   sheets as empty shells before kickoff, and the tab counted
   `lineups.length` — the containers — instead of the players in them. **Count
   content, never the container that holds it.**
4. **Recent form showed a score next to a blank club, on both pages.** ESPN
   nests the other club under `opponent` as an OBJECT; we read
   `opponentTeamName`/`homeTeamName`, fields the payload has never sent. The
   test fixture encoded the same invented shape, so it passed throughout. When
   a parser and its fixture agree with each other and not with the source,
   nothing fails — check a live payload.

**Delays are not timeline events.** ESPN files a `start-delay`/`end-delay` pair
per club for every drinks break and VAR check. On the 2026 World Cup final that
was **20 of 43 entries**, so nearly half the timeline read "Start Delay" and the
winning goal was one line among them. Filtered at the source, alongside the
kickoff and half-time markers. Extra-time markers are kept: they tell a reader
of a 120-minute match where the periods broke.

**All THREE match surfaces render `MatchDetail` (2026-08-15).** `/matches/[id]`
was a fourth layout with its own tab set, so the same fixture looked like two
products depending on how you reached it. It now renders the shared card and
contributes its extra depth through `extraTabs` — Prediction and Table appended
after the five every match gets. `?tab=` still deep-links, via `CARD_TAB`.
Reaching a match by id skips the name-and-date join the other two need.

**Watch for a rebuilt response object.** That page constructs `MatchDetails`
field by field rather than spreading, so `card` arrived at the API and was
dropped on the client — the page silently fell back to the old layout and
looked like the conversion had not worked.

**ESPN qualifies an event type with how it happened: `goal---header`, not
`goal`.** Matching the raw string dropped every headed goal from the scorer
line and drew it under the fallback dot — Arsenal 3-0 Fulham listed two scorers
for three goals. `baseEventType()` splits on `---`; the qualifier is
presentation, the base type is the event.

`gameResult` is ESPN's, and it accounts for shootouts — a 1-1 marked `L` is the
Champions League final Arsenal lost on penalties, not a bug. Do not "fix" it.

**The bracket is sized to be seen at once.** FotMob fits a 32-team World Cup on
a laptop by using crest pairs and three-letter codes; we print real club names,
so the width came down the honest way — `bracketLabel` drops `FC`/`CF`/`SC` and
the rest of the structural tokens from what is PRINTED, never from the name,
and `colW` went 196 → 150. A 16-team mirrored board is 1228px instead of 1568.
**Do not "abbreviate" a club to a code**: this project has no source for one,
and a wrong code is read as a fact. The champion is a trophy in the middle of
the board above the final, dropping below it only when the final sits too near
the top to fit.

**Both evidence pages are per competition, and share `LayerTabs`.** `/accuracy`
was reporting one pooled hit rate over every league — an average of leagues that
differ by six points. Its league side reads `by_league` from the tracking
summary; its knockout side folds `tournaments.json`'s settled editions
(`tournamentCalls.ts`) into a per-competition call record. **That knockout
record is a BACKTEST and is labelled one everywhere it appears** — a 2021
edition's forecast was reconstructed by a model refit on earlier seasons, and
this site does not let that blur into "published in advance".

**There is no global search.** The topbar field, the Cmd/Ctrl+K palette and its
store were removed: it searched leagues, teams and matches, all of which are one
tap away, and a shortcut printed in a chip advertises a product bigger than this
one. The mobile tab bar's fourth slot is the record instead.

**Both competition sections are directory-then-detail.** `/leagues` and
`/tournaments` open on cards — title race, or title odds / who won it / when the
next edition starts — and each has a back control. A dropdown showing one
competition and hiding thirteen is a control, not a home page.

**Football and evidence are different destinations, and that split is load-bearing.**
`/leagues` and `/tournaments` answer "what is happening and what does the model
expect"; `/evaluation` and `/accuracy` answer "how right has it been". The
knockout backtest — ladder, calibration, per-round, progression check — used to
sit under the brackets on `/tournaments` and is now on `/evaluation`, because a
reader who came for the next round should not have to scroll a calibration
table to reach it. `tournaments.smoke.test.tsx` asserts it has not crept back.

**The site does not explain itself in place; it links to `docs/handbook/`.**
Every methodology paragraph that used to sit on a page — what Brier means, why
a knockout tie is a different question, the six feature groups measured and
dropped — is in the handbook, addressed through `src/lib/docs.ts` (one place a
doc's path is written down) and rendered by `DocsLink`/`DocsRow`.
`src/__tests__/lib/docs.test.ts` pins both halves of that trade: every
registered path resolves to a real file, every cross-link inside the handbook
resolves, **and the specific claims removed from pages are present in the
documents they moved into.** Deleting an honesty note and calling it "moved to
the docs" is the failure mode this reorganisation invites, and that test is the
only thing that catches it.

`/evaluation` is organised per competition because the evidence exists per
competition: `season_projections.json` carries a `measured` block per league,
and `bracket_backtest.json` one row per reconstructed tournament (folded per
competition by `components/evidence/competitionRecords.ts`). The pooled
walk-forward .59303 is an average over the top five whose members run .56873 to
.62101 — showing it under one league's name is a wrong claim about that league.
Per-TIE records per competition come from `knockout_model.json`'s
`by_competition`, which `benchmark_knockout` has written since 2026-08-13;
older artifacts lack it and the UI renders that half only when it is there.

`/leagues` reads `season_projections.json` and lists `SERVED_COMPETITION_IDS`
from `leagueAccents.ts`, which mirrors `LEAGUES` in `forecast_season.py` and is
pinned to the artifact by `src/__tests__/lib/servedLeagues.test.ts`. **Keep
`SERVED_COMPETITION_IDS` and `WAVE_A_COMPETITION_IDS` distinct.** Nine leagues
are projected; only the five in Wave A carry a closing price on every fixture
and may be described as scored against the market. The page marks that per row
rather than flattening the two, because merging them promotes four leagues into
a claim no measurement supports — the previous version went the other way and
listed five leagues while advertising MLS and the Champions League as "not
covered yet", both of which had been live for days.

Components in `src/components/forecast/`: `ProbabilityBar`, `ProbabilityRow`,
`FixtureCard`, `FixtureList` (rows and day headings, six matchdays at a time),
`ProjectedTable` (two layouts, not one squeezed), `CompetitionSelect`,
`LeagueSelect`, `EvidencePanel`. Every probability is rendered as **text**,
never colour-only; the projected table sorts from the keyboard with
`aria-sort`.

`CompetitionSelect` is the one picker, used by `/season` (via `LeagueSelect`,
which only supplies ordering and the second line) and by `/tournaments`. It is
the ARIA listbox pattern, not a `<select>`, because its rows carry a badge and
a second line — fixtures left, or whether a tournament has been drawn. It
therefore owns the whole keyboard contract by hand — arrows with wraparound,
Home/End, Enter, Escape returning focus, Tab, type-ahead — and all of it is
tested. **Below the `sm` breakpoint it is a bottom sheet portalled to
`document.body`**: an anchored panel does not fit between the trigger and the
fixed tab bar at 375x667, and `position: fixed` is positioned against the
nearest transformed ancestor rather than the viewport.

On `/tournaments` the second line is the tournament's STATE, because that is
what decides whether the numbers underneath are odds on something undecided or
a record of a call already settled.

`leagueAccents.ts` carries the badge for every published competition. **Each
`logoUrl` came from ESPN's own scoreboard payload for that competition and was
curl-verified.** Where ESPN would not answer — `afc.asian` — the entry ships
with no logo and falls back to a neutral trophy; a confidently wrong badge is
worse than an honest placeholder.

The evidence panel is deliberately **not** one of the tabs. Those percentages
are unfalsifiable without it and a tab is a place things go to be unread; a
test asserts it is visible from every tab.

`scripts/responsive_audit.mjs` drives real Playwright device descriptors at
320/375/390/768/1440 and **fails** on horizontal overflow, on a picker that
does not fit above the tab bar, and on tap targets under 24px:

    npx next start -p 3111
    QA_BASE=http://127.0.0.1:3111 node scripts/responsive_audit.mjs

| Task | Command |
|---|---|
| Season forecast | `python3 -m backend.scripts.forecast_season` |
| Score live forecasts | `python3 -m backend.scripts.evaluate_live` |
| Export provenance | `python3 -m backend.scripts.export_snapshots` |
| Rebuild canonical layer | `python3 -m backend.scripts.build_canonical` |
| Restore published provenance | `python3 -m backend.scripts.import_snapshots --allow-missing` |
| Responsive/tap-target audit | `node scripts/responsive_audit.mjs` |
| Walk-forward baselines | `python3 -m backend.scripts.baseline_walkforward` |
| Layered ablation | `python3 -m backend.scripts.train_layered` |
| Per-league benchmark gate | `python3 -m backend.scripts.league_gate` |

## Superseded measured state (2026-08-09)

Two separate corpora, so read the columns not the rows. The first is the full
market benchmark; the second is the 2,264-fixture paired holdout from
`benchmark_unified_vs_dc` (2024-10 onward, Wave A, priced fixtures only).

**The paired-holdout column is WRONG and is kept only as a record.** It was
produced by the mis-paired harness described above, which is why its market
Brier (.5848) sits .019 worse than the same market measured directly (.5666).
The −.0030 NN-vs-DC verdict below came from the same run. Do not cite either.

| forecaster | Brier (full corpus) | Brier (paired holdout) |
|---|---|---|
| Market (closing line, Shin de-vig) | **.5666** | **.5848** |
| Neural stack, 75 features | — | .6014 |
| Dixon-Coles (`penaltyblog`, off-the-shelf) | .5977 | .6044 |
| 30-feature logreg baseline | .5871 | — |
| Constant base rate | .6468 | .6498 |

**Dixon-Coles remains the serving default for Wave A.** The retrained neural
stack is ahead of it on the point estimate (−.0030 pooled, and ahead in eng.1,
ger.1, ita.1) — and **that lead does not survive a paired bootstrap**. Pooled
95% CI [−.0112, +.0051], p(NN better) = .78; every individual league's interval
straddles zero, including the Premier League's −.0212. Three point-estimate
wins, zero significant ones. Re-run
`benchmark_unified_vs_dc` after any retrain; promote only on
`unified_beats_dc_significant_in`, never on the sign of the difference.

A goal-model bake-off (`backend/scripts/bakeoff_goal_models.py`) found all six penaltyblog goal models within .0017 Brier of each other and **every blend worse than Dixon-Coles alone** — their errors are too correlated for ensembling to help. Do not add a hybrid without new evidence.

### What the features are worth (ablation, 2026-08-09, 75-feature vector)

Rolling-origin folds, greedy selection on early folds and scored on later ones
it never saw. Δ is against the 30-feature logreg baseline; negative helps.

| group | Δ Brier | |
|---|---|---|
| market | **−.0102** | helps, but **cannot serve** — see the train/serve landmine |
| xg_form | **−.0011** | helps |
| news_sentiment_proxy | +.0001 | neutral |
| congestion | +.0004 | neutral |
| weather | +.0006 | harmful |
| clubelo | +.0007 | harmful |
| calendar | +.0007 | harmful |
| venue | +.0012 | harmful |
| referee | +.0015 | harmful |
| h2h_deep | +.0023 | harmful |

Greedy forward selection picked **one** group: market. Head-to-head, venue
records, referee effects, weather and kickoff timing all make the model worse
out of sample. This is the measured answer to "what else can give it an edge":
nothing in the current candidate set, and the remaining ceiling is in the data
rather than the feature list.

## League scope — Wave A only

Premier League (`eng.1`), La Liga (`esp.1`), Bundesliga (`ger.1`), Serie A (`ita.1`), Ligue 1 (`fra.1`).

This is the scope of the *benchmark corpus*, which is not the scope of
`/season` — see "Which leagues serve" above for what the site publishes.

MLS is Wave B; UCL/UEL/Euros/World Cup/Copa América are Wave C. Each wave advances only on measured evidence. Women's competitions were dropped in the pivot — a real cost, to be revisited on the same evidence gate.

## Known landmines

- **Train/serve skew (fixed 2026-08-08, understand it anyway).** Market features were in `FEATURE_NAMES` and populated for 96.1% of training rows, while `unified_inference.py` synthesised the live row with `NULL AS odds_home`. Every served prediction saw 0.0. Brier .5801 → .6561, *below* the constant base rate. This was the entire 60.56%-holdout / 46%-live gap. The schema guard could not catch it because feature **names** matched — only **values** differed. `_warn_on_dead_feature_blocks()` in `unified_inference.py` is the guard that does catch it. **Never put a feature in the served vector that the serving path cannot populate.**
- **Data integrity — fixed 2026-08-08, guard it.** The warehouse had 1,278 duplicate-fixture groups, 27 orphan team rows, and 60 of 77 league-seasons with the wrong team count. **One bug caused nearly all of it:** football-data's terse club names ("Ath Madrid", "Sp Lisbon") scored below `team_resolver`'s 0.92 fuzzy threshold, creating a second `teams` row, so `_find_existing_match` missed the ESPN fixture and inserted a duplicate. Dortmund "won" the 2018-19 Bundesliga because a 7-0 was counted twice. A second one-line bug — a naive local-midnight datetime run through `.astimezone(utc)` on an `Asia/Jerusalem` host — shifted every football-data kickoff back across midnight, making day-of-week wrong for 86% of Wave A.

  **Run `python3 -m backend.scripts.validate_warehouse_integrity` after any ingest change.** 9 checks, exits non-zero. Prefer adding a spelling to `team_aliases.yml` over lowering the fuzzy threshold.
- **What is still genuinely missing.** Referees outside England are a *source* limitation — football-data publishes `Referee` for England only, and ESPN carries officials only from 2022-23 — so esp/ger/ita/fra sit at 0.8–1.8% and referee features stay untestable there. Kickoff times before 2019 do not exist upstream. Weather covers 66.6% of Wave A. There is no injury or lineup source at all: `player_form` and `match_events` are empty tables.
- **A constant feature is not free.** A zero-variance audit over 600 Wave A fixtures on 2026-08-09 found 9 of 81 served features constant. Six were constant because nothing fed them — `is_post_intl_break` (never derived), `home_squad_form` / `away_squad_form` / `home_missing_top3` / `away_missing_top3` (empty `player_form` table), `venue_altitude_m` (no source) — and were removed, 81 → 75. Three (`is_knockout`, `is_2leg_aggregate`, `is_neutral_venue`) are constant *by construction* in league play and go live in Wave C, so they stay. `away_travel_km` was in the first category until it was wired to the venue coordinates that now exist; it is real (median 311 km, max 2,260 km, 100% of Wave A). **Re-run the zero-variance check before adding a feature, and treat a permanently-constant column as a bug.**
- **ESPN host — use `site.web.api.espn.com`, never `site.api.espn.com`.** The two serve
  byte-identical payloads. Akamai answers `site.api` with **403 Access Denied** from
  datacentre IPs (Vercel, GitHub Actions) and its error page carries no CORS headers, so a
  browser fetch dies with `net::ERR_FAILED`. Measured 2026-08-09: every `site.api` request
  returned 403 while the same path on `site.web.api` returned 200 with
  `access-control-allow-origin: *`. This is what made the season simulation "unavailable"
  and blanked live standings/fixtures on all five league pages. The host is named once, in
  [`src/lib/espnHost.ts`](src/lib/espnHost.ts) (`ESPN_SITE` / `ESPN_V2`) and once in
  `backend/services/espn/client.py`. Do not hardcode it anywhere else.
- **ESPN's scoreboard silently caps at 100 events.** No error, no field saying so. Asking
  for a whole remaining season without `&limit=` returned the next 100 fixtures, and the
  Monte Carlo projected a "final table" from a quarter of a season. Any scoreboard call
  spanning more than a few weeks must pass an explicit `limit`.
- **An unmatched simulator prior is a silent, visible bug.** `build_sim_priors` resolves
  Dixon-Coles team names onto ESPN `displayName`s. A team it cannot match gets no prior and
  falls back to neutral — and at preseason the prior is the *only* signal, so the league's
  best clubs vanish from the title race. With `Inter` and `Roma` unresolved the Serie A
  projection made **Como** the favourite. The script now prints suggested
  `MANUAL_OVERRIDES` entries; check `unmatched_frontend_teams` after every rebuild and
  treat anything that is not a genuine promotion as a bug.
- **The weekly `--full` warehouse build re-splits club identities.** `train_unified.yml`
  runs `build_warehouse --full`, and `--full` includes the OpenFootball loader, whose
  spellings ('Real Sociedad de Fútbol', '1899 Hoffenheim', 'Angers SCO') score below
  `team_resolver`'s 0.92 threshold against the ESPN name. A second `teams` row appears, the
  fixture is inserted twice, and the 2026-08-08 repair's hand-written `SPLIT_IDENTITIES`
  list — written for two sources — never catches up. On 2026-08-10 the local warehouse had
  **42 of 55 Wave A league-seasons since 2015 carrying the wrong team count**.

  `repair_warehouse` now heals this structurally, in three passes, and **must be run to a
  fixpoint** — each merge exposes duplicates that expose more identities:
  `merge-normalised` (exact normalised equality, then token-subset gated on the two clubs
  never having met), then `dedupe-fixtures`, then `merge-schedule-twins`.

  **`merge-schedule-twins` only applies to round-robin seasons, and that guard is not
  optional.** Two clubs in the same league that never met and share ≥90% of a home/away
  calendar are one club — but in a GROUP STAGE two clubs in different groups also never meet
  and also play on identical matchdays. Without the round-robin precondition the rule merged
  `Feyenoord` into `FC Astana` and `Olympiacos` into `VfL Wolfsburg`: 19 merges, all wrong.
  The precondition is measured from the season (share of team pairs that actually met) and
  must be counted over EVERY participant — restricted to clubs with a deep European run, a
  knockout bracket looks fully connected and passes.
- **A source can serve you another competition's matches. Check before writing.** On
  2026-08-13 football-data.co.uk answered the 2026-27 request for `E0` (Premier League)
  with **National League** fixtures and `SP1` (La Liga) with the **Portuguese Primeira
  Liga** — both of those leagues had not kicked off yet and the ones served in their place
  had. 22 well-formed matches between real clubs with real scores landed under `eng.1` and
  `esp.1`; every row-level integrity check passed. Two steps later `eng.1` had 44 entrants
  = 21% of a double round robin, `forecast_season` correctly refused to project a 44-team
  "single table", and **the Premier League and La Liga silently left the site** behind one
  warning line. `_belongs_to_competition` in `footballdata_loader.py` now refuses a file
  whose clubs are strangers to the competition it claims to be (promotion turns over 3-4
  clubs in 20, so a genuine file shares ~85% of its sides; the foreign files shared 0%),
  **before any name is resolved** — resolving is what creates permanent `teams` rows.
- **`phase` cannot separate duplicate fixtures, because it is what the SOURCE called the
  round.** `find_duplicate_fixtures` keyed on it, so two sources describing the same match
  disagreed and the duplicate became invisible: ESPN files league matches under a season
  slug (`2025-26-english-premier-league`, 9,495 rows across 76 such values) where
  football-data writes NULL. `eng.1` 2025 carried **748 rows for a 380-match season** and
  the integrity check reported no duplicates. It keys on **when the two clubs met**,
  clustered within ±1 day (football-data knows only the calendar date, ESPN carries a true
  kickoff). Measured: 2,169 groups collapse, **274 real repeat meetings** — the AFCON group
  stage and its final — are left alone, and zero cases share a day while disagreeing about
  the score. `merge_duplicate_fixtures` re-selects by `match_ids`, never by the key, or a
  group formed for the group stage drags the final in.
- **A dedupe that deletes the row tomorrow's ingest rewrites is not a dedupe.** The
  survivor was picked as "most populated columns, ESPN on ties", and football-data rows
  carry closing odds so they counted as richer and won — 298 of the 380 `eng.1` 2025
  survivors were football-data rows. ESPN is re-ingested **daily**, so the next Event
  Backfill wrote all 298 fixtures back (`ESPN/M eng.1 2025 → 380 matches written` into a
  season already holding 380) and 1,838 duplicates returned within four hours of being
  removed. **Source comes first, richness is only the tiebreak.** Nothing is lost: every
  column the survivor lacks is coalesced in from the losers, odds included.
- **Merging fixtures must MOVE the timeline, not delete it.** `match_events` and
  `match_event_coverage` are keyed by `match_id` and cost one verified ESPN request each.
  With football-data rows left as survivors by the old rule, months of backfill had
  attached to those ids, and re-running the merge under the corrected rule threw away
  **1,146 verified timelines in a single pass**. `UPDATE OR IGNORE ... SET match_id` onto
  the keeper first — OR IGNORE because the keeper may already carry its own.
- **A pin in `team_aliases.yml` can MANUFACTURE the split it exists to prevent.** The
  canonical must be the spelling the **daily** source writes. Heidenheim was pinned to
  `1. FC Heidenheim` while ESPN — ingested every day — writes `1. FC Heidenheim 1846`, so
  football-data's "Heidenheim" landed on one row and ESPN's ingest created another;
  `ger.1` 2025 held 340 rows for a 306-match season, `repair_warehouse` merged the pair on
  every run, and the next day's ingest split them again.
- **Team identity is global; club names are competition-scoped. That gap mis-attributes
  matches.** ESPN's MLS scoreboard calls Inter Miami "Inter", which the resolver matched to
  the existing global `Inter` — Internazionale. 28 matches against D.C. United, Orlando
  City, Atlanta United, NYCFC, Montréal and Nashville sat on Inter Milan's record from 2020
  to 2023, and **both clubs were rated on it**. Repointed to Inter Miami (58 → 86 matches).
  **Do not "fix" this by merging.** `split_identities` flags the pair because within
  `usa.1` they look like one club, and merging is what that normally means — here it would
  fuse Internazionale into Inter Miami. A competition-scoped check cannot see that one of
  the two rows is a foreign club that should not be in that competition at all.
- **`event_backfill.yml` folds split identities BEFORE deduping** — a duplicate is only
  visible once both rows point at the same club, and deduping alone could not see the
  Heidenheim pair at all. It runs `repair_warehouse --only merge-identities
  --only dedupe-fixtures` after the ingest,
  before the event backfill (so timelines attach to surviving rows) and before the artifact
  builders (so nothing is derived from a corpus that counts matches twice). The corpus
  heals daily rather than when someone happens to look at it.
- **`forecast_season` refuses to publish when a league the live artifact serves would
  disappear**, leaving the previous forecast up rather than shipping the survivors.
  Compared against the artifact on disk, not against `LEAGUES`, so a competition that is
  merely between seasons does not trip it every summer. `--allow-missing-leagues` is for a
  competition that genuinely ended, never for getting past a bad ingest.
- **`conferences.json` and the warehouse are the same provider in two vocabularies.** The
  map is built from ESPN's **standings** ("Inter Miami CF"); the warehouse holds the name
  ESPN's **scoreboard** uses ("Inter"). Exact matching placed 29 of 30 MLS clubs and
  refused the whole table over the 30th. `load_groups` resolves a short spelling only when
  its tokens sit inside exactly **one** unplaced entry, and refuses otherwise — `inter` is
  Internazionale in every other competition served.
- **`merge_teams` and `delete_orphan_teams` must repoint every table that references
  `teams`.** `players`, `player_match_stats`, `lineups` **and `scheduled_matches`** carry no
  `ON DELETE CASCADE`, so one surviving row makes the final DELETE raise `FOREIGN KEY
  constraint failed` and aborts the whole repair. `scheduled_matches` arrived with the
  tournament layer, *after* the player tables were fixed, and was missed — with 224 rows in
  it `repair_warehouse --fixpoint` aborted before healing a single identity. **When a new
  table gains a `teams` foreign key, add it to `merge_teams`**; guard it with
  `_existing_tables` so older schemas and test fixtures still merge. The 2026-08-08 run never hit this because that machine's player tables
  were empty. `players` is `UNIQUE(name, gender, current_team_id)`, so a repointed player can
  collide with their own twin — fold them together rather than deleting, or the delete
  cascades their appearances away.
- **The prediction pipeline bot** commits to `main` 3×/day. Rebase feature branches often.
- **Vercel escalates ESLint warnings to errors.** Run `npx next lint` before pushing; `npm run build` is not enough.

## Common commands

| Task | Command |
|---|---|
| Run both servers | `npm run dev` |
| Production build | `npm run build` |
| Lint (Vercel hard gate) | `npx next lint` |
| Frontend tests | `npm test` |
| Backend tests | `python3 -m pytest backend/tests/` |
| Market benchmark | `python3 -m backend.scripts.benchmark_market` |
| Dixon-Coles challenger | `python3 -m backend.scripts.benchmark_dc_challenger` |
| Neural vs DC (promotion gate) | `python3 -m backend.scripts.benchmark_unified_vs_dc` |
| Goal-model bake-off | `python3 -m backend.scripts.bakeoff_goal_models` |
| Feature ablation | `python3 -m backend.scripts.ablate_features` |
| Season projection backtest | `python3 -m backend.scripts.backtest_season_projections` |
| Warehouse rebuild (with odds) | `python3 -m backend.scripts.build_warehouse --espn --football-data` |

**Check which interpreter has the dependencies before running anything.** There is no
`.venv` in this repo — on 2026-08-10 every one of these lines failed with
`.venv/bin/python: No such file or directory`. The working interpreter on this machine
is the miniforge base env (`/home/ronaltshuler/miniforge3/bin/python3`, which carries
penaltyblog, torch, sklearn, fastapi); the sibling `code/.venv` does **not** have
penaltyblog. CI installs into a bare 3.12 and calls plain `python -m ...`, so a script
that only works under a named venv is a script CI cannot run.

## Architecture

### Backend (`backend/`)
- **FastAPI** at `backend/main.py`, routes under `backend/api/v1/`.
- **`services/prediction/`** — `unified_inference.py` (PyTorch artifacts), `dixon_coles.py`, `model.py` (legacy ELO-Poisson fallback), `market.py` (de-vigging, EV, Kelly, RPS/Brier — cross-validated against penaltyblog), `feature_builder_v2.py` (75 served features + a separate 6-feature market block), `features_v2.py` (candidate features with structurally-enforced point-in-time correctness), `tracker.py`.
- **`services/data/`** — SQLite warehouse at `backend/data/warehouse.sqlite` (**gitignored**) plus ingestion loaders and `team_resolver.py`.
- **`services/simulation/league_simulator.py`** — Monte Carlo season projections. Beats its naive baseline at every matchday; title Brier ≤.02 from matchday 10, relegation ≤.05 from matchday 26. **Overconfident in the 70–90% band** (says 80%, happens 69.8%) — do not print those raw.

### Frontend (`src/`)
Next.js 15 App Router, **10 pages** (was 26), **32 API routes** (was 67).

Design language is **Bugatti**, ported from the sibling RaceIQ project (`../f1_predictions`): pure black `#000`, surfaces `#0d0d0d`/`#141414`, hairlines `#262626`, white uppercase letterspaced display, monospace for nav/buttons/captions/tables. **No gradients, no shadows, no glassmorphism, no chrome.** Colour carries meaning only — never decoration.

**Dark-only.** `<html class="dark">` is hardcoded and there is no theme provider; `:root` in `globals.css` is the single source of truth and the `.dark` block is intentionally empty.

### Conventions
- **CSS variables, never Tailwind colours** — `text-[var(--text-primary)]`, `bg-[var(--card-bg)]`, `border-[var(--border-color)]`. Hardcoded `text-white`/`bg-black`/`text-gray-400` bypass the token layer.
- **No bot attribution in commits** — no "Co-Authored-By: Claude" or "Generated with Claude Code" trailers in this repo.
- **Feature branches** for long-lived work; small fixes straight to `main`.
- Backend tests use absolute imports (`from backend.services...`); root `conftest.py` makes that work.
- `localStorage` keys still use the `fotpredict.*` prefix, preserving preferences across two rebrands.

## Deleted in the pivot — do not resurrect without a decision

Counterfactual Machine · Rarity Engine · Story Compiler · Boardroom agents · Almanac / Ask Pitchverse · match2vec · 3D Match Theater · Universe Browser · Justice Ledger · bracket challenge · news feed · players pages · world-cup hub · design-system page · the entire `services/llm/` layer (which also removes the Gemini free-tier quota failures from the critical path).

The first sweep deleted the backends and left the callers. On 2026-08-09 a second pass
removed the frontends that were still fetching those dead endpoints and silently rendering
nothing: `JusticeLedger`, `RarityStamp`, `SimilarMatches`, `BoardroomPanel`,
`CounterfactualMachine`, `LiveMatchTracker`, `UniverseBrowser`, the league News tab, and 17
orphaned API routes. **When deleting a feature, grep for its fetch URL, not just its
module** — a component whose endpoint 404s looks identical to one with no data.
