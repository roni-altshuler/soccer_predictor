"""Capture the price as it moves, not just where it ended up.

The gap this closes
-------------------
The warehouse holds exactly four odds columns and one set of numbers per
fixture — and that set is the CLOSING line. There is no opening price, no
intermediate move, no second bookmaker, and no timestamp on the price itself.
47,600 priced fixtures, each a single snapshot taken at the hardest moment.

That makes one thing structurally impossible: measuring closing line value. CLV
is the price you could have taken against the price at close, and this project
has only ever stored the second half of that comparison. Every benchmark it has
ever run therefore compares the model to the sharpest number in the market and
reports, correctly, that it loses — "+.0140 Brier behind the close" is the same
sentence a hundred different ways.

Three independent challenger families have now landed on Dixon-Coles (six goal
models within .003, the Bayesian pair within .001, pi-ratings plus gradient
boosting within .0006), and the feature ablation picks out exactly one group
that helps — market data, which the serving path cannot populate. Those results
all say the same thing: the remaining edge is not in modelling goals harder. It
is in the market, and we cannot see the market move.

What this does
--------------
ESPN carries a live moneyline for upcoming fixtures (DraftKings, verified
2026-08-10: Alavés v Getafe priced 135 / 180 / 260 five days out). Polled on a
schedule it yields the one thing no amount of modelling can substitute for — a
price history. From it: the opening line, the drift, the closing line, and for
the first time an answer to "did our disagreement predict which way the line
moved?"

A snapshot is append-only and immutable. Prices are observations, and an
observation that gets overwritten by a later one is not a history.

    python3 -m backend.scripts.capture_odds_snapshots --days-ahead 10
    python3 -m backend.scripts.capture_odds_snapshots --stats

Writes to `odds_snapshots`.
"""
from __future__ import annotations

import argparse
import json
import logging
import sqlite3
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import httpx

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

logger = logging.getLogger("capture_odds_snapshots")

DB = ROOT / "backend" / "data" / "warehouse.sqlite"
ESPN = "https://site.web.api.espn.com/apis/site/v2/sports/soccer"
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/124 Safari/537.36"}
WAVE_A = ("eng.1", "esp.1", "ger.1", "ita.1", "fra.1")


def ensure_schema(conn: sqlite3.Connection) -> None:
    """Append-only price history.

    The primary key deliberately includes `captured_at`: a second reading of
    the same book on the same fixture is a NEW fact, not a correction of the
    old one. Overwriting is how you end up with only the closing line again.
    """
    conn.execute(
        """CREATE TABLE IF NOT EXISTS odds_snapshots (
               match_id     TEXT NOT NULL,
               bookmaker    TEXT NOT NULL,
               captured_at  TEXT NOT NULL,
               kickoff_utc  TEXT,
               minutes_to_kickoff REAL,
               odds_home    REAL,
               odds_draw    REAL,
               odds_away    REAL,
               -- ESPN ships the OPENING price alongside the current one, so a
               -- single request already contains a move. Verified 2026-08-10:
               -- Getafe at Alaves opened away +250 and had drifted to +260.
               -- Draw has no open/close split upstream, so it stays NULL.
               odds_home_open REAL,
               odds_away_open REAL,
               overround    REAL,
               source       TEXT NOT NULL DEFAULT 'espn',
               PRIMARY KEY (match_id, bookmaker, captured_at)
           )"""
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_odds_snapshots_match ON odds_snapshots(match_id)"
    )
    conn.commit()


def american_to_decimal(v) -> Optional[float]:
    """ESPN publishes American moneylines; the rest of this project is decimal."""
    try:
        a = float(v)
    except (TypeError, ValueError):
        return None
    if a == 0:
        return None
    return 1.0 + (a / 100.0 if a > 0 else 100.0 / abs(a))


def _side(ml: dict, side: str, phase: str):
    """`moneyline.{side}.{phase}.odds`, e.g. moneyline.home.open.odds.

    The scoreboard nests each side under open/close rather than exposing a flat
    moneyLine, which the core API does. Reading it as a scalar silently yields
    None for every fixture — the shape has to be walked.
    """
    node = ml.get(side)
    if not isinstance(node, dict):
        return None
    phase_node = node.get(phase)
    if isinstance(phase_node, dict):
        return phase_node.get("odds")
    return None


def parse_odds(comp: dict) -> List[dict]:
    out = []
    for o in comp.get("odds") or []:
        # ESPN's odds array can contain nulls for a fixture it has listed but
        # not yet priced.
        if not isinstance(o, dict):
            continue
        book = ((o.get("provider") or {}).get("name") or "unknown").strip()
        ml = o.get("moneyline") or {}

        h = _side(ml, "home", "close") or (o.get("homeTeamOdds") or {}).get("moneyLine")
        a = _side(ml, "away", "close") or (o.get("awayTeamOdds") or {}).get("moneyLine")
        d = o.get("drawOdds")
        if isinstance(d, dict):
            d = d.get("moneyLine")

        cur = [american_to_decimal(x) for x in (h, d, a)]
        if not all(v is not None and v > 1.0 for v in cur):
            continue
        out.append({
            "book": book,
            "home": cur[0], "draw": cur[1], "away": cur[2],
            "home_open": american_to_decimal(_side(ml, "home", "open")),
            "away_open": american_to_decimal(_side(ml, "away", "open")),
        })
    return out


def match_id_for(comp_id: str, event_id: str) -> str:
    """The id `espn_loader` will give this fixture once it is ingested.

    Deterministic from the competition and event, so a price captured days
    before the fixture exists in `matches` still joins to it later. An earlier
    version looked the row up first and returned the same string either way —
    a query whose result changed nothing, and which made the CI path (no
    warehouse at all) fail outright.
    """
    return f"espn_{comp_id}_{event_id}"


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", type=Path, default=DB)
    ap.add_argument("--leagues", default=",".join(WAVE_A))
    ap.add_argument("--days-ahead", type=int, default=10)
    ap.add_argument("--delay", type=float, default=0.4)
    ap.add_argument("--stats", action="store_true")
    ap.add_argument("--jsonl-dir", type=Path, default=ROOT / "backend" / "data" / "odds",
                    help="durable append-only record, committed to git")
    ap.add_argument("--no-jsonl", action="store_true",
                    help="skip the committed record (local experiments only)")
    ap.add_argument("--no-warehouse", action="store_true",
                    help="write only the committed record. CI uses this: the warehouse "
                         "there is a throwaway copy of a release asset, and writing to it "
                         "would imply a durability the runner does not have.")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    if args.no_warehouse:
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        ensure_schema(conn)
    else:
        if not args.db.exists():
            logger.error("warehouse not found at %s", args.db)
            return 2
        conn = sqlite3.connect(args.db)
        conn.row_factory = sqlite3.Row
        ensure_schema(conn)

    if args.stats:
        n = conn.execute("SELECT COUNT(*) FROM odds_snapshots").fetchone()[0]
        m = conn.execute("SELECT COUNT(DISTINCT match_id) FROM odds_snapshots").fetchone()[0]
        print(f"snapshots: {n:,} across {m:,} fixtures")
        for r in conn.execute(
            """SELECT bookmaker, COUNT(*) n, MIN(captured_at) first, MAX(captured_at) last
               FROM odds_snapshots GROUP BY bookmaker ORDER BY n DESC"""
        ):
            print(f"  {r['bookmaker']:<16} {r['n']:>7,}  {r['first'][:16]} .. {r['last'][:16]}")
        print("\nfixtures with a movable history (2+ snapshots):")
        for r in conn.execute(
            """SELECT match_id, COUNT(*) n, MIN(odds_home) lo, MAX(odds_home) hi
               FROM odds_snapshots GROUP BY match_id HAVING n > 1
               ORDER BY n DESC LIMIT 8"""
        ):
            print(f"  {r['match_id']:<34} {r['n']:>3} snapshots  home {r['lo']:.2f}..{r['hi']:.2f}")
        return 0

    comps = [c.strip() for c in args.leagues.split(",") if c.strip()]
    now = datetime.now(timezone.utc)
    start = now.strftime("%Y%m%d")
    end = (now + timedelta(days=args.days_ahead)).strftime("%Y%m%d")
    captured_at = now.isoformat()

    # The warehouse is gitignored and lives on a release asset that three
    # workflows overwrite; a snapshot written only there is one release upload
    # away from being lost, and a lost price cannot be re-fetched — the market
    # has moved on. So the durable record is a committed JSONL, and the
    # warehouse copy is a convenience for local analysis.
    jsonl_path = None
    if not args.no_jsonl:
        args.jsonl_dir.mkdir(parents=True, exist_ok=True)
        jsonl_path = args.jsonl_dir / f"snapshots-{now.strftime('%Y-%m')}.jsonl"

    cl = httpx.Client(timeout=30, headers=UA, follow_redirects=True)
    stored = fixtures = 0
    lines: List[str] = []
    try:
        for comp in comps:
            try:
                sb = cl.get(f"{ESPN}/{comp}/scoreboard?dates={start}-{end}&limit=200").json()
            except Exception as exc:  # noqa: BLE001
                logger.warning("%s scoreboard failed: %s", comp, exc)
                continue
            time.sleep(args.delay)
            events = sb.get("events") or []
            logger.info("%s: %d upcoming fixtures", comp, len(events))
            for ev in events:
                competition = (ev.get("competitions") or [{}])[0]
                prices = parse_odds(competition)
                if not prices:
                    continue
                kickoff = ev.get("date")
                mtk = None
                if kickoff:
                    try:
                        ko = datetime.fromisoformat(kickoff.replace("Z", "+00:00"))
                        mtk = round((ko - now).total_seconds() / 60.0, 1)
                    except ValueError:
                        mtk = None
                mid = match_id_for(comp, str(ev.get("id")))
                fixtures += 1
                for pr in prices:
                    h, d, a = pr["home"], pr["draw"], pr["away"]
                    overround = round(1 / h + 1 / d + 1 / a, 5)
                    conn.execute(
                        """INSERT OR IGNORE INTO odds_snapshots
                           (match_id, bookmaker, captured_at, kickoff_utc,
                            minutes_to_kickoff, odds_home, odds_draw, odds_away,
                            odds_home_open, odds_away_open, overround, source)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'espn')""",
                        (mid, pr["book"], captured_at, kickoff, mtk, h, d, a,
                         pr["home_open"], pr["away_open"], overround),
                    )
                    lines.append(json.dumps({
                        "match_id": mid, "competition_id": comp, "bookmaker": pr["book"],
                        "captured_at": captured_at, "kickoff_utc": kickoff,
                        "minutes_to_kickoff": mtk,
                        "odds_home": h, "odds_draw": d, "odds_away": a,
                        "odds_home_open": pr["home_open"], "odds_away_open": pr["away_open"],
                        "overround": overround, "source": "espn",
                    }, separators=(",", ":")))
                    stored += 1
            conn.commit()
    finally:
        cl.close()
        conn.commit()

    if jsonl_path is not None and lines:
        with jsonl_path.open("a", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")
        logger.info("appended %d lines to %s", len(lines), jsonl_path)

    logger.info("captured %d prices across %d fixtures at %s", stored, fixtures, captured_at)
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
