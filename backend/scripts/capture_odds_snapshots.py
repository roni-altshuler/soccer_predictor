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
import math
import os
import sqlite3
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional

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
    if a == 0 or not math.isfinite(a):
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
    odds = comp.get("odds")
    if odds is not None and not isinstance(odds, list):
        raise ValueError("ESPN odds must be a list or null")
    for o in odds or []:
        # ESPN's odds array can contain nulls for a fixture it has listed but
        # not yet priced.
        if o is None:
            continue
        if not isinstance(o, dict):
            raise ValueError("ESPN odds entry must be an object or null")
        ml = o.get("moneyline") or {}
        if not isinstance(ml, dict):
            raise ValueError("ESPN moneyline must be an object")

        h = _side(ml, "home", "close") or (o.get("homeTeamOdds") or {}).get("moneyLine")
        a = _side(ml, "away", "close") or (o.get("awayTeamOdds") or {}).get("moneyLine")
        d = o.get("drawOdds")
        if isinstance(d, dict):
            d = d.get("moneyLine")

        cur = [american_to_decimal(x) for x in (h, d, a)]
        if not all(v is not None and v > 1.0 for v in cur):
            continue
        provider = o.get("provider")
        if not isinstance(provider, dict) or not isinstance(provider.get("name"), str):
            raise ValueError("ESPN priced odds are missing their bookmaker")
        book = provider["name"].strip()
        if not book:
            raise ValueError("ESPN priced odds are missing their bookmaker")
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


def fetch_events(client: httpx.Client, league: str, start: datetime,
                 days_ahead: int, delay: float) -> List[dict]:
    """Validate a complete range; retry HTTP 400 using inclusive daily dates."""
    url = f"{ESPN}/{league}/scoreboard"

    def get(dates):
        response = client.get(url, params={"dates": dates, "limit": 200})
        time.sleep(delay)
        return response

    end = start + timedelta(days=days_ahead)
    response = get(f"{start:%Y%m%d}-{end:%Y%m%d}")
    dates = ([f"{start + timedelta(days=i):%Y%m%d}" for i in range(days_ahead + 1)]
             if response.status_code == 400 else [])
    events = {}
    # Validate each response before requesting the next; never publish a
    # partial daily fallback if a later day fails.
    for day in dates or [None]:
        current = get(day) if day is not None else response
        current.raise_for_status()
        payload = current.json()
        if not isinstance(payload, dict) or not isinstance(payload.get("events"), list):
            raise ValueError(f"{league}: scoreboard must contain an events list")
        for event in payload["events"]:
            if not isinstance(event, dict):
                raise ValueError(f"{league}: event must be an object")
            eid = event.get("id")
            if isinstance(eid, bool) or not isinstance(eid, (str, int)) or not str(eid).strip():
                raise ValueError(f"{league}: event is missing its id")
            events[str(eid)] = event
    return list(events.values())


def snapshot_rows(events: List[dict], league: str, now: datetime) -> List[dict]:
    """Scheduled, priced fixtures only; unpriced fixtures remain missing."""
    rows = {}
    for event in events:
        competitions = event.get("competitions")
        if not isinstance(competitions, list) or not competitions or not isinstance(competitions[0], dict):
            raise ValueError(f"{league}: event {event['id']} has no competition")
        competition = competitions[0]
        status = competition.get("status") or event.get("status")
        if not isinstance(status, dict) or not isinstance(status.get("type"), dict):
            raise ValueError(f"{league}: event {event['id']} has no status")
        kind = status["type"]
        if kind.get("state") not in {"pre", "in", "post"} and not kind.get("name"):
            raise ValueError(f"{league}: event {event['id']} has invalid status")
        if kind.get("state") in {"in", "post"} or kind.get("completed") is True:
            continue
        if kind.get("state") != "pre" and kind.get("name") != "STATUS_SCHEDULED":
            continue
        kickoff = event.get("date")
        if not isinstance(kickoff, str):
            raise ValueError(f"{league}: event {event['id']} has no kickoff")
        ko = datetime.fromisoformat(kickoff.replace("Z", "+00:00"))
        if ko.tzinfo is None:
            raise ValueError(f"{league}: event {event['id']} has a naive kickoff")
        if ko <= now:
            continue
        for price in parse_odds(competition):
            mid = match_id_for(league, str(event["id"]))
            h, d, a = price["home"], price["draw"], price["away"]
            rows[(mid, price["book"])] = {
                "match_id": mid, "competition_id": league, "bookmaker": price["book"],
                "captured_at": now.isoformat(), "kickoff_utc": kickoff,
                "minutes_to_kickoff": round((ko - now).total_seconds() / 60.0, 1),
                "odds_home": h, "odds_draw": d, "odds_away": a,
                "odds_home_open": price["home_open"], "odds_away_open": price["away_open"],
                "overround": round(1 / h + 1 / d + 1 / a, 5), "source": "espn",
            }
    return list(rows.values())


def persist_rows(conn: sqlite3.Connection, rows: List[dict], path: Optional[Path]) -> None:
    """One SQLite transaction and atomic JSONL replacement after batch validation.

    The caller/workflow serializes writers. A retained copy of the previous
    file also lets a failed SQLite commit restore the durable record.
    """
    if not rows:
        return
    staged = backup = None
    published = False
    try:
        if path is not None:
            path.parent.mkdir(parents=True, exist_ok=True)
            previous = path.read_bytes() if path.exists() else b""
            with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as fh:
                staged = Path(fh.name)
                fh.write(previous)
                if previous and not previous.endswith(b"\n"):
                    fh.write(b"\n")
                for row in rows:
                    fh.write((json.dumps(row, separators=(",", ":"), allow_nan=False) + "\n").encode())
                fh.flush()
                os.fsync(fh.fileno())
            if path.exists():
                with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as fh:
                    backup = Path(fh.name)
                    fh.write(previous)
        with conn:
            for row in rows:
                conn.execute(
                    """INSERT OR IGNORE INTO odds_snapshots
                       (match_id, bookmaker, captured_at, kickoff_utc,
                        minutes_to_kickoff, odds_home, odds_draw, odds_away,
                        odds_home_open, odds_away_open, overround, source)
                       VALUES (:match_id, :bookmaker, :captured_at, :kickoff_utc,
                               :minutes_to_kickoff, :odds_home, :odds_draw, :odds_away,
                               :odds_home_open, :odds_away_open, :overround, :source)""", row,
                )
            if path is not None:
                os.replace(staged, path)
                published = True
    except Exception:
        if published:
            if backup is not None:
                os.replace(backup, path)
            else:
                path.unlink()
        raise
    finally:
        for temporary in (staged, backup):
            if temporary is not None:
                temporary.unlink(missing_ok=True)


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

    if args.days_ahead < 0 or args.days_ahead > 31 or args.delay < 0:
        ap.error("days-ahead must be between 0 and 31 and delay must be non-negative")
    comps = list(dict.fromkeys(c.strip() for c in args.leagues.split(",") if c.strip()))
    if not comps:
        ap.error("at least one league is required")
    now = datetime.now(timezone.utc)
    path = None if args.no_jsonl else args.jsonl_dir / f"snapshots-{now:%Y-%m}.jsonl"
    rows = []
    try:
        with httpx.Client(timeout=30, headers=UA, follow_redirects=True) as client:
            for league in comps:
                events = fetch_events(client, league, now, args.days_ahead, args.delay)
                prices = snapshot_rows(events, league, now)
                logger.info("%s: %d events, %d prices", league, len(events), len(prices))
                rows.extend(prices)
        persist_rows(conn, rows, path)
    except Exception as exc:
        logger.error("odds capture failed; batch not published: %s", exc)
        return 1
    finally:
        conn.close()
    fixtures = len({row["match_id"] for row in rows})
    logger.info("captured %d prices across %d fixtures at %s", len(rows), fixtures, now.isoformat())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
