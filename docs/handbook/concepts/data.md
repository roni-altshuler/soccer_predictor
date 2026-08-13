# Data

Where every number ultimately comes from, what is covered, and what is
genuinely missing.

---

## Sources

| source | what it provides | notes |
|---|---|---|
| **ESPN** | results, fixtures, standings, knockout brackets, shootout scores, `winner` flags | ingested daily; the primary source |
| **football-data.co.uk** | historical results with **closing odds** | the only odds source; England-only referee column |
| **FBref** | schedules, historical match tables | **403 from datacentre IPs** — see below |
| **OpenFootball** | historical results | used only in the weekly full rebuild |

### ESPN host — `site.web.api.espn.com`, never `site.api.espn.com`

The two serve byte-identical payloads. Akamai answers `site.api` with **403
Access Denied** from datacentre IPs (Vercel, GitHub Actions) and its error page
carries no CORS headers, so a browser fetch dies with `net::ERR_FAILED`. The
host is named once in `src/lib/espnHost.ts` and once in
`backend/services/espn/client.py`.

### ESPN's scoreboard silently caps at 100 events

No error, no field saying so. Asking for a whole remaining season without
`&limit=` returns the next 100 fixtures — and a season projection built from a
quarter of a season. Any scoreboard call spanning more than a few weeks must
pass an explicit limit.

### FBref is not available to this machine

Sports Reference answers datacentre IPs with HTTP 403, re-verified 2026-08-11
with a browser User-Agent. It is genuinely free in a browser and genuinely
unreachable from CI. ESPN answers the same questions and additionally carries
shootout scores and winner flags that FBref's match tables do not expose. Where
FBref would add something ESPN cannot — per-match xG before 2017 — that gap is
recorded rather than filled.

---

## The warehouse

SQLite, at `backend/data/warehouse.sqlite`, **gitignored**. It is rebuildable
from the loaders, and nothing in the repository depends on a copy of it
existing.

Two invariants worth knowing if you read the schema:

- **`matches` is results-only.** It has held zero null-score rows for the life
  of the project, and every consumer — Elo, Dixon-Coles, the feature builder,
  the integrity checker — reads a row there as a fact about something that
  happened. Drawn-but-unplayed fixtures live in `scheduled_matches`.
- **Team identity is global; club names are competition-scoped.** ESPN's MLS
  scoreboard calls Inter Miami "Inter", which once put 28 matches on
  Internazionale's record from 2020 to 2023 — and *both* clubs were rated on
  it. This class of bug is why identity resolution is competition-aware.

### Integrity is checked, not assumed

`validate_warehouse_integrity` runs 9 checks and exits non-zero. Run it after
any ingest change. Two representative failures it exists to catch:

- **Duplicate fixtures.** Terse club names from one source scored below the
  fuzzy-match threshold against another source's spelling, creating a second
  team row, so the same match was inserted twice. Dortmund once "won" a
  Bundesliga title because a 7-0 was counted twice.
- **A source serving another competition's matches.** On 2026-08-13
  football-data answered a Premier League request with **National League**
  fixtures and a La Liga request with the **Portuguese Primeira Liga**. Every
  row-level check passed — 22 well-formed matches between real clubs with real
  scores — and two steps later the Premier League had 44 entrants and silently
  left the site. Files are now refused if their clubs are strangers to the
  competition they claim to be, *before* any name is resolved.

**Data-integrity work outscores modelling work here.** The 2026-08-10 repair
moved Dixon-Coles .0030 closer to the market on 2.5× the sample with no
modelling change at all.

---

## Coverage

**Leagues projected:** nine — eng.1, esp.1, ger.1, ita.1, fra.1, ned.1, por.1,
tur.1, usa.1 (MLS). Each admitted by a per-league walk-forward gate against
three baselines.

**Leagues with a closing price on every fixture (Wave A):** five — eng.1,
esp.1, ger.1, ita.1, fra.1. Only these may be described as scored against the
market.

**Knockout competitions:** fourteen — UEFA Champions League, Europa League,
Conference League, Nations League; FIFA World Cup and Club World Cup; the
Euros; Copa América, Libertadores and Sudamericana; AFCON; AFC Asian Cup; Gold
Cup; CONCACAF Champions Cup.

Scope is a **product** decision, not a measurement one. Five second tiers and
Brazil each cleared the gate and are held out with the reason recorded and
their gate evidence untouched — a Championship table next to the Premier League
made the page harder to read. They are one line away from returning.

---

## What is genuinely missing

Left empty rather than imputed:

- **Referees outside England.** football-data publishes the column for England
  only, and ESPN carries officials only from 2022-23, so Spain, Germany, Italy
  and France sit at 0.8–1.8% coverage. Referee features are untestable there.
- **Kickoff times before 2019.** They do not exist upstream.
- **Weather** covers 66.6% of Wave A.
- **Injuries and lineups as a signal.** `player_form` and `match_events` were
  empty for the life of the project. Lineups now exist (759,920 rows over
  18,939 matches) and were measured: ratings-only .59471 versus ratings+lineups
  .59377, **delta −.00095, 95% CI [−.00219, +.00029] — no measurable effect.**
- **Women's competitions**, dropped in the 2026-08 pivot. A real cost, to be
  revisited on the same evidence gate as everything else.

A constant feature is not free: a zero-variance audit found 9 of 81 served
features constant, six of them because nothing fed them. They were removed
rather than left in place looking like signal.

## See also

- [Models](models.md) — what is fitted on this
- [Commands](../reference/cli.md) — how to rebuild any of it
