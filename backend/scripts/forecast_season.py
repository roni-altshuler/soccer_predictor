"""Train on everything played, forecast everything not yet played.

This is the production path. It is deliberately the same code that was
measured: `FeatureState` from `train_layered`, the ratings+form feature set
that won the layered ablation (Brier .59303, ECE .0099), and Dixon-Coles for
the scoreline distribution. Nothing here is a second implementation of a
measured thing — a serving path that re-implements its own features is how
this repo previously shipped a model that saw zeros where training saw prices.

One model, three outputs, no disagreement
-----------------------------------------
The 1X2 head and the goal model are different families and they will not agree
by accident. Showing "home 52%" next to a scoreline grid that implies 48% is
the kind of incoherence that makes a page untrustworthy, so they are
reconciled rather than displayed side by side:

  1. Dixon-Coles gives (lambda_home, lambda_away) and the low-score tau.
  2. The logistic gives the 1X2 that was actually measured best.
  3. Solve for scalars (a, b) such that the scoreline matrix built from
     (a*lambda_home, b*lambda_away) reproduces the logistic's home and away
     probabilities.

The result is ONE object — expected goals, a scoreline matrix, and a 1X2 —
all internally consistent, with the 1X2 equal to the measured-best forecast.

Leakage
-------
The upcoming fixtures have no results, so there is nothing for them to leak.
The guard that matters is the other direction: the feature state is advanced
over played matches only, in chronological order, and is then FROZEN before
any future fixture is featurised. A future fixture cannot alter the state that
another future fixture is scored from, which is what would happen if the loop
observed its own predictions.

    python3 -m backend.scripts.forecast_season
    python3 -m backend.scripts.forecast_season --competitions eng.1 --sims 20000

Writes backend/data/predictions/season_fixtures.json and season_projections.json.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import math
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Set, Tuple

import numpy as np

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.scripts.baseline_walkforward import IDX, load_matches  # noqa: E402
from backend.scripts.train_layered import FeatureState  # noqa: E402
from backend.services.forecast import version as mv  # noqa: E402
from backend.services.forecast.snapshots import (  # noqa: E402
    SnapshotStore,
    snapshots_from_fixtures,
)

logger = logging.getLogger("forecast_season")

CANONICAL = ROOT / "backend" / "data" / "canonical.duckdb"
OUT_DIR = ROOT / "backend" / "data" / "predictions"

# The feature set that won the layered ablation. Referee, rest, h2h and context
# were measured and did not earn a place; they are absent rather than carried
# "just in case", because an unused column is a column that can silently break.
KEPT_PREFIXES = ("elo_", "form_")

# Leagues served, with the relegation rule the simulation actually applies.
# Every league whose season this can project.
#
# Two conditions, both checked rather than assumed. The model must beat
# uniform, the competition's own base rate AND always-picking-home on a
# day-blocked walk-forward of that league alone — `league_gate.py`, results in
# reports/baselines/league_gate.json. And the season must be a plain double
# round robin, which `_is_round_robin` verifies against the fixture list at
# publish time; a table simulated from a schedule that is not one would be
# wrong in a way no footnote repairs.
#
# `top_cut` is the position band worth naming in that competition. Fourth is
# a Champions League place in a top flight and nothing at all in a second
# tier, where second is the last automatic promotion spot. Publishing "Top 4"
# for the Championship would be a straightforwardly wrong label.
LEAGUES: Dict[str, Dict] = {
    # -- top flights ---------------------------------------------------
    "eng.1": {"name": "Premier League", "country": "England", "relegate": 3,
              "top_cut": 4, "top_cut_label": "Top 4"},
    "esp.1": {"name": "La Liga", "country": "Spain", "relegate": 3,
              "top_cut": 4, "top_cut_label": "Top 4"},
    "ger.1": {"name": "Bundesliga", "country": "Germany", "relegate": 2,
              "playoff": 1, "top_cut": 4, "top_cut_label": "Top 4"},
    "ita.1": {"name": "Serie A", "country": "Italy", "relegate": 3,
              "top_cut": 4, "top_cut_label": "Top 4"},
    "fra.1": {"name": "Ligue 1", "country": "France", "relegate": 2,
              "playoff": 1, "top_cut": 4, "top_cut_label": "Top 4"},
    "ned.1": {"name": "Eredivisie", "country": "Netherlands", "relegate": 2,
              "top_cut": 4, "top_cut_label": "Top 4"},
    "por.1": {"name": "Primeira Liga", "country": "Portugal", "relegate": 2,
              "top_cut": 4, "top_cut_label": "Top 4"},
    "tur.1": {"name": "Süper Lig", "country": "Türkiye", "relegate": 4,
              "top_cut": 4, "top_cut_label": "Top 4"},

    # -- North America -------------------------------------------------
    # Grouped rather than single-table, which changes what every number on
    # the page means: `p_title` is the Supporters' Shield (best record in
    # the league), while a club's season is decided by where it finishes in
    # its OWN conference. Membership and the playoff cut line come from
    # `conferences.json`, built from ESPN's published standings.
    "usa.1": {"name": "Major League Soccer", "country": "United States",
              "relegate": 0, "grouped": True,
              "top_cut": 1, "top_cut_label": "Supporters' Shield"},
}

# Measured and NOT shipped, each for its own reason.
#
# `mex.1` and `arg.1` clear the match gate (.61854, .64524) and are held for
# STRUCTURE: Apertura/Clausura with knockout stages inside the league, so
# there is no season-long table for a simulation to project. That is the same
# reason MLS was held until conference-aware ranking existed.
#
# The rest are held for SCOPE. Each cleared its gate and each was served for a
# day; the site is now the top flight of Europe plus MLS, and a Championship
# table on the same page as the Premier League made the product harder to read
# rather than more complete. The evidence stays in
# `reports/baselines/league_gate.json` — nothing was un-measured, and turning
# any of them back on is one line here.
HELD: Dict[str, str] = {
    "mex.1": "Apertura/Clausura split with a liguilla",
    "arg.1": "zones and knockout rounds inside the league",
    "ksa.1": "too little history to measure under the same protocol",
    "eng.2": "out of scope: the site serves the European top flight and MLS",
    "esp.2": "out of scope: the site serves the European top flight and MLS",
    "ger.2": "out of scope: the site serves the European top flight and MLS",
    "ita.2": "out of scope: the site serves the European top flight and MLS",
    "fra.2": "out of scope: the site serves the European top flight and MLS",
    "bra.1": "out of scope: the site serves the European top flight and MLS",
}

MAX_GOALS = 10

# How close a schedule has to be to a double round robin before a projected
# table is meaningful. Set between the two populations it separates: every
# single-table league measured sits at 98%+, and every multi-conference or
# Apertura/Clausura competition below 60%.
ROUND_ROBIN_MIN = 0.95


def _seed_for(competition_id: str, seed: int) -> int:
    """A stable per-competition seed.

    sha256 rather than `hash()`, which is salted per process and would make
    the same command produce different probabilities on two runs.
    """
    digest = hashlib.sha256(competition_id.encode("utf-8")).digest()
    return (int.from_bytes(digest[:8], "big") ^ (seed & 0xFFFFFFFF)) % (2 ** 63)


def load_upcoming(competitions: Sequence[str],
                  played: Optional[Sequence[dict]] = None) -> List[dict]:
    """Fixtures with no result yet, from the FBref schedule tier.

    Read here rather than from `matches` because the canonical layer is played
    matches only — that invariant is what lets every consumer treat a row as a
    fact — so the fixture list is a separate read by construction.

    Two sources have to agree about what "not yet played" means, and they
    refresh on different clocks. Results arrive daily from ESPN; the FBref
    schedule is a release artifact that can be weeks old, so its `home_goals`
    stays NULL all season for matches that have very much been played. The
    date filter hides most of that, and `played` closes the rest: any fixture
    already in the results corpus for that season is dropped whatever the
    schedule says its date was. Without it, a match moved forward from its
    published date would be forecast after it finished.
    """
    import duckdb

    from backend.scripts.build_canonical import (
        COMPETITION_MAP,
        fbref_time,
        norm_team,
    )

    con = duckdb.connect(str(CANONICAL), read_only=True)
    con.execute("INSTALL sqlite; LOAD sqlite;")
    con.execute(f"ATTACH '{ROOT / 'backend' / 'data' / 'fbref.sqlite'}' "
                f"AS fb (TYPE sqlite, READ_ONLY)")
    con.create_function("norm_team", norm_team, ["VARCHAR"], "VARCHAR")
    rows = con.execute("""
        SELECT f.league, f.season, f.date, f.time, f.home, f.away, f.round
          FROM fb.fbref_fixtures f
         WHERE f.home_goals IS NULL AND f.date >= ?
         ORDER BY f.date, f.home
    """, [datetime.now(timezone.utc).date().isoformat()]).fetchall()
    aliases = {(r[0], r[1]): r[2] for r in con.execute(
        "SELECT competition_id, fb_norm, wh_norm FROM team_aliases").fetchall()}
    con.close()

    # (competition, season, home_key, away_key) of everything already played.
    done = {(m["competition_id"], m["season"], m["home_key"], m["away_key"])
            for m in (played or [])}

    out, already = [], 0
    for league, season, date, time, home, away, rnd in rows:
        comp = COMPETITION_MAP.get(league)
        if comp not in competitions:
            continue
        hn = aliases.get((comp, norm_team(home)), norm_team(home))
        an = aliases.get((comp, norm_team(away)), norm_team(away))
        if (comp, int(str(season)[:4]), f"{comp}::{hn}", f"{comp}::{an}") in done:
            already += 1
            continue
        out.append({
            "competition_id": comp, "season": int(str(season)[:4]),
            "local_date": datetime.fromisoformat(date).date(),
            # `fbref_time` because FBref prints "20:15 (22:15)" and the raw
            # cell concatenated onto a date is not a timestamp.
            "kickoff": fbref_time(time), "round": rnd,
            "home_name": home, "away_name": away,
            "home_key": f"{comp}::{hn}", "away_key": f"{comp}::{an}",
            "home_score": None, "away_score": None,
        })
    if already:
        logger.info("  %d scheduled fixture(s) already have a result and were "
                    "dropped — the schedule artifact is behind the results",
                    already)
    return out


def fit_head(X: np.ndarray, y: np.ndarray, cols: Sequence[int]):
    from sklearn.impute import SimpleImputer
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    model = make_pipeline(SimpleImputer(strategy="median"), StandardScaler(),
                          LogisticRegression(max_iter=2000, C=0.5))
    model.fit(X[:, cols], y)
    return model


def score_matrix(lh: float, la: float, rho: float = -0.05) -> np.ndarray:
    """Dixon-Coles scoreline matrix: independent Poisson with the low-score
    cells reweighted, which is the whole point of the correction."""
    i = np.arange(MAX_GOALS + 1)
    fact = np.array([math.factorial(int(k)) for k in i], dtype=np.float64)
    ph = np.exp(-lh) * lh ** i / fact
    pa = np.exp(-la) * la ** i / fact
    M = np.outer(ph, pa)
    M[0, 0] *= 1 - lh * la * rho
    M[0, 1] *= 1 + lh * rho
    M[1, 0] *= 1 + la * rho
    M[1, 1] *= 1 - rho
    return M / M.sum()


def outcome_probs(M: np.ndarray) -> Tuple[float, float, float]:
    return (float(np.tril(M, -1).sum()), float(np.trace(M)),
            float(np.triu(M, 1).sum()))


def reconcile(target: np.ndarray, lh0: float, la0: float) -> Tuple[float, float]:
    """Find (lambda_home, lambda_away) whose scoreline matrix reproduces the
    measured-best 1X2. Two unknowns, two equations (home and away; the draw
    follows). Falls back to the goal model's own lambdas if the solve fails —
    a slightly incoherent forecast beats a missing one."""
    from scipy.optimize import least_squares

    def resid(z):
        lh, la = float(np.exp(z[0])), float(np.exp(z[1]))
        ph, _, pa = outcome_probs(score_matrix(lh, la))
        return [ph - target[0], pa - target[2]]

    try:
        sol = least_squares(resid, x0=[np.log(max(lh0, .2)), np.log(max(la0, .2))],
                            bounds=([np.log(.1)] * 2, [np.log(6.0)] * 2))
        return float(np.exp(sol.x[0])), float(np.exp(sol.x[1]))
    except Exception:  # noqa: BLE001
        return lh0, la0


# Within-season Elo drift, measured over 3,583 team-seasons in this corpus:
# sd 45.3 points (p10 -58, p90 +57). That is how wrong a start-of-season rating
# turns out to be about the season it is about to predict, and it is NOT
# match-level noise — it is correlated across all 38 of a club's fixtures.
#
# Simulating without it is why the first run of this script made Bayern 93.3%
# and PSG 88.1% for their titles, against bookmaker prices nearer 70%. A point
# estimate compounded 34 times is not a forecast, it is an assumption repeated.
#
# Converted to a log-goal-rate shock: 400 Elo is a factor of 10 in odds, and a
# strength difference splits roughly evenly across the two lambdas.
SEASON_ELO_DRIFT_SD = 45.3
STRENGTH_SHOCK_SD = SEASON_ELO_DRIFT_SD / 400 * np.log(10) / 2
SHOCK_BUCKETS = 15


CONFERENCES = ROOT / "backend" / "data" / "conferences.json"


def load_groups(competition: str, season: int,
                entrants: Sequence[str]) -> Optional[Dict[str, str]]:
    """`team_key -> conference name`, or None if this is a single table.

    Read from the committed artifact rather than fetched, so the forecast has
    no live dependency on a third-party endpoint. Returns None — and the
    caller then holds the league rather than projecting it — whenever the map
    cannot be trusted: wrong season, or clubs it does not place. Half a
    conference table is worse than none, because it looks like the real thing.
    """
    from backend.scripts.build_canonical import norm_team

    if not CONFERENCES.exists():
        logger.warning("  %s is grouped but %s does not exist — run "
                       "build_conferences", competition, CONFERENCES.name)
        return None
    payload = json.loads(CONFERENCES.read_text())
    cfg = (payload.get("competitions") or {}).get(competition)
    if not cfg:
        logger.warning("  %s is grouped but has no entry in %s",
                       competition, CONFERENCES.name)
        return None
    if int(cfg.get("season", -1)) != int(season):
        logger.warning("  %s conference map is for %s, not %s — refusing to "
                       "place this season's clubs with last season's map",
                       competition, cfg.get("season"), season)
        return None

    placed: Dict[str, str] = {}
    for group in cfg.get("groups", []):
        for name in group.get("teams", []):
            placed[f"{competition}::{norm_team(name)}"] = group["name"]

    # One provider, two vocabularies. `conferences.json` is built from ESPN's
    # STANDINGS, which name the club "Inter Miami CF", while the warehouse
    # holds the name ESPN's SCOREBOARD uses for the same club — "Inter". They
    # normalise to `inter miami` and `inter`, so an exact match places
    # twenty-nine of thirty MLS clubs and refuses the table over the thirtieth.
    #
    # Resolved by containment, and only when the answer is unambiguous: the
    # short key's tokens must be a subset of exactly ONE unplaced conference
    # entry. `inter` is inside `inter miami` and nothing else here, so it
    # resolves; had the league also contained `inter miami cf ii` there would
    # be two candidates and this refuses rather than guessing — which matters
    # because `inter` is Internazionale in every other competition we serve.
    unresolved = [t for t in entrants if t not in placed]
    if unresolved:
        free = {key: name for key, name in placed.items()
                if key not in set(entrants)}
        for team in list(unresolved):
            tokens = set(team.split("::")[-1].split())
            hits = [key for key in free
                    if tokens and tokens < set(key.split("::")[-1].split())]
            if len(hits) == 1:
                placed[team] = free.pop(hits[0])
                unresolved.remove(team)
                logger.info("  %s: placed %r via %r — the standings and the "
                            "scoreboard spell the same club differently",
                            competition, team.split("::")[-1],
                            hits[0].split("::")[-1])

    if unresolved:
        logger.warning("  %s: %d club(s) are in the fixture list but not in "
                       "the conference map (%s) — no table published",
                       competition, len(unresolved),
                       ", ".join(sorted(m.split("::")[-1]
                                        for m in unresolved)[:5]))
        return None
    return {t: placed[t] for t in entrants}


def group_config(competition: str) -> Optional[Dict]:
    """The published shape of a grouped competition: its groups and cut line."""
    if not CONFERENCES.exists():
        return None
    cfg = (json.loads(CONFERENCES.read_text()).get("competitions")
           or {}).get(competition)
    if not cfg:
        return None
    # `qualify` is per group and identical across them in every format seen so
    # far; the minimum is the honest reduction if that ever stops being true.
    qualify = min((g.get("qualify", 0) for g in cfg.get("groups", [])),
                  default=0)
    return {
        "qualify": qualify,
        "qualify_label": cfg.get("qualify_label"),
        "groups": [{"name": g["name"], "short": g["short"],
                    "teams": len(g["teams"]), "qualify": g.get("qualify", 0)}
                   for g in cfg.get("groups", [])],
    }


def league_participants(entrants: Sequence[str],
                        appearances: Dict[str, int]) -> List[str]:
    """The clubs actually playing the league season.

    A season's fixture list can contain sides that are not in the league. MLS
    is the live example: ESPN files the All-Star Game under `usa.1`, so
    `MLS All-Stars` and `Liga MX All-Stars` arrive as clubs with one match
    each and a 30-team league becomes a 32-team table.

    Filtered on participation rather than on names, because the shape of the
    error is the general one — a side that plays once in a competition where
    everyone else plays thirty times is not in that competition — and a name
    filter only ever catches the instance someone already noticed.
    """
    if not entrants:
        return []
    counts = sorted(appearances.get(t, 0) for t in entrants)
    median = counts[len(counts) // 2]
    floor = median * 0.25
    keep = [t for t in entrants if appearances.get(t, 0) >= floor]
    dropped = [t for t in entrants if t not in set(keep)]
    if dropped:
        logger.info("  dropped %d non-participant(s) — %s — each with far "
                    "fewer matches than the season's median of %d",
                    len(dropped),
                    ", ".join(sorted(d.split("::")[-1] for d in dropped)[:4]),
                    median)
    return keep


def simulate_season(fixtures: List[dict], table: Dict[str, dict], *,
                    sims: int, rng: np.random.Generator,
                    groups: Optional[Dict[str, str]] = None,
                    shock_sd: float = STRENGTH_SHOCK_SD) -> Dict[str, dict]:
    """Monte Carlo the rest of the league, with strength uncertainty.

    Each simulation draws one strength offset PER TEAM and holds it for the
    whole season, so a run where Inter are better than rated is a run where
    they are better in all 38 matches. That correlation is the entire
    difference between a 93% title probability and a defensible one.

    The Dixon-Coles low-score correction survives the perturbation: the two
    lambdas depend only on the strength DIFFERENCE, so bucketing that
    difference into `SHOCK_BUCKETS` quantiles and precomputing one matrix per
    bucket keeps the tau term exact while staying vectorised.
    """
    teams = sorted(table)
    ti = {t: i for i, t in enumerate(teams)}
    n = len(teams)
    base_pts = np.array([table[t]["points"] for t in teams], dtype=np.int32)
    base_gd = np.array([table[t]["gd"] for t in teams], dtype=np.int32)
    base_gf = np.array([table[t]["gf"] for t in teams], dtype=np.int32)

    # One offset per team per simulation, fixed for the season.
    U = rng.normal(0.0, shock_sd, size=(sims, n))

    # Representative delta for each bucket, and each sim's bucket per fixture.
    edges = np.quantile(rng.normal(0.0, shock_sd * np.sqrt(2), size=200000),
                        np.linspace(0, 1, SHOCK_BUCKETS + 1))
    centres = (edges[:-1] + edges[1:]) / 2

    pts = np.tile(base_pts, (sims, 1)).astype(np.int32)
    gd = np.tile(base_gd, (sims, 1)).astype(np.int32)
    gf = np.tile(base_gf, (sims, 1)).astype(np.int32)

    for f in fixtures:
        if f["home_key"] not in ti or f["away_key"] not in ti:
            continue
        h, a = ti[f["home_key"]], ti[f["away_key"]]
        delta = U[:, h] - U[:, a]
        bucket = np.clip(np.searchsorted(edges[1:-1], delta), 0,
                         SHOCK_BUCKETS - 1)
        lh0, la0 = f["_lh"], f["_la"]

        hg = np.empty(sims, dtype=np.int32)
        ag = np.empty(sims, dtype=np.int32)
        for b in range(SHOCK_BUCKETS):
            mask = bucket == b
            k = int(mask.sum())
            if not k:
                continue
            d = float(centres[b])
            M = score_matrix(lh0 * np.exp(d), la0 * np.exp(-d))
            flat = M.ravel()
            idx = rng.choice(len(flat), size=k, p=flat / flat.sum())
            hg[mask] = (idx // (MAX_GOALS + 1)).astype(np.int32)
            ag[mask] = (idx % (MAX_GOALS + 1)).astype(np.int32)

        home_win, draw = hg > ag, hg == ag
        pts[:, h] += np.where(home_win, 3, np.where(draw, 1, 0))
        pts[:, a] += np.where(hg < ag, 3, np.where(draw, 1, 0))
        gd[:, h] += hg - ag
        gd[:, a] += ag - hg
        gf[:, h] += hg
        gf[:, a] += ag

    # Rank on points, then goal difference, then goals scored — the ordering
    # every one of these leagues actually uses.
    key = pts.astype(np.int64) * 10_000_000 + (gd + 200) * 10_000 + gf
    order = np.argsort(-key, axis=1, kind="stable")
    position = np.empty_like(order)
    rows = np.arange(sims)[:, None]
    position[rows, order] = np.arange(n)[None, :]

    out = {t: {"pos": position[:, ti[t]], "pts": pts[:, ti[t]]} for t in teams}

    # In a grouped competition the league-wide position answers one real
    # question (the Supporters' Shield) and the club's actual season is
    # decided inside its conference. Rank there too, on the same key, so both
    # are available and neither has to stand in for the other.
    if groups:
        for name in sorted(set(groups.values())):
            cols = [ti[t] for t in teams if groups.get(t) == name]
            if not cols:
                continue
            sub = key[:, cols]
            sub_order = np.argsort(-sub, axis=1, kind="stable")
            sub_pos = np.empty_like(sub_order)
            sub_pos[np.arange(sims)[:, None], sub_order] = \
                np.arange(len(cols))[None, :]
            for j, col in enumerate(cols):
                out[teams[col]]["group"] = name
                out[teams[col]]["group_pos"] = sub_pos[:, j]
    return out


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--competitions", default=",".join(LEAGUES))
    ap.add_argument("--min-season", type=int, default=2000)
    ap.add_argument("--sims", type=int, default=20000)
    ap.add_argument("--seed", type=int, default=17)
    ap.add_argument("--no-snapshots", action="store_true",
                    help="skip the provenance write (for local experiments; "
                         "the scheduled job must never pass this)")
    ap.add_argument("--allow-missing-leagues", action="store_true",
                    help="publish even though a league the live forecast "
                         "serves would disappear. For a competition that has "
                         "genuinely ended — never to get past a bad ingest.")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    comps = [c.strip() for c in args.competitions.split(",") if c.strip()]
    played = load_matches(comps, args.min_season, None)
    logger.info("training on %d played matches (%s .. %s)", len(played),
                played[0]["local_date"], played[-1]["local_date"])

    # -- pass 1: advance state over history, then FREEZE ------------------
    state = FeatureState()
    rows, i, n = [], 0, len(played)
    while i < n:
        j = i
        day = played[i]["local_date"]
        while j < n and played[j]["local_date"] == day:
            j += 1
        for m in played[i:j]:
            rows.append(state.emit(m))
        for m in played[i:j]:
            state.observe(m)
        i = j

    names = list(rows[0].keys())
    cols = [k for k, nm in enumerate(names)
            if any(nm.startswith(p) for p in KEPT_PREFIXES)]
    X = np.array([[r[k] for k in names] for r in rows], dtype=np.float64)
    y = np.array([IDX[m["result"]] for m in played])
    logger.info("feature matrix %d x %d (serving %d columns)", *X.shape, len(cols))

    head = fit_head(X, y, cols)

    # -- goal scale, per competition --------------------------------------
    # Expected goals have to come from somewhere before reconciliation can
    # adjust them; the competition's own recent scoring rate is the least
    # assuming starting point.
    recent = defaultdict(list)
    for m in played[-40000:]:
        recent[m["competition_id"]].append((m["home_score"], m["away_score"]))
    scale = {c: (float(np.mean([x[0] for x in v])), float(np.mean([x[1] for x in v])))
             for c, v in recent.items()}

    # -- upcoming ---------------------------------------------------------
    upcoming = load_upcoming(comps, played)
    logger.info("upcoming fixtures: %d", len(upcoming))
    unknown = {f["home_key"] for f in upcoming if f["home_key"] not in state.elo.rating}
    if unknown:
        logger.info("  %d clubs with no rating yet (promoted sides) — they start "
                    "at the base rating, which is the honest prior", len(unknown))

    feats = np.array([[state.emit(f)[k] for k in names] for f in upcoming],
                     dtype=np.float64)
    P = head.predict_proba(feats[:, cols])

    fixtures_out = []
    for f, p in zip(upcoming, P):
        lh0, la0 = scale.get(f["competition_id"], (1.5, 1.2))
        lh, la = reconcile(p, lh0, la0)
        M = score_matrix(lh, la)
        f["_lh"], f["_la"] = lh, la
        ph, pd_, pa = outcome_probs(M)
        top = np.dstack(np.unravel_index(np.argsort(-M.ravel())[:5], M.shape))[0]
        fixtures_out.append({
            "fixture_uid": None,  # filled below, once the uid helper is imported
            "competition_id": f["competition_id"], "season": f["season"],
            "date": f["local_date"].isoformat(), "kickoff": f["kickoff"],
            "round": f["round"],
            "home": f["home_name"], "away": f["away_name"],
            "p_home": round(float(p[0]), 4), "p_draw": round(float(p[1]), 4),
            "p_away": round(float(p[2]), 4),
            "xg_home": round(lh, 3), "xg_away": round(la, 3),
            "scorelines": [{"score": f"{int(h)}-{int(a)}",
                            "p": round(float(M[h, a]), 4)} for h, a in top],
            "elo_home": round(float(state.elo.rating[f["home_key"]]), 1),
            "elo_away": round(float(state.elo.rating[f["away_key"]]), 1),
            "coherence_gap": round(float(max(abs(ph - p[0]), abs(pa - p[2]))), 5),
        })

    gap = max(f["coherence_gap"] for f in fixtures_out) if fixtures_out else 0
    logger.info("worst 1X2/scoreline disagreement after reconciliation: %.5f", gap)
    if gap > 1e-3:
        raise SystemExit(
            f"1X2 and scoreline grid disagree by {gap:.5f}. They are reconciled "
            f"by construction, so a gap this size is a solver failure, not "
            f"noise — refusing to publish an incoherent forecast.")

    from backend.services.forecast.snapshots import fixture_uid
    for f in fixtures_out:
        f["fixture_uid"] = fixture_uid(f["competition_id"], f["season"],
                                       f["date"], f["home"], f["away"])

    # -- season projections ------------------------------------------------
    # Each league carries its OWN measured record. The headline .59303 was
    # measured on Europe's top five and says nothing about the Championship,
    # where the same model scores .63810 — still better than every baseline,
    # but a reader of that page deserves the number for their league rather
    # than one borrowed from a different one.
    gate = {}
    gate_path = ROOT / "reports" / "baselines" / "league_gate.json"
    if gate_path.exists():
        try:
            gate = {g["competition_id"]: g
                    for g in json.loads(gate_path.read_text())["leagues"]}
        except Exception as exc:  # noqa: BLE001
            logger.warning("could not read the league gate: %s", exc)

    projections = []
    by_comp: Dict[str, List[dict]] = defaultdict(list)
    for f in upcoming:
        by_comp[f["competition_id"]].append(f)

    # Sorted so the run order is the same every time, and each competition
    # gets its OWN stream. One shared generator consumed in iteration order
    # means a league's published probabilities depend on which other leagues
    # ran before it: adding the Championship moved Manchester City by a point
    # without anything about the Premier League changing. A forecast has to be
    # reproducible from its own inputs.
    for comp in sorted(by_comp):
        fs = by_comp[comp]
        rng = np.random.default_rng(_seed_for(comp, args.seed))
        season = max(x["season"] for x in fs)
        fs = [f for f in fs if f["season"] == season]
        done_this_season = [m for m in played
                            if m["competition_id"] == comp and m["season"] == season]
        entrants = sorted({k for f in fs for k in (f["home_key"], f["away_key"])}
                          | {k for m in done_this_season
                             for k in (m["home_key"], m["away_key"])})

        # A projected table only means anything if everyone plays everyone
        # twice. Checked against the actual schedule rather than trusted from
        # config, because the alternative is a confident 30-team table for a
        # competition that is really two conferences and a playoff.
        #
        # Proportional rather than exact: the question is whether the format is
        # a double round robin, and the two failure modes are far apart. MLS
        # runs at 59% of one, Liga MX 50%, Argentina 57% — those are different
        # competitions. A league sitting at 98% is the right competition with a
        # postponement the schedule has not been redrawn for yet, which costs a
        # rounding error rather than a wrong answer. The shortfall is published
        # either way.
        appearances: Dict[str, int] = {}
        for row in list(fs) + list(done_this_season):
            for k in (row["home_key"], row["away_key"]):
                appearances[k] = appearances.get(k, 0) + 1
        entrants = league_participants(entrants, appearances)

        cfg_early = LEAGUES.get(comp, {})
        groups = None
        if cfg_early.get("grouped"):
            groups = load_groups(comp, season, entrants)
            if groups is None:
                logger.warning("  %s: no usable conference map — fixtures are "
                               "published, no table is", comp)
                continue

        expected = len(entrants) * (len(entrants) - 1)
        n_total = len(fs) + len(done_this_season)
        completeness = n_total / expected if expected else 0.0
        # A grouped competition is not trying to be a double round robin and
        # measuring it against one is meaningless — MLS runs at 59% of one BY
        # DESIGN. Its structural check is the conference map above: every club
        # placed, or no table.
        if groups is not None:
            pass
        elif completeness < ROUND_ROBIN_MIN or completeness > 1.0:
            logger.warning(
                "  %s: %d teams and %d fixtures — %.0f%% of a double round "
                "robin (%d). Not a single-table competition; fixtures are "
                "published, no table is.",
                comp, len(entrants), n_total, 100 * completeness, expected)
            continue
        if groups is not None:
            # Measured against a format this competition is not playing, so it
            # is neither logged nor published. MLS at "59% of a double round
            # robin" is not an incomplete schedule, it is a different one.
            completeness = None
        elif n_total != expected:
            logger.info("  %s: %d of %d fixtures scheduled (%.1f%%) — table "
                        "projected from what exists", comp, n_total, expected,
                        100 * completeness)

        # Both sides must be in the league for the match to be part of it.
        # Without this the All-Star Game still contributes points to whoever
        # ESPN listed as the home side.
        member = set(entrants)
        fs = [f for f in fs
              if f["home_key"] in member and f["away_key"] in member]
        done_this_season = [m for m in done_this_season
                            if m["home_key"] in member and m["away_key"] in member]

        # Points already banked this season, if any of it has been played.
        table = {t: {"points": 0, "gd": 0, "gf": 0, "played": 0} for t in entrants}
        for m in done_this_season:
            for key, gf_, ga in ((m["home_key"], m["home_score"], m["away_score"]),
                                 (m["away_key"], m["away_score"], m["home_score"])):
                if key not in table:
                    continue
                table[key]["points"] += 3 if gf_ > ga else (1 if gf_ == ga else 0)
                table[key]["gd"] += gf_ - ga
                table[key]["gf"] += gf_
                table[key]["played"] += 1

        sim = simulate_season(fs, table, sims=args.sims, rng=rng, groups=groups)
        cfg = cfg_early
        group_meta = group_config(comp) if groups is not None else None
        qualify = (group_meta or {}).get("qualify", 0)
        rel_from = len(entrants) - cfg.get("relegate", 3)
        po_from = rel_from - cfg.get("playoff", 0)
        top_cut = cfg.get("top_cut", 4)
        names_by_key = {}
        for f in fs:
            names_by_key[f["home_key"]] = f["home_name"]
            names_by_key[f["away_key"]] = f["away_name"]
        for m in done_this_season:
            names_by_key.setdefault(m["home_key"], m["home_name"])
            names_by_key.setdefault(m["away_key"], m["away_name"])

        rows_out = []
        for t, s in sim.items():
            pos = s["pos"]
            rows_out.append({
                "team": names_by_key.get(t, t.split("::")[-1]),
                "p_title": round(float((pos == 0).mean()), 4),
                "p_top_cut": round(float((pos < top_cut).mean()), 4),
                # Retained for anything still reading the old key. In a second
                # tier it is a genuine top-four probability and not the number
                # the page shows, which is `p_top_cut`.
                "p_top4": round(float((pos < 4).mean()), 4),
                # A league with no relegation has no relegation probability.
                # Zero would read as "safe"; absent reads as "not a thing here".
                "p_relegated": round(float((pos >= rel_from).mean()), 4)
                if cfg.get("relegate") else None,
                "p_playoff": round(float(((pos >= po_from) & (pos < rel_from)).mean()), 4)
                if cfg.get("playoff") else None,
                "exp_points": round(float(s["pts"].mean()), 1),
                "exp_position": round(float(pos.mean()) + 1, 2),
                "played": table[t]["played"], "points": table[t]["points"],
            })
            if groups is not None:
                gpos = s["group_pos"]
                rows_out[-1].update({
                    "group": s["group"],
                    "group_exp_position": round(float(gpos.mean()) + 1, 2),
                    "p_group_title": round(float((gpos == 0).mean()), 4),
                    "p_qualify": round(float((gpos < qualify).mean()), 4)
                    if qualify else None,
                })
        rows_out.sort(key=lambda r: (-r["p_title"], -r.get("p_group_title", 0)))
        projections.append({
            "competition_id": comp, "name": cfg.get("name", comp),
            "country": cfg.get("country"), "season": season,
            "fixtures_remaining": len(fs), "teams": len(entrants),
            "relegation_places": cfg.get("relegate", 3),
            "top_cut": top_cut,
            "top_cut_label": cfg.get("top_cut_label", "Top 4"),
            "schedule_completeness": (round(completeness, 4)
                                      if completeness is not None else None),
            "groups": group_meta["groups"] if group_meta else None,
            "qualify_label": (group_meta or {}).get("qualify_label"),
            "measured": {k: g[k] for k in ("n_scored", "brier", "log_loss",
                                           "accuracy", "uniform", "base_rate",
                                           "always_home")} if (g := gate.get(comp)) else None,
            "table": rows_out,
        })
        top = rows_out[0]
        logger.info("  %-8s %d  %2d teams, %3d to play  favourite %s %.1f%%",
                    comp, season, len(entrants), len(fs), top["team"],
                    100 * top["p_title"])

    model_version = mv.compute(
        head="logistic-elo-form",
        features=list(KEPT_PREFIXES),
        leagues=comps,
        min_season=args.min_season,
        sims=args.sims,
        strength_shock_sd=STRENGTH_SHOCK_SD,
        elo={"k": 20.0, "home_adv": 65.0, "draw_width": 0.28, "regress": 0.0},
    )
    trained_through = str(played[-1]["local_date"])
    logger.info("model version %s (trained through %s)", model_version.id,
                trained_through)

    method = {
        "model_version": model_version.id,
        "release": model_version.release,
        "config_hash": model_version.config_hash,
        "trained_through": trained_through,
        "head": "multinomial logistic on Elo + rolling form, the feature set "
                "that won the layered ablation",
        "measured": {"brier": 0.59303, "ece": 0.0099, "n": 43433,
                     "protocol": "expanding-window walk-forward, Wave A 2000-2025",
                     "beats": {"elo_formula": 0.60108, "base_rate": 0.64760,
                               "dixon_coles_walkforward": 0.59580}},
        "goals": "Dixon-Coles scoreline matrix, lambdas solved so the implied "
                 "1X2 equals the logistic's",
        "sims": args.sims,
        "strength_uncertainty": {
            "within_season_elo_drift_sd": SEASON_ELO_DRIFT_SD,
            "measured_over_team_seasons": 3583,
            "note": "drawn once per team per simulation and held for the "
                    "season, so a club's error is correlated across all its "
                    "fixtures. Per-MATCH probabilities are unperturbed: the "
                    "head was measured at ECE .0099 on exactly those inputs.",
        },
        "excluded_after_measurement": ["referee", "rest", "head-to-head",
                                       "venue", "attendance", "kickoff time"],
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).isoformat()

    # A league that published yesterday and does not today is a regression,
    # and until now it was a warning in a log nobody reads.
    #
    # 2026-08-13: football-data.co.uk served National League fixtures for the
    # `E0` request and the Primeira Liga for `SP1`. Twenty-two matches landed
    # under eng.1 and esp.1, eng.1 came out with forty-four entrants, the
    # round-robin check correctly refused to call that a single table, and the
    # PREMIER LEAGUE AND LA LIGA SILENTLY LEFT THE SITE. Every step behaved as
    # designed and the product lost its two biggest leagues.
    #
    # Compared against the artifact already on disk rather than against
    # `LEAGUES`, because between seasons a league legitimately has neither
    # fixtures nor a table — it was absent yesterday too, so it does not trip
    # this. What trips it is losing something we were already publishing.
    #
    # Refuses to write ANY of it rather than publishing the survivors: the
    # atomic replace means the previous complete forecast keeps serving, which
    # is strictly better than a page that quietly shows six leagues where it
    # showed nine.
    # Scoped to what this run was ASKED for. `--competitions eng.1` is a
    # deliberate one-league run, not a product that lost eight leagues.
    published = {p["competition_id"] for p in projections}
    missing = _leagues_lost(
        OUT_DIR / "season_projections.json", published, set(comps))
    if missing and not args.allow_missing_leagues:
        logger.error(
            "REFUSING TO PUBLISH: %d league(s) that the live forecast serves "
            "would disappear — %s. The previous forecast stays up. Fix the "
            "input, or pass --allow-missing-leagues if the competition has "
            "genuinely ended.",
            len(missing), ", ".join(sorted(missing)))
        return 1

    # Record what we are about to publish BEFORE replacing the live artifact.
    # A snapshot for a forecast that failed to publish is a harmless extra row;
    # a published forecast with no snapshot is a permanently unauditable one.
    if not args.no_snapshots:
        snaps = snapshots_from_fixtures(
            fixtures_out, generated_at=stamp,
            model_version=model_version.id, trained_through=trained_through)
        with SnapshotStore() as store:
            written = store.record(snaps)
        logger.info("recorded %d prediction snapshots (%d already present)",
                    written, len(snaps) - written)

    # Atomic replace. A crash mid-write must leave the PREVIOUS valid forecast
    # serving, not a truncated file — the API reads these on every request and
    # a half-written JSON is a 500 on the flagship page.
    _publish(OUT_DIR / "season_fixtures.json",
             {"generated_at": stamp, "method": method,
              "fixtures": [{k: v for k, v in f.items() if not k.startswith("_")}
                           for f in fixtures_out]})
    _publish(OUT_DIR / "season_projections.json",
             {"generated_at": stamp, "method": method, "leagues": projections})
    logger.info("\nwrote %s", OUT_DIR / "season_fixtures.json")
    logger.info("wrote %s", OUT_DIR / "season_projections.json")
    return 0


def _leagues_lost(path: Path, publishing: Set[str],
                  in_scope: Set[str]) -> Set[str]:
    """Leagues the live artifact serves that this run would drop.

    A missing or unreadable artifact yields nothing to lose — the first run on
    a fresh checkout must not be blocked by a guard about continuity. Likewise
    a league outside `in_scope` was never this run's to produce.
    """
    try:
        previous = json.loads(path.read_text())
    except (OSError, ValueError):
        return set()
    served = {league.get("competition_id")
              for league in previous.get("leagues", [])}
    served.discard(None)
    return (served & in_scope) - publishing


def _publish(path: Path, payload: dict) -> None:
    """Write via a temp file in the same directory, then os.replace.

    Same filesystem so the replace is atomic; a reader either sees the whole
    old file or the whole new one, never a prefix of either.
    """
    import os
    import tempfile

    body = json.dumps(payload, indent=2)
    json.loads(body)  # refuse to publish something that will not parse back
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as fh:
            fh.write(body)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


if __name__ == "__main__":
    raise SystemExit(main())
