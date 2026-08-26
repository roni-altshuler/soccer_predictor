"""One-off repair for warehouses built before the 2026-08-08 ingest fixes.

The loaders now prevent every defect below, but a warehouse already on disk
cannot heal itself by re-running them: rows are keyed by `match_id`, so a
duplicate fixture inserted under a split team identity survives any number
of idempotent re-runs. This script fixes what is already stored.

    .venv/bin/python -m backend.scripts.repair_warehouse --dry-run
    .venv/bin/python -m backend.scripts.repair_warehouse

Steps, in dependency order (all run by default except the last):

1. merge-identities   Fold each football-data-spelled duplicate club into
                      the ESPN club it actually is. Must run FIRST: it is
                      what makes the duplicate fixtures detectable at all,
                      because until the ids agree no GROUP BY can see
                      them. On the 2026-08-08 warehouse this turned 82
                      visible duplicate fixtures into 1,278 real ones.
2. rename-canonicals  Adopt the canonical spelling pinned in
                      `team_aliases.yml` for clubs kept under a terser name.
3. fix-dates          Undo the football-data timezone shift.
4. fix-seasons        Relabel matches filed under the season that starts
                      after they were played.
5. drop-non-participants
                      Remove rows for clubs that were not in that
                      league-season (a provider filing another
                      competition's fixture under this one).
6. dedupe-fixtures    Collapse duplicate fixtures, coalescing their columns
                      so no odds/referee/shot data is lost.
7. drop-orphans       Remove zero-match teams left by the old resolver.
8. backfill-kickoffs  OPT-IN (`--only backfill-kickoffs`), needs network.
                      Upgrades date-only rows to a real kickoff instant
                      using football-data's `Time` column (2019-20 on).

Every step is idempotent — running twice is a no-op the second time.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from backend.services.data.warehouse import WAREHOUSE_PATH, Warehouse

logger = logging.getLogger(__name__)

# (competition, football-data spelling, ESPN spelling). Hand-verified on
# 2026-08-08: in every case the first name had matches ONLY from
# source='fdcouk' and the second ONLY from source='espn', in the same
# competition — i.e. one club whose history had been cut in two.
#
# Deliberately NOT in this table, because they are genuinely distinct or
# genuinely new clubs rather than split identities:
#   ger.1 Paderborn / Heidenheim / Holstein Kiel  — ESPN never covered them
#   fra.1 Nancy                                   — ESPN never covered it
#   fra.1 Ajaccio (AC) vs GFC Ajaccio (Gazélec)   — two different clubs
#   ned.1 Almere City                             — ESPN never covered it
#   por.1 Aves (Desportivo, dissolved 2020) vs AVS (promoted 2024)
SPLIT_IDENTITIES: Tuple[Tuple[str, str, str], ...] = (
    ("eng.1", "Swansea", "Swansea City"),
    ("eng.1", "Norwich", "Norwich City"),
    ("eng.1", "Stoke", "Stoke City"),
    ("eng.1", "West Brom", "West Bromwich Albion"),
    ("eng.1", "Hull", "Hull City"),
    ("eng.1", "Huddersfield", "Huddersfield Town"),
    ("eng.1", "Cardiff", "Cardiff City"),
    ("eng.1", "Luton", "Luton Town"),
    ("eng.1", "Ipswich", "Ipswich Town"),
    ("eng.1", "Coventry", "Coventry City"),

    ("esp.1", "Ath Madrid", "Atletico Madrid"),
    ("esp.1", "La Coruna", "Deportivo La Coruña"),
    ("esp.1", "Vallecano", "Rayo Vallecano"),
    ("esp.1", "Sp Gijon", "Sporting Gijón"),
    ("esp.1", "Valladolid", "Real Valladolid"),
    ("esp.1", "Oviedo", "Real Oviedo"),

    ("ger.1", "Hertha", "Hertha Berlin"),
    ("ger.1", "Darmstadt", "SV Darmstadt 98"),
    ("ger.1", "Hannover", "Hannover 96"),
    ("ger.1", "Ingolstadt", "FC Ingolstadt 04"),
    ("ger.1", "FC Koln", "FC Cologne"),
    ("ger.1", "Freiburg", "SC Freiburg"),
    ("ger.1", "Nurnberg", "1. FC Nürnberg"),
    ("ger.1", "Union Berlin", "1. FC Union Berlin"),
    ("ger.1", "Bielefeld", "Arminia Bielefeld"),
    ("ger.1", "Greuther Furth", "SpVgg Greuther Fürth"),
    # The pin in team_aliases.yml used to make `1. FC Heidenheim` canonical
    # while ESPN wrote `1. FC Heidenheim 1846`, so the alias file itself split
    # the club: ger.1 2025 held 340 rows for a 306-match season, this merged
    # them on every run, and the next day's ingest split them again. The pin
    # now follows ESPN; this heals the warehouses written before it did.
    ("ger.1", "1. FC Heidenheim", "1. FC Heidenheim 1846"),

    ("ita.1", "Verona", "Hellas Verona"),
    ("ita.1", "Chievo", "Chievo Verona"),

    ("fra.1", "Ajaccio GFCO", "GFC Ajaccio"),
    ("fra.1", "Reims", "Stade de Reims"),
    ("fra.1", "St Etienne", "Saint-Étienne"),
    ("fra.1", "Dijon", "Dijon FCO"),
    ("fra.1", "Amiens", "SC Amiens"),
    ("fra.1", "Clermont", "Clermont Foot"),
    ("fra.1", "Auxerre", "AJ Auxerre"),

    ("ned.1", "Roda", "Roda JC Kerkrade"),
    ("ned.1", "Heracles", "Heracles Almelo"),
    ("ned.1", "Den Haag", "ADO Den Haag"),
    ("ned.1", "Graafschap", "De Graafschap"),
    ("ned.1", "Nijmegen", "NEC Nijmegen"),
    ("ned.1", "Zwolle", "PEC Zwolle"),
    ("ned.1", "Cambuur", "SC Cambuur"),
    ("ned.1", "For Sittard", "Fortuna Sittard"),
    ("ned.1", "Waalwijk", "RKC Waalwijk"),

    ("por.1", "Sp Lisbon", "Sporting CP"),
    ("por.1", "Guimaraes", "Vitória de Guimaraes"),
    ("por.1", "Setubal", "Vitoria Setubal"),
    ("por.1", "Sp Braga", "Braga"),
    ("por.1", "Nacional", "C.D. Nacional"),
    ("por.1", "Uniao Madeira", "Uniao da Madeira"),
    ("por.1", "Pacos Ferreira", "Paços de Ferreira"),
    ("por.1", "Academica", "Academica de Coimbra"),
    ("por.1", "Chaves", "GD Chaves"),
    ("por.1", "Aves", "Desportivo Aves"),
    ("por.1", "Farense", "SC Farense"),

    # Same club under two ESPN spellings across the European competitions.
    ("uefa.europa", "PAOK", "PAOK Salonika"),
)

# Clubs kept under football-data's terser spelling that team_aliases.yml
# now pins to a fuller canonical. Renaming keeps the warehouse and the
# alias file in agreement so a rebuild does not fork them again.
CANONICAL_RENAMES: Tuple[Tuple[str, str], ...] = (
    ("Paderborn", "SC Paderborn 07"),
    ("Heidenheim", "1. FC Heidenheim"),
    ("Nancy", "AS Nancy Lorraine"),
    ("Ajaccio", "AC Ajaccio"),
)

# The zone the damaged warehouse was built in — override with --build-tz if
# yours was built elsewhere. `fix-dates` only rewrites a row when
# reinterpreting it in this zone lands on EXACT local midnight, which is the
# unambiguous signature of the bug, so a wrong guess here is safe: it simply
# matches nothing. On the 2026-08-08 warehouse all 23,416 football-data rows
# matched, which is what confirmed the diagnosis.
DEFAULT_BUILD_TZ = "Asia/Jerusalem"


def _team_id(wh: Warehouse, name: str, competition: str) -> Optional[int]:
    """team_id for an exact canonical name that plays in `competition`."""
    rows = wh._conn.execute(  # noqa: SLF001
        """
        SELECT DISTINCT t.team_id
        FROM teams t
        JOIN matches m ON m.home_team_id = t.team_id OR m.away_team_id = t.team_id
        WHERE t.canonical_name = ? AND t.gender = 'M' AND m.competition_id = ?
        """,
        (name, competition),
    ).fetchall()
    if len(rows) == 1:
        return int(rows[0]["team_id"])
    if len(rows) > 1:
        logger.error("ambiguous team name %r in %s: ids %s", name, competition,
                     [r["team_id"] for r in rows])
    return None


def merge_identities(wh: Warehouse, *, dry_run: bool) -> Dict[str, int]:
    merged = skipped = matches_moved = 0
    for competition, fd_name, espn_name in SPLIT_IDENTITIES:
        src = _team_id(wh, fd_name, competition)
        dst = _team_id(wh, espn_name, competition)
        if src is None or dst is None or src == dst:
            # Already merged on an earlier run, or never present.
            skipped += 1
            continue
        if dry_run:
            n = wh._conn.execute(  # noqa: SLF001
                "SELECT COUNT(*) AS n FROM matches WHERE home_team_id = ? OR away_team_id = ?",
                (src, src),
            ).fetchone()["n"]
            logger.info("[dry-run] %s: %r(id=%d, %d matches) -> %r(id=%d)",
                        competition, fd_name, src, n, espn_name, dst)
            matches_moved += n
            merged += 1
            continue
        counts = wh.merge_teams(src, dst)
        matches_moved += counts["matches"]
        merged += 1
        logger.info("%s: merged %r(id=%d) into %r(id=%d) — %d matches",
                    competition, fd_name, src, espn_name, dst, counts["matches"])
    return {"merged": merged, "skipped": skipped, "matches_moved": matches_moved}


def merge_normalised_identities(wh: Warehouse, *, dry_run: bool) -> Dict[str, int]:
    """Merge clubs whose names normalise identically inside one competition.

    `SPLIT_IDENTITIES` above is hand-verified and therefore permanently behind
    reality: it was written for the five Wave A leagues on 2026-08-08, so a
    warehouse carrying more competitions, or a provider that changes a spelling
    next season, re-splits identities that nobody has listed yet. On the
    2026-08-10 warehouse the hand list healed 27 clubs and left 74 splits
    standing — 'Alavés'/'CD Alavés', 'Celta Vigo'/'RC Celta de Vigo' and so on.

    This closes the loop by merging exactly what
    `validate_warehouse_integrity.check_split_identities` flags in its first
    pass, reusing that module's own `_norm` so the repair and the guard can
    never drift apart.

    Two passes, mirroring the validator's own two:

    1. Exact normalised equality — 'Alavés' / 'CD Alavés'. Unambiguous.
    2. One normalised name a prefix of the other — 'Blackburn' / 'Blackburn
       Rovers'. This is where genuinely distinct clubs live ('AC Ajaccio' vs
       'GFC Ajaccio', 'Serbia' vs 'Serbia & Montenegro'), so it carries an
       extra proof obligation: **the two identities must never have played
       each other.** A club cannot be its own opponent, so a single head-to-head
       is conclusive evidence they are two different clubs. `DISTINCT_CLUB_PAIRS`
       is honoured on top of that as a second belt.

    Why this cannot be left to the hand list: `train_unified.yml` runs
    `build_warehouse --full` every Sunday, and `--full` includes the OpenFootball
    loader, which spells clubs its own way ('Real Sociedad de Fútbol', 'Angers
    SCO', 'Nîmes Olympique'). Those spellings score below `team_resolver`'s 0.92
    threshold against the ESPN name, so a second `teams` row appears and the
    fixture is inserted twice — the exact mechanism the 2026-08-08 repair fixed
    for football-data. The warehouse therefore re-splits weekly, and a static
    list of names can never catch up with it.
    """
    # Imported here rather than at module scope: the validator imports nothing
    # from this module, and keeping the dependency one-way means running the
    # repair can never be blocked by a syntax error in the guard.
    from backend.scripts.validate_warehouse_integrity import (
        DISTINCT_CLUB_PAIRS,
        _norm,
        _same_club_shape,
    )

    rows = wh._conn.execute(  # noqa: SLF001
        """
        SELECT DISTINCT t.team_id, t.canonical_name, t.gender, m.competition_id,
               COUNT(*) OVER (PARTITION BY t.team_id) AS appearances
        FROM teams t
        JOIN matches m
          ON m.home_team_id = t.team_id OR m.away_team_id = t.team_id
        """
    ).fetchall()

    buckets: Dict[Tuple[str, str, str], List[Tuple[int, str]]] = {}
    for r in rows:
        key = (r["competition_id"], r["gender"], _norm(r["canonical_name"]))
        if not key[2]:
            continue
        buckets.setdefault(key, []).append((r["team_id"], r["canonical_name"]))

    def _appearances(tid: int) -> int:
        return wh._conn.execute(  # noqa: SLF001
            "SELECT COUNT(*) AS n FROM matches "
            "WHERE home_team_id = ? OR away_team_id = ?",
            (tid, tid),
        ).fetchone()["n"]

    def _have_met(a: int, b: int) -> bool:
        return wh._conn.execute(  # noqa: SLF001
            "SELECT 1 FROM matches WHERE (home_team_id = ? AND away_team_id = ?) "
            "OR (home_team_id = ? AND away_team_id = ?) LIMIT 1",
            (a, b, b, a),
        ).fetchone() is not None

    merged = matches_moved = skipped_distinct = skipped_met = 0

    def _merge_group(competition: str, unique: Dict[int, str]) -> None:
        nonlocal merged, matches_moved
        # Survivor = the identity carrying the most history; the longer
        # spelling breaks ties, since the terse one is the provider artefact.
        ranked = sorted(
            unique.items(), key=lambda it: (_appearances(it[0]), len(it[1])), reverse=True
        )
        dst_id, dst_name = ranked[0]
        for src_id, src_name in ranked[1:]:
            if dry_run:
                n = _appearances(src_id)
                logger.info("[dry-run] %s: %r(id=%d, %d matches) -> %r(id=%d)",
                            competition, src_name, src_id, n, dst_name, dst_id)
                matches_moved += n
                merged += 1
                continue
            counts = wh.merge_teams(src_id, dst_id)
            matches_moved += counts["matches"]
            merged += 1
            logger.info("%s: merged %r(id=%d) into %r(id=%d) — %d matches",
                        competition, src_name, src_id, dst_name, dst_id,
                        counts["matches"])

    def _pinned_distinct(names: List[str]) -> bool:
        return any(
            frozenset((a, b)) in DISTINCT_CLUB_PAIRS
            for i, a in enumerate(names)
            for b in names[i + 1:]
        )

    # -- pass 1: exact normalised equality ---------------------------------
    for (competition, _gender, _norm_name), members in sorted(buckets.items()):
        unique = {tid: name for tid, name in members}
        if len(unique) < 2:
            continue
        if _pinned_distinct(list(unique.values())):
            skipped_distinct += 1
            logger.info("%s: leaving %s alone — pinned as distinct clubs",
                        competition, ", ".join(repr(n) for n in unique.values()))
            continue
        _merge_group(competition, unique)

    if dry_run:
        # Pass 2 reads state pass 1 would have written, so its findings would
        # be wrong on an unrepaired warehouse. Report pass 1 only.
        return {
            "merged": merged, "matches_moved": matches_moved,
            "skipped_distinct": skipped_distinct, "skipped_met": 0,
        }

    # -- pass 2: containment, gated on never having met --------------------
    by_comp: Dict[Tuple[str, str], List[Tuple[int, str, str]]] = {}
    for r in wh._conn.execute(  # noqa: SLF001
        """
        SELECT DISTINCT t.team_id, t.canonical_name, t.gender, m.competition_id
        FROM teams t
        JOIN matches m
          ON m.home_team_id = t.team_id OR m.away_team_id = t.team_id
        """
    ).fetchall():
        by_comp.setdefault((r["competition_id"], r["gender"]), []).append(
            (r["team_id"], r["canonical_name"], _norm(r["canonical_name"]))
        )

    for (competition, _g), members in sorted(by_comp.items()):
        for i, (id_a, name_a, norm_a) in enumerate(members):
            for id_b, name_b, norm_b in members[i + 1:]:
                if id_a == id_b or not norm_a or not norm_b or norm_a == norm_b:
                    continue
                if not _same_club_shape(name_a, name_b):
                    continue
                if _pinned_distinct([name_a, name_b]):
                    skipped_distinct += 1
                    continue
                if _have_met(id_a, id_b):
                    skipped_met += 1
                    logger.info(
                        "%s: %r(id=%d) and %r(id=%d) have played each other — "
                        "two different clubs, not a split identity",
                        competition, name_a, id_a, name_b, id_b,
                    )
                    continue
                if _appearances(id_a) == 0 or _appearances(id_b) == 0:
                    continue  # already folded away by an earlier pair
                _merge_group(competition, {id_a: name_a, id_b: name_b})

    return {
        "merged": merged,
        "matches_moved": matches_moved,
        "skipped_distinct": skipped_distinct,
        "skipped_met": skipped_met,
    }


def merge_schedule_twins(wh: Warehouse, *, dry_run: bool, min_overlap: float = 0.9,
                         min_matches: int = 10,
                         min_pair_coverage: float = 0.6) -> Dict[str, int]:
    """Merge clubs proven identical by their fixture list rather than their name.

    Name matching has a floor it cannot pass. 'FC Cologne' and '1. FC Köln' are
    one club in two languages; 'Hertha Berlin' and 'Hertha BSC', 'Brest' and
    'Stade Brestois 29', 'Rennes' and 'Stade Rennais FC 1901' likewise. No
    normaliser, fuzzy ratio or token-subset rule will ever fold those together,
    and each one silently doubles a club's fixtures.

    The schedule proves what the name cannot. Two clubs in the same
    league-season that

      * never played each other, and
      * played on the same dates, home and away, with >=90% overlap

    are one club — **but only in a round-robin, where every pair is required to
    meet.** That precondition is not optional and is measured, not assumed:

        ONLY APPLIES TO ROUND-ROBIN SEASONS. In a group-stage competition two
        clubs in different groups also never meet AND also play on identical
        matchdays, because the whole round is scheduled on one date. Run
        without the guard, this rule merged 'Feyenoord' into 'FC Astana' and
        'Olympiacos' into 'VfL Wolfsburg' across the Europa League — 19 merges,
        every one of them wrong. A season therefore qualifies only if at least
        `min_pair_coverage` of its team pairs actually played each other.

    `DISTINCT_CLUB_PAIRS` vetoes on top of that — 'AC Ajaccio' and 'GFC Ajaccio'
    hit this rule in fra.1 2015 because only one of them was in Ligue 1 that
    season and the other name was misapplied, which is a resolver bug to fix at
    the source rather than a merge to perform here.
    """
    from backend.scripts.validate_warehouse_integrity import DISTINCT_CLUB_PAIRS

    def _schedule(tid: int, comp: str, season: int) -> set:
        return {
            (r["date_utc"][:10], r["home_team_id"] == tid)
            for r in wh._conn.execute(  # noqa: SLF001
                "SELECT date_utc, home_team_id FROM matches "
                "WHERE competition_id = ? AND season = ? "
                "AND (home_team_id = ? OR away_team_id = ?)",
                (comp, season, tid, tid),
            )
        }

    merged = matches_moved = vetoed = skipped_format = 0
    pairs_done: set = set()
    # Every proven-identical pair, gathered before anything is written. Ids
    # change as merges land, so decisions are made against one consistent
    # snapshot and then resolved through a union-find.
    to_merge: List[Tuple[int, int]] = []

    season_rows = wh._conn.execute(  # noqa: SLF001
        "SELECT DISTINCT competition_id, season FROM matches ORDER BY competition_id, season"
    ).fetchall()

    for sr in season_rows:
        comp, season = sr["competition_id"], sr["season"]
        teams = wh._conn.execute(  # noqa: SLF001
            """
            SELECT t.team_id, t.canonical_name, COUNT(*) AS n
            FROM matches m
            JOIN teams t ON t.team_id IN (m.home_team_id, m.away_team_id)
            WHERE m.competition_id = ? AND m.season = ?
            GROUP BY t.team_id
            HAVING n >= ?
            """,
            (comp, season, min_matches),
        ).fetchall()

        if len(teams) < 4:
            continue

        # Is this season a round-robin? Count the share of team pairs that
        # actually met. A double round-robin scores ~1.0; a group stage scores
        # roughly 1/n_groups. Everything below the floor is skipped entirely,
        # because "never met" carries no information there.
        #
        # Counted over EVERY participant, not the >=min_matches subset above:
        # restricted to clubs with a deep European run, a knockout bracket
        # looks fully connected and scores ~1.0. That mistake let three
        # Champions/Europa League pairs through on the first attempt.
        all_ids = [
            r["team_id"]
            for r in wh._conn.execute(  # noqa: SLF001
                "SELECT DISTINCT t.team_id FROM matches m "
                "JOIN teams t ON t.team_id IN (m.home_team_id, m.away_team_id) "
                "WHERE m.competition_id = ? AND m.season = ?",
                (comp, season),
            )
        ]
        met_pairs = {
            frozenset((r["home_team_id"], r["away_team_id"]))
            for r in wh._conn.execute(  # noqa: SLF001
                "SELECT home_team_id, away_team_id FROM matches "
                "WHERE competition_id = ? AND season = ?",
                (comp, season),
            )
        }
        possible = len(all_ids) * (len(all_ids) - 1) / 2
        coverage = len(met_pairs) / possible if possible else 0.0
        if coverage < min_pair_coverage:
            logger.debug(
                "%s %s: %.0f%% of %d participants' pairs met — not a round-robin, skipping",
                comp, season, coverage * 100, len(all_ids),
            )
            skipped_format += 1
            continue

        schedules = {t["team_id"]: _schedule(t["team_id"], comp, season) for t in teams}
        for i, a in enumerate(teams):
            for b in teams[i + 1:]:
                pair = frozenset((a["team_id"], b["team_id"]))
                if pair in pairs_done:
                    continue
                met = wh._conn.execute(  # noqa: SLF001
                    "SELECT 1 FROM matches WHERE competition_id = ? AND season = ? "
                    "AND ((home_team_id = ? AND away_team_id = ?) "
                    "  OR (home_team_id = ? AND away_team_id = ?)) LIMIT 1",
                    (comp, season, a["team_id"], b["team_id"], b["team_id"], a["team_id"]),
                ).fetchone()
                if met:
                    continue
                sa, sb = schedules[a["team_id"]], schedules[b["team_id"]]
                if not sa or not sb:
                    continue
                overlap = len(sa & sb) / len(sa | sb)
                if overlap < min_overlap:
                    continue
                pairs_done.add(pair)
                if frozenset((a["canonical_name"], b["canonical_name"])) in DISTINCT_CLUB_PAIRS:
                    vetoed += 1
                    logger.warning(
                        "%s %s: %r(id=%d) and %r(id=%d) share %.0f%% of a schedule and never "
                        "met, but are pinned as distinct clubs — one of the two names is "
                        "misapplied in this season; fix the resolver, not the warehouse",
                        comp, season, a["canonical_name"], a["team_id"],
                        b["canonical_name"], b["team_id"], overlap * 100,
                    )
                    continue
                logger.info("%s %s: %r(id=%d) and %r(id=%d) share %.0f%% of a schedule "
                            "and never met — one club",
                            comp, season, a["canonical_name"], a["team_id"],
                            b["canonical_name"], b["team_id"], overlap * 100)
                to_merge.append((a["team_id"], b["team_id"]))

    # Union-find over the collected pairs, so a club split three ways collapses
    # to one survivor rather than a chain of stale ids.
    parent: Dict[int, int] = {}

    def find(x: int) -> int:
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def total_matches(tid: int) -> int:
        return wh._conn.execute(  # noqa: SLF001
            "SELECT COUNT(*) AS n FROM matches WHERE home_team_id = ? OR away_team_id = ?",
            (tid, tid),
        ).fetchone()["n"]

    for a_id, b_id in to_merge:
        ra, rb = find(a_id), find(b_id)
        if ra == rb:
            continue
        # Root the group at the identity with the most history.
        keep, drop = (ra, rb) if total_matches(ra) >= total_matches(rb) else (rb, ra)
        parent[drop] = keep

    groups: Dict[int, List[int]] = {}
    for tid in parent:
        groups.setdefault(find(tid), []).append(tid)

    for dst_id, members in groups.items():
        for src_id in members:
            if src_id == dst_id:
                continue
            name = wh._conn.execute(  # noqa: SLF001
                "SELECT canonical_name FROM teams WHERE team_id = ?", (src_id,)
            ).fetchone()
            if name is None:
                continue
            if dry_run:
                logger.info("[dry-run] merge %r(id=%d) -> id=%d", name[0], src_id, dst_id)
                merged += 1
                continue
            counts = wh.merge_teams(src_id, dst_id)
            matches_moved += counts["matches"]
            merged += 1
            logger.info("merged %r(id=%d) into id=%d — %d matches",
                        name[0], src_id, dst_id, counts["matches"])

    return {"merged": merged, "matches_moved": matches_moved, "vetoed": vetoed,
            "skipped_format": skipped_format}


def rename_canonicals(wh: Warehouse, *, dry_run: bool) -> int:
    renamed = 0
    for old, new in CANONICAL_RENAMES:
        row = wh._conn.execute(  # noqa: SLF001
            "SELECT team_id FROM teams WHERE canonical_name = ? AND gender = 'M'", (old,)
        ).fetchone()
        if row is None:
            continue
        existing = wh._conn.execute(  # noqa: SLF001
            "SELECT team_id FROM teams WHERE canonical_name = ? AND gender = 'M'", (new,)
        ).fetchone()
        if dry_run:
            logger.info("[dry-run] rename %r(id=%d) -> %r%s", old, row["team_id"], new,
                        f" (absorbing empty id={existing['team_id']})" if existing else "")
            renamed += 1
            continue
        if existing is not None and existing["team_id"] != row["team_id"]:
            # The pinned name already exists as an empty shell; drop it so
            # the UNIQUE(canonical_name, gender) rename can proceed.
            wh.merge_teams(int(existing["team_id"]), int(row["team_id"]))
        with wh._lock, wh._conn:  # noqa: SLF001
            wh._conn.execute(  # noqa: SLF001
                "UPDATE teams SET canonical_name = ? WHERE team_id = ?", (new, row["team_id"])
            )
            wh._conn.execute(  # noqa: SLF001
                "INSERT OR IGNORE INTO team_aliases(alias, gender, team_id) VALUES (?, 'M', ?)",
                (old, row["team_id"]),
            )
        logger.info("renamed %r -> %r (id=%d)", old, new, row["team_id"])
        renamed += 1
    return renamed


def fix_dates(wh: Warehouse, *, dry_run: bool, build_tz: str = DEFAULT_BUILD_TZ) -> Dict[str, int]:
    """Undo the naive-datetime timezone shift on football-data rows.

    `historical_data` produced a naive local-midnight datetime and the
    loader called `.astimezone(utc)` on it, so Python read it as build-host
    local time. Reinterpreting the stored instant back in that zone
    recovers the original midnight exactly — and the fact that it lands on
    exact midnight is the proof the row is affected. Rows that do not land
    on midnight carry a real kickoff and are left alone.
    """
    tz = ZoneInfo(build_tz)
    rows = wh._conn.execute(  # noqa: SLF001
        "SELECT match_id, date_utc FROM matches WHERE source = 'fdcouk'"
    ).fetchall()

    updates: List[Tuple[str, str]] = []
    unaffected = unparsable = 0
    for r in rows:
        raw = str(r["date_utc"])
        try:
            stored = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            unparsable += 1
            continue
        if stored.tzinfo is None:
            stored = stored.replace(tzinfo=timezone.utc)
        local = stored.astimezone(tz)
        if (local.hour, local.minute, local.second) != (0, 0, 0):
            unaffected += 1
            continue
        corrected = datetime(
            local.year, local.month, local.day, tzinfo=timezone.utc
        ).isoformat()
        if corrected != raw:
            updates.append((corrected, r["match_id"]))

    if updates and not dry_run:
        with wh._lock, wh._conn:  # noqa: SLF001
            wh._conn.executemany(  # noqa: SLF001
                "UPDATE matches SET date_utc = ? WHERE match_id = ?", updates
            )
    return {
        "candidates": len(rows),
        "shifted": len(updates),
        "already_correct_or_real_kickoff": unaffected,
        "unparsable": unparsable,
    }


def fix_season_labels(wh: Warehouse, *, dry_run: bool) -> Dict[str, int]:
    """Move matches labelled with the season that starts after they were played.

    A domestic season cannot begin before its predecessor has finished, so a
    match labelled season S whose date precedes the last match of season S-1
    in the same competition is mislabelled. ESPN assigns the season from the
    calendar year, which broke when COVID pushed Serie A 2019-20's final
    matchday to 1-2 August 2020: the 1 August fixtures were filed as
    2020-21, giving that season 21 teams and a wrong final table.

    Deliberately conservative — it only ever moves a match one season
    EARLIER, and only when the dates make the current label impossible.
    """
    leagues = tuple(sorted({c for c, _n, _e in SPLIT_IDENTITIES} | {"eng.1", "esp.1", "ger.1", "ita.1", "fra.1"}))
    spans = {
        (r["competition_id"], r["season"]): (r["mn"], r["mx"])
        for r in wh._conn.execute(  # noqa: SLF001
            "SELECT competition_id, season, MIN(date_utc) AS mn, MAX(date_utc) AS mx "
            "FROM matches WHERE competition_id IN ({}) GROUP BY 1, 2".format(
                ", ".join("?" * len(leagues))
            ),
            leagues,
        ).fetchall()
    }

    moves: List[Tuple[int, str]] = []
    for r in wh._conn.execute(  # noqa: SLF001
        "SELECT match_id, competition_id, season, date_utc FROM matches "
        "WHERE competition_id IN ({})".format(", ".join("?" * len(leagues))),
        leagues,
    ).fetchall():
        prev = spans.get((r["competition_id"], r["season"] - 1))
        if prev is None:
            continue
        if r["date_utc"] <= prev[1]:
            moves.append((r["season"] - 1, r["match_id"]))
            if dry_run:
                logger.info(
                    "[dry-run] %s %s: season %d -> %d (played %s, but season %d ran to %s)",
                    r["competition_id"], r["match_id"], r["season"], r["season"] - 1,
                    r["date_utc"][:10], r["season"] - 1, prev[1][:10],
                )
    if moves and not dry_run:
        with wh._lock, wh._conn:  # noqa: SLF001
            wh._conn.executemany(  # noqa: SLF001
                "UPDATE matches SET season = ? WHERE match_id = ?", moves
            )
    return {"moved": len(moves)}


def drop_non_participants(wh: Warehouse, *, dry_run: bool, max_appearances: int = 2) -> Dict[str, int]:
    """Delete rows for clubs that were never in that league-season.

    Every competition here is a double round-robin, so a real participant
    plays 2*(N-1) matches. A club with one or two appearances in a
    300-fixture season did not take part — the row is a fixture from
    another competition that the provider filed under this one (ESPN
    returned a Ligue 2 match, Le Havre 2-0 Brest on 2018-05-15, under the
    Ligue 1 scoreboard). Left alone it adds phantom teams to the final
    table and to that season's ground truth.
    """
    leagues = ("eng.1", "esp.1", "ger.1", "ita.1", "fra.1", "ned.1", "por.1")
    placeholders = ", ".join("?" * len(leagues))
    suspects = wh._conn.execute(  # noqa: SLF001
        f"""
        SELECT competition_id, season, tid, COUNT(*) AS appearances FROM (
            SELECT competition_id, season, home_team_id AS tid FROM matches
             WHERE competition_id IN ({placeholders})
            UNION ALL
            SELECT competition_id, season, away_team_id AS tid FROM matches
             WHERE competition_id IN ({placeholders})
        )
        GROUP BY competition_id, season, tid
        HAVING appearances <= ?
        """,
        (*leagues, *leagues, max_appearances),
    ).fetchall()

    doomed: List[str] = []
    for s in suspects:
        # Only act when the season is otherwise full-sized, so a genuinely
        # partial/in-progress season is never pruned.
        total = wh._conn.execute(  # noqa: SLF001
            "SELECT COUNT(*) AS n FROM matches WHERE competition_id = ? AND season = ?",
            (s["competition_id"], s["season"]),
        ).fetchone()["n"]
        if total < 200:
            continue
        rows = wh._conn.execute(  # noqa: SLF001
            """
            SELECT m.match_id, m.date_utc, h.canonical_name AS hn, a.canonical_name AS an
            FROM matches m
            JOIN teams h ON h.team_id = m.home_team_id
            JOIN teams a ON a.team_id = m.away_team_id
            WHERE m.competition_id = ? AND m.season = ?
              AND (m.home_team_id = ? OR m.away_team_id = ?)
            """,
            (s["competition_id"], s["season"], s["tid"], s["tid"]),
        ).fetchall()
        for r in rows:
            logger.info(
                "%s %s: %r %s %r — only %d appearance(s), not a participant%s",
                s["competition_id"], s["season"], r["hn"], r["date_utc"][:10], r["an"],
                s["appearances"], " [dry-run]" if dry_run else "",
            )
            doomed.append(r["match_id"])

    doomed = sorted(set(doomed))
    if doomed and not dry_run:
        marks = ", ".join("?" * len(doomed))
        with wh._lock, wh._conn:  # noqa: SLF001
            wh._conn.execute(f"DELETE FROM match_events WHERE match_id IN ({marks})", doomed)
            wh._conn.execute(f"DELETE FROM match_event_coverage WHERE match_id IN ({marks})", doomed)
            wh._conn.execute(f"DELETE FROM weather WHERE match_id IN ({marks})", doomed)
            wh._conn.execute(f"DELETE FROM matches WHERE match_id IN ({marks})", doomed)
    return {"rows": len(doomed)}


def backfill_kickoffs(wh: Warehouse, *, dry_run: bool) -> Dict[str, int]:
    """Give date-only football-data rows their real kickoff instant.

    `fix_dates` recovers the correct calendar DAY but leaves the row at
    00:00:00Z, because football-data's `Date` column carries no time. Its
    `Time` column does, from the 2019-20 season onward, for every league.
    This fetches those season files and upgrades the matching rows.

    Rows outside that window keep 00:00:00Z and stay honestly
    kickoff-unknown. Needs network: ~50 small CSV GETs.
    """
    import asyncio

    import httpx

    from backend.services.data.footballdata_loader import (
        FD_TO_COMPETITION_ID,
        _combine_local_kickoff,
        _venue_timezone,
        fetch_kickoff_times,
    )
    from backend.services.prediction.historical_data import FOOTBALL_DATA_SEASONS

    async def _run() -> List[Tuple[str, str]]:
        updates: List[Tuple[str, str]] = []
        async with httpx.AsyncClient(
            headers={"User-Agent": "SoccerPredictor/4.0 (+research)"}, follow_redirects=True
        ) as client:
            for league, competition_id in FD_TO_COMPETITION_ID.items():
                for season in FOOTBALL_DATA_SEASONS.get(league, []):
                    if season < 2019:  # `Time` first appears in the 2019-20 file
                        continue
                    rows = wh._conn.execute(  # noqa: SLF001
                        """
                        SELECT m.match_id, m.date_utc, h.canonical_name AS hn,
                               a.canonical_name AS an
                        FROM matches m
                        JOIN teams h ON h.team_id = m.home_team_id
                        JOIN teams a ON a.team_id = m.away_team_id
                        WHERE m.competition_id = ? AND m.season = ?
                          AND substr(m.date_utc, 12, 8) = '00:00:00'
                        """,
                        (competition_id, season),
                    ).fetchall()
                    if not rows:
                        continue
                    kickoffs = await fetch_kickoff_times(client, league, season)
                    if not kickoffs:
                        continue
                    # football-data spells clubs its own way; the warehouse
                    # now holds the canonical spelling, so index the fetched
                    # kickoffs by date and resolve the pair through aliases.
                    by_date: Dict[str, List[Tuple[str, str, str]]] = {}
                    for (day, home, away), hhmm in kickoffs.items():
                        by_date.setdefault(day, []).append((home, away, hhmm))

                    for r in rows:
                        day = r["date_utc"][:10]
                        for home, away, hhmm in by_date.get(day, []):
                            if (
                                wh.find_team_id_by_alias(home, "M") is None
                                or wh.find_team_id_by_alias(away, "M") is None
                            ):
                                continue
                            hid = wh.find_team_id_by_alias(home, "M")
                            aid = wh.find_team_id_by_alias(away, "M")
                            match = wh._conn.execute(  # noqa: SLF001
                                "SELECT home_team_id, away_team_id FROM matches WHERE match_id = ?",
                                (r["match_id"],),
                            ).fetchone()
                            if match["home_team_id"] != hid or match["away_team_id"] != aid:
                                continue
                            base = datetime.fromisoformat(r["date_utc"].replace("Z", "+00:00"))
                            precise = _combine_local_kickoff(
                                base, hhmm, _venue_timezone(league, home)
                            )
                            if precise is not None:
                                updates.append((precise.isoformat(), r["match_id"]))
                            break
        return updates

    updates = asyncio.run(_run())
    if updates and not dry_run:
        with wh._lock, wh._conn:  # noqa: SLF001
            wh._conn.executemany(  # noqa: SLF001
                "UPDATE matches SET date_utc = ? WHERE match_id = ?", updates
            )
    return {"kickoffs_applied": len(updates)}


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--db", type=Path, default=WAREHOUSE_PATH)
    parser.add_argument("--dry-run", action="store_true", help="Report without writing.")
    parser.add_argument("--build-tz", default=DEFAULT_BUILD_TZ,
                        help="Timezone the damaged warehouse was built in (fix-dates).")
    parser.add_argument(
        "--only",
        choices=("merge-identities", "merge-normalised", "merge-schedule-twins",
                 "rename-canonicals", "fix-dates", "fix-seasons",
                 "drop-non-participants", "dedupe-fixtures", "drop-orphans",
                 "backfill-kickoffs"),
        action="append",
        help="Run only these steps (repeatable).",
    )
    parser.add_argument(
        "--fixpoint", action="store_true",
        help="Repeat the step sequence until a pass changes nothing. Each merge "
             "exposes duplicates that expose more split identities, so one pass "
             "always leaves work behind. Exits 3 if it is still changing after "
             "--max-passes.",
    )
    parser.add_argument("--max-passes", type=int, default=6)
    parser.add_argument(
        "--report", type=Path,
        help="Write a JSON summary of what the repair changed (accumulated "
             "across fixpoint passes). The event-coverage guard reads "
             "`match_rows_removed` from it to allow the covered count to "
             "shrink by exactly the duplicates removed, and no more.")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(message)s",
        stream=sys.stderr,
    )
    if not args.db.exists():
        print(f"warehouse not found at {args.db}", file=sys.stderr)
        return 2

    steps = set(args.only) if args.only else {
        "merge-identities", "merge-normalised", "merge-schedule-twins",
        "rename-canonicals", "fix-dates", "fix-seasons",
        "drop-non-participants", "dedupe-fixtures", "drop-orphans",
    }
    wh = Warehouse(args.db)
    try:
        wh.migrate()
        print(f"{'DRY RUN — ' if args.dry_run else ''}repairing {args.db}")

        report: Dict[str, int] = {}
        changed = _run_once(wh, steps, args, report)
        if args.fixpoint and not args.dry_run:
            # Each merge exposes duplicates that expose more split identities, so
            # a single pass leaves work behind. Loop until a pass changes nothing.
            for extra in range(2, args.max_passes + 1):
                if changed == 0:
                    break
                print(f"\n-- pass {extra} (previous pass made {changed:,} changes) --")
                changed = _run_once(wh, steps, args, report)
            else:
                if changed:
                    print(
                        f"\nSTILL CHANGING after {args.max_passes} passes "
                        f"({changed:,} in the last one) — not a fixpoint.",
                        file=sys.stderr,
                    )
                    return 3
            print(f"\nfixpoint reached: the last pass changed nothing")

        if not args.dry_run:
            with wh._lock:  # noqa: SLF001
                wh._conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")  # noqa: SLF001

        if args.report:
            # A dry run's counts are hypothetical (each step reports what it
            # WOULD change against unrepaired state), so say so in the file
            # rather than letting a guard consume them as fact.
            args.report.write_text(json.dumps(
                {"dry_run": args.dry_run, **report}, indent=2))
            print(f"report written to {args.report}")
    finally:
        wh.close()

    print("\nNow run: python3 -m backend.scripts.validate_warehouse_integrity")
    return 0


def _run_once(wh: Warehouse, steps: set, args,
              report: Optional[Dict[str, int]] = None) -> int:
    """One full pass of the selected steps. Returns how many rows it changed.

    `report` accumulates the counts a caller can act on across fixpoint
    passes — today that is `match_rows_removed`, the number of `matches` rows
    deleted outright. The event-coverage guard in `event_backfill.yml` needs
    it: a deduped twin can carry a coverage row of its own (the secondary
    backfill covers football-data rows the primary has no event id for), so
    collapsing the pair legitimately shrinks the covered-match count by one.
    The guard allows a drop of at most this number — exact accounting, not a
    tolerance.
    """
    changed = 0
    if "merge-identities" in steps:
        r = merge_identities(wh, dry_run=args.dry_run)
        print(f"  merge-identities   : {r['merged']} merged, {r['skipped']} already clean, "
              f"{r['matches_moved']:,} matches repointed")
        changed += r['merged']

    if "merge-normalised" in steps:
        r = merge_normalised_identities(wh, dry_run=args.dry_run)
        print(f"  merge-normalised   : {r['merged']} merged, "
              f"{r['matches_moved']:,} matches repointed, "
              f"{r['skipped_distinct']} pinned distinct, "
              f"{r['skipped_met']} proven distinct by a head-to-head")
        changed += r['merged']

    if "rename-canonicals" in steps:
        n = rename_canonicals(wh, dry_run=args.dry_run)
        print(f"  rename-canonicals  : {n} renamed")
        changed += n

    if "fix-dates" in steps:
        r = fix_dates(wh, dry_run=args.dry_run, build_tz=args.build_tz)
        print(f"  fix-dates          : {r['shifted']:,} of {r['candidates']:,} fdcouk rows "
              f"un-shifted ({r['already_correct_or_real_kickoff']:,} already fine, "
              f"{r['unparsable']} unparsable)")
        changed += r['shifted']

    if "fix-seasons" in steps:
        r = fix_season_labels(wh, dry_run=args.dry_run)
        print(f"  fix-seasons        : {r['moved']} matches relabelled to the season "
              f"they were actually played in")
        changed += r['moved']

    if "drop-non-participants" in steps:
        r = drop_non_participants(wh, dry_run=args.dry_run)
        print(f"  drop-non-participants: {r['rows']} rows for clubs that were not in "
              f"that league-season")
        changed += r['rows']
        if report is not None:
            report["match_rows_removed"] = (
                report.get("match_rows_removed", 0) + r["rows"])

    if "dedupe-fixtures" in steps:
        r = wh.merge_duplicate_fixtures(dry_run=args.dry_run)
        print(f"  dedupe-fixtures    : {r['groups']} duplicate groups, "
              f"{r['rows_removed']:,} rows removed, "
              f"{r['fields_coalesced']:,} fields coalesced into survivors")
        changed += r['rows_removed']
        if report is not None:
            report["match_rows_removed"] = (
                report.get("match_rows_removed", 0) + r["rows_removed"])

    # Runs AFTER dedupe on purpose. Its round-robin precondition is measured
    # from the season itself, and a season still carrying split identities
    # and duplicate rows does not look like a round-robin — so run early, it
    # disqualifies exactly the seasons it exists to repair.
    if "merge-schedule-twins" in steps:
        r = merge_schedule_twins(wh, dry_run=args.dry_run)
        print(f"  merge-schedule-twins: {r['merged']} merged, "
              f"{r['matches_moved']:,} matches repointed, "
              f"{r['vetoed']} vetoed as pinned-distinct, "
              f"{r['skipped_format']} season(s) skipped as not round-robin")
        changed += r['merged']

    if "backfill-kickoffs" in steps:
        r = backfill_kickoffs(wh, dry_run=args.dry_run)
        print(f"  backfill-kickoffs  : {r['kickoffs_applied']:,} date-only rows given a "
              f"real kickoff from football-data's Time column")
        changed += r['kickoffs_applied']

    if "drop-orphans" in steps:
        if args.dry_run:
            orphans = wh.find_orphan_teams()
            print(f"  drop-orphans       : {len(orphans)} zero-match teams would be removed")
        else:
            dropped = wh.delete_orphan_teams()
            changed += dropped
            print(f"  drop-orphans       : {dropped} zero-match teams removed")

    return changed


if __name__ == "__main__":
    raise SystemExit(main())
