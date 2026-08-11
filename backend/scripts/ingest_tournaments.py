"""Ingest the knockout tournaments the warehouse never had.

What was missing and why it matters
-----------------------------------
The warehouse held five tournaments: Champions League, Europa League, World
Cup, Euros, Copa América. That is a European-plus-South-American-international
view of knockout football and it leaves out most of the world's brackets —
Libertadores, Sudamericana, the Africa Cup of Nations, the Asian Cup, the Gold
Cup, the Nations League, the CONCACAF Champions Cup, the Conference League and
the Club World Cup.

Those tournaments are not decoration. The tournament model is trained on
knockout TIES, and ties are scarce: a Champions League season produces about
thirty of them. Nine more competitions roughly doubles the sample, and — more
usefully — it breaks the correlation, because a model trained only on UEFA
brackets has learned "the richer club advances" and nothing else.

A note on FBref
---------------
FBref is the obvious source and it is genuinely free to a person with a
browser. It is not available to this machine: Sports Reference answers
datacentre IPs with HTTP 403 (re-verified 2026-08-11 against the Champions
League page, with a browser User-Agent). ESPN answers the same questions,
carries the shootout results FBref does not expose in its match tables, and is
already this project's spine. Where FBref would add something ESPN cannot —
per-match xG before 2017 — that gap is recorded rather than papered over.

Season and phase both come from ESPN's own `event.season` block, so a
tournament that straddles a new year lands in one season rather than two.

    python3 -m backend.scripts.ingest_tournaments --competitions conmebol.libertadores
    python3 -m backend.scripts.ingest_tournaments --all --since 2005

Writes to `matches`, `teams`, `competitions`.
"""
from __future__ import annotations

import argparse
import logging
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import httpx

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services.data.team_resolver import TeamResolver  # noqa: E402
from backend.services.data.warehouse import MatchRow, Warehouse  # noqa: E402

logger = logging.getLogger("ingest_tournaments")

ESPN = "https://site.web.api.espn.com/apis/site/v2/sports/soccer"
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/124 Safari/537.36"}


@dataclass(frozen=True)
class Tournament:
    espn: str            # ESPN slug, verified live before being added here
    competition_id: str  # warehouse id
    name: str
    confederation: str
    tier: int            # 0 = national team, 1 = top club continental
    since: int
    gender: str = "M"


# Every slug below was probed against the live scoreboard on 2026-08-11 and
# returned events. Four plausible guesses did NOT and are absent rather than
# left in to fail quietly: afc.asiancup, uefa.conference.league,
# uefa.europa.conference, uefa.conf.
TOURNAMENTS: Tuple[Tournament, ...] = (
    Tournament("conmebol.libertadores", "conmebol.libertadores",
               "Copa Libertadores", "CONMEBOL", 1, 2005),
    Tournament("conmebol.sudamericana", "conmebol.sudamericana",
               "Copa Sudamericana", "CONMEBOL", 1, 2005),
    Tournament("caf.nations", "caf.nations",
               "Africa Cup of Nations", "CAF", 0, 2004),
    Tournament("afc.asian.cup", "afc.asian",
               "AFC Asian Cup", "AFC", 0, 2004),
    Tournament("concacaf.gold", "concacaf.gold",
               "CONCACAF Gold Cup", "CONCACAF", 0, 2005),
    Tournament("concacaf.champions", "concacaf.champions",
               "CONCACAF Champions Cup", "CONCACAF", 1, 2009),
    Tournament("uefa.nations", "uefa.nations",
               "UEFA Nations League", "UEFA", 0, 2018),
    Tournament("uefa.europa.conf", "uefa.conference",
               "UEFA Conference League", "UEFA", 1, 2021),
    Tournament("fifa.cwc", "fifa.cwc",
               "FIFA Club World Cup", "FIFA", 1, 2005),
)

BY_ID: Dict[str, Tournament] = {t.competition_id: t for t in TOURNAMENTS}


def _to_int(v) -> Optional[int]:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _to_float(v) -> Optional[float]:
    try:
        f = float(v)
        return f if f == f else None
    except (TypeError, ValueError):
        return None


def _stats(competitor: dict) -> Dict[str, Optional[float]]:
    out: Dict[str, Optional[float]] = {}
    for s in competitor.get("statistics") or []:
        name = s.get("name")
        if name:
            out[name] = _to_float(s.get("displayValue"))
    return out


def _cards(competition: dict, team_id: str) -> Tuple[int, int]:
    yellow = red = 0
    for d in competition.get("details") or []:
        if str((d.get("team") or {}).get("id")) != str(team_id):
            continue
        t = (d.get("type") or {}).get("text", "").lower()
        if "yellow" in t:
            yellow += 1
        elif "red" in t:
            red += 1
    return yellow, red


def parse_event(event: dict, competition_id: str, resolver: TeamResolver,
                gender: str) -> Optional[MatchRow]:
    comps = event.get("competitions") or []
    if not comps:
        return None
    comp = comps[0]
    if not ((comp.get("status") or {}).get("type") or {}).get("completed"):
        return None

    sides = {c.get("homeAway"): c for c in comp.get("competitors") or []}
    home, away = sides.get("home"), sides.get("away")
    if not home or not away:
        return None

    hs, as_ = _to_int(home.get("score")), _to_int(away.get("score"))
    if hs is None or as_ is None:
        return None

    hname = (home.get("team") or {}).get("displayName")
    aname = (away.get("team") or {}).get("displayName")
    if not hname or not aname:
        return None

    season = _to_int((event.get("season") or {}).get("year"))
    date = event.get("date")
    if season is None or not date:
        return None
    # ESPN's scoreboard dates are '2024-11-30T20:00Z'; the warehouse stores
    # full ISO-8601 with an offset.
    if date.endswith("Z"):
        date = date[:-1] + ":00+00:00" if len(date) == 17 else date[:-1] + "+00:00"

    hstat, astat = _stats(home), _stats(away)
    hy, hr = _cards(comp, (home.get("team") or {}).get("id", ""))
    ay, ar = _cards(comp, (away.get("team") or {}).get("id", ""))

    return MatchRow(
        match_id=f"espn_{competition_id}_{event.get('id')}",
        source="espn",
        competition_id=competition_id,
        season=season,
        date_utc=date,
        home_team_id=resolver.resolve(hname, gender=gender).team_id,
        away_team_id=resolver.resolve(aname, gender=gender).team_id,
        home_score=hs,
        away_score=as_,
        phase=(event.get("season") or {}).get("slug"),
        home_shots=hstat.get("totalShots"),
        away_shots=astat.get("totalShots"),
        home_sot=hstat.get("shotsOnTarget"),
        away_sot=astat.get("shotsOnTarget"),
        home_corners=hstat.get("wonCorners"),
        away_corners=astat.get("wonCorners"),
        home_yellows=hy, away_yellows=ay, home_reds=hr, away_reds=ar,
        attendance=_to_int(comp.get("attendance")),
        venue=(comp.get("venue") or {}).get("fullName"),
        fetched_at=datetime.now(timezone.utc).isoformat(),
    )


def fetch_year(client: httpx.Client, slug: str, year: int) -> List[dict]:
    """Quarterly windows. A whole year in one call silently truncates at the
    server's cap for a busy competition, and a truncated season looks exactly
    like a short one."""
    events: Dict[str, dict] = {}
    windows = [(f"{year}0101", f"{year}0331"), (f"{year}0401", f"{year}0630"),
               (f"{year}0701", f"{year}0930"), (f"{year}1001", f"{year}1231")]
    for start, end in windows:
        try:
            r = client.get(f"{ESPN}/{slug}/scoreboard",
                           params={"dates": f"{start}-{end}", "limit": 500})
            r.raise_for_status()
            for ev in r.json().get("events") or []:
                if ev.get("id"):
                    events[str(ev["id"])] = ev
        except Exception as exc:  # noqa: BLE001
            logger.debug("  %s %s-%s failed: %s", slug, start, end, exc)
        time.sleep(0.2)
    return list(events.values())


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--competitions", help="comma-separated warehouse ids")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--since", type=int, help="override each tournament's start year")
    ap.add_argument("--until", type=int, default=datetime.now(timezone.utc).year)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s",
                        datefmt="%H:%M:%S")
    logging.getLogger("httpx").setLevel(logging.WARNING)

    if args.competitions:
        wanted = [BY_ID[c.strip()] for c in args.competitions.split(",") if c.strip()]
    elif args.all:
        wanted = list(TOURNAMENTS)
    else:
        ap.error("pass --competitions or --all")

    wh = Warehouse()
    wh.migrate()
    resolver = TeamResolver(wh, gender_default="M")

    grand_total = 0
    for t in wanted:
        if not args.dry_run:
            wh.upsert_competition(t.competition_id, t.name, t.gender,
                                  tier=t.tier, confederation=t.confederation)
        start = max(args.since or t.since, t.since)
        logger.info("%s (%s) %d-%d", t.name, t.espn, start, args.until)
        written = 0
        with httpx.Client(headers=UA, timeout=30.0) as client:
            for year in range(start, args.until + 1):
                events = fetch_year(client, t.espn, year)
                rows = [r for r in (parse_event(e, t.competition_id, resolver, t.gender)
                                    for e in events) if r]
                if rows and not args.dry_run:
                    wh.upsert_matches(rows)
                written += len(rows)
                if events or rows:
                    logger.info("  %d: %d events -> %d completed matches",
                                year, len(events), len(rows))
        logger.info("  %s total: %d matches", t.competition_id, written)
        grand_total += written

    if resolver.near_duplicates:
        logger.warning("%d near-duplicate team names created — check "
                       "team_aliases.yml:", len(resolver.near_duplicates))
        for new, existing, score in resolver.near_duplicates[:25]:
            logger.warning("   %-32s ~ %-32s %.2f", new, existing, score)

    logger.info("wrote %d matches across %d tournaments", grand_total, len(wanted))
    wh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
