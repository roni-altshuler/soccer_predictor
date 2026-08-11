# Existing system audit

Written 2026-08-11 by inspection of the repository, both databases and the raw
HTML cache. Every number here was measured, not recalled. The machine-readable
companion is [`fbref_data_inventory.md`](fbref_data_inventory.md) and
`reports/data_inventory.parquet`, both regenerable with
`python3 -m backend.scripts.audit_fbref_inventory`.

## Executive summary

**The FBref scrape works, is nearly complete, and is used by nothing.**

207,517 fixtures across 39 competitions back to 1888 sit in a landing-zone
SQLite that no model, feature builder, or serving path reads. The loader that
would fold it into the warehouse (`load_fbref_to_warehouse.py`) has never been
run — La Liga, Bundesliga and Ligue 1 still carry **0 referees** in the
warehouse while FBref has 92% coverage for all three. That single gap is the
largest available improvement in the repository and it requires no new
scraping.

Second finding: **most of what a from-scratch brief would ask for already
exists and is better than a rewrite would be.** Point-in-time feature
construction is structurally enforced (not conventional), walk-forward
backtesting exists and labels its own leaky mode as leaky, and there are nine
measured challenger families with paired-bootstrap verdicts. Rebuilding those
would destroy evidence, not add it.

Third finding: **the match tier — every FBref table the brief lists beyond the
schedule — is not collected at all.** 13 rows. Zero shots. That is the real
frontier, and `match_url` is populated on 97.2% of fixtures, so it is reachable
without re-discovering anything.

## 1. Repository structure

```
backend/
  services/
    fbref/          client.py — the scraper core (one file, 10KB)
    data/           warehouse.py + 12 loaders (espn, footballdata, understat,
                    clubelo, openfootball, referee, venue, weather, injury,
                    lineup, fbref) + team_resolver.py
    prediction/     24 modules: dixon_coles, neural_model, unified_model,
                    features.py / features_v2.py / feature_builder_v2.py,
                    backtest_walkforward, calibration, market, tracker
    ratings/        elo.py, elo_goals.py, national_elo.py
    simulation/     league_simulator, knockout_simulator, bracket_paths,
                    group_permutations
    tournament/     ratings.py, ties.py, rounds.py   (added 2026-08-11)
  scripts/          57 scripts: 14 benchmark_*, 5 backtest_*, 6 train_*,
                    ingest_*, build_warehouse, validate_warehouse_integrity
  tests/            34 files, 766 tests
src/                Next.js 15 frontend, 10 pages, 32 API routes
docs/               33 documents
notebooks/          model_diagnostics.ipynb + its generator
```

Python entry points are `python3 -m backend.scripts.<name>`. There is **no
`.venv`**; the working interpreter is the miniforge base env.

## 2. The FBref scraper — how it works

Three layers, each of which exists because the one above cannot do its job.

### `backend/services/fbref/client.py`

One long-lived botasaurus browser. The design constraints are measured, not
assumed:

| approach | result (measured 2026-08-11) |
|---|---|
| `requests.get()` | 403, Cloudflare challenge |
| curl with full browser headers | 403 |
| headless Chromium, 12s wait | 403, challenge unsolved |
| **botasaurus, headed, under Xvfb** | **200** |

So headless is not an option and CI can never run this. It is a local bake
whose *output* is the artefact. `run_fbref_scrape.sh` wraps the process in
`xvfb-run` so no window appears on the desktop.

Rate limit is 6.0s and is floored, not merely defaulted:
`self.min_interval = max(min_interval, MIN_INTERVAL_SECONDS)`. Raw HTML is
gzipped into a content-addressed disk cache (`backend/data/cache/fbref_html/`,
**4.9 GB, 829 pages**) so a parser bug costs a re-parse rather than a re-scrape.
`unwrap_comments()` strips `<!-- -->` markers because Sports-Reference hides
secondary tables inside comments — without it `_get_shots` silently returns an
empty frame, which is exactly what ScraperFC does.

**A defect found and fixed during this audit.** The client cached *rejections*.
FBref answers a burst with a well-formed 110KB page titled "Rate Limited
Request (429 error)" that parses cleanly to zero rows. Caching it made the
failure permanent: France Ligue 1 and both World Cups came out of a
790-season sweep with **no rows at all** while the log said `error: 0,
unscraped: 0, done`. `rejection()` now names rate limits, Cloudflare
challenges, and implausibly short pages, retries with backoff, and never
writes them to disk. 28 of 829 cached pages were poisoned; all purged and
re-fetched.

### `ingest_fbref_schedules.py` — the tier that actually has data

The arithmetic that makes the corpus possible: one request per
**competition-season**, not per match. A season's Scores-and-Fixtures page
carries the whole schedule in one table. 39 competitions × ~20 seasons ≈ 800
requests ≈ 80 minutes, versus decades for a match-by-match sweep.

League list comes from `ScraperFC.fbref.comps` (39 entries). Resume is safe and
incremental: `_already_current()` skips league-seasons with a `scraped_at`,
finished seasons are never re-scraped, unfinished ones age out after
`--stale-days`. `--reparse` rebuilds every fixture row from cached HTML fetching
nothing.

### `ingest_fbref.py` — the match tier, effectively unused

Per-match pages for shot-level xG and the full officials crew. **13 rows.**
Six seconds a request means the full 200k-match corpus is ~340 hours. It works;
it has never been run at scale.

## 3. Data inventory

### FBref landing zone (`backend/data/fbref.sqlite`, 102 MB)

| table | rows | what it is |
|---|---|---|
| `fbref_fixtures` | **207,517** | the corpus — one row per scheduled match |
| `fbref_seasons` | 854 | scrape ledger, one row per competition-season |
| `fbref_matches` | 13 | match tier, unused |
| `fbref_officials` | 13 | match tier, unused |
| `fbref_shots` | **0** | match tier, never populated |

39 competitions, **1888-09-08 to 2027-06-06**, 200,562 played (96.6%).

Column coverage across all 207,517 rows:

| column | populated | consequence |
|---|---|---|
| `date` | 100.0% | the join key is sound |
| `match_url` | 97.2% | **the match tier is reachable for any subset** |
| `round` | 99.6% | gameweek / knockout label |
| `home_goals` | 96.6% | the label |
| `referee` | **76.9%** | the headline — see §5 |
| `venue` | 70.8% | free text, not a venue id |
| `time` | 51.6% | real kickoff time, absent pre-2014 |
| `attendance` | 44.2% | |
| `home_xg` | **0.0%** | **the schedule tier cannot supply xG** — see §6 |

### Warehouse (`backend/data/warehouse.sqlite`, 295 MB, gitignored)

| table | rows |
|---|---|
| `matches` | 69,943 |
| `clubelo_ratings` | 784,779 |
| `player_match_stats` | 786,104 |
| `lineups` | 759,920 |
| `match_events` | 91,895 |
| `players` | 22,416 |
| `knockout_results` | 6,874 |
| `teams` | 1,409 |
| `scheduled_matches` | 224 |
| `weather` | **0** |
| `player_form` | **0** |
| `odds_snapshots` | 74 |

`matches` holds **zero null-score rows** and every consumer relies on that —
a row there is a fact about something that happened. Drawn-but-unplayed
fixtures live in `scheduled_matches` (added 2026-08-11) precisely so that
invariant survives.

## 4. Existing modelling — what must not be rebuilt

| capability | where | status |
|---|---|---|
| Elo | `services/ratings/elo.py`, `elo_goals.py`, `national_elo.py` | live |
| Tournament Elo over all matches | `services/tournament/ratings.py` | live |
| Dixon-Coles | `services/prediction/dixon_coles.py` | **the serving default** |
| Goal-model bake-off (6 families) | `scripts/bakeoff_goal_models.py` | run; all within .0017 |
| pi-ratings | `scripts/benchmark_pi_ratings.py` | run; parity |
| Neural stack (75 features) | `services/prediction/unified_model.py` | run; **not promoted** |
| Market benchmark + Shin de-vig | `services/prediction/market.py` | live |
| Walk-forward backtest | `services/prediction/backtest_walkforward.py` | live |
| Feature ablation | `scripts/ablate_features.py` | run |
| Calibration | `services/prediction/calibration.py` | live |
| Season Monte Carlo (title + relegation) | `services/simulation/league_simulator.py` | live |
| Knockout / bracket simulation | `services/simulation/`, `scripts/backtest_brackets.py` | live |

### Leakage discipline is already structural

This is the strongest thing in the repository and the part a rewrite would most
easily destroy. `features_v2.py` enforces point-in-time correctness three ways,
each tested:

1. **Split types.** `PreMatchInfo` holds only what is knowable before kickoff;
   `MatchOutcome` holds the result and every post-kickoff statistic.
   `features_for()` accepts *only* a `PreMatchInfo`, so the current match's
   score, cards and xG are **unreachable from feature code** — no discipline
   required.
2. **Write-after-read ordering.** History is mutated exclusively by
   `observe(info, outcome)`; `features_for()` is a pure read.
3. **A monotone clock.** `TemporalOrderError` is raised on observing a match
   older than the last seen date, or on featurising a match on or before it.
   Same-day fixtures are treated as *simultaneous*: the whole day is featurised
   before any of it is observed, so a 12:30 kickoff cannot see a 17:30 result.

29 tests in `test_features_v2.py`, plus `test_no_leakage.py`. The brief's
requested `test_no_future_matches_in_rolling_features` and
`test_target_match_not_in_features` exist as
`test_future_matches_do_not_change_features` and
`test_features_are_identical_before_and_after_the_match_is_played`.

`backtest_walkforward.py` has three modes and **documents its own leaky one**
(`--load-production` evaluates saved artifacts on seasons they were trained on,
with a WARNING block saying so).

### Measured state, carried forward honestly

| forecaster | Brier | source |
|---|---|---|
| Market (closing line, Shin de-vig) | **.5793** | `benchmark_market`, 37,981 fixtures |
| Dixon-Coles (serving) | .5897 | `benchmark_unified_vs_dc`, 5,320 paired |
| Neural stack, 75 features | .5925 | same |
| Constant base rate | .6526 | same |

Nine independent challenger families have landed within noise of each other.
The feature ablation picked **one** group out of ten (market, which cannot
serve). This is the measured reason to believe the bottleneck is *data*, not
model family — and the reason the FBref corpus matters.

## 5. The referee finding — the largest immediate win

The warehouse's referee coverage, and FBref's, for the five Wave A leagues:

| league | warehouse | FBref (2014+) |
|---|---|---|
| eng.1 | 98.9% | 92% |
| esp.1 | **0.0%** | **92%** |
| ger.1 | **0.0%** | **92%** |
| ita.1 | 9.2% | **92%** |
| fra.1 | **0.0%** | **91%** |

The repository's verdict on referee features — *"+.0015 Brier, harmful"* — was
measured on **England alone**, because England was the only league with the
data. That verdict does not generalise and is currently the only evidence
there is. FBref makes the real test possible for the first time.

Note the direction of the England/FBref difference: FBref is 92% because it
includes the current unplayed 2026-27 season; on played fixtures it is ~100%.

## 6. Known limitations, stated rather than worked around

- **xG is absent from the schedule tier.** Verified against raw cached HTML,
  not inferred: the Premier League 2023-24 Scores-and-Fixtures page as served
  contains no `data-stat` matching `xg`. xG needs the match tier at one request
  per match. Warehouse xG (from Understat/ESPN) covers 28.5% and starts ~2014.
- **The match tier is unpopulated.** Shooting, passing, possession, defensive
  actions, goalkeeping, player stats, squads, lineups — none collected. ~340
  hours for the full corpus; ~29 hours for Wave A 2017+.
- **124 of 854 competition-seasons produced zero rows.** Mostly benign (FBref
  has no schedule table for that era) but this is *also* what a poisoned cache
  entry looks like, so it needs the audit in §2 rather than trust.
- **Team names are free text in both databases** and differ between them.
  `team_resolver.py` exists with a 0.92 fuzzy threshold and
  `team_aliases.yml`; the repo has been burned by lowering that threshold.
- **`weather` and `player_form` are empty tables.** Features referencing them
  were removed from the served vector in the zero-variance audit (81 → 75).
- **`teams.venue_lat/lon` are all NULL**, so true travel distance is not
  computable.
- **`odds_home` is the pre-kickoff price, not the closing price.** The closing
  columns exist (`odds_close_*`) but grep for `PSC`/`B365C` returns zero hits
  repo-wide, so nothing populates them. Any claim of "beating the closing
  line" on this corpus is a claim about a softer number.

## 7. Recommendations, in order

1. **Load FBref into the warehouse.** Free, no scraping, unlocks referee
   testing across four leagues that have never had it. The loader already
   refuses to create teams or fixtures, which is the rule that matters.
2. **Build the canonical analytical layer** (DuckDB + Parquet) over both
   databases. The warehouse cannot absorb FBref's 207k fixtures because its
   loader is forbidden from creating fixtures — correctly. A rebuildable
   read-only analytical layer sidesteps that without weakening it, and gives
   the modelling side one substrate instead of two SQLite files.
3. **Freeze the split protocol before fitting anything**, with 2026-27 as an
   untouched forward season.
4. **Re-run the layered ablation** (results → Elo → goal model → FBref layers)
   on the expanded corpus. This is the experiment that decides everything else.
5. **Targeted match-tier scrape** for Wave A 2017+ only, once the ablation says
   whether xG earns its 29 hours.
6. **Do not rebuild** Dixon-Coles, the point-in-time builder, the walk-forward
   harness, the market benchmark, or the tournament simulator. They exist, they
   are measured, and their measurements are the baseline any new work has to
   beat.
