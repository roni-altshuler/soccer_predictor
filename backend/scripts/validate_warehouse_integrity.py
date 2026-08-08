"""Assert every data-integrity invariant the warehouse is supposed to hold.

This is the regression guard for the defects catalogued in
`docs/PIVOT_2026-08.md` §4c. Each of them silently corrupted either
training labels or evaluation truth, and none of them announced itself —
they were found by hand-auditing a benchmark. This script turns each one
into an assertion that fails loudly.

Run it after any warehouse build or repair:

    .venv/bin/python -m backend.scripts.validate_warehouse_integrity

Exit codes
----------
0  every check passed (warnings may still be printed)
1  at least one check FAILED
2  the warehouse could not be opened / is empty

Checks
------
1.  season_team_counts   Distinct teams per league-season equals the real
                         size of that league. A split team identity or a
                         mislabelled season shows up here first, and it is
                         what makes a reconstructed final table wrong.
2.  duplicate_fixtures   No two rows share (competition, season, home,
                         away). Every competition checked is a double
                         round-robin, so a repeat is always an artefact.
3.  split_identities     No two teams in the same competition have names
                         that normalise to near-identical strings.
4.  orphan_teams         No `teams` row with zero matches.
5.  date_utc_sanity      Timestamps parse, carry UTC, sit in a plausible
                         range, and the weekday distribution peaks at the
                         weekend rather than a day early.
6.  season_row_counts    Row count per league-season is within tolerance
                         of the true fixture count.
7.  coverage             Per-column non-null coverage, reported always and
                         asserted only where a floor is genuinely expected.
8.  referential          No match points at a missing team/competition;
                         no weather row points at a missing match.

`--strict` promotes coverage warnings to failures. `--json PATH` writes a
machine-readable report.
"""

from __future__ import annotations

import argparse
import json
import sys
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from backend.services.data.warehouse import WAREHOUSE_PATH, Warehouse

# Real size of each league, by season where it changed. A season-season
# mapping rather than one number because these genuinely move: the
# Bundesliga has always been 18, but Ligue 1 dropped 20 → 18 in 2023-24
# and the Eredivisie/Primeira Liga each changed size in the window.
LEAGUE_SIZE: Dict[str, Dict[str, int]] = {
    "eng.1": {"default": 20},
    "esp.1": {"default": 20},
    "ita.1": {"default": 20, "2005": 20, "2006": 20},
    "ger.1": {"default": 18},
    "fra.1": {"default": 20, "2023": 18, "2024": 18, "2025": 18},
    "ned.1": {"default": 18},
    "por.1": {"default": 18, "2005": 18, "2014": 18, "2015": 18, "2016": 18},
}

WAVE_A = ("eng.1", "esp.1", "ger.1", "ita.1", "fra.1")

# Seasons that genuinely ended early, so a short row count is the truth
# rather than missing data. Ligue 1 and the Eredivisie were abandoned in
# March 2020 and never resumed; both were declared final as played.
TRUNCATED_SEASONS: Dict[Tuple[str, int], str] = {
    ("fra.1", 2019): "abandoned 2020-03-08 (COVID-19); Ligue 1 declared final on 279 matches",
    ("ned.1", 2019): "abandoned 2020-03-08 (COVID-19); Eredivisie declared void/final on 232 matches",
}

# Club pairs whose names look alike to the containment heuristic but are
# genuinely different clubs. Each was checked by hand — do not add to this
# list to silence a real split identity.
DISTINCT_CLUB_PAIRS: frozenset = frozenset(
    frozenset(pair) for pair in (
        ("Paris Saint-Germain", "Paris FC"),        # different Paris clubs
        ("Inter", "Inter Baku"),                    # Milan vs Azerbaijan
        ("Arsenal", "FC Arsenal Tula"),             # London vs Tula
        ("Aris", "Aris Limassol"),                  # Thessaloniki vs Cyprus
        ("GFC Ajaccio", "AC Ajaccio"),              # Gazélec vs AC, same city
        ("Desportivo Aves", "AVS"),                 # dissolved 2020 vs founded 2024
        ("Hellas Verona", "Chievo Verona"),         # two Verona clubs
    )
)

# Columns whose coverage we always report. `floor` is asserted only when a
# genuine minimum is expected; None means "report, never fail" because the
# true coverage is a property of what the sources publish, not a bug.
COVERAGE_COLUMNS: Tuple[Tuple[str, str, Optional[float]], ...] = (
    ("matches", "home_score", 0.95),
    ("matches", "date_utc", 1.0),
    ("matches", "odds_home", None),
    ("matches", "referee_id", None),
    ("matches", "home_xg", None),
    ("matches", "venue", None),
    ("matches", "attendance", None),
)


def _norm(name: str) -> str:
    """Aggressive normalisation used only for near-duplicate detection."""
    nfkd = unicodedata.normalize("NFKD", name or "")
    ascii_only = "".join(c for c in nfkd if not unicodedata.combining(c)).lower()
    keep = [c for c in ascii_only if c.isalnum() or c == " "]
    tokens = "".join(keep).split()
    noise = {
        "fc", "cf", "sc", "ac", "afc", "sv", "as", "rc", "cd", "ud", "gd",
        "aj", "sd", "club", "de", "the", "1", "04", "07", "96", "98",
    }
    return " ".join(t for t in tokens if t not in noise)


@dataclass
class CheckResult:
    name: str
    passed: bool
    detail: str
    failures: List[str] = field(default_factory=list)
    data: Dict[str, Any] = field(default_factory=dict)
    warning: bool = False


class IntegrityValidator:
    def __init__(self, warehouse: Warehouse, *, strict: bool = False):
        self.wh = warehouse
        self.strict = strict
        self.results: List[CheckResult] = []

    def _q(self, sql: str, args: Tuple = ()) -> List:
        with self.wh._lock:  # noqa: SLF001
            return self.wh._conn.execute(sql, args).fetchall()  # noqa: SLF001

    # -- 1 -----------------------------------------------------------------
    def check_season_team_counts(self) -> CheckResult:
        rows = self._q(
            """
            SELECT competition_id, season,
                   COUNT(DISTINCT home_team_id) AS home_teams,
                   COUNT(DISTINCT away_team_id) AS away_teams
            FROM matches
            WHERE competition_id IN ({})
            GROUP BY competition_id, season
            ORDER BY competition_id, season
            """.format(", ".join("?" * len(LEAGUE_SIZE))),
            tuple(LEAGUE_SIZE),
        )
        failures, checked = [], 0
        for r in rows:
            sizes = LEAGUE_SIZE[r["competition_id"]]
            expected = sizes.get(str(r["season"]), sizes["default"])
            checked += 1
            observed = max(r["home_teams"], r["away_teams"])
            if observed != expected:
                failures.append(
                    f"{r['competition_id']} {r['season']}: {observed} distinct "
                    f"teams, expected {expected}"
                )
        return CheckResult(
            name="season_team_counts",
            passed=not failures,
            detail=f"{checked - len(failures)}/{checked} league-seasons have the right team count",
            failures=failures,
            data={"checked": checked, "bad": len(failures)},
        )

    # -- 2 -----------------------------------------------------------------
    def check_duplicate_fixtures(self) -> CheckResult:
        groups = self.wh.find_duplicate_fixtures()
        excess = sum(g["n"] - 1 for g in groups)
        by_comp = Counter(g["competition_id"] for g in groups)
        failures = [
            f"{g['competition_id']} {g['season']} "
            f"home={g['home_team_id']} away={g['away_team_id']}: {g['n']} rows"
            for g in groups[:40]
        ]
        return CheckResult(
            name="duplicate_fixtures",
            passed=not groups,
            detail=(
                "no duplicate fixtures"
                if not groups
                else f"{len(groups)} duplicated fixtures, {excess} excess rows "
                     f"({', '.join(f'{k}={v}' for k, v in by_comp.most_common(6))})"
            ),
            failures=failures,
            data={"groups": len(groups), "excess_rows": excess, "by_competition": dict(by_comp)},
        )

    # -- 3 -----------------------------------------------------------------
    def check_split_identities(self) -> CheckResult:
        rows = self._q(
            """
            SELECT DISTINCT t.team_id, t.canonical_name, t.gender, m.competition_id
            FROM teams t
            JOIN matches m
              ON m.home_team_id = t.team_id OR m.away_team_id = t.team_id
            """
        )
        buckets: Dict[Tuple[str, str, str], List] = defaultdict(list)
        for r in rows:
            key = (r["competition_id"], r["gender"], _norm(r["canonical_name"]))
            buckets[key].append((r["team_id"], r["canonical_name"]))

        failures = []
        for (comp, _gender, norm_name), members in sorted(buckets.items()):
            if len(members) < 2 or not norm_name:
                continue
            unique_ids = {m[0] for m in members}
            if len(unique_ids) < 2:
                continue
            names = ", ".join(f"{n!r}(id={i})" for i, n in sorted(members))
            failures.append(f"{comp}: {names} all normalise to {norm_name!r}")

        # Second pass: one club's name fully contained in another's, same
        # competition. Catches "Swansea" vs "Swansea City" before it becomes
        # two Elo histories.
        by_comp: Dict[Tuple[str, str], List] = defaultdict(list)
        for r in rows:
            by_comp[(r["competition_id"], r["gender"])].append(
                (r["team_id"], r["canonical_name"], _norm(r["canonical_name"]))
            )
        for (comp, _g), members in sorted(by_comp.items()):
            for i, (id_a, name_a, norm_a) in enumerate(members):
                for id_b, name_b, norm_b in members[i + 1:]:
                    if id_a == id_b or not norm_a or not norm_b or norm_a == norm_b:
                        continue
                    if frozenset((name_a, name_b)) in DISTINCT_CLUB_PAIRS:
                        continue
                    if norm_a.startswith(norm_b + " ") or norm_b.startswith(norm_a + " "):
                        failures.append(
                            f"{comp}: {name_a!r}(id={id_a}) and {name_b!r}(id={id_b}) "
                            f"look like the same club"
                        )
        return CheckResult(
            name="split_identities",
            passed=not failures,
            detail=(
                "no split team identities"
                if not failures
                else f"{len(failures)} suspected split identities"
            ),
            failures=failures[:40],
            data={"count": len(failures)},
        )

    # -- 4 -----------------------------------------------------------------
    def check_orphan_teams(self) -> CheckResult:
        orphans = self.wh.find_orphan_teams()
        return CheckResult(
            name="orphan_teams",
            passed=not orphans,
            detail=(
                "no zero-match teams"
                if not orphans
                else f"{len(orphans)} teams with no matches attached"
            ),
            failures=[
                f"id={o['team_id']} {o['canonical_name']!r} ({o['gender']})" for o in orphans[:40]
            ],
            data={"count": len(orphans)},
        )

    # -- 5 -----------------------------------------------------------------
    def check_date_utc_sanity(self) -> CheckResult:
        failures: List[str] = []
        data: Dict[str, Any] = {}

        bad = self._q(
            """
            SELECT match_id, date_utc FROM matches
            WHERE date_utc IS NULL OR length(date_utc) < 10
               OR date_utc < '1990-01-01' OR date_utc > '2100-01-01'
            LIMIT 20
            """
        )
        if bad:
            failures.append(f"{len(bad)} rows with an unusable date_utc, e.g. {bad[0]['date_utc']!r}")

        unparsable = 0
        naive = 0
        for r in self._q("SELECT date_utc FROM matches LIMIT 200000"):
            raw = str(r["date_utc"])
            try:
                parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            except ValueError:
                unparsable += 1
                continue
            if parsed.tzinfo is None:
                naive += 1
            elif parsed.utcoffset() != timezone.utc.utcoffset(None):
                naive += 1
        data["unparsable"] = unparsable
        data["not_utc"] = naive
        if unparsable:
            failures.append(f"{unparsable} date_utc values do not parse as ISO-8601")
        if naive:
            failures.append(
                f"{naive} date_utc values are naive or carry a non-UTC offset "
                f"(they must be stored as UTC instants)"
            )

        # The football-data timezone bug moved every one of its rows back
        # across midnight, which shows up as a weekday histogram peaking on
        # Friday+Saturday instead of Saturday+Sunday.
        dow = {
            int(r["dow"]): r["n"]
            for r in self._q(
                """
                SELECT strftime('%w', date_utc) AS dow, COUNT(*) AS n
                FROM matches WHERE competition_id IN (?, ?, ?, ?, ?)
                GROUP BY dow
                """,
                WAVE_A,
            )
        }
        total = sum(dow.values()) or 1
        weekend = (dow.get(6, 0) + dow.get(0, 0)) / total  # Sat + Sun
        fri_sat = (dow.get(5, 0) + dow.get(6, 0)) / total
        data["weekday_histogram"] = dow
        data["weekend_share"] = round(weekend, 4)
        if dow:
            peak = max(dow, key=lambda k: dow[k])
            data["peak_dow"] = peak
            if peak not in (0, 6):
                failures.append(
                    f"Wave A fixtures peak on weekday {peak} (0=Sun, 6=Sat), not the "
                    f"weekend — Sat+Sun is {weekend:.1%} vs Fri+Sat {fri_sat:.1%}. "
                    f"This is the signature of a timezone shift at ingest."
                )
            elif weekend < 0.60:
                # Shifting every date back one day turns Sunday fixtures
                # into Saturday ones and Saturday's into Friday's, which
                # halves this ratio: it read 46.3% while broken and 77.2%
                # once corrected. A real European league sits near 75%.
                failures.append(
                    f"only {weekend:.1%} of Wave A fixtures fall on Sat/Sun (expected "
                    f">60%); Fri+Sat is {fri_sat:.1%}. A weekend share this low means "
                    f"dates have been shifted off their true day."
                )

        # A domestic European kickoff at 21:00 UTC or later is rare (that is
        # 22:00-01:00 local). A large cluster there is what local midnight
        # looks like after being mis-converted to UTC: it was 86.4% of Wave A
        # before the fix.
        late = self._q(
            """
            SELECT COUNT(*) AS n FROM matches
            WHERE competition_id IN (?, ?, ?, ?, ?)
              AND CAST(substr(date_utc, 12, 2) AS INTEGER) >= 21
            """,
            WAVE_A,
        )[0]["n"]
        wave_a_total = self._q(
            "SELECT COUNT(*) AS n FROM matches WHERE competition_id IN (?, ?, ?, ?, ?)",
            WAVE_A,
        )[0]["n"] or 1
        data["late_kickoff_share"] = round(late / wave_a_total, 4)
        if late / wave_a_total > 0.20:
            failures.append(
                f"{late / wave_a_total:.1%} of Wave A kickoffs are at or after 21:00 UTC, "
                f"which is implausible for European domestic football — the timestamps "
                f"look like local midnight converted with the wrong timezone."
            )

        # Midnight-UTC rows are legitimate but mean "kickoff unknown", so
        # report the share rather than failing on it.
        midnight = self._q(
            """
            SELECT COUNT(*) AS n FROM matches
            WHERE substr(date_utc, 12, 8) = '00:00:00'
            """
        )[0]["n"]
        n_all = self._q("SELECT COUNT(*) AS n FROM matches")[0]["n"] or 1
        data["midnight_utc_rows"] = midnight
        data["midnight_utc_share"] = round(midnight / n_all, 4)

        return CheckResult(
            name="date_utc_sanity",
            passed=not failures,
            detail=(
                f"dates parse as UTC; Wave A weekend share {weekend:.1%}; "
                f"{midnight:,} rows ({midnight / n_all:.1%}) carry no kickoff time"
                if not failures
                else "; ".join(failures)
            ),
            failures=failures,
            data=data,
        )

    # -- 6 -----------------------------------------------------------------
    def check_season_row_counts(self, tolerance: float = 0.02) -> CheckResult:
        rows = self._q(
            """
            SELECT competition_id, season, COUNT(*) AS n
            FROM matches
            WHERE competition_id IN ({})
            GROUP BY competition_id, season
            ORDER BY competition_id, season
            """.format(", ".join("?" * len(LEAGUE_SIZE))),
            tuple(LEAGUE_SIZE),
        )
        latest = self._q("SELECT MAX(date_utc) AS d FROM matches")[0]["d"] or ""
        current_season = int(latest[:4]) - (0 if latest[5:7] >= "08" else 1) if latest else 0

        failures, truncated = [], []
        for r in rows:
            if r["season"] >= current_season:
                continue  # in-progress season is legitimately short
            key = (r["competition_id"], r["season"])
            if key in TRUNCATED_SEASONS:
                truncated.append(f"{key[0]} {key[1]}: {r['n']} rows — {TRUNCATED_SEASONS[key]}")
                continue
            sizes = LEAGUE_SIZE[r["competition_id"]]
            size = sizes.get(str(r["season"]), sizes["default"])
            expected = size * (size - 1)
            if abs(r["n"] - expected) > max(2, expected * tolerance):
                failures.append(
                    f"{r['competition_id']} {r['season']}: {r['n']} rows, expected ~{expected}"
                )
        return CheckResult(
            name="season_row_counts",
            passed=not failures,
            detail=(
                f"all completed league-seasons within {tolerance:.0%} of their fixture count"
                + (f" ({len(truncated)} known-truncated season(s) exempted)" if truncated else "")
                if not failures
                else f"{len(failures)} league-seasons with an implausible row count"
            ),
            failures=failures[:40],
            data={
                "bad": len(failures),
                "current_season": current_season,
                "truncated_exempt": truncated,
            },
        )

    # -- 6b ----------------------------------------------------------------
    def check_season_boundaries(self) -> CheckResult:
        """No match may be dated before its predecessor season finished.

        A season cannot start before the previous one ends, so this is a
        hard impossibility rather than a heuristic. It is the check that
        catches a provider deriving the season from the calendar year —
        which is how Serie A 2019-20's COVID-delayed final matchday
        (1 August 2020) was filed as 2020-21, handing that season 21 teams
        and a wrong champion.
        """
        comps = tuple(LEAGUE_SIZE)
        spans = {
            (r["competition_id"], r["season"]): (r["mn"], r["mx"])
            for r in self._q(
                "SELECT competition_id, season, MIN(date_utc) AS mn, MAX(date_utc) AS mx "
                "FROM matches WHERE competition_id IN ({}) GROUP BY 1, 2".format(
                    ", ".join("?" * len(comps))
                ),
                comps,
            )
        }
        failures = []
        for (comp, season), (mn, _mx) in sorted(spans.items()):
            prev = spans.get((comp, season - 1))
            if prev and mn <= prev[1]:
                n = self._q(
                    "SELECT COUNT(*) AS n FROM matches WHERE competition_id = ? "
                    "AND season = ? AND date_utc <= ?",
                    (comp, season, prev[1]),
                )[0]["n"]
                failures.append(
                    f"{comp} {season}: {n} match(es) dated on/before {prev[1][:10]}, "
                    f"when season {season - 1} was still running"
                )
        return CheckResult(
            name="season_boundaries",
            passed=not failures,
            detail=(
                "no season overlaps its predecessor"
                if not failures
                else f"{len(failures)} league-seasons overlap the previous season"
            ),
            failures=failures,
            data={"count": len(failures)},
        )

    # -- 7 -----------------------------------------------------------------
    def check_coverage(self) -> CheckResult:
        total = self._q("SELECT COUNT(*) AS n FROM matches")[0]["n"]
        report: Dict[str, Any] = {"matches": total}
        failures, warnings = [], []
        if not total:
            return CheckResult("coverage", False, "warehouse has no matches", ["empty"], report)

        for table, column, floor in COVERAGE_COLUMNS:
            n = self._q(f"SELECT COUNT({column}) AS n FROM {table}")[0]["n"]
            share = n / total
            report[f"{table}.{column}"] = {"n": n, "share": round(share, 4)}
            if floor is not None and share < floor:
                failures.append(f"{table}.{column} coverage {share:.1%} below floor {floor:.0%}")

        # Auxiliary tables: report, and warn when a table is entirely empty
        # since that is usually a broken loader rather than a real absence.
        for table in ("weather", "clubelo_ratings", "referees", "match_events"):
            n = self._q(f"SELECT COUNT(*) AS n FROM {table}")[0]["n"]
            report[table] = n
            if n == 0:
                warnings.append(f"{table} is empty")

        located = self._q(
            "SELECT COUNT(*) AS n FROM teams WHERE venue_lat IS NOT NULL AND venue_lon IS NOT NULL"
        )[0]["n"]
        teams = self._q("SELECT COUNT(*) AS n FROM teams")[0]["n"] or 1
        report["teams.venue_lat"] = {"n": located, "share": round(located / teams, 4)}
        if located == 0:
            warnings.append("no team has venue coordinates (travel + weather cannot be computed)")

        # Per-competition referee coverage — the eng.1-only gap is a real
        # source limitation, so it is reported and never asserted.
        report["referee_by_competition"] = {
            r["competition_id"]: {"n": r["ref"], "share": round(r["ref"] / r["n"], 4)}
            for r in self._q(
                """
                SELECT competition_id, COUNT(*) AS n,
                       COUNT(referee_id) AS ref
                FROM matches WHERE competition_id IN (?, ?, ?, ?, ?)
                GROUP BY competition_id
                """,
                WAVE_A,
            )
        }

        if self.strict:
            failures.extend(warnings)
            warnings = []
        return CheckResult(
            name="coverage",
            passed=not failures,
            detail="; ".join(warnings) if warnings else "coverage floors met",
            failures=failures,
            data=report,
            warning=bool(warnings),
        )

    # -- 8 -----------------------------------------------------------------
    def check_referential(self) -> CheckResult:
        failures = []
        for label, sql in (
            ("matches → teams (home)",
             "SELECT COUNT(*) AS n FROM matches m LEFT JOIN teams t "
             "ON t.team_id = m.home_team_id WHERE t.team_id IS NULL"),
            ("matches → teams (away)",
             "SELECT COUNT(*) AS n FROM matches m LEFT JOIN teams t "
             "ON t.team_id = m.away_team_id WHERE t.team_id IS NULL"),
            ("matches → competitions",
             "SELECT COUNT(*) AS n FROM matches m LEFT JOIN competitions c "
             "ON c.competition_id = m.competition_id WHERE c.competition_id IS NULL"),
            ("matches → referees",
             "SELECT COUNT(*) AS n FROM matches m LEFT JOIN referees r "
             "ON r.referee_id = m.referee_id "
             "WHERE m.referee_id IS NOT NULL AND r.referee_id IS NULL"),
            ("weather → matches",
             "SELECT COUNT(*) AS n FROM weather w LEFT JOIN matches m "
             "ON m.match_id = w.match_id WHERE m.match_id IS NULL"),
            ("team_aliases → teams",
             "SELECT COUNT(*) AS n FROM team_aliases a LEFT JOIN teams t "
             "ON t.team_id = a.team_id WHERE t.team_id IS NULL"),
            ("matches self-play",
             "SELECT COUNT(*) AS n FROM matches WHERE home_team_id = away_team_id"),
        ):
            n = self._q(sql)[0]["n"]
            if n:
                failures.append(f"{label}: {n} dangling row(s)")
        return CheckResult(
            name="referential",
            passed=not failures,
            detail="all references resolve" if not failures else f"{len(failures)} broken reference sets",
            failures=failures,
            data={},
        )

    # ----------------------------------------------------------------------
    def run_all(self) -> List[CheckResult]:
        self.results = [
            self.check_season_team_counts(),
            self.check_duplicate_fixtures(),
            self.check_split_identities(),
            self.check_orphan_teams(),
            self.check_date_utc_sanity(),
            self.check_season_row_counts(),
            self.check_season_boundaries(),
            self.check_coverage(),
            self.check_referential(),
        ]
        return self.results


def _print_report(results: List[CheckResult], *, verbose: bool) -> None:
    print()
    print("=" * 78)
    print("WAREHOUSE INTEGRITY")
    print("=" * 78)
    for r in results:
        mark = "PASS" if r.passed else "FAIL"
        if r.passed and r.warning:
            mark = "WARN"
        print(f"[{mark}] {r.name:<22} {r.detail}")
        if not r.passed or verbose:
            for line in r.failures[: (None if verbose else 10)]:
                print(f"         - {line}")
            if not verbose and len(r.failures) > 10:
                print(f"         ... and {len(r.failures) - 10} more")

    coverage = next((r for r in results if r.name == "coverage"), None)
    if coverage:
        print()
        print("-" * 78)
        print("COVERAGE")
        print("-" * 78)
        total = coverage.data.get("matches", 0)
        print(f"  matches: {total:,}")
        for key, val in coverage.data.items():
            if isinstance(val, dict) and "share" in val:
                print(f"    {key:<28} {val['n']:>8,}  {val['share']:>7.1%}")
            elif isinstance(val, int) and key != "matches":
                print(f"    {key:<28} {val:>8,}")
        refs = coverage.data.get("referee_by_competition") or {}
        if refs:
            print("    referee by competition:")
            for comp, v in sorted(refs.items()):
                print(f"      {comp:<10} {v['n']:>6,}  {v['share']:>7.1%}")

    failed = [r for r in results if not r.passed]
    print()
    print("=" * 78)
    print(f"{len(results) - len(failed)}/{len(results)} checks passed")
    if failed:
        print("FAILED: " + ", ".join(r.name for r in failed))
    print("=" * 78)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--db", type=Path, default=WAREHOUSE_PATH)
    parser.add_argument("--strict", action="store_true", help="Treat coverage warnings as failures.")
    parser.add_argument("--json", type=Path, help="Write the full report here.")
    parser.add_argument("-v", "--verbose", action="store_true", help="List every failure.")
    args = parser.parse_args(argv)

    if not args.db.exists():
        print(f"warehouse not found at {args.db}", file=sys.stderr)
        return 2

    wh = Warehouse(args.db)
    try:
        if wh._conn.execute("SELECT COUNT(*) FROM matches").fetchone()[0] == 0:  # noqa: SLF001
            print("warehouse contains no matches", file=sys.stderr)
            return 2
        results = IntegrityValidator(wh, strict=args.strict).run_all()
    finally:
        wh.close()

    _print_report(results, verbose=args.verbose)

    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(
            {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "database": str(args.db),
                "strict": args.strict,
                "passed": all(r.passed for r in results),
                "checks": [
                    {
                        "name": r.name, "passed": r.passed, "detail": r.detail,
                        "failures": r.failures, "data": r.data,
                    }
                    for r in results
                ],
            },
            indent=2, default=str,
        ))
        print(f"report written to {args.json}")

    return 0 if all(r.passed for r in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
