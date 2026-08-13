"""Forward tournament forecasts: who wins the one that has not finished yet.

The tennis-video shape, applied honestly
----------------------------------------
Green Code's Wimbledon workflow trains on every previous tournament and then
names a winner for the one about to be played. That transfers here, with one
condition that must not be quietly dropped: **you can only forecast a field you
know.** A tournament whose draw has not been made has no field, and inventing a
plausible one — last year's entrants, say — would produce a confident-looking
table with nothing behind it.

So every competition lands in exactly one of four states, and the state is
reported rather than hidden:

  upcoming        the draw is made and NONE of it has been played. The only
                  state in which this is a forecast in the ordinary sense of
                  the word, and the one the whole layer exists for.
  in_progress     some ties are decided and some are not. Decided ties are
                  held at their real winner and only the remainder is
                  simulated.
  completed       there is nothing left to predict, so the page shows what the
                  model said BEFORE the knockout stage began — refit on prior
                  seasons only — next to who actually won. That is the honest
                  way to show a finished tournament: the call, then the result.
  awaiting_draw   the last edition is finished and the next has no bracket
                  yet. No title odds. What IS shown is the strength table of
                  the teams most likely to be involved, from the same ratings,
                  clearly labelled as a power ranking and not a forecast.

Status is decided by FIXTURES, never by resolution
--------------------------------------------------
The first version of this script called a tournament live whenever some tie had
`winner is None`. That is wrong in a way that is easy to miss and hard to spot
afterwards: a tie is also winner-less when a leg is *missing from the data*.
Six such holes in the 2025-26 Champions League — mostly pre-2010-style single
legs ESPN never paired — made a competition whose final was played on
2026-05-30 report as still running, with live-looking title odds for a trophy
Bayern had already won or lost months earlier.

A tournament is live if and only if it has fixtures still to play. That is a
question about the calendar, which `scheduled_matches` answers, and never a
question about how confidently a past result could be resolved.

Every probability comes from the same model `benchmark_knockout` measures, refit
on seasons strictly earlier than the one being forecast. Nothing here is fitted
on a match it then predicts.

    python3 -m backend.scripts.predict_tournaments
    python3 -m backend.scripts.predict_tournaments --sims 40000

Writes backend/data/predictions/tournaments.json.
"""
from __future__ import annotations

import argparse
import json
import logging
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.scripts.backtest_brackets import (  # noqa: E402
    bracket_tree,
    rounds_in_order,
    simulate,
    simulate_open_draw,
)
from backend.scripts.benchmark_knockout import (  # noqa: E402
    History,
    build_matrix,
    pedigree,
)
from backend.services.tournament import ratings as R  # noqa: E402
from backend.services.tournament import ties as T  # noqa: E402
from backend.services.tournament.rounds import QUALIFYING, classify  # noqa: E402

logger = logging.getLogger("predict_tournaments")

DB = ROOT / "backend" / "data" / "warehouse.sqlite"
OUT = ROOT / "backend" / "data" / "predictions" / "tournaments.json"

COMPETITIONS: Dict[str, Dict[str, str]] = {
    "uefa.champions": {"name": "UEFA Champions League", "region": "Europe"},
    "uefa.europa": {"name": "UEFA Europa League", "region": "Europe"},
    "uefa.conference": {"name": "UEFA Conference League", "region": "Europe"},
    "uefa.euro": {"name": "UEFA European Championship", "region": "Europe"},
    "uefa.nations": {"name": "UEFA Nations League", "region": "Europe"},
    "fifa.world": {"name": "FIFA World Cup", "region": "World"},
    "fifa.cwc": {"name": "FIFA Club World Cup", "region": "World"},
    "conmebol.america": {"name": "Copa América", "region": "South America"},
    "conmebol.libertadores": {"name": "Copa Libertadores", "region": "South America"},
    "conmebol.sudamericana": {"name": "Copa Sudamericana", "region": "South America"},
    "caf.nations": {"name": "Africa Cup of Nations", "region": "Africa"},
    "afc.asian": {"name": "AFC Asian Cup", "region": "Asia"},
    "concacaf.gold": {"name": "CONCACAF Gold Cup", "region": "North America"},
    "concacaf.champions": {"name": "CONCACAF Champions Cup", "region": "North America"},
}


def team_names(conn: sqlite3.Connection) -> Dict[int, str]:
    return {int(r[0]): r[1] for r in conn.execute(
        "SELECT team_id, canonical_name FROM teams")}


def next_fixtures(conn: sqlite3.Connection) -> Dict[str, Dict]:
    """The next scheduled fixture per competition, from `scheduled_matches`.

    This is what lets a finished competition say "and the next one starts on
    24 September" from a published fixture list rather than from an inference
    about how the calendar usually runs.
    """
    have = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='scheduled_matches'"
    ).fetchone()
    if not have:
        return {}
    now = datetime.now(timezone.utc).isoformat()
    out: Dict[str, Dict] = {}
    for r in conn.execute(
            "SELECT competition_id, season, MIN(date_utc) AS d, COUNT(*) AS n "
            "FROM scheduled_matches WHERE date_utc >= ? "
            "GROUP BY competition_id, season ORDER BY d", (now,)):
        out.setdefault(r["competition_id"], {
            "season": int(r["season"]), "starts": r["d"][:10],
            "fixtures": int(r["n"])})
    return out


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sims", type=int, default=20000)
    ap.add_argument("--min-season", type=int, default=2005)
    ap.add_argument("--history", type=int, default=8,
                    help="How many editions per competition to publish, ending "
                         "at the current one. 0 for every edition on record. "
                         "Past editions are what the season explorer walks "
                         "back through; nothing after the current one is ever "
                         "published.")
    ap.add_argument("--seed", type=int, default=17)
    ap.add_argument("--output", default=str(OUT))
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=30000")

    have = {r[0] for r in conn.execute("SELECT DISTINCT competition_id FROM matches")}
    comps = [c for c in COMPETITIONS if c in have]
    logger.info("competitions: %s", ", ".join(comps))

    names = team_names(conn)
    upcoming = next_fixtures(conn)
    elo = R.build(conn)
    hist = History.build(conn)
    all_ties = T.build(conn, comps, include_qualifying=True,
                       min_season=args.min_season, include_scheduled=True)
    ped = pedigree([t for t in all_ties if not t.pending])
    main_draw = [t for t in all_ties if classify(t.round_slug) != QUALIFYING]

    # Pending ties carry no label, so they are excluded from the fit by
    # construction rather than by remembering to filter later.
    X, y, kept = build_matrix([t for t in main_draw if not t.pending],
                              elo, hist, ped)
    seasons = np.array([t.season for t in kept])

    from sklearn.base import clone
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import make_pipeline

    template = make_pipeline(
        SimpleImputer(strategy="median"),
        RandomForestClassifier(n_estimators=600, min_samples_leaf=25,
                               n_jobs=-1, random_state=17))

    by_event: Dict[Tuple[str, int], List[T.Tie]] = defaultdict(list)
    for t in main_draw:
        by_event[(t.competition_id, t.season)].append(t)

    rng = np.random.default_rng(args.seed)
    fitted: Dict[int, object] = {}
    out: List[Dict] = []

    for comp in comps:
        seasons_present = sorted({s for (c, s) in by_event if c == comp})
        if not seasons_present:
            continue
        # The CURRENT edition is the one with fixtures still to play, if there
        # is one, and otherwise the most recently finished. Taking the newest
        # season unconditionally reports a competition whose next edition has
        # one qualifying tie in the books as though that were the tournament.
        live_seasons = sorted({s for s in seasons_present
                               if any(t.pending for t in by_event[(comp, s)])})
        current_season = live_seasons[-1] if live_seasons else seasons_present[-1]

        # Past editions ship too, so a reader can walk back through them. Never
        # forward: anything after the current edition either has no draw or has
        # a handful of qualifying ties, and publishing that as "next season"
        # would put a confident-looking bracket in front of a tournament that
        # does not exist yet.
        wanted = [s for s in seasons_present if s <= current_season]
        if args.history > 0:
            wanted = wanted[-args.history:]

        for season in wanted:
            group = by_event[(comp, season)]
            rounds = rounds_in_order(group)

            entry = {
                "competition_id": comp,
                "name": COMPETITIONS[comp]["name"],
                "region": COMPETITIONS[comp]["region"],
                "season": season,
                "is_current": season == current_season,
                "bracket": _bracket(rounds, names),
                "last_match": max(t.legs[-1].date_utc for t in group)[:10],
            }
            if comp in upcoming and season == current_season:
                entry["next_fixture"] = upcoming[comp]

            model = fitted.get(season)
            if model is None:
                tr = np.flatnonzero(seasons < season)
                if len(tr) < 200:
                    entry["status"] = "insufficient_history"
                    entry["reason"] = "fewer than 200 earlier ties to learn from"
                    out.append(entry)
                    continue
                model = clone(template)
                model.fit(X[tr], y[tr])
                fitted[season] = model

            predict = lambda M: model.predict_proba(M)[:, 1]  # noqa: E731

            pending_rounds = [(slug, ts) for slug, ts in rounds
                              if any(t.pending for t in ts)]
            tree = bracket_tree([(s, ts) for s, ts in rounds
                                 if not any(t.pending for t in ts)] or rounds)

            if pending_rounds:
                # ---- something is still to be played -----------------------
                slug, current = pending_rounds[0]
                if len(current) & (len(current) - 1):
                    entry["status"] = "awaiting_draw"
                    entry["reason"] = (f"the {slug} has {len(current)} ties, which is not "
                                       f"a whole round — the draw is still being filled in")
                    entry["power_ranking"] = _power_ranking(group, elo, names)
                    out.append(entry)
                    logger.info("  %-24s %d  awaiting_draw (partial round)", comp, season)
                    continue

                champion_probs, tie_probs = simulate_open_draw(
                    current, predict, elo, hist, ped, args.sims, rng)
                played = [t for t in current if not t.pending]
                entry["status"] = "in_progress" if played else "upcoming"
                entry["current_round"] = current[0].round_label
                entry["field"] = 2 * len(current)
                entry["forecast_from"] = min(t.date_utc for t in current)[:10]
                entry["draw_known_to"] = current[0].round_label
                # Re-emit the bracket now that the undecided ties have
                # probabilities. Rebuilt rather than patched so a tie carries
                # its number in exactly one place — the round the reader is
                # watching shows a percentage on every unplayed tie, and every
                # earlier round shows the score that settled it.
                entry["bracket"] = _bracket(rounds, names, tie_probs)
                entry["ties"] = [
                    {"round": t.round_label,
                     "team_a": names.get(t.team_a, str(t.team_a)),
                     "team_b": names.get(t.team_b, str(t.team_b)),
                     "team_a_id": t.team_a, "team_b_id": t.team_b,
                     "p_team_a": round(tie_probs[(t.team_a, t.team_b)], 4),
                     "kickoff": t.date_utc[:10],
                     "decided": None if t.pending else names.get(t.winner, str(t.winner))}
                    for t in sorted(current, key=lambda x: x.date_utc)
                ]
                entry["odds"] = _odds_rows(champion_probs, names, elo,
                                           entry["forecast_from"])
                out.append(entry)
                top = entry["odds"][0]
                logger.info("  %-24s %d  %-12s %s, %d teams  favourite %s %.1f%%",
                            comp, season, entry["status"], entry["current_round"],
                            entry["field"], top["team"], 100 * top["probability"])
                continue

            if tree is None:
                # NOT `awaiting_draw`. Nothing is pending here — every tie in
                # this edition has been played, and the bracket above carries
                # the scores. What is missing is a reconstructable TREE to
                # simulate, so there are no odds to state. Filing that under
                # "the draw has not been made" put "Draw not made" on the page
                # next to the finished 2020-21 Champions League, whose final
                # Chelsea won on 2021-05-29 and which the bracket prints in
                # full. The two states differ in what the reader is owed: one
                # is a tournament that has not started, the other is a result
                # we can show but could not have forecast.
                entry["status"] = "not_reconstructed"
                entry["reason"] = ("the bracket could not be paired into a tree, so no "
                                   "forecast was made for this edition — the results below "
                                   "are what happened")
                entry["power_ranking"] = _power_ranking(group, elo, names)
                out.append(entry)
                logger.info("  %-24s %d  not_reconstructed", comp, season)
                continue

            # ---- finished: show the call that was made, then the result ----
            champion_probs = simulate(tree, predict, elo, hist, ped, args.sims, rng)
            field = sorted({tid for n in tree[0]
                            for tid in (n["tie"].team_a, n["tie"].team_b)})
            actual = tree[-1][0]["tie"].winner
            opened = tree[0][0]["tie"].date_utc[:10]

            entry["status"] = "completed"
            entry["field"] = len(field)
            entry["forecast_made_at_round"] = tree[0][0]["tie"].round_label
            entry["forecast_from"] = opened
            entry["odds"] = _odds_rows(champion_probs, names, elo, opened)
            if actual is not None:
                entry["actual_champion"] = names.get(actual, str(actual))
                entry["actual_champion_id"] = actual
                entry["probability_on_actual"] = round(champion_probs.get(actual, 0.0), 4)
                entry["called_it"] = bool(entry["odds"] and entry["odds"][0]["team_id"] == actual)

            out.append(entry)
            top = entry["odds"][0] if entry["odds"] else None
            logger.info("  %-24s %d  %-12s field %2d  favourite %s %.1f%%%s",
                        comp, season, entry["status"], len(field),
                        (top["team"] if top else "-"),
                        100 * (top["probability"] if top else 0),
                        "  <- called it" if entry.get("called_it") else "")

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": {
            "model": "random forest over tie features, refit on seasons strictly "
                     "before the edition being forecast",
            "sims": args.sims,
            "states": {
                "upcoming": "the draw is made and none of it has been played — a "
                            "forecast of something genuinely undecided",
                "in_progress": "some ties are decided; those are held at their real "
                               "winner and only the rest is simulated",
                "completed": "nothing left to predict, so the forecast shown is the one "
                             "made before the knockout stage began, next to the result",
                "awaiting_draw": "still to be played, but the round is only part drawn "
                                 "— a power ranking, not a forecast",
                "not_reconstructed": "finished, and the bracket is shown, but it could "
                                     "not be paired into a tree so no forecast was made",
                "insufficient_history": "fewer than 200 earlier ties to learn from",
            },
            "caveats": [
                "Status comes from the fixture list, not from whether a past tie "
                "could be resolved: a competition is live only when matches remain "
                "to be played.",
                "Where only the current round is drawn, later rounds are paired by a "
                "fresh random draw each round. CONMEBOL in fact seeds its bracket "
                "from the round of 16, so the true spread is slightly tighter than "
                "the title odds shown.",
                "UEFA drew the Champions League quarter-finals and semi-finals "
                "openly before 2023-24; for those editions the bracket is held "
                "fixed rather than redrawn.",
            ],
        },
        "tournaments": out,
    }
    op = Path(args.output)
    op.parent.mkdir(parents=True, exist_ok=True)
    op.write_text(json.dumps(payload, indent=2))
    logger.info("\nwrote %s", op)
    return 0


def _score(tie: T.Tie) -> Optional[str]:
    """The scoreline as a reader would say it, or None if unplayed.

    Two legs are shown as an aggregate, because that is what decided the tie —
    but a shootout is shown as well as the aggregate, never instead of it. A
    tie that finished 1-1 and went to penalties reads as a draw otherwise, and
    the bracket would show a team advancing from a drawn tie with no reason
    given.
    """
    legs = [leg for leg in tie.legs if leg.played]
    if not legs:
        return None
    a = sum(leg.home_score if leg.home_team_id == tie.team_a else leg.away_score
            for leg in legs)
    b = sum(leg.away_score if leg.home_team_id == tie.team_a else leg.home_score
            for leg in legs)
    text = f"{a}-{b}"
    last = legs[-1]
    if last.home_shootout is not None and last.away_shootout is not None:
        pa = (last.home_shootout if last.home_team_id == tie.team_a
              else last.away_shootout)
        pb = (last.away_shootout if last.home_team_id == tie.team_a
              else last.home_shootout)
        text += f" ({pa}-{pb} pens)"
    return text


def _bracket(rounds: Sequence[Tuple[str, List[T.Tie]]], names: Dict[int, str],
             tie_probs: Optional[Dict[Tuple[int, int], float]] = None) -> List[Dict]:
    """Every round of the draw, in order, as the page draws it.

    This is the whole point of a bracket and it was the one thing the forecast
    did not publish: the artifact carried the CURRENT round's ties and a list
    of title odds, so a reader could see who was favourite and never see the
    path. Rounds are emitted whether played or not, so one component renders a
    finished edition and a live one without knowing which it has.

    `feeders` is deliberately absent here. `bracket_tree` can pair a round onto
    the previous one only where the result is already known, so threading a
    tree through would make the LIVE half of a bracket — the half a reader is
    actually following — the half that cannot be drawn. The page lays rounds
    out in order and lets position carry the pairing, which is what a printed
    bracket does anyway.
    """
    probs = tie_probs or {}
    out: List[Dict] = []
    for slug, ties in rounds:
        if not ties:
            continue
        rows = []
        for t in sorted(ties, key=lambda x: (x.date_utc, x.team_a)):
            # Only an UNDECIDED tie is priced. `probs` is keyed by the pairing
            # alone, so a rematch — the same two clubs meeting again later in
            # the same edition — would otherwise hand the settled earlier tie
            # the later one's percentage, and the page would print a forecast
            # beside a result. The docstring's contract, made structural:
            # every earlier round shows the score that settled it, and only
            # the round still being played shows a number.
            p = probs.get((t.team_a, t.team_b)) if t.pending else None
            rows.append({
                "team_a": names.get(t.team_a, str(t.team_a)),
                "team_b": names.get(t.team_b, str(t.team_b)),
                "team_a_id": t.team_a,
                "team_b_id": t.team_b,
                "score": _score(t),
                "winner": names.get(t.winner) if t.winner is not None else None,
                "winner_id": t.winner,
                "p_team_a": round(p, 4) if p is not None else None,
                "kickoff": t.date_utc[:10],
                "two_legged": t.two_legged,
                "pending": t.pending,
            })
        out.append({
            "slug": slug,
            "label": ties[0].round_label,
            "display": _round_display(slug, ties[0].round_label),
            "ties": rows,
        })
    return out


# Slugs seen across the fourteen competitions, mapped to what a reader calls
# the round. Anything unlisted is spaced out from its slug rather than guessed
# at, so a new format shows an ugly-but-true label instead of a wrong one.
_ROUND_NAMES = {
    "final": "Final",
    "finals": "Finals",
    "semifinals": "Semi-finals",
    "quarterfinals": "Quarter-finals",
    "roundof16": "Round of 16",
    "roundof32": "Round of 32",
    "knockoutroundplayoffs": "Knockout play-offs",
    "3rdplace": "Third place",
    "fifthplace": "Fifth place",
    # CONMEBOL runs three numbered qualifying stages into the round of 16, and
    # ESPN writes them as one word. The fallback below can only space a slug
    # out on a separator it has, so "firststage" came out as "Firststage" —
    # true, but not a thing anyone calls that round.
    "firststage": "First stage",
    "secondstage": "Second stage",
    "thirdstage": "Third stage",
    "firstround": "First round",
    "secondround": "Second round",
    "roundone": "Round one",
    "playoff": "Play-off",
    "relegationplayoffs": "Relegation play-offs",
    # Nations League divisions, not bracket depth: League A is the top tier.
    "leaguea": "League A",
    "leagueb": "League B",
    "leaguec": "League C",
    "leagued": "League D",
}


def _round_display(slug: str, depth_label: str) -> str:
    """What to print above a round.

    NOT what to sort or pair by — `round_label` stays the counted depth, and
    that is the one the bracket's structure comes from. This exists because
    two different rounds can sit at the same depth and would otherwise print
    the same heading: the Champions League league-phase play-off and the round
    of 16 are both eight ties, so both count as "round-of-16", and an edition
    rendered from the counted label alone shows the same title twice.
    """
    if slug in _ROUND_NAMES:
        return _ROUND_NAMES[slug]
    cleaned = slug.replace("-", " ").replace("_", " ").strip()
    return cleaned.title() if cleaned else depth_label


def _odds_rows(champion_probs: Dict[int, float], names: Dict[int, str],
               elo: R.EloTable, when: str) -> List[Dict]:
    return [
        {"team_id": tid, "team": names.get(tid, str(tid)),
         "probability": round(p, 4),
         "elo": round(elo.rating_before(tid, when) or R.BASE, 1)}
        for tid, p in sorted(champion_probs.items(), key=lambda kv: -kv[1])
    ]


def _power_ranking(group: Sequence[T.Tie], elo: R.EloTable,
                   names: Dict[int, str]) -> List[Dict]:
    """Ratings of the teams that reached the knockout stage.

    Explicitly NOT a forecast. Without a bracket there is no path to a
    trophy to simulate, and a rating is the most that can honestly be said.
    """
    when = max(t.legs[-1].date_utc for t in group)
    teams = {tid for t in group for tid in (t.team_a, t.team_b)}
    rated = [(tid, elo.rating_before(tid, when)) for tid in teams]
    rated = [(tid, r) for tid, r in rated if r is not None]
    rated.sort(key=lambda kv: -kv[1])
    return [{"team_id": tid, "team": names.get(tid, str(tid)), "elo": round(r, 1)}
            for tid, r in rated[:16]]


if __name__ == "__main__":
    raise SystemExit(main())
