"""Collect a club crest for every team the site publishes.

Why a committed map rather than a lookup
-----------------------------------------
A crest is the fastest way a reader finds their team in a table — faster than
reading twenty names — which is why every scoreboard product leads with them.
But the club identities in this repo are normalised names (`arsenal`,
`red bull new york`), and no image URL follows from that string.

So the map is built once, offline, against ESPN's own team list per
competition, and keyed by exactly the same `norm_team` the forecast keys its
tables by. That means a crest can only ever attach to a club the forecast
already recognises: a name that does not resolve gets no crest and the UI
falls back to a monogram, rather than a confidently wrong badge on the wrong
club.

Refusing the ambiguous case matters here. Two clubs in one competition that
normalise to the same string would silently overwrite each other, so the
second one drops the entry instead.

    python -m backend.scripts.build_team_crests
    python -m backend.scripts.build_team_crests --competition eng.1
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

import httpx

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

logger = logging.getLogger("build_team_crests")

OUT = ROOT / "src" / "data" / "teamCrests.json"

# `site.web.api`, never `site.api` — Akamai 403s the latter from datacentres.
ESPN = "https://site.web.api.espn.com/apis/site/v2/sports/soccer"


# Two competitions whose warehouse id is not the id ESPN serves them under.
# The map is keyed by the warehouse id, because that is what the pages ask for.
ESPN_ID = {
    "uefa.conference": "uefa.europa.conf",
}


def fetch(competition: str) -> List[Dict]:
    espn_id = ESPN_ID.get(competition, competition)
    r = httpx.get(f"{ESPN}/{espn_id}/teams", timeout=30,
                  headers={"User-Agent": "Pitchverse/1.0"})
    if r.status_code == 404:
        # Not every competition has a club list — the national-team ones never
        # do. A competition without crests is a competition whose rows fall
        # back to monograms, not a reason to abandon the other thirteen.
        logger.warning("%s: ESPN has no team list (404) — no crests", competition)
        return []
    r.raise_for_status()
    payload = r.json()
    try:
        return payload["sports"][0]["leagues"][0]["teams"]
    except (KeyError, IndexError):
        logger.warning("%s: unexpected payload shape", competition)
        return []


def build(competitions: List[str]) -> Dict[str, Dict[str, str]]:
    from backend.scripts.build_canonical import norm_team

    out: Dict[str, Dict[str, str]] = {}
    for comp in competitions:
        entries = fetch(comp)
        crests: Dict[str, str] = {}
        refused = set()
        for entry in entries:
            team = entry.get("team") or {}
            logo = (team.get("logos") or [{}])[0].get("href")
            if not logo:
                continue
            # Every spelling ESPN offers, so a table keyed on the short name
            # resolves as readily as one keyed on the full one.
            for spelling in (team.get("displayName"), team.get("name"),
                             team.get("shortDisplayName")):
                key = norm_team(spelling or "")
                if not key or key in refused:
                    continue
                if key in crests and crests[key] != logo:
                    # One normalised name, two clubs. Neither gets a crest.
                    del crests[key]
                    refused.add(key)
                    logger.warning("%s: %r means two clubs — no crest for "
                                   "either", comp, key)
                    continue
                crests[key] = logo
        # ESPN's own spellings are not the ones on the page. The projected
        # table is keyed by FBref names — `Manchester Utd`, `Köln`, `Inter` —
        # and normalising those does not reach `manchester united`,
        # `cologne`, `inter milan`. The canonical layer already resolved that
        # gap through the fixture graph, so reuse its answer rather than
        # guessing at the strings: every FBref spelling that resolves to a
        # crested warehouse club inherits its crest.
        crests.update(_fbref_spellings(comp, crests))

        out[comp] = crests
        logger.info("%s: %d clubs, %d name spellings mapped",
                    comp, len(entries), len(crests))
    return out


def _fbref_spellings(competition: str,
                     crests: Dict[str, str]) -> Dict[str, str]:
    canonical = ROOT / "backend" / "data" / "canonical.duckdb"
    if not canonical.exists():
        logger.info("no canonical layer — crests keyed on ESPN spellings only")
        return {}
    try:
        import duckdb

        con = duckdb.connect(str(canonical), read_only=True)
        rows = con.execute(
            "SELECT fb_norm, wh_norm FROM team_aliases WHERE competition_id = ?",
            [competition]).fetchall()
        con.close()
    except Exception as exc:  # noqa: BLE001
        logger.warning("could not read fixture-graph aliases: %s", exc)
        return {}
    return {fb: crests[wh] for fb, wh in rows
            if wh in crests and fb not in crests}


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--competition", action="append",
                    help="default: every league the forecast serves")
    ap.add_argument("--output", default=str(OUT))
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    from backend.scripts.forecast_season import LEAGUES

    # The tournaments page shows club competitions too, and those clubs are
    # mostly not in any served league — a Libertadores tie is Flamengo against
    # Liga de Quito. National-team competitions are deliberately absent: ESPN
    # has no club list for them, and a country is identified by its name.
    club_tournaments = [
        "uefa.champions", "uefa.europa", "uefa.conference",
        "conmebol.libertadores", "conmebol.sudamericana",
    ]
    competitions = args.competition or sorted(set(LEAGUES) | set(club_tournaments))
    crests = build(competitions)

    path = Path(args.output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "ESPN team lists, keyed by the same norm_team the forecast uses",
        "crests": crests,
    }, indent=1, sort_keys=True) + "\n")
    total = sum(len(v) for v in crests.values())
    logger.info("wrote %s (%d competitions, %d keys)", path, len(crests), total)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
