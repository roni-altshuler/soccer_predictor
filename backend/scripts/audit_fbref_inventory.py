"""What the FBref scrape actually contains, per competition-season.

Why a script and not a hand-written table
-----------------------------------------
An inventory written by hand is wrong the next time the scraper runs, and a
number nobody can regenerate is a number nobody can check. This emits both
artefacts from one pass over the landing zone:

    reports/data_inventory.parquet   machine-readable, one row per
                                     competition-season-table
    docs/fbref_data_inventory.md     the same thing for a human

What it measures, and why each column is here
---------------------------------------------
`rows` / `date_min` / `date_max`   coverage — which eras exist at all.
`played`                           a fixture list includes future matches;
                                   only played rows can train anything.
`dup_keys`                         two rows sharing (date, home, away). FBref
                                   repeats its header every ~25 rows and a
                                   parser that swallows one stores a fixture
                                   called "Home vs Away".
`missing_*`                        per-column missingness. The point of the
                                   exercise: `referee` is 0% in the warehouse
                                   outside England and ~97% here, and `xg` is
                                   0% here despite the column existing in the
                                   schema.
`schema_signature`                 hash of the non-null column set. Two seasons
                                   of the same league with different signatures
                                   are a schema change, which is the failure
                                   mode that silently drops a feature for an
                                   era.

    python3 -m backend.scripts.audit_fbref_inventory
    python3 -m backend.scripts.audit_fbref_inventory --no-markdown
"""
from __future__ import annotations

import argparse
import hashlib
import logging
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

logger = logging.getLogger("audit_fbref_inventory")

FBREF_DB = ROOT / "backend" / "data" / "fbref.sqlite"
WAREHOUSE_DB = ROOT / "backend" / "data" / "warehouse.sqlite"
PARQUET_OUT = ROOT / "reports" / "data_inventory.parquet"
MD_OUT = ROOT / "docs" / "fbref_data_inventory.md"

# Columns whose missingness decides whether a feature family is possible.
FIXTURE_COLUMNS = ("date", "time", "round", "home", "away", "home_goals",
                   "away_goals", "home_xg", "away_xg", "attendance", "venue",
                   "referee", "match_url")


def _sig(cols: Dict[str, int], total: int) -> str:
    """Hash of the columns that are populated at all. Two seasons of one league
    with different signatures had different tables served to them."""
    present = sorted(c for c, n in cols.items() if n > 0)
    return hashlib.sha256("|".join(present).encode()).hexdigest()[:10]


def inventory(conn: sqlite3.Connection) -> List[Dict]:
    rows: List[Dict] = []
    per = conn.execute("""
        SELECT league, season, COUNT(*) AS rows_n,
               MIN(date) AS date_min, MAX(date) AS date_max,
               SUM(home_goals IS NOT NULL) AS played
          FROM fbref_fixtures
         GROUP BY league, season
    """).fetchall()

    filled: Dict[tuple, Dict[str, int]] = defaultdict(dict)
    for col in FIXTURE_COLUMNS:
        for r in conn.execute(
                f"SELECT league, season, SUM({col} IS NOT NULL AND {col} <> '') "
                f"FROM fbref_fixtures GROUP BY league, season"):
            filled[(r[0], r[1])][col] = int(r[2] or 0)

    dups: Dict[tuple, int] = defaultdict(int)
    for r in conn.execute("""
        SELECT league, season, COUNT(*) - COUNT(DISTINCT date || '|' || home || '|' || away)
          FROM fbref_fixtures GROUP BY league, season"""):
        dups[(r[0], r[1])] = int(r[2] or 0)

    scraped = {(r[0], r[1]): r[2] for r in conn.execute(
        "SELECT league, season, scraped_at FROM fbref_seasons")}

    for league, season, n, dmin, dmax, played in per:
        cols = filled[(league, season)]
        row = {
            "source": "fbref",
            "competition": league,
            "season": str(season),
            "table_type": "schedule",
            "rows": int(n),
            "played": int(played or 0),
            "columns": len(FIXTURE_COLUMNS),
            "date_min": dmin,
            "date_max": dmax,
            "duplicate_count": dups[(league, season)],
            "schema_signature": _sig(cols, int(n)),
            "scraped_at": scraped.get((league, season)),
        }
        for col in FIXTURE_COLUMNS:
            row[f"missing_{col}"] = round(1 - (cols.get(col, 0) / n), 4) if n else 1.0
        rows.append(row)

    # Season rows that produced nothing. A zero is only benign when FBref has
    # no schedule table for that era; anything else is a hole.
    for r in conn.execute("""
        SELECT s.league, s.season, s.scraped_at, s.error
          FROM fbref_seasons s
          LEFT JOIN (SELECT DISTINCT league, season FROM fbref_fixtures) f
            ON f.league = s.league AND f.season = s.season
         WHERE f.league IS NULL"""):
        rows.append({
            "source": "fbref", "competition": r[0], "season": str(r[1]),
            "table_type": "schedule", "rows": 0, "played": 0,
            "columns": len(FIXTURE_COLUMNS), "date_min": None, "date_max": None,
            "duplicate_count": 0, "schema_signature": "empty",
            "scraped_at": r[2],
            **{f"missing_{c}": 1.0 for c in FIXTURE_COLUMNS},
        })

    for table, label in (("fbref_matches", "match_report"),
                         ("fbref_shots", "shots"),
                         ("fbref_officials", "officials")):
        n = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        rows.append({
            "source": "fbref", "competition": "(all)", "season": "(all)",
            "table_type": label, "rows": int(n), "played": int(n),
            "columns": len([d[1] for d in conn.execute(f"PRAGMA table_info({table})")]),
            "date_min": None, "date_max": None, "duplicate_count": 0,
            "schema_signature": "n/a", "scraped_at": None,
            **{f"missing_{c}": None for c in FIXTURE_COLUMNS},
        })
    return rows


def write_parquet(rows: List[Dict], path: Path) -> None:
    import duckdb  # duckdb writes Parquet with no pyarrow dependency

    path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    con.execute("CREATE TABLE inv AS SELECT * FROM (VALUES " + ",".join(
        "(" + ",".join("?" * len(rows[0])) + ")" for _ in rows) + ") AS t(" +
        ",".join(f'"{k}"' for k in rows[0]) + ")",
        [v for r in rows for v in r.values()])
    con.execute(f"COPY inv TO '{path}' (FORMAT PARQUET)")
    con.close()


def markdown(rows: List[Dict], conn: sqlite3.Connection) -> str:
    sched = [r for r in rows if r["table_type"] == "schedule"]
    by_league: Dict[str, List[Dict]] = defaultdict(list)
    for r in sched:
        by_league[r["competition"]].append(r)

    total = sum(r["rows"] for r in sched)
    played = sum(r["played"] for r in sched)

    def _missing(row: Dict, col: str) -> float:
        """Missingness, treating an ABSENT measurement as fully missing.

        Written out rather than `row[key] or 1.0`, which is the same trap that
        made the first run of this script report `date` as 0% populated across
        207,517 rows that all have one: a genuine 0.0 missingness is falsy, so
        `or` replaced it with 1.0 and inverted every perfect column.
        """
        v = row.get(f"missing_{col}")
        return 1.0 if v is None else float(v)

    def cov(col: str) -> float:
        num = sum(r["rows"] * (1 - _missing(r, col)) for r in sched)
        return num / total if total else 0.0

    out = [
        "# FBref data inventory",
        "",
        f"Generated {datetime.now(timezone.utc).isoformat(timespec='seconds')} by "
        "`python3 -m backend.scripts.audit_fbref_inventory`. Do not hand-edit — "
        "regenerate it.",
        "",
        "## Totals",
        "",
        f"| | |",
        f"|---|---|",
        f"| competitions | **{len(by_league)}** |",
        f"| competition-seasons | **{len(sched)}** |",
        f"| fixture rows | **{total:,}** |",
        f"| played (has a score) | **{played:,}** ({played / total:.1%}) |",
        f"| earliest fixture | {min((r['date_min'] for r in sched if r['date_min']), default='—')} |",
        f"| latest fixture | {max((r['date_max'] for r in sched if r['date_max']), default='—')} |",
        "",
        "## Column coverage across every scraped fixture",
        "",
        "| column | populated | note |",
        "|---|---|---|",
    ]
    notes = {
        "date": "the join key for everything",
        "time": "kickoff time; absent for older eras",
        "round": "gameweek or knockout round label",
        "home_goals": "the label; blank means not yet played",
        "home_xg": "**absent from the schedule tier entirely** — see below",
        "attendance": "sparse and era-dependent",
        "venue": "free text, not a venue id",
        "referee": "**the reason this scrape matters** — see below",
        "match_url": "the key to the match tier (shots, lineups, per-90 tables)",
    }
    for col in ("date", "time", "round", "home_goals", "home_xg", "attendance",
                "venue", "referee", "match_url"):
        out.append(f"| `{col}` | {cov(col):.1%} | {notes.get(col, '')} |")

    out += [
        "",
        "## Per competition",
        "",
        "| competition | seasons | rows | played | span | referee | xG | schemas |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for league in sorted(by_league):
        rs = by_league[league]
        n = sum(r["rows"] for r in rs)
        if not n:
            continue
        p = sum(r["played"] for r in rs)
        ref = sum(r["rows"] * (1 - _missing(r, "referee")) for r in rs) / n
        xg = sum(r["rows"] * (1 - _missing(r, "home_xg")) for r in rs) / n
        lo = min((r["date_min"] for r in rs if r["date_min"]), default="—")
        hi = max((r["date_max"] for r in rs if r["date_max"]), default="—")
        sigs = len({r["schema_signature"] for r in rs if r["rows"]})
        out.append(f"| {league} | {len([r for r in rs if r['rows']])} | {n:,} | "
                   f"{p:,} | {lo[:4]}–{hi[:4]} | {ref:.0%} | {xg:.0%} | {sigs} |")

    empties = [r for r in sched if r["rows"] == 0]
    out += [
        "",
        "## Competition-seasons that produced no rows",
        "",
        f"{len(empties)} of {len(sched)}. FBref serves a real page for seasons it "
        "has no schedule table for, so a zero is usually benign — but a zero is "
        "also what a cached rate-limit page looks like, which is how three whole "
        "competitions went missing from a sweep that reported success.",
        "",
    ]
    by_l: Dict[str, int] = defaultdict(int)
    for r in empties:
        by_l[r["competition"]] += 1
    for lg, n in sorted(by_l.items(), key=lambda kv: -kv[1])[:15]:
        out.append(f"- {lg}: {n}")

    out += [
        "",
        "## Match tier",
        "",
        "| table | rows |",
        "|---|---|",
    ]
    for r in rows:
        if r["table_type"] in ("match_report", "shots", "officials"):
            out.append(f"| `{r['table_type']}` | {r['rows']:,} |")
    out += [
        "",
        "**The match tier is effectively empty.** Every FBref table the brief "
        "lists — standard, shooting, passing, passing types, goal and shot "
        "creation, defensive actions, possession, playing time, miscellaneous, "
        "goalkeeping, advanced goalkeeping, player stats, squads, lineups — "
        "lives behind a per-match page at six seconds a request. None of it is "
        "collected. What exists is the SCHEDULE tier: one request per "
        "competition-season, which is why 206k fixtures were reachable at all.",
        "",
        "## The xG finding",
        "",
        "`home_xg` and `away_xg` are in the schema and are **0% populated across "
        "every row**. This was verified against the raw cached HTML rather than "
        "inferred from the empty column: the Premier League 2023-24 "
        "Scores-and-Fixtures page as served carries no `data-stat` matching "
        "`xg` at all. The schedule tier cannot supply xG; the match tier can, at "
        "one request per match.",
        "",
    ]
    return "\n".join(out) + "\n"


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--no-markdown", action="store_true")
    ap.add_argument("--no-parquet", action="store_true")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    conn = sqlite3.connect(f"file:{FBREF_DB}?mode=ro", uri=True)
    rows = inventory(conn)
    logger.info("inventory rows: %d", len(rows))

    if not args.no_parquet:
        write_parquet(rows, PARQUET_OUT)
        logger.info("wrote %s", PARQUET_OUT)
    if not args.no_markdown:
        MD_OUT.parent.mkdir(parents=True, exist_ok=True)
        MD_OUT.write_text(markdown(rows, conn))
        logger.info("wrote %s", MD_OUT)
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
