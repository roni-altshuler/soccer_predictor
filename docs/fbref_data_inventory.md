# FBref data inventory

Generated 2026-08-11T11:21:06+00:00 by `python3 -m backend.scripts.audit_fbref_inventory`. Do not hand-edit — regenerate it.

## Totals

| | |
|---|---|
| competitions | **39** |
| competition-seasons | **854** |
| fixture rows | **207,517** |
| played (has a score) | **200,562** (96.6%) |
| earliest fixture | 1888-09-08 |
| latest fixture | 2027-06-06 |

## Column coverage across every scraped fixture

| column | populated | note |
|---|---|---|
| `date` | 100.0% | the join key for everything |
| `time` | 51.6% | kickoff time; absent for older eras |
| `round` | 99.6% | gameweek or knockout round label |
| `home_goals` | 96.6% | the label; blank means not yet played |
| `home_xg` | 0.0% | **absent from the schedule tier entirely** — see below |
| `attendance` | 44.2% | sparse and era-dependent |
| `venue` | 70.8% | free text, not a venue id |
| `referee` | 76.9% | **the reason this scrape matters** — see below |
| `match_url` | 97.2% | the key to the match tier (shots, lineups, per-90 tables) |

## Per competition

| competition | seasons | rows | played | span | referee | xG | schemas |
|---|---|---|---|---|---|---|---|
| Argentina Liga Profesional | 12 | 4,604 | 4,413 | 2015–2026 | 93% | 0% | 2 |
| Australia A-League Women | 8 | 749 | 746 | 2018–2026 | 100% | 0% | 1 |
| Belgium Pro League | 12 | 3,590 | 3,580 | 2014–2026 | 100% | 0% | 1 |
| Brazil Serie A | 13 | 4,940 | 4,775 | 2014–2026 | 94% | 0% | 2 |
| CONMEBOL Copa America | 5 | 144 | 129 | 2015–2024 | 100% | 0% | 1 |
| CONMEBOL Copa Libertadores | 13 | 1,653 | 1,608 | 2014–2026 | 93% | 0% | 2 |
| England EFL Championship | 13 | 7,236 | 6,679 | 2014–2027 | 92% | 0% | 2 |
| England Premier League | 128 | 51,708 | 51,328 | 1888–2027 | 25% | 0% | 4 |
| England WSL | 10 | 1,169 | 1,115 | 2017–2026 | 93% | 0% | 2 |
| FIFA Womens World Cup | 9 | 348 | 337 | 1991–2023 | 98% | 0% | 1 |
| FIFA World Cup | 23 | 1,068 | 1,029 | 1930–2026 | 76% | 0% | 2 |
| France Ligue 1 | 32 | 11,510 | 11,102 | 1995–2027 | 96% | 0% | 3 |
| France Ligue 2 | 13 | 4,760 | 4,357 | 2014–2027 | 92% | 0% | 1 |
| France Premiere Ligue | 9 | 1,198 | 1,160 | 2017–2026 | 97% | 0% | 1 |
| Germany 2.Bundesliga | 13 | 4,026 | 3,728 | 2014–2027 | 84% | 0% | 2 |
| Germany Bundesliga | 39 | 12,032 | 11,725 | 1988–2027 | 97% | 0% | 3 |
| Germany Womens Bundesliga | 10 | 1,370 | 1,370 | 2016–2026 | 100% | 0% | 1 |
| Italy Serie A | 39 | 13,637 | 13,257 | 1988–2027 | 97% | 0% | 3 |
| Italy Serie B | 14 | 5,818 | 5,436 | 2013–2027 | 85% | 0% | 3 |
| Italy Womens Serie A | 8 | 1,050 | 1,013 | 2018–2026 | 96% | 0% | 2 |
| Mexico Liga MX | 13 | 4,204 | 3,998 | 2014–2026 | 95% | 0% | 2 |
| Netherlands Eredivisie | 27 | 8,436 | 8,056 | 2000–2027 | 95% | 0% | 2 |
| Portugal Primeira Liga | 27 | 7,748 | 7,450 | 2000–2027 | 96% | 0% | 3 |
| Saudi Arabia Pro League | 13 | 3,152 | 2,846 | 2014–2027 | 90% | 0% | 2 |
| Spain La Liga | 39 | 14,984 | 14,604 | 1988–2027 | 97% | 0% | 3 |
| Spain La Liga 2 | 13 | 6,078 | 5,616 | 2014–2027 | 92% | 0% | 2 |
| Spain Liga F | 4 | 960 | 960 | 2022–2026 | 25% | 0% | 2 |
| Turkiye Super Lig | 14 | 4,618 | 4,312 | 2013–2027 | 86% | 0% | 4 |
| UEFA Champions League | 37 | 4,365 | 4,315 | 1990–2026 | 99% | 0% | 1 |
| UEFA Conference League | 6 | 939 | 888 | 2021–2026 | 97% | 0% | 1 |
| UEFA Europa League | 37 | 6,569 | 6,485 | 1990–2026 | 100% | 0% | 3 |
| UEFA European Championship | 7 | 277 | 260 | 2000–2024 | 100% | 0% | 1 |
| UEFA Womens Champions League | 13 | 802 | 787 | 2014–2026 | 85% | 0% | 2 |
| UEFA Womens European Championship | 7 | 173 | 165 | 2001–2025 | 100% | 0% | 1 |
| USA MLS | 31 | 9,594 | 9,134 | 1996–2026 | 94% | 0% | 3 |
| USA NWSL | 14 | 1,868 | 1,664 | 2013–2026 | 78% | 0% | 2 |
| USA NWSL Challenge Cup | 4 | 122 | 117 | 2020–2023 | 100% | 0% | 2 |
| USA NWSL Fall Series | 1 | 18 | 18 | 2020–2020 | 100% | 0% | 1 |

## Competition-seasons that produced no rows

124 of 854. FBref serves a real page for seasons it has no schedule table for, so a zero is usually benign — but a zero is also what a cached rate-limit page looks like, which is how three whole competitions went missing from a sweep that reported success.

- FBref Big 5 Combined: 32
- England EFL Championship: 13
- Spain La Liga 2: 13
- Italy Serie B: 12
- Turkiye Super Lig: 12
- Belgium Pro League: 11
- Germany 2.Bundesliga: 11
- Mexico Liga MX: 11
- France Ligue 2: 5
- USA NWSL Challenge Cup: 3
- Argentina Liga Profesional: 1

## Match tier

| table | rows |
|---|---|
| `match_report` | 13 |
| `shots` | 0 |
| `officials` | 13 |

**The match tier is effectively empty.** Every FBref table the brief lists — standard, shooting, passing, passing types, goal and shot creation, defensive actions, possession, playing time, miscellaneous, goalkeeping, advanced goalkeeping, player stats, squads, lineups — lives behind a per-match page at six seconds a request. None of it is collected. What exists is the SCHEDULE tier: one request per competition-season, which is why 206k fixtures were reachable at all.

## The xG finding

`home_xg` and `away_xg` are in the schema and are **0% populated across every row**. This was verified against the raw cached HTML rather than inferred from the empty column: the Premier League 2023-24 Scores-and-Fixtures page as served carries no `data-stat` matching `xg` at all. The schedule tier cannot supply xG; the match tier can, at one request per match.

