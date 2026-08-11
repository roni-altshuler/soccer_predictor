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

Measured 2026-08-11 on **14 competitions** — UCL, UEL, Conference, World Cup,
Euros, Copa América, Libertadores, Sudamericana, AFCON, Asian Cup, Gold Cup,
CONCACAF Champions Cup, Club World Cup, Nations League.

| | accuracy | Brier (binary) |
|---|---|---|
| Coin flip | 50.0% | .2500 |
| Higher-rated side advances | 64.1% | .2387 |
| **Random forest over tie features** | **64.8%** | **.2179** |

2,110 test ties, 2013–2026, rolling origin (train on every previous season,
test on the season played). Progression check 2,403/2,412 = **99.6%**.

**Calibration is the result worth quoting, not the accuracy.** Says 64.6%,
happens 64.6%. Says 74.3%, happens 74.3%. Says 83.9%, happens 86.2%. That is
what a bracket simulation consumes.

Read the ladder as a gap, not as levels: adding nine minnow-heavy competitions
raised absolute Brier for *everything* (the baseline moved .2308 → .2387), and
the model's edge over "back the better-rated side" grew from .0175 to
**.0208**. Logistic .2187, HGB .2200, XGBoost .2287 — the forest still wins.

Bracket Monte Carlo over **84** reconstructed tournaments:

| | log loss on the actual champion | picked the winner outright |
|---|---|---|
| Uniform over the field | 2.5498 | — |
| Elo simulation (unfitted) | 2.1454 | 21.4% (highest-rated) |
| **This model** | **1.9672** | **32.1%** (top 3: 63.1%) |

Half again as often as taking the highest-rated team, on a sample nearly three
times the first run's.

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
| Lineup ablation | `python3 -m backend.scripts.benchmark_lineup_features` |

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
- **`merge_teams` and `delete_orphan_teams` must repoint every table that references
  `teams`.** `players`, `player_match_stats` and `lineups` carry no `ON DELETE CASCADE`, so
  one surviving row makes the final DELETE raise `FOREIGN KEY constraint failed` and aborts
  the whole repair. The 2026-08-08 run never hit this because that machine's player tables
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
