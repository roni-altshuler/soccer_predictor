"""Backfill who actually advanced, for every knockout match in the warehouse.

The gap this closes
-------------------
`matches` stores a scoreline and nothing else. For a league match that is the
whole result. For a knockout tie it is not: Argentina 3-3 France is recorded as
a draw, and Argentina won the World Cup. Morocco 0-0 Spain is a draw, and
Morocco went to the quarter-final. Across the tournaments in this warehouse,
521 knockout matches finished level, and for every one of them the warehouse
holds the wrong answer to the only question a knockout asks.

ESPN answers it on the summary endpoint. Each competitor carries `winner`
(true/false) and `shootoutScore`, and the status detail distinguishes FT from
FT-Pens. Verified 2026-08-11 on the 2022 final (Argentina 4-2 on penalties) and
Morocco-Spain (3-0). That is the label the tournament layer trains on.

Guards
------
The scoreline returned by ESPN must match the scoreline already in the
warehouse. This repo has been bitten before by an upstream API confidently
returning the wrong event (see the F1 wrong-event incident); a backfill that
writes a winner from a different match would be undetectable afterwards. A
mismatch is refused and counted, never written.

Resumable and idempotent: rows already present are skipped unless --force.

    python3 -m backend.scripts.backfill_knockout_results --limit 200
    python3 -m backend.scripts.backfill_knockout_results --stats

Writes to `knockout_results`.
"""
from __future__ import annotations

import argparse
import logging
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import httpx

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services.tournament.rounds import (  # noqa: E402
    GROUP,
    classify,
)

logger = logging.getLogger("backfill_knockout_results")

DB = ROOT / "backend" / "data" / "warehouse.sqlite"

# site.web.api, never site.api — the latter answers 403 from datacentre IPs.
ESPN = "https://site.web.api.espn.com/apis/site/v2/sports/soccer"
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/124 Safari/537.36"}

TOURNAMENTS = (
    "uefa.champions", "uefa.europa", "fifa.world", "uefa.euro",
    "conmebol.america", "fifa.world.w", "uefa.euro.w", "uefa.champions.w",
    "conmebol.libertadores", "conmebol.sudamericana", "caf.nations",
    "uefa.nations", "concacaf.champions", "concacaf.gold", "fifa.cwc",
)

# The warehouse names women's competitions `<men's id>.w`; ESPN does not.
# Requesting uefa.champions.w answers 400, which reads as "no data" and would
# have quietly dropped every women's knockout tie.
ESPN_SLUG = {
    "uefa.champions.w": "uefa.wchampions",
    "fifa.world.w": "fifa.wwc",
    "uefa.euro.w": "uefa.weuro",
    "usa.1.w": "usa.nwsl",
    "eng.1.w": "eng.w.1",
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS knockout_results (
    match_id       TEXT PRIMARY KEY REFERENCES matches(match_id),
    home_shootout  INTEGER,
    away_shootout  INTEGER,
    winner_side    TEXT,      -- 'home' | 'away' | NULL when the leg itself is level
    status_detail  TEXT,      -- FT | AET | FT-Pens
    fetched_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_knockout_winner ON knockout_results(winner_side);
"""


def event_id(match_id: str) -> Optional[str]:
    """`espn_uefa.champions_733620` -> `733620`."""
    if not match_id.startswith("espn_"):
        return None
    tail = match_id.rsplit("_", 1)[-1]
    return tail if tail.isdigit() else None


def pending(conn: sqlite3.Connection, comps: Sequence[str], force: bool,
            limit: Optional[int]) -> List[sqlite3.Row]:
    """Knockout and qualifying matches with a result but no recorded winner.

    Qualifying rounds are included deliberately. They are two-legged knockout
    ties like any other and roughly double the training set; the model can
    always be restricted to the main draw later, but the rows cannot be
    invented after the fact.
    """
    ph = ",".join("?" * len(comps))
    sql = f"""
        SELECT m.match_id, m.competition_id, m.season, m.date_utc, m.phase,
               m.home_score, m.away_score
          FROM matches m
          {"" if force else "LEFT JOIN knockout_results k ON k.match_id = m.match_id"}
         WHERE m.competition_id IN ({ph})
           AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
           {"" if force else "AND k.match_id IS NULL"}
         ORDER BY m.date_utc DESC
    """
    rows = [r for r in conn.execute(sql, list(comps))
            if classify(r["phase"]) != GROUP]
    return rows[:limit] if limit else rows


def parse(payload: dict) -> Optional[Dict]:
    """Pull winner, shootout and status off a summary payload."""
    header = payload.get("header") or {}
    comps = header.get("competitions") or []
    if not comps:
        return None
    comp = comps[0]
    status = ((comp.get("status") or {}).get("type") or {})
    if not status.get("completed"):
        return None

    out: Dict = {"status_detail": status.get("detail"),
                 "home": None, "away": None}
    for t in comp.get("competitors") or []:
        side = t.get("homeAway")
        if side not in ("home", "away"):
            continue
        try:
            score = int(t.get("score"))
        except (TypeError, ValueError):
            return None
        so = t.get("shootoutScore")
        out[side] = {
            "score": score,
            "shootout": int(so) if so is not None else None,
            "winner": bool(t.get("winner")),
        }
    if not out["home"] or not out["away"]:
        return None
    return out


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--competitions", default=",".join(TOURNAMENTS))
    ap.add_argument("--limit", type=int)
    ap.add_argument("--force", action="store_true",
                    help="refetch matches already recorded")
    ap.add_argument("--sleep", type=float, default=0.35)
    ap.add_argument("--stats", action="store_true")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s",
                        datefmt="%H:%M:%S")
    logging.getLogger("httpx").setLevel(logging.WARNING)

    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    conn.commit()

    if args.stats:
        total = conn.execute("SELECT COUNT(*) FROM knockout_results").fetchone()[0]
        pens = conn.execute(
            "SELECT COUNT(*) FROM knockout_results WHERE home_shootout IS NOT NULL"
        ).fetchone()[0]
        logger.info("knockout_results: %d rows, %d decided on penalties", total, pens)
        for r in conn.execute("""
            SELECT m.competition_id, COUNT(*) n,
                   SUM(CASE WHEN k.winner_side IS NULL THEN 1 ELSE 0 END) level
              FROM knockout_results k JOIN matches m USING(match_id)
             GROUP BY 1 ORDER BY 2 DESC"""):
            logger.info("  %-24s %5d  (%d level after this leg)",
                        r["competition_id"], r["n"], r["level"])
        return 0

    comps = [c.strip() for c in args.competitions.split(",") if c.strip()]
    todo = pending(conn, comps, args.force, args.limit)
    logger.info("%d knockout matches to resolve", len(todo))

    written = mismatched = missing = skipped = 0
    now = datetime.now(timezone.utc).isoformat()
    with httpx.Client(headers=UA, timeout=25.0) as client:
        for i, row in enumerate(todo, 1):
            ev = event_id(row["match_id"])
            if not ev:
                skipped += 1
                continue
            slug = ESPN_SLUG.get(row["competition_id"], row["competition_id"])
            url = f"{ESPN}/{slug}/summary?event={ev}"
            try:
                resp = client.get(url)
                resp.raise_for_status()
                parsed = parse(resp.json())
            except Exception as exc:  # noqa: BLE001 — network is best-effort
                logger.debug("fetch failed %s: %s", row["match_id"], exc)
                missing += 1
                time.sleep(args.sleep)
                continue

            if not parsed:
                missing += 1
                time.sleep(args.sleep)
                continue

            # The scoreline must agree. An API that hands back a different
            # event is worse than an API that hands back nothing.
            if (parsed["home"]["score"] != row["home_score"]
                    or parsed["away"]["score"] != row["away_score"]):
                mismatched += 1
                logger.warning("scoreline mismatch %s: espn %d-%d vs warehouse %d-%d",
                               row["match_id"], parsed["home"]["score"],
                               parsed["away"]["score"], row["home_score"],
                               row["away_score"])
                time.sleep(args.sleep)
                continue

            if parsed["home"]["winner"]:
                winner = "home"
            elif parsed["away"]["winner"]:
                winner = "away"
            else:
                # First leg of a two-legged tie, or a group-format match that
                # slipped the classifier. NULL is the honest answer for the
                # leg; the tie builder resolves it on aggregate.
                winner = None

            conn.execute(
                """INSERT INTO knockout_results
                       (match_id, home_shootout, away_shootout, winner_side,
                        status_detail, fetched_at)
                   VALUES (?,?,?,?,?,?)
                   ON CONFLICT(match_id) DO UPDATE SET
                       home_shootout=excluded.home_shootout,
                       away_shootout=excluded.away_shootout,
                       winner_side=excluded.winner_side,
                       status_detail=excluded.status_detail,
                       fetched_at=excluded.fetched_at""",
                (row["match_id"], parsed["home"]["shootout"],
                 parsed["away"]["shootout"], winner, parsed["status_detail"], now),
            )
            written += 1
            if written % 100 == 0:
                conn.commit()
                logger.info("  %d/%d written (%d mismatched, %d unavailable)",
                            i, len(todo), mismatched, missing)
            time.sleep(args.sleep)

    conn.commit()
    logger.info("done: %d written, %d scoreline mismatches refused, "
                "%d unavailable, %d without an ESPN id",
                written, mismatched, missing, skipped)
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
