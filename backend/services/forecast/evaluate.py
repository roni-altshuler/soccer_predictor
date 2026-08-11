"""Score the forecasts we actually published, against what actually happened.

The distinction this module exists to protect
---------------------------------------------
There are two evaluations in this repository and conflating them would be the
single most misleading thing the product could do:

  HISTORICAL WALK-FORWARD   Brier .59303 over 43,433 matches. Honest, large,
                            and retrospective: the model was refit as the
                            corpus advanced, but no user ever saw those
                            numbers before those kickoffs.

  LIVE PUBLISHED            The final pre-kickoff snapshot for each fixture,
                            scored after the result lands. Small — it starts
                            at zero and grows a few hundred a month — and it
                            is the only evaluation of forecasts anyone could
                            have acted on.

They are computed here by different functions, carry a `basis` field, and are
never summed. A live sample of 40 matches is not evidence of anything, and the
right response to that is to say `n=40`, not to pad it with history.

Only `final_before_kickoff` snapshots are scored: strictly the last forecast
generated before the match started. Scoring every snapshot would weight a
fixture by how many times the job happened to run, and scoring the first one
would grade a week-old forecast that nobody was still being shown.
"""
from __future__ import annotations

import logging
import math
import sqlite3
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

logger = logging.getLogger("forecast.evaluate")

ROOT = Path(__file__).resolve().parent.parent.parent.parent
WAREHOUSE = ROOT / "backend" / "data" / "warehouse.sqlite"

OUTCOMES = ("H", "D", "A")

# Key for the warehouse-wide fallback vocabulary. Not a competition id, and
# deliberately not one any source could produce.
GLOBAL = "*"


def _result(hs: int, as_: int) -> str:
    return "H" if hs > as_ else ("A" if hs < as_ else "D")


def club_vocabulary(conn, db: Optional[Path] = None
                    ) -> Dict[str, Dict[str, int]]:
    """Per-competition `normalised club name -> team_id`.

    A snapshot's club name comes from FBref ("Wolves", "Gladbach", "Man Utd")
    and a result's comes from the warehouse ("Wolverhampton Wanderers",
    "Borussia Mönchengladbach", "Manchester United"). Normalising both sides
    does not close that gap — it is not a punctuation difference, it is a
    different name — so a join on names alone silently drops the match. This
    resolves both sides to a team_id instead, through three sources in order
    of trust:

      1. the warehouse's own `canonical_name`
      2. its curated `team_aliases`
      3. the canonical layer's fixture-graph aliases, which were derived by
         aligning FBref and warehouse fixtures on date and scoreline rather
         than by string similarity

    Scoped per competition, and an alias that resolves to two different clubs
    *within one competition* is refused rather than guessed. Merging two clubs
    to raise a match rate would corrupt the evaluation it exists to serve.
    """
    from backend.scripts.build_canonical import norm_team

    # Which clubs actually play in which competition. Scoping by this is what
    # makes "Arsenal" unambiguous: the men's and women's clubs share a name
    # but never a competition.
    in_comp: Dict[str, set] = defaultdict(set)
    for r in conn.execute(
            "SELECT DISTINCT competition_id, home_team_id AS t FROM matches "
            "UNION SELECT DISTINCT competition_id, away_team_id FROM matches"):
        in_comp[r["competition_id"]].add(r["t"])

    names = {r["team_id"]: r["canonical_name"]
             for r in conn.execute("SELECT team_id, canonical_name FROM teams")}
    try:
        aliases: List[tuple] = [
            (r["alias"], r["team_id"])
            for r in conn.execute("SELECT alias, team_id FROM team_aliases")]
    except sqlite3.OperationalError:
        # An older or minimal warehouse may not carry the alias table. Fewer
        # names resolve; nothing breaks.
        aliases = []

    def vocabulary(ids: Optional[set]) -> Dict[str, int]:
        v: Dict[str, int] = {}
        canonical: set = set()
        for tid, name in names.items():
            if ids is not None and tid not in ids:
                continue
            k = norm_team(name)
            if not k:
                continue
            if k in canonical and v.get(k) != tid:
                # Two clubs with the same canonical name in one competition.
                # Nothing can tell them apart, so neither is resolvable.
                v.pop(k, None)
                continue
            v[k] = tid
            canonical.add(k)
        refused: set = set()
        for alias, tid in aliases:
            if ids is not None and tid not in ids:
                continue
            k = norm_team(alias)
            if not k or k in canonical or k in refused:
                # A canonical name outranks an alias: the warehouse's own name
                # for a club is the store of record.
                continue
            existing = v.get(k)
            if existing is None:
                v[k] = tid
            elif existing != tid:
                del v[k]
                refused.add(k)
                logger.warning("%r resolves to two clubs — refusing it rather "
                               "than picking one", alias)
        return v

    vocab: Dict[str, Dict[str, int]] = {
        comp: vocabulary(ids) for comp, ids in in_comp.items()}
    _add_fixture_graph_aliases(vocab, db)

    # A competition with no played matches yet — a new league, or the first
    # week of a season in a fresh warehouse — has no per-competition
    # vocabulary at all. Falling back to a warehouse-wide one keeps those
    # resolvable, and it is safe precisely because a name that means two
    # different clubs anywhere in the warehouse is refused rather than guessed.
    vocab[GLOBAL] = vocabulary(None)
    return vocab


def _add_fixture_graph_aliases(vocab: Dict[str, Dict[str, int]],
                               db: Optional[Path]) -> None:
    """Fold in the canonical layer's derived FBref->warehouse name map.

    Optional by design: the canonical layer is a rebuildable artifact and the
    evaluation must still run without it, just with a lower match rate. A
    missing file is logged, never fatal.
    """
    from backend.scripts.build_canonical import norm_team

    canonical = (Path(db).parent if db else WAREHOUSE.parent) / "canonical.duckdb"
    if not canonical.exists():
        logger.info("no canonical layer at %s — joining on warehouse names "
                    "and curated aliases only", canonical)
        return
    try:
        import duckdb

        con = duckdb.connect(str(canonical), read_only=True)
        rows = con.execute("SELECT competition_id, fb_norm, wh_norm "
                           "FROM team_aliases").fetchall()
        con.close()
    except Exception as exc:  # noqa: BLE001
        logger.warning("could not read fixture-graph aliases: %s", exc)
        return

    added = 0
    for comp, fb_norm, wh_norm in rows:
        v = vocab.get(comp)
        if v is None or fb_norm in v:
            continue
        tid = v.get(norm_team(wh_norm))
        if tid is not None:
            v[fb_norm] = tid
            added += 1
    logger.debug("fixture-graph aliases added %d name(s)", added)


def join_results(snapshots: Sequence[Dict[str, Any]],
                 db: Optional[Path] = None,
                 report: Optional[Dict[str, Any]] = None
                 ) -> List[Dict[str, Any]]:
    """Attach the actual result to each snapshot, where one exists yet.

    Matched on competition, date and both clubs resolved to warehouse team
    ids. A fixture with no result is DROPPED, not defaulted — a forecast for a
    match that has not happened contributes nothing to a score, and inventing
    a row for it is fabrication.

    A snapshot whose club cannot be resolved at all is also dropped, but it is
    counted and reported. That distinction matters: "not played yet" shrinks
    the sample legitimately, "we no longer recognise this club's name" shrinks
    it because something is broken, and a silent join makes the two look
    identical.
    """
    from backend.scripts.build_canonical import norm_team

    conn = sqlite3.connect(f"file:{db or WAREHOUSE}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    vocab = club_vocabulary(conn, db)

    index: Dict[tuple, sqlite3.Row] = {}
    for r in conn.execute("""
        SELECT m.competition_id, m.date_utc, m.home_score, m.away_score,
               m.home_team_id, m.away_team_id
          FROM matches m
         WHERE m.home_score IS NOT NULL"""):
        index[(r["competition_id"], r["date_utc"][:10],
               r["home_team_id"], r["away_team_id"])] = r
    conn.close()

    out: List[Dict[str, Any]] = []
    unresolved: Dict[str, int] = defaultdict(int)
    no_result = 0
    fallback = vocab.get(GLOBAL, {})

    def resolve(comp: str, name: str) -> Optional[int]:
        key = norm_team(name)
        v = vocab.get(comp)
        if v is not None and key in v:
            return v[key]
        return fallback.get(key)

    for s in snapshots:
        comp = s["competition_id"]
        hid = resolve(comp, s["home_team"])
        aid = resolve(comp, s["away_team"])
        if hid is None or aid is None:
            for side in ("home_team", "away_team"):
                if resolve(comp, s[side]) is None:
                    unresolved[f"{comp}:{s[side]}"] += 1
            continue

        day = s["kickoff_at"][:10]
        row = None
        # +/- one day: kickoff instants and stored match dates disagree by a
        # timezone for some sources, and a fixture is not two fixtures.
        for d in (day, _shift(day, -1), _shift(day, 1)):
            row = index.get((comp, d, hid, aid))
            if row is not None:
                break
        if row is None:
            no_result += 1
            continue
        enriched = dict(s)
        enriched["home_score"] = int(row["home_score"])
        enriched["away_score"] = int(row["away_score"])
        enriched["result"] = _result(enriched["home_score"], enriched["away_score"])
        out.append(enriched)

    if unresolved:
        logger.warning("%d snapshot(s) name a club the warehouse does not "
                       "recognise and were NOT scored: %s",
                       sum(unresolved.values()),
                       ", ".join(sorted(unresolved)[:8]))
    if report is not None:
        report.update({
            "snapshots": len(snapshots),
            "scored": len(out),
            "awaiting_result": no_result,
            "unresolved_clubs": dict(sorted(unresolved.items())),
            "unresolved_count": sum(unresolved.values()),
        })
    return out


def _shift(day: str, days: int) -> str:
    from datetime import date, timedelta

    y, m, d = (int(x) for x in day.split("-"))
    return (date(y, m, d) + timedelta(days=days)).isoformat()


def _core(rows: Sequence[Dict[str, Any]]) -> Dict[str, float]:
    """Brier, log loss and accuracy on one sample.

    Split out from `score` because `score` computes per-league and per-version
    breakdowns, and calling itself to do that recursed forever the moment a
    sample contained exactly one league — which is the normal case.
    """
    n = len(rows)
    P = [[r["p_home"], r["p_draw"], r["p_away"]] for r in rows]
    Y = [OUTCOMES.index(r["result"]) for r in rows]
    brier = sum(sum((p[k] - (1.0 if k == y else 0.0)) ** 2 for k in range(3))
                for p, y in zip(P, Y)) / n
    logloss = sum(-math.log(max(p[y], 1e-15)) for p, y in zip(P, Y)) / n
    acc = sum(1 for p, y in zip(P, Y) if max(range(3), key=lambda k: p[k]) == y) / n
    return {"brier": round(brier, 5), "log_loss": round(logloss, 5),
            "accuracy": round(acc, 5)}


def score(rows: Sequence[Dict[str, Any]], *, basis: str,
          bins: int = 10) -> Dict[str, Any]:
    """Brier, log loss, calibration and the breakdowns, on one sample.

    `basis` is required and is carried into the output because every consumer
    of this number has to know whether it describes a retrospective backtest
    or forecasts that were actually published.
    """
    if not rows:
        return {"basis": basis, "n": 0,
                "note": "no scored fixtures yet — nothing has both a published "
                        "forecast and a result"}

    P, Y = [], []
    for r in rows:
        P.append([r["p_home"], r["p_draw"], r["p_away"]])
        Y.append(OUTCOMES.index(r["result"]))

    n = len(rows)
    core = _core(rows)

    # Reliability over every (fixture, outcome) pair: each is one forecast of a
    # binary event, which is what calibration actually measures.
    flat = [(p[k], 1.0 if k == y else 0.0) for p, y in zip(P, Y) for k in range(3)]
    buckets: List[Dict[str, Any]] = []
    ece = 0.0
    for i in range(bins):
        lo, hi = i / bins, (i + 1) / bins
        sel = [(s, o) for s, o in flat
               if (lo <= s < hi) or (i == bins - 1 and s == 1.0)]
        if not sel:
            continue
        stated = sum(s for s, _ in sel) / len(sel)
        observed = sum(o for _, o in sel) / len(sel)
        buckets.append({"bin_low": round(lo, 2), "bin_high": round(hi, 2),
                        "n": len(sel), "stated": round(stated, 4),
                        "observed": round(observed, 4)})
        ece += (len(sel) / len(flat)) * abs(stated - observed)

    # Goal-rate error, only where a lambda was recorded.
    xg_rows = [r for r in rows if r.get("lambda_home") is not None]
    xg_mae = (sum(abs(r["lambda_home"] - r["home_score"])
                  + abs(r["lambda_away"] - r["away_score"])
                  for r in xg_rows) / (2 * len(xg_rows))) if xg_rows else None

    # How likely did we say the score that actually happened was? Only
    # available where the top scoreline was stored, so it is reported as a
    # hit-rate on that single cell rather than as a full likelihood.
    top_hits = [r for r in rows if r.get("top_scoreline")]
    top_hit_rate = (sum(1 for r in top_hits
                        if r["top_scoreline"] == f"{r['home_score']}-{r['away_score']}")
                    / len(top_hits)) if top_hits else None

    by_league: Dict[str, Dict[str, Any]] = {}
    grouped: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for r in rows:
        grouped[r["competition_id"]].append(r)
    for comp, rs in grouped.items():
        if len(rs) < 10:
            by_league[comp] = {"n": len(rs), "brier": None,
                               "note": "fewer than 10 scored fixtures"}
            continue
        by_league[comp] = {"n": len(rs), **_core(rs)}

    by_version: Dict[str, Dict[str, Any]] = {}
    vgrouped: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for r in rows:
        vgrouped[r.get("model_version", "unknown")].append(r)
    for ver, rs in vgrouped.items():
        by_version[ver] = ({"n": len(rs), "brier": None,
                            "note": "fewer than 10 scored fixtures"}
                           if len(rs) < 10 else
                           {"n": len(rs), **_core(rs)})

    return {
        "basis": basis,
        "n": n,
        **core,
        "ece": round(ece, 5),
        "reliability": buckets,
        "xg_mae": round(xg_mae, 4) if xg_mae is not None else None,
        "top_scoreline_hit_rate": (round(top_hit_rate, 4)
                                   if top_hit_rate is not None else None),
        "by_league": by_league,
        "by_model_version": by_version,
        "first_kickoff": min(r["kickoff_at"] for r in rows),
        "last_kickoff": max(r["kickoff_at"] for r in rows),
    }


def baselines(rows: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    """What the same fixtures score under forecasts that know nothing.

    A Brier of .59 means nothing on its own; it means something against .667
    for a uniform guess on the same matches. Computed on the identical sample
    so the comparison is paired.
    """
    if not rows:
        return {}
    Y = [OUTCOMES.index(r["result"]) for r in rows]
    n = len(Y)
    uni = sum(sum((1 / 3 - (1.0 if k == y else 0.0)) ** 2 for k in range(3))
              for y in Y) / n
    counts = [sum(1 for y in Y if y == k) / n for k in range(3)]
    base = sum(sum((counts[k] - (1.0 if k == y else 0.0)) ** 2 for k in range(3))
               for y in Y) / n
    return {"uniform": round(uni, 5),
            "sample_base_rate": round(base, 5),
            "note": "sample_base_rate is computed ON this sample and is "
                    "therefore optimistic; it is a floor, not a competitor"}
