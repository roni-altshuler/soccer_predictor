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
from backend.services.tournament.rounds import (  # noqa: E402
    QUALIFYING,
    classify,
    depth_label,
)

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

        # ---- the edition that has not started yet --------------------
        # Published as soon as FIXTURES for it exist, which is well before the
        # knockout draw is made. Without this the page had nothing at all to
        # say about the next Champions League between one final and the next
        # draw — a gap of three months on the competition readers ask about
        # most, during which the site's most prominent page showed only last
        # season's result.
        #
        # It carries no bracket and no odds by construction. The moment the
        # draw lands, `wanted` includes that season and the real edition
        # replaces this one, because a published edition always sorts newer.
        nf = upcoming.get(comp)
        if nf and nf["season"] > current_season:
            out.append({
                "competition_id": comp,
                "name": COMPETITIONS[comp]["name"],
                "region": COMPETITIONS[comp]["region"],
                "season": nf["season"],
                "is_current": False,
                "bracket": [],
                "status": "awaiting_fixtures",
                "reason": ("fixtures are published but the knockout draw for this "
                           "edition has not been made"),
                "next_fixture": nf,
            })
            logger.info("  %-24s %d  awaiting_fixtures (%d fixtures from %s)",
                        comp, nf["season"], nf["fixtures"], nf["starts"])

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
                "awaiting_fixtures": "the next edition — fixtures exist but the knockout "
                                     "draw has not been made, so there is nothing to "
                                     "forecast yet",
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


def _bracket_slots(
    rounds: Sequence[Sequence[Tuple[int, int]]],
    *,
    project: bool = False,
) -> Tuple[Dict[Tuple[int, int], int], int]:
    """Where each tie sits in the bracket, as a printed bracket would place it.

    Takes rounds of `(team_a_id, team_b_id)` pairs, already in the order they
    will be printed, rather than `Tie` objects — the placement is pure
    arithmetic over who played whom, and keeping it that way lets the same
    function place a bracket read back out of a published artifact.

    Returns `{(round_index, tie_index): slot}`. A round holding `n` ties owns
    slots `0..2n-1` of the round before it: the tie at slot `s` is fed by slots
    `2s` and `2s+1`, which is the rule the whole drawing depends on. The final
    is slot 0 of a one-slot round, and every earlier round doubles.

    This is what the old comment here said could not be done, and the reasoning
    was half right. `bracket_tree` refuses the WHOLE edition when any single
    pairing cannot be traced, so threading it through would indeed have left a
    live bracket undrawable. But a bracket does not need every pairing to be
    known in order to be drawn — it needs every SLOT to be known. A tie whose
    feeder is still to be played is an empty box, which is exactly what a
    printed bracket shows before the tournament starts.

    So the tree is walked BACKWARDS from the final, which is the direction the
    information actually flows: a later tie names the two clubs that won their
    way into it, and `source` says which earlier tie each of them came out of.
    Whatever cannot be traced that way is placed into the slots left over, in
    date order, rather than dropping the round.

    Only the trophy tree is placed. Entry rounds are excluded on the same rule
    `bracket_tree` uses — the longest run of rounds that halves cleanly. The
    Europa League bolts a 16-tie play-off round onto a 16-tie round of 32 and
    the Champions League has done the same since 2024; those are ways into the
    bracket, not rounds of it, and forcing them in doubles the drawing and
    misaligns every pairing above them.

    The run does NOT have to end in a final, and that is what makes a LIVE
    tournament drawable. `bracket_tree` requires one, so the two competitions
    actually being played — the ones a reader most wants a bracket for —
    produced nothing: the Libertadores stops at a drawn round of 16 because
    the quarter-finals do not exist yet. The last round of the run is the
    frontier, it takes slots `0..n-1`, and the rounds above it are returned as
    a count so the page can draw them as the empty boxes a printed bracket
    shows before a tournament starts.

    Forward projection is only offered when `project` is set, which the caller
    ties to the edition having fixtures still to play. Without that gate the
    2020-21 Europa League — finished, and holding a malformed trailing round of
    16 — would sprout four empty rounds above a competition Villarreal won five
    years ago. Empty boxes are a true statement about a draw that has not
    happened and a false one about a tournament that is over.

    Returns `(slots, to_come)` where `to_come` is how many rounds sit above the
    frontier: 0 for a finished bracket, 3 for one drawn only to the round of 16.
    """
    sizes = [len(r) for r in rounds]
    if not sizes:
        return {}, 0
    frontier = sizes[-1]
    # A frontier that is not a power of two is not a round of a bracket.
    if frontier < 1 or frontier & (frontier - 1):
        return {}, 0
    start = len(sizes) - 1
    while start > 0 and sizes[start - 1] == sizes[start] * 2:
        start -= 1

    to_come = (frontier.bit_length() - 1) if project else 0
    # Two rows make a bracket. A single drawn round counts when the rounds
    # above it are still to come — that is the whole live case, where the
    # Libertadores has its round of 16 and nothing above it yet.
    if frontier != 1 and not project:
        return {}, 0
    if (len(sizes) - start) + to_come < 2:
        return {}, 0
    slot_of: Dict[Tuple[int, int], int] = {
        (len(rounds) - 1, i): i for i in range(frontier)
    }
    for depth in range(len(rounds) - 1, start, -1):
        prev_ties = rounds[depth - 1]
        cur_ties = rounds[depth]

        # Which earlier tie did each club come out of? A club appears in at
        # most one tie per round, so this is a lookup and not a search.
        source: Dict[int, int] = {}
        for i, (a, b) in enumerate(prev_ties):
            source[a] = i
            source[b] = i

        placed: Dict[int, int] = {}
        taken: set = set()
        for j, (a, b) in enumerate(cur_ties):
            s = slot_of.get((depth, j))
            if s is None:
                continue
            for feeder, target in ((source.get(a), 2 * s),
                                   (source.get(b), 2 * s + 1)):
                if feeder is None or feeder in placed or target in taken:
                    continue
                placed[feeder] = target
                taken.add(target)

        # Anything the results could not place — a pending tie, or a leg the
        # source never carried — takes a free slot rather than vanishing.
        free = [s for s in range(2 * len(cur_ties)) if s not in taken]
        for i in range(len(prev_ties)):
            if i in placed or not free:
                continue
            placed[i] = free.pop(0)
        for i, s in placed.items():
            slot_of[(depth - 1, i)] = s
    return slot_of, to_come


def _bracket(rounds: Sequence[Tuple[str, List[T.Tie]]], names: Dict[int, str],
             tie_probs: Optional[Dict[Tuple[int, int], float]] = None) -> List[Dict]:
    """Every round of the draw, in order, as the page draws it.

    This is the whole point of a bracket and it was the one thing the forecast
    did not publish: the artifact carried the CURRENT round's ties and a list
    of title odds, so a reader could see who was favourite and never see the
    path. Rounds are emitted whether played or not, so one component renders a
    finished edition and a live one without knowing which it has.

    Each tie carries the `slot` it occupies in its round, so the page can draw
    a real two-sided bracket rather than a stack of lists — see
    `_bracket_slots`. A round outside the trophy tree carries `slots: 0` and
    every tie in it `slot: None`; it is a way into the bracket, not a round of
    it, and the page prints it separately.

    Rounds that have not been drawn yet are emitted too, with no ties and
    `projected: true`. A tournament stopped at a drawn round of 16 gets its
    quarter-finals, semi-finals and final as empty rounds, because a bracket
    missing its top three rows is not a bracket — and the empty boxes are a
    true statement about a draw that has not happened.
    """
    probs = tie_probs or {}
    ordered = [(slug, sorted(ties, key=lambda x: (x.date_utc, x.team_a)))
               for slug, ties in rounds if ties]
    slot_of, to_come = _bracket_slots(
        [[(t.team_a, t.team_b) for t in ties] for _, ties in ordered],
        project=any(t.pending for _, ties in ordered for t in ties),
    )

    out: List[Dict] = []
    for depth, (slug, ties) in enumerate(ordered):
        rows = []
        for idx, t in enumerate(ties):
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
                "slot": slot_of.get((depth, idx)),
            })
        placed = sum(1 for r in rows if r["slot"] is not None)
        out.append({
            "slug": slug,
            "label": ties[0].round_label,
            "display": _round_display(slug, ties[0].round_label),
            # Positions in this round of the bracket, which is TWICE the ties
            # in the round above it — not the number of ties here. A round of
            # 16 that is missing a tie still owns sixteen slots, and the hole
            # is the point: it draws as an empty box.
            "slots": (2 ** (len(ordered) - 1 - depth)) * (2 ** to_come) if placed else 0,
            "ties": rows,
            "projected": False,
        })

    # The rounds above the frontier: drawn from the shape of the bracket, not
    # from any fixture, so they are named by the size they must be and carry
    # nothing else.
    for step in range(to_come - 1, -1, -1):
        n = 2 ** step
        out.append({
            "slug": f"projected-{n}",
            "label": depth_label(2 * n),
            "display": _slots_display(n),
            "slots": n,
            "ties": [],
            "projected": True,
        })
    return out


def _slots_display(slots: int) -> str:
    """What to call a round nobody has drawn yet, from its size alone."""
    return {1: "Final", 2: "Semi-finals", 4: "Quarter-finals"}.get(
        slots, f"Round of {2 * slots}")


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
