"""Backfill minute-level goal + red-card events into the warehouse.

Phase 0 of VISION_2030: the `match_events` table (schema v3) is the substrate
for the Rarity Engine — "down 2-0 at 75'+ → win" needs the minute of every
goal, not just the final score.

Usage
-----
    # One league-season worth of ESPN matches (newest first, resumable):
    python -m backend.scripts.backfill_events --source espn --competition eng.1 --limit 400 --sleep 0.4

    # Knockout competitions (extra-time minutes parse as plain 91'..120'):
    python -m backend.scripts.backfill_events --source espn --competition uefa.champions --limit 200

    # Understat goal minutes for matches ESPN can't cover (top-5 leagues,
    # 2014+, e.g. the 43k football-data.co.uk rows have no ESPN event id):
    python -m backend.scripts.backfill_events --source understat --competition eng.1 --season 2024

    # Everything ESPN has, throttled:
    python -m backend.scripts.backfill_events --source espn --sleep 0.5

Source precedence: espn > understat > openfootball. A match whose events came
from an equal-or-better source is skipped (ESPN has red cards + own-goal
flags; Understat has goals only). Re-runs are idempotent: events are replaced
per match, raw payloads are cached under backend/data/cache/, and only
matches still missing (or upgradeable) events are attempted.

Integrity guard (house honesty rule): after parsing, the per-side sum of
goal-type events MUST equal matches.home_score/away_score. On mismatch the
match stores NOTHING — a table of half-truths poisons the rarity engine.
Mismatches are counted in the run summary.

Coverage markers (schema v4): every successfully verified match gets a
`match_event_coverage` row — including verified-empty matches (0-0, no
cards, `events = 0`), which are full timelines of level states and belong
in the rarity engine's denominators. Integrity-mismatched matches get NO
coverage row: they remain honestly uncovered and retryable.

openfootball verdict: NOT implementable. Their football.json per-season files
(the only openfootball source this warehouse ingests) carry only half/full-
time scores — verified across 2010-11, 2015-16, 2017-18, 2023-24 and 2024-25
files: no goal minutes, no scorer lists. `--source openfootball` explains
this and exits.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import httpx

from backend.services.data import open_warehouse
from backend.services.data.espn_loader import (
    ESPN_SUMMARY_URL,
    SummaryParseError,
    espn_event_id_from_match_id,
    espn_league_for_competition,
    parse_summary_events,
)
from backend.services.data.team_resolver import TeamResolver
from backend.services.data.understat_loader import (
    UNDERSTAT_LEAGUES,
    _fetch_league_matches,  # noqa: SLF001 — same-package reuse, repo precedent
    _find_warehouse_match,  # noqa: SLF001
    _match_shots_cache_path,  # noqa: SLF001
    fetch_match_shots,
    parse_match_shot_events,
)
from backend.services.data.warehouse import GOAL_EVENT_TYPES, MatchEvent, Warehouse

logger = logging.getLogger(__name__)

USER_AGENT = "SoccerPredictor/4.0 (+research; contact via github.com)"

# Higher rank wins: ESPN has cards + own-goal/penalty flags, Understat has
# goals (minute + scorer) only, openfootball has no minutes at all.
SOURCE_PRECEDENCE: Dict[str, int] = {"openfootball": 1, "understat": 2, "espn": 3}

ESPN_SUMMARY_CACHE = (
    Path(__file__).resolve().parent.parent / "data" / "cache" / "espn_summary"
)

UNDERSTAT_FIRST_SEASON = 2014


def replaceable_sources(source: str) -> Tuple[str, ...]:
    """Event sources that `source` is allowed to overwrite (strictly worse)."""
    rank = SOURCE_PRECEDENCE[source]
    return tuple(s for s, r in SOURCE_PRECEDENCE.items() if r < rank)


def events_match_score(
    events: Sequence[MatchEvent], home_score: Optional[int], away_score: Optional[int]
) -> bool:
    """The non-negotiable integrity guard: goal events must sum to the score."""
    if home_score is None or away_score is None:
        return False
    home_goals = sum(
        1 for e in events if e.event_type in GOAL_EVENT_TYPES and e.team_side == "home"
    )
    away_goals = sum(
        1 for e in events if e.event_type in GOAL_EVENT_TYPES and e.team_side == "away"
    )
    return home_goals == int(home_score) and away_goals == int(away_score)


def store_events_checked(
    warehouse: Warehouse,
    match_id: str,
    events: Sequence[MatchEvent],
    source: str,
    home_score: Optional[int],
    away_score: Optional[int],
) -> bool:
    """Store events only when they reconcile with the final score.

    On success also writes the match's coverage marker — including for an
    EMPTY verified timeline (0-0, no cards → coverage row with events = 0),
    so downstream consumers can tell "verified empty" from "never
    backfilled". On mismatch returns False and stores NOTHING (no events,
    no coverage row — the match stays honestly uncovered).
    """
    if not events_match_score(events, home_score, away_score):
        return False
    warehouse.upsert_match_events(match_id, list(events), source)
    warehouse.record_event_coverage(match_id, source, len(events))
    return True


@dataclass
class RunSummary:
    source: str
    candidates: int = 0
    attempted: int = 0
    stored: int = 0
    events_written: int = 0
    no_data: int = 0            # provider has no timeline for the match
    verified_empty: int = 0     # 0-0, no cards: timeline is genuinely empty
    mismatched: int = 0         # integrity guard rejections (stored nothing)
    parse_errors: int = 0       # structurally unusable payloads
    http_errors: int = 0
    unmatched: int = 0          # understat: no warehouse match resolved
    skipped_existing: int = 0   # equal-or-better events already stored
    hard_stopped: bool = False

    @property
    def mismatch_rate(self) -> float:
        return self.mismatched / self.attempted if self.attempted else 0.0

    def as_dict(self) -> Dict[str, Any]:
        d = {k: getattr(self, k) for k in (
            "source", "candidates", "attempted", "stored", "events_written",
            "no_data", "verified_empty", "mismatched", "parse_errors",
            "http_errors", "unmatched", "skipped_existing", "hard_stopped",
        )}
        d["mismatch_rate"] = round(self.mismatch_rate, 4)
        return d


class ConsecutiveClientErrorGuard:
    """Hard-stop the run after N consecutive 4xx responses (be polite)."""

    def __init__(self, threshold: int):
        self.threshold = threshold
        self.count = 0

    def note_status(self, status: Optional[int]) -> None:
        if status is not None and 400 <= status < 500:
            self.count += 1
            if self.count >= self.threshold:
                raise HardStop(
                    f"{self.count} consecutive 4xx responses — stopping so we "
                    "don't hammer an endpoint that is refusing us"
                )
        else:
            self.count = 0

    def reset(self) -> None:
        self.count = 0


class HardStop(RuntimeError):
    pass


async def fetch_json_with_retry(
    client: httpx.AsyncClient,
    url: str,
    *,
    headers: Optional[Dict[str, str]] = None,
    retries: int = 3,
    backoff_base: float = 1.5,
) -> Tuple[Optional[Dict], Optional[int]]:
    """GET with exponential backoff on 429/5xx/network errors.

    Plain 4xx (except 429) is returned immediately — retrying won't help and
    the caller's ConsecutiveClientErrorGuard decides whether to hard-stop.
    Returns (payload, status); payload is None on any failure.
    """
    status: Optional[int] = None
    for attempt in range(retries):
        try:
            resp = await client.get(url, timeout=30, headers=headers)
        except Exception as exc:  # noqa: BLE001 — network layer, retry
            logger.debug("fetch error %s: %s", url, exc)
            status = None
        else:
            status = resp.status_code
            if status == 200:
                try:
                    return resp.json(), 200
                except Exception:  # noqa: BLE001
                    return None, 200
            if 400 <= status < 500 and status != 429:
                return None, status
        await asyncio.sleep(backoff_base * (2 ** attempt))
    return None, status


# ---------------------------------------------------------------------------
# ESPN
# ---------------------------------------------------------------------------

def _espn_cache_path(league: str, event_id: str) -> Path:
    return ESPN_SUMMARY_CACHE / f"{league}_{event_id}.json"


def _trim_summary(payload: Dict) -> Dict:
    """Keep only what the event parser needs (full summaries are ~200KB+)."""
    try:
        competitors = payload["header"]["competitions"][0]["competitors"]
    except (KeyError, IndexError, TypeError):
        competitors = []
    return {
        "header": {"competitions": [{"competitors": competitors}]},
        "keyEvents": payload.get("keyEvents") or [],
    }


def _read_espn_cache(league: str, event_id: str) -> Optional[Dict]:
    p = _espn_cache_path(league, event_id)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text())
    except Exception:  # noqa: BLE001
        return None


def _write_espn_cache(league: str, event_id: str, trimmed: Dict) -> None:
    ESPN_SUMMARY_CACHE.mkdir(parents=True, exist_ok=True)
    try:
        _espn_cache_path(league, event_id).write_text(json.dumps(trimmed))
    except Exception as exc:  # noqa: BLE001
        logger.debug("Failed to cache ESPN summary %s/%s: %s", league, event_id, exc)


async def run_espn(args: argparse.Namespace, warehouse: Warehouse) -> RunSummary:
    summary = RunSummary(source="espn")
    candidates = list(
        warehouse.iter_matches_missing_events(
            source="espn",
            competition=args.competition,
            season=args.season,
            since=args.since,
            replaceable_sources=replaceable_sources("espn"),
        )
    )
    if args.limit:
        candidates = candidates[: args.limit]
    summary.candidates = len(candidates)
    guard = ConsecutiveClientErrorGuard(args.max_consecutive_4xx)

    try:
        async with httpx.AsyncClient(
            headers={"User-Agent": USER_AGENT}, follow_redirects=True
        ) as client:
            for row in candidates:
                match_id = row["match_id"]
                event_id = espn_event_id_from_match_id(match_id)
                if not event_id:
                    summary.parse_errors += 1
                    logger.warning("cannot extract ESPN event id from %s", match_id)
                    continue
                league = espn_league_for_competition(row["competition_id"])

                payload = _read_espn_cache(league, event_id)
                fetched = False
                if payload is None:
                    fetched = True
                    url = ESPN_SUMMARY_URL.format(league=league, event_id=event_id)
                    raw, status = await fetch_json_with_retry(client, url)
                    if raw is None:
                        summary.http_errors += 1
                        guard.note_status(status)
                        await asyncio.sleep(args.sleep)
                        continue
                    guard.reset()
                    payload = _trim_summary(raw)
                    _write_espn_cache(league, event_id, payload)

                summary.attempted += 1
                try:
                    events = parse_summary_events(payload)
                except SummaryParseError as exc:
                    summary.parse_errors += 1
                    logger.warning("parse error %s: %s", match_id, exc)
                else:
                    if not payload.get("keyEvents"):
                        # Provider has no timeline at all — NOT the same as a
                        # verified-empty match; stays uncovered for a retry.
                        summary.no_data += 1
                    elif store_events_checked(
                        warehouse, match_id, events, "espn",
                        row["home_score"], row["away_score"],
                    ):
                        # A 0-0 no-card match verifies with zero events and
                        # gets a coverage marker (events = 0) so it is never
                        # re-attempted and counts in rarity denominators.
                        if events:
                            summary.stored += 1
                            summary.events_written += len(events)
                        else:
                            summary.verified_empty += 1
                    else:
                        summary.mismatched += 1
                        logger.warning(
                            "integrity mismatch %s: %d/%d goal events vs %s-%s score — stored NOTHING",
                            match_id,
                            sum(1 for e in events if e.event_type in GOAL_EVENT_TYPES and e.team_side == "home"),
                            sum(1 for e in events if e.event_type in GOAL_EVENT_TYPES and e.team_side == "away"),
                            row["home_score"], row["away_score"],
                        )
                if fetched:
                    await asyncio.sleep(args.sleep)
    except HardStop as exc:
        summary.hard_stopped = True
        logger.error("HARD STOP (espn): %s", exc)
    return summary


# ---------------------------------------------------------------------------
# Understat
# ---------------------------------------------------------------------------

def _get_match_scores(
    warehouse: Warehouse, match_id: str
) -> Tuple[Optional[int], Optional[int]]:
    with warehouse._lock:  # noqa: SLF001 — repo precedent for loader-side reads
        cur = warehouse._conn.execute(  # noqa: SLF001
            "SELECT home_score, away_score FROM matches WHERE match_id = ?",
            (match_id,),
        )
        row = cur.fetchone()
    if row is None:
        return None, None
    return row["home_score"], row["away_score"]


async def run_understat(args: argparse.Namespace, warehouse: Warehouse) -> RunSummary:
    summary = RunSummary(source="understat")
    leagues = [
        lg for lg in UNDERSTAT_LEAGUES
        if args.competition is None or lg["competition_id"] == args.competition
    ]
    if not leagues:
        covered = ", ".join(lg["competition_id"] for lg in UNDERSTAT_LEAGUES)
        raise SystemExit(
            f"Understat does not cover {args.competition!r} (covered: {covered})"
        )
    if args.season:
        seasons = [args.season]
    else:
        seasons = list(range(UNDERSTAT_FIRST_SEASON, datetime.now(timezone.utc).year + 1))

    resolver = TeamResolver(warehouse, gender_default="M")
    existing = warehouse.event_sources()
    my_rank = SOURCE_PRECEDENCE["understat"]
    guard = ConsecutiveClientErrorGuard(args.max_consecutive_4xx)

    try:
        await _understat_loop(args, warehouse, summary, leagues, seasons, resolver, existing, my_rank, guard)
    except HardStop as exc:
        summary.hard_stopped = True
        logger.error("HARD STOP (understat): %s", exc)
    return summary


async def _understat_loop(
    args: argparse.Namespace,
    warehouse: Warehouse,
    summary: RunSummary,
    leagues: List[Dict],
    seasons: List[int],
    resolver: TeamResolver,
    existing: Dict[str, str],
    my_rank: int,
    guard: ConsecutiveClientErrorGuard,
) -> None:
    limit_hit = False
    async with httpx.AsyncClient(
        headers={"User-Agent": USER_AGENT}, follow_redirects=True
    ) as client:
        for league in leagues:
            if limit_hit:
                break
            for season in seasons:
                if limit_hit:
                    break
                matches, error = await _fetch_league_matches(client, league["slug"], season)
                if matches is None:
                    summary.http_errors += 1
                    logger.warning(
                        "Understat league fetch failed %s/%s: %s",
                        league["slug"], season, error,
                    )
                    continue
                for m in matches:
                    if args.limit and summary.attempted >= args.limit:
                        limit_hit = True
                        break
                    if not m.get("isResult"):
                        continue
                    home = (m.get("h") or {}).get("title")
                    away = (m.get("a") or {}).get("title")
                    date_str = m.get("datetime")
                    us_id = m.get("id")
                    if not home or not away or not date_str or not us_id:
                        continue
                    try:
                        date_obj = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
                        if date_obj.tzinfo is None:
                            date_obj = date_obj.replace(tzinfo=timezone.utc)
                    except ValueError:
                        continue
                    if args.since and date_obj.isoformat() < args.since:
                        continue

                    home_id = resolver.resolve(home, gender="M").team_id
                    away_id = resolver.resolve(away, gender="M").team_id
                    match_id = _find_warehouse_match(
                        warehouse,
                        competition_id=league["competition_id"],
                        home_team_id=home_id,
                        away_team_id=away_id,
                        target_date=date_obj,
                    )
                    if not match_id:
                        summary.candidates += 1
                        summary.unmatched += 1
                        continue
                    prev = existing.get(match_id)
                    if prev and SOURCE_PRECEDENCE.get(prev, 0) >= my_rank:
                        summary.skipped_existing += 1
                        continue
                    summary.candidates += 1

                    was_cached = _match_shots_cache_path(str(us_id)).exists()
                    shots, error = await fetch_match_shots(client, str(us_id))
                    if shots is None:
                        summary.http_errors += 1
                        status = None
                        if error and error.startswith("http "):
                            try:
                                status = int(error.split()[1])
                            except (ValueError, IndexError):
                                status = None
                        guard.note_status(status)
                        if not was_cached:
                            await asyncio.sleep(args.sleep)
                        continue
                    guard.reset()

                    summary.attempted += 1
                    events = parse_match_shot_events(shots)
                    home_score, away_score = _get_match_scores(warehouse, match_id)
                    has_shot_data = bool((shots.get("h") or []) or (shots.get("a") or []))
                    if events is None:
                        summary.parse_errors += 1
                        logger.warning("unusable shot minutes for understat match %s", us_id)
                    elif not has_shot_data:
                        # Entirely empty shots payload is a provider gap, not
                        # a verified 0-0 (a real 0-0 still has missed shots) —
                        # stays uncovered, never a coverage row.
                        summary.no_data += 1
                    elif store_events_checked(
                        warehouse, match_id, events, "understat", home_score, away_score
                    ):
                        # Shots exist but none were goals + score is 0-0 →
                        # verified-empty coverage marker (events = 0).
                        if events:
                            summary.stored += 1
                            summary.events_written += len(events)
                        else:
                            summary.verified_empty += 1
                        existing[match_id] = "understat"
                    else:
                        summary.mismatched += 1
                        logger.warning(
                            "integrity mismatch %s (understat %s): stored NOTHING",
                            match_id, us_id,
                        )
                    if not was_cached:
                        await asyncio.sleep(args.sleep)


# ---------------------------------------------------------------------------
# openfootball — investigated, not implementable (see module docstring)
# ---------------------------------------------------------------------------

OPENFOOTBALL_VERDICT = (
    "openfootball backfill is intentionally not implemented: the football.json\n"
    "per-season files this warehouse ingests contain only half/full-time scores\n"
    "(verified across 2010-2025 era files) — no goal minutes exist to backfill.\n"
    "Use --source understat for pre-ESPN top-5-league coverage instead."
)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _print_report(summary: RunSummary, warehouse: Warehouse, competition: Optional[str]) -> None:
    print("\n=== run summary ===")
    for k, v in summary.as_dict().items():
        print(f"  {k}: {v}")
    print("\n=== events coverage (completed matches) ===")
    rows = warehouse.events_coverage()
    if competition:
        rows = [r for r in rows if r["competition_id"] == competition]
    header = (
        f"{'competition':24} {'matches':>8} {'covered':>8} {'w/events':>9} "
        f"{'empty':>6} {'uncov':>7} {'coverage':>9} {'events':>8}"
    )
    print(header)
    for r in rows:
        print(
            f"{r['competition_id']:24} {r['matches']:>8} {r['covered']:>8} "
            f"{r['with_events']:>9} {r['verified_empty']:>6} {r['without_events']:>7} "
            f"{r['coverage']:>9.1%} {r['events']:>8}"
        )


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m backend.scripts.backfill_events",
        description="Backfill minute-level goal + red-card events into the warehouse.",
    )
    p.add_argument("--source", required=True, choices=("espn", "understat", "openfootball"))
    p.add_argument("--competition", help="warehouse competition_id, e.g. eng.1")
    p.add_argument("--season", type=int, help="season start year, e.g. 2024")
    p.add_argument("--since", help="ISO date lower bound on match date, e.g. 2020-01-01")
    p.add_argument("--limit", type=int, default=0, help="max matches to attempt (0 = no limit)")
    p.add_argument("--sleep", type=float, default=0.5, help="seconds between HTTP requests")
    p.add_argument(
        "--max-consecutive-4xx", type=int, default=10,
        help="hard-stop the run after this many consecutive 4xx responses",
    )
    p.add_argument("-v", "--verbose", action="store_true")
    return p


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stderr,
    )

    if args.source == "openfootball":
        print(OPENFOOTBALL_VERDICT)
        return 0

    with open_warehouse() as warehouse:
        runner = run_espn if args.source == "espn" else run_understat
        summary = asyncio.run(runner(args, warehouse))
        _print_report(summary, warehouse, args.competition)
        if summary.mismatch_rate > 0.05 and summary.attempted >= 20:
            logger.warning(
                "mismatch rate %.1f%% exceeds 5%% — investigate the parser before "
                "trusting this source at scale",
                100 * summary.mismatch_rate,
            )
    return 1 if summary.hard_stopped else 0


if __name__ == "__main__":
    sys.exit(main())
