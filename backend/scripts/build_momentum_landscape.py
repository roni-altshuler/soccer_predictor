"""Build committed momentum-landscape artifacts for the 3D match reconstructions.

This is the data half of the ``/reconstructions`` showcase. It turns a full
open-event stream for a single famous match into a compact, committed artifact
that the front-end renders as a sweeping 3D momentum wave. Our own warehouse
only stores goal/card minutes, so a real momentum-from-passes surface is only
possible for matches with a full event feed — hence a curated showcase of a
handful of iconic finals rather than a per-fixture feature.

Source
------
Open event data (CC BY-NC — educational use). Raw match event JSON is streamed
into a gitignored cache (``backend/data/cache/statsbomb/``) and never committed
(the raw files are ~3-4 MB each and their redistribution is not ours to make).
The committed output is the small derived artifact only. Anything published
from this data must carry a visible "Data: StatsBomb" credit — see
``dataCredit`` in the artifact and the credit line on the showcase route.

What the landscape measures
---------------------------
For every on-ball possession event we compute a *threat contribution* and place
it on a fixed pitch frame from the home team's point of view (home attacks
toward x = 120). Because the source records every location from the acting
team's own attacking direction (x = 120 is always the goal that team attacks),
we flip the away team's x to a shared home frame: ``x_home = 120 - x_away``.

Per event ``e`` performed by team ``T`` at end-location ``(xe, ye)`` (the pass /
carry / dribble end, or the shot itself), the contribution is::

    base(type)  x  danger(xe, ye)  +  progressive_bonus  +  xg_bonus

with fully explicit, non-tunable weights:

  base(type):   Pass 1.0 · Carry 0.6 · Dribble 0.8 · Shot 3.0
                (other event types carry no threat and are ignored)

  danger(xe):   how deep into the attack the ball ended, in *attacker-relative*
                coordinates (0 = own goal line, 120 = attacked goal):
                  xe < 60                     -> 0.5   (own half / build-up)
                  60 <= xe < 80               -> 1.0   (entering midfield)
                  80 <= xe < 102              -> 2.0   (final third, wide/edge)
                  xe >= 102 and 18 <= ye < 62 -> 3.5   (penalty area)
                  xe >= 102 and ye outside box-> 2.0   (byline, wide of box)

  progressive:  +0.5 when the action carried the ball >= 15 units toward the
                attacked goal and ended at xe >= 60 (a line-breaking advance).

  xg_bonus:     + statsbomb_xg * 6.0 on shots (a 0.5 xG chance adds 3.0 on top
                of the shot base). Nothing else uses xG.

Signing & zones
---------------
Home contributions are positive, away negative. Each event is dropped into one
of three home-frame pitch zones by its home-frame end-x:

    [0, 40) Defensive third · [40, 80) Middle third · [80, 120] Attacking third

``zoneIntensities[z]`` for a time bin is the signed sum of contributions that
ended in zone ``z`` during that bin; ``momentum`` is their sum. So a positive,
up-and-green landscape means the home side is creating threat; away pressure
near the home goal shows as a negative (red) dip in the home *defensive* zone.

Time axis
---------
Match time is binned into fixed 30-second bins from kick-off across regulation,
stoppage and extra time (periods 1-4). The penalty shootout (period 5) is *not*
open-play momentum and is excluded from the wave; its result is recorded in the
final-score note instead. Every bin value traces to real events — there is no
smoothing, no interpolation and no invented continuity beyond honest binning.

Normalisation
-------------
All bin values are scaled by a single per-match divisor ``scaleReference`` =
the max absolute value across every bin's ``momentum`` and every
``zoneIntensity``. This is a pure linear rescale into [-1, 1]; the raw divisor
is emitted so the mapping is fully reversible. Values are rounded to 4 dp.

Determinism
-----------
Same events in -> byte-identical artifact out: events are processed in file
order (sums are order-independent), floats are rounded to fixed precision, key
ordering is fixed, and no timestamp or RNG enters the output.

Usage
-----
    python -m backend.scripts.build_momentum_landscape          # build all
    python -m backend.scripts.build_momentum_landscape --slug wc2022-final-arg-fra
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CACHE_DIR = REPO_ROOT / "backend" / "data" / "cache" / "statsbomb"
OUT_DIR = REPO_ROOT / "public" / "momentum"

RAW_EVENTS_URL = "https://raw.githubusercontent.com/statsbomb/open-data/master/data/events/{match_id}.json"

BIN_SECONDS = 30
PITCH_LENGTH = 120.0
BOX_X = 102.0
BOX_Y_MIN, BOX_Y_MAX = 18.0, 62.0

BASE_WEIGHT = {"Pass": 1.0, "Carry": 0.6, "Dribble": 0.8, "Shot": 3.0}
ZONE_NAMES = ["Defensive third", "Middle third", "Attacking third"]


@dataclass(frozen=True)
class Showcase:
    slug: str
    match_id: int
    competition: str
    stage: str
    gender: str  # 'M' | 'F'


SHOWCASES: list[Showcase] = [
    Showcase(
        slug="wc2022-final-arg-fra",
        match_id=3869685,
        competition="FIFA World Cup 2022",
        stage="Final",
        gender="M",
    ),
    Showcase(
        slug="wwc2023-final-esp-eng",
        match_id=3906390,
        competition="Women's World Cup 2023",
        stage="Final",
        gender="F",
    ),
]


# ---------------------------------------------------------------------------
# Fetch (polite, cached, never committed)
# ---------------------------------------------------------------------------
def load_events(match_id: int) -> list[dict]:
    """Return the raw event list, downloading into the gitignored cache once."""
    cached = CACHE_DIR / f"{match_id}.json"
    if not cached.exists():
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        url = RAW_EVENTS_URL.format(match_id=match_id)
        print(f"  downloading events for {match_id} ...")
        req = urllib.request.Request(url, headers={"User-Agent": "pitchverse-reconstruction-builder"})
        with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310 (trusted host)
            cached.write_bytes(resp.read())
    return json.loads(cached.read_text())


# ---------------------------------------------------------------------------
# Geometry / weighting helpers (pure)
# ---------------------------------------------------------------------------
def danger(xe: float, ye: float) -> float:
    """Positional danger of an end-location in attacker-relative coordinates."""
    if xe < 60.0:
        return 0.5
    if xe < 80.0:
        return 1.0
    if xe < BOX_X:
        return 2.0
    # Deep (xe >= 102): penalty area is more dangerous than the byline corners.
    if BOX_Y_MIN <= ye < BOX_Y_MAX:
        return 3.5
    return 2.0


def end_location(ev: dict) -> tuple[float, float] | None:
    """Where the ball ended for this event (pass/carry/dribble end, else start)."""
    t = ev["type"]["name"]
    if t == "Pass":
        loc = ev.get("pass", {}).get("end_location")
    elif t == "Carry":
        loc = ev.get("carry", {}).get("end_location")
    elif t == "Shot":
        loc = ev.get("location")  # the shot's own location is the threat point
    else:
        loc = ev.get("location")
    if not loc or len(loc) < 2:
        loc = ev.get("location")
    if not loc or len(loc) < 2:
        return None
    return float(loc[0]), float(loc[1])


def contribution(ev: dict) -> float:
    """Threat contribution of one event (>= 0), in attacker-relative terms."""
    t = ev["type"]["name"]
    base = BASE_WEIGHT.get(t)
    if base is None:
        return 0.0
    # Passes/dribbles must be completed to count as threat (an incomplete pass
    # created nothing). A pass with no 'outcome' is a completion in this feed.
    if t == "Pass" and ev.get("pass", {}).get("outcome"):
        return 0.0
    if t == "Dribble" and ev.get("dribble", {}).get("outcome", {}).get("name") == "Incomplete":
        return 0.0
    end = end_location(ev)
    if end is None:
        return 0.0
    xe, ye = end
    val = base * danger(xe, ye)
    start = ev.get("location")
    if start and len(start) >= 2:
        if (xe - float(start[0])) >= 15.0 and xe >= 60.0:
            val += 0.5
    if t == "Shot":
        xg = ev.get("shot", {}).get("statsbomb_xg")
        if isinstance(xg, (int, float)):
            val += float(xg) * 6.0
    return val


def zone_index(x_home: float) -> int:
    if x_home < 40.0:
        return 0
    if x_home < 80.0:
        return 1
    return 2


# ---------------------------------------------------------------------------
# Build one landscape
# ---------------------------------------------------------------------------
def card_type(ev: dict) -> str | None:
    if ev["type"]["name"] == "Bad Behaviour":
        card = ev.get("bad_behaviour", {}).get("card", {}).get("name")
    elif ev["type"]["name"] == "Foul Committed":
        card = ev.get("foul_committed", {}).get("card", {}).get("name")
    else:
        return None
    if not card:
        return None
    return "red" if "Red" in card else "yellow"


def clean_name(name: str) -> str:
    return name.replace(" Women's", "").strip()


# Source records full legal names ("Lionel Andrés Messi Cuccittini"); a marker
# needs the name a viewer recognises. This is a pure display alias — the same
# person, just the common form. Uncurated players fall back to their full name.
DISPLAY_ALIASES = {
    "Lionel Andrés Messi Cuccittini": "Messi",
    "Ángel Fabián Di María Hernández": "Di María",
    "Kylian Mbappé Lottin": "Mbappé",
    "Olga Carmona García": "Carmona",
}


def short_player(name: str) -> str:
    """A readable name for a marker: the common alias, else the full name."""
    collapsed = " ".join(name.split())
    return DISPLAY_ALIASES.get(collapsed, collapsed)


def build_landscape(show: Showcase, match_meta: dict) -> dict:
    events = load_events(show.match_id)

    home_name = match_meta["home_team"]["home_team_name"]
    away_name = match_meta["away_team"]["away_team_name"]

    def side(team_name: str) -> int:
        return 1 if team_name == home_name else -1

    # ---- accumulate signed threat into (bin, zone) --------------------------
    open_play = [e for e in events if e["period"] <= 4]
    max_sec = 0
    for e in open_play:
        max_sec = max(max_sec, e["minute"] * 60 + e["second"])
    n_bins = max_sec // BIN_SECONDS + 1

    zone_grid = [[0.0, 0.0, 0.0] for _ in range(n_bins)]  # signed per zone

    for e in open_play:
        c = contribution(e)
        if c == 0.0:
            continue
        end = end_location(e)
        if end is None:
            continue
        s = side(e["team"]["name"])
        x_home = end[0] if s == 1 else PITCH_LENGTH - end[0]
        z = zone_index(x_home)
        b = (e["minute"] * 60 + e["second"]) // BIN_SECONDS
        if 0 <= b < n_bins:
            zone_grid[b][z] += s * c

    # ---- normalise by a single per-match divisor ----------------------------
    ref = 0.0
    for row in zone_grid:
        ref = max(ref, abs(sum(row)), *(abs(v) for v in row))
    if ref <= 0.0:
        ref = 1.0

    bins = []
    for i, row in enumerate(zone_grid):
        t_min = round((i * BIN_SECONDS) / 60.0, 4)
        zi = [round(v / ref, 4) for v in row]
        momentum = round(sum(row) / ref, 4)
        bins.append({"t": t_min, "momentum": momentum, "zoneIntensities": zi})

    # ---- key events (goals / cards / subs) ----------------------------------
    key_events: list[dict] = []
    home_goals = away_goals = 0
    for e in open_play:
        etype = e["type"]["name"]
        t_min = round((e["minute"] * 60 + e["second"]) / 60.0, 4)
        team = "home" if side(e["team"]["name"]) == 1 else "away"
        player = e.get("player", {}).get("name", "")
        if etype == "Shot" and e.get("shot", {}).get("outcome", {}).get("name") == "Goal":
            if team == "home":
                home_goals += 1
            else:
                away_goals += 1
            detail = e.get("shot", {}).get("type", {}).get("name")
            key_events.append({
                "t": t_min, "minute": e["minute"], "type": "goal", "team": team,
                "player": short_player(player),
                "detail": "Penalty" if detail == "Penalty" else "",
                "scoreAfter": {"home": home_goals, "away": away_goals},
            })
        elif etype == "Own Goal Against":
            # Own goal credited to the opponent's tally.
            if team == "home":
                away_goals += 1
            else:
                home_goals += 1
            key_events.append({
                "t": t_min, "minute": e["minute"], "type": "goal",
                "team": "away" if team == "home" else "home",
                "player": short_player(player), "detail": "Own goal",
                "scoreAfter": {"home": home_goals, "away": away_goals},
            })
        else:
            card = card_type(e)
            if card:
                key_events.append({
                    "t": t_min, "minute": e["minute"], "type": "card", "team": team,
                    "player": short_player(player), "detail": f"{card.title()} card",
                })
            elif etype == "Substitution":
                key_events.append({
                    "t": t_min, "minute": e["minute"], "type": "sub", "team": team,
                    "player": short_player(player), "detail": "Substitution",
                })
    key_events.sort(key=lambda k: (k["t"], 0 if k["type"] == "goal" else 1))

    # ---- integrity: reconstructed open-play score must match the meta -------
    meta_home = match_meta["home_score"]
    meta_away = match_meta["away_score"]
    if (home_goals, away_goals) != (meta_home, meta_away):
        raise SystemExit(
            f"[{show.slug}] reconstructed score {home_goals}-{away_goals} != "
            f"official {meta_home}-{meta_away}; refusing to emit a wrong artifact"
        )

    # ---- penalty shootout note (period 5), if any ---------------------------
    pens = [e for e in events if e["period"] == 5 and e["type"]["name"] == "Shot"]
    score_note = ""
    if pens:
        ph = sum(1 for e in pens if side(e["team"]["name"]) == 1 and e.get("shot", {}).get("outcome", {}).get("name") == "Goal")
        pa = sum(1 for e in pens if side(e["team"]["name"]) == -1 and e.get("shot", {}).get("outcome", {}).get("name") == "Goal")
        winner = clean_name(home_name if ph > pa else away_name)
        score_note = f"{winner} won {max(ph, pa)}-{min(ph, pa)} on penalties"

    return {
        "slug": show.slug,
        "matchId": show.match_id,
        "competition": show.competition,
        "stage": show.stage,
        "date": match_meta.get("match_date", ""),
        "gender": show.gender,
        "dataCredit": "StatsBomb",
        "binSeconds": BIN_SECONDS,
        "zones": ZONE_NAMES,
        "scaleReference": round(ref, 4),
        "home": {"team": clean_name(home_name), "isNational": True},
        "away": {"team": clean_name(away_name), "isNational": True},
        "finalScore": {"home": meta_home, "away": meta_away, "note": score_note},
        "bins": bins,
        "keyEvents": key_events,
    }


def load_match_meta(show: Showcase) -> dict:
    """Fetch the match row so team names / score / date come from source, not us."""
    comp_season = {"M": (43, 106), "F": (72, 107)}[show.gender]
    url = (
        "https://raw.githubusercontent.com/statsbomb/open-data/master/data/matches/"
        f"{comp_season[0]}/{comp_season[1]}.json"
    )
    cache = CACHE_DIR / f"matches_{comp_season[0]}_{comp_season[1]}.json"
    if not cache.exists():
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(url, headers={"User-Agent": "pitchverse-reconstruction-builder"})
        with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310
            cache.write_bytes(resp.read())
    for m in json.loads(cache.read_text()):
        if m["match_id"] == show.match_id:
            return m
    raise SystemExit(f"match {show.match_id} not found in {url}")


def emit(artifact: dict) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"{artifact['slug']}.json"
    # Compact + deterministic. A trailing newline keeps the file POSIX-clean.
    out.write_text(json.dumps(artifact, separators=(",", ":"), ensure_ascii=False) + "\n")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--slug", help="build only this showcase slug")
    args = ap.parse_args()

    targets = [s for s in SHOWCASES if not args.slug or s.slug == args.slug]
    if not targets:
        print(f"no showcase matches slug={args.slug!r}", file=sys.stderr)
        return 2

    for show in targets:
        print(f"building {show.slug} (match {show.match_id}) ...")
        meta = load_match_meta(show)
        artifact = build_landscape(show, meta)
        out = emit(artifact)
        kb = out.stat().st_size / 1024
        n_ev = len(artifact["keyEvents"])
        print(
            f"  wrote {out.relative_to(REPO_ROOT)}  "
            f"({kb:.1f} KB, {len(artifact['bins'])} bins, {n_ev} key events, "
            f"score {artifact['finalScore']['home']}-{artifact['finalScore']['away']}"
            f"{'; ' + artifact['finalScore']['note'] if artifact['finalScore']['note'] else ''})"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
