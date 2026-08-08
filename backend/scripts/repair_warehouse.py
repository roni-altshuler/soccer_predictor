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
        choices=("merge-identities", "rename-canonicals", "fix-dates",
                 "fix-seasons", "drop-non-participants", "dedupe-fixtures",
                 "drop-orphans", "backfill-kickoffs"),
        action="append",
        help="Run only these steps (repeatable).",
    )
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
        "merge-identities", "rename-canonicals", "fix-dates", "fix-seasons",
        "drop-non-participants", "dedupe-fixtures", "drop-orphans",
    }
    wh = Warehouse(args.db)
    try:
        wh.migrate()
        print(f"{'DRY RUN — ' if args.dry_run else ''}repairing {args.db}")

        if "merge-identities" in steps:
            r = merge_identities(wh, dry_run=args.dry_run)
            print(f"  merge-identities   : {r['merged']} merged, {r['skipped']} already clean, "
                  f"{r['matches_moved']:,} matches repointed")

        if "rename-canonicals" in steps:
            n = rename_canonicals(wh, dry_run=args.dry_run)
            print(f"  rename-canonicals  : {n} renamed")

        if "fix-dates" in steps:
            r = fix_dates(wh, dry_run=args.dry_run, build_tz=args.build_tz)
            print(f"  fix-dates          : {r['shifted']:,} of {r['candidates']:,} fdcouk rows "
                  f"un-shifted ({r['already_correct_or_real_kickoff']:,} already fine, "
                  f"{r['unparsable']} unparsable)")

        if "fix-seasons" in steps:
            r = fix_season_labels(wh, dry_run=args.dry_run)
            print(f"  fix-seasons        : {r['moved']} matches relabelled to the season "
                  f"they were actually played in")

        if "drop-non-participants" in steps:
            r = drop_non_participants(wh, dry_run=args.dry_run)
            print(f"  drop-non-participants: {r['rows']} rows for clubs that were not in "
                  f"that league-season")

        if "dedupe-fixtures" in steps:
            r = wh.merge_duplicate_fixtures(dry_run=args.dry_run)
            print(f"  dedupe-fixtures    : {r['groups']} duplicate groups, "
                  f"{r['rows_removed']:,} rows removed, "
                  f"{r['fields_coalesced']:,} fields coalesced into survivors")

        if "backfill-kickoffs" in steps:
            r = backfill_kickoffs(wh, dry_run=args.dry_run)
            print(f"  backfill-kickoffs  : {r['kickoffs_applied']:,} date-only rows given a "
                  f"real kickoff from football-data's Time column")

        if "drop-orphans" in steps:
            if args.dry_run:
                orphans = wh.find_orphan_teams()
                print(f"  drop-orphans       : {len(orphans)} zero-match teams would be removed")
            else:
                print(f"  drop-orphans       : {wh.delete_orphan_teams()} zero-match teams removed")

        if not args.dry_run:
            with wh._lock:  # noqa: SLF001
                wh._conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")  # noqa: SLF001
    finally:
        wh.close()

    print("\nNow run: .venv/bin/python -m backend.scripts.validate_warehouse_integrity")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
