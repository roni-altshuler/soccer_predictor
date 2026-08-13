"""Record which conference each club plays in, and where the playoff line sits.

Why this is a separate, committed artifact
------------------------------------------
A projected league table assumes one table. MLS is two: a club's season is
decided by where it finishes in its own conference, and the league's 30-team
combined standing decides only the Supporters' Shield. Ranking all 30 together
and calling the top of it "the title race" would be the same category error as
projecting a single Apertura/Clausura table.

So the forecast needs to know two things it cannot derive from a fixture list:
which conference each club is in, and how many of them qualify for the
playoffs. Both are published by ESPN in its own standings payload — the
conference as a group, and the cut line as a per-team note reading
"Qualifies for MLS Cup Playoffs - Round One Best-of-3 series" (ranks 1-7) or
"- Wild Card Matches" (8-9). The cut line is READ from those notes rather than
written down here, because a hard-coded 9 is a number that stops being true
the year the format changes and nothing would say so.

Committed rather than fetched at forecast time: the season forecast must not
acquire a live dependency on a third-party endpoint that can be down, and a
conference map changes once a year. Re-run this when the league expands.

    python -m backend.scripts.build_conferences
    python -m backend.scripts.build_conferences --competition usa.1 --season 2026
"""
from __future__ import annotations

import argparse
import json
import logging
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

import httpx

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

logger = logging.getLogger("build_conferences")

OUT = ROOT / "backend" / "data" / "conferences.json"

# `site.web.api`, never `site.api`: Akamai answers the latter with 403 from
# datacentre IPs and its error page carries no CORS headers.
ESPN = "https://site.web.api.espn.com/apis/v2/sports/soccer"

# Competitions that are structurally grouped. Adding one here is a claim that
# its clubs are ranked within a group rather than in one table.
GROUPED = {
    "usa.1": {"name": "Major League Soccer",
              "qualify_label": "MLS Cup Playoffs"},
}

# A note that means "this finishing position qualifies for the post-season".
# ESPN phrases it several ways per round; what they share is the verb.
QUALIFIES = re.compile(r"\bqualif", re.I)


def _short(name: str) -> str:
    """`Eastern Conference` -> `East`."""
    return re.sub(r"\s*Conference$", "", name).strip() or name


def fetch(competition: str, season: int) -> List[Dict]:
    url = f"{ESPN}/{competition}/standings"
    r = httpx.get(url, params={"season": season}, timeout=30,
                  headers={"User-Agent": "Pitchverse/1.0"})
    r.raise_for_status()

    groups: List[Dict] = []

    def walk(node) -> None:
        if isinstance(node, dict):
            standings = node.get("standings")
            if node.get("name") and isinstance(standings, dict):
                entries = standings.get("entries") or []
                if entries:
                    groups.append({"name": node["name"], "entries": entries})
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(r.json())
    return groups


def build(competition: str, season: int) -> Dict:
    groups = fetch(competition, season)
    if len(groups) < 2:
        raise SystemExit(
            f"{competition} {season}: ESPN returned {len(groups)} group(s). "
            f"A grouped competition needs at least two; refusing to write a "
            f"conference map that would put every club in one.")

    out_groups = []
    for g in groups:
        teams, qualify = [], 0
        for entry in g["entries"]:
            teams.append(entry["team"]["displayName"])
            note = entry.get("note") or {}
            if QUALIFIES.search(str(note.get("description", ""))):
                rank = note.get("rank")
                if isinstance(rank, int):
                    qualify = max(qualify, rank)
        out_groups.append({
            "name": g["name"],
            "short": _short(g["name"]),
            "teams": sorted(teams),
            # 0 means ESPN published no qualification notes for this group —
            # recorded as unknown rather than guessed, and the page then shows
            # a conference table with no cut line rather than a wrong one.
            "qualify": qualify,
        })

    total = sum(len(g["teams"]) for g in out_groups)
    logger.info("%s %d: %s", competition, season,
                ", ".join(f"{g['short']} {len(g['teams'])} teams"
                          f"{f', top {g['qualify']} qualify' if g['qualify'] else ''}"
                          for g in out_groups))
    return {
        "season": season,
        "name": GROUPED.get(competition, {}).get("name", competition),
        "qualify_label": GROUPED.get(competition, {}).get(
            "qualify_label", "Qualifies"),
        "teams": total,
        "groups": out_groups,
    }


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--competition", action="append",
                    help="default: every competition in GROUPED")
    ap.add_argument("--season", type=int)
    ap.add_argument("--output", default=str(OUT))
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    from backend.services.prediction.historical_data import current_season

    competitions = args.competition or sorted(GROUPED)
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "ESPN standings — groups and the qualification notes on them",
        "competitions": {},
    }
    for comp in competitions:
        season = args.season or current_season("mls")
        payload["competitions"][comp] = build(comp, season)

    path = Path(args.output)
    path.write_text(json.dumps(payload, indent=2) + "\n")
    logger.info("wrote %s", path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
