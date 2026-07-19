"""Build the Boardroom debate artifact for upcoming fixtures.

Runs at **pipeline time** (GitHub Actions / local). For each fixture in the next
N days that already has a committed prediction, it convenes three dissenting
personas (The Quant / The Historian / The Skeptic), grounds each on a typed
bundle of verifiable facts, generates a short section per persona, rejects any
section whose prose states an ungrounded number or a banned term, and writes the
surviving debate to ``backend/data/boardroom/debates.json``.

Key behaviours:
* **No key, no write.** If no provider key is configured, print a clear message
  and exit 0 without touching the artifact — the pipeline stays green before the
  key exists.
* ``--dry-run`` uses the deterministic :class:`FakeProvider` end-to-end (no
  network, no key) and writes the artifact so the shape can be inspected/tested.
* A match with fewer than two surviving personas produces **no** entry.

Usage::

    python -m backend.scripts.build_boardroom --days 3
    python -m backend.scripts.build_boardroom --dry-run --output backend/tests/fixtures/boardroom_debates.json
"""

from __future__ import annotations

import argparse
import json
import logging
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Dict, List, Optional

# Ensure repo-root imports work when run as a script.
_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from backend.services.llm import FakeProvider, Provider, get_provider  # noqa: E402
from backend.services.llm.grounding import (  # noqa: E402
    PERSONAS,
    PERSONA_TITLES,
    BoardroomBundle,
    RecentMiss,
    TeamForm,
    boardroom_system_prompt,
    boardroom_user_prompt,
    build_boardroom_bundle,
    dissent_index,
    dissent_level,
    parse_persona_output,
    verify_text,
)

logger = logging.getLogger("pitchverse.boardroom")

_DEFAULT_OUTPUT = _ROOT / "backend" / "data" / "boardroom" / "debates.json"
_WAREHOUSE = _ROOT / "backend" / "data" / "warehouse.sqlite"
_RARITY = _ROOT / "backend" / "data" / "rarity" / "state_outcomes.json"

_HIGH_CONF_MIN = 0.60  # normalized confidence that counts as "high confidence"


# --------------------------------------------------------------------------- #
# Context loaders (all best-effort; missing sources are simply omitted)
# --------------------------------------------------------------------------- #


def _load_rarity_states() -> dict:
    try:
        with _RARITY.open("r", encoding="utf-8") as fh:
            return json.load(fh).get("states", {})
    except (OSError, ValueError):
        logger.info("boardroom: rarity artifact unavailable — precedents omitted")
        return {}


def _open_warehouse_ro() -> Optional[sqlite3.Connection]:
    if not _WAREHOUSE.exists():
        return None
    try:
        con = sqlite3.connect(f"file:{_WAREHOUSE}?mode=ro", uri=True)
        con.row_factory = sqlite3.Row
        return con
    except sqlite3.Error:
        return None


def _team_form(
    con: Optional[sqlite3.Connection],
    team: str,
    gender: str,
    before: str,
    k: int = 5,
) -> Optional[TeamForm]:
    """Last ``k`` completed results for ``team`` before ``before`` (read-only)."""
    if con is None:
        return None
    try:
        row = con.execute(
            "SELECT team_id FROM teams WHERE canonical_name = ? AND gender = ?",
            (team, gender),
        ).fetchone()
        if row is None:
            alias = con.execute(
                "SELECT ta.team_id FROM team_aliases ta JOIN teams t ON t.team_id = ta.team_id "
                "WHERE ta.alias = ? AND t.gender = ?",
                (team, gender),
            ).fetchone()
            if alias is None:
                return None
            team_id = alias["team_id"]
        else:
            team_id = row["team_id"]

        rows = con.execute(
            """
            SELECT home_team_id, away_team_id, home_score, away_score
            FROM matches
            WHERE (home_team_id = ? OR away_team_id = ?)
              AND home_score IS NOT NULL AND away_score IS NOT NULL
              AND date_utc < ?
            ORDER BY date_utc DESC
            LIMIT ?
            """,
            (team_id, team_id, before or "9999", k),
        ).fetchall()
    except sqlite3.Error:
        return None

    if not rows:
        return None
    w = d = l = gf = ga = 0
    for r in rows:
        is_home = r["home_team_id"] == team_id
        own = r["home_score"] if is_home else r["away_score"]
        opp = r["away_score"] if is_home else r["home_score"]
        gf += own
        ga += opp
        if own > opp:
            w += 1
        elif own == opp:
            d += 1
        else:
            l += 1
    return TeamForm(team=team, played=len(rows), wins=w, draws=d, losses=l, goals_for=gf, goals_against=ga)


def _recent_miss(tracker, gender: str) -> Optional[RecentMiss]:
    """Most recent settled, high-confidence, WRONG call in this universe."""
    try:
        records = tracker.get_recent_predictions(limit=300, completed_only=True, gender=gender)
    except Exception:  # pragma: no cover - defensive
        return None
    for r in records:  # already sorted by date desc
        if r.winner_correct is not False:
            continue
        conf = tracker._normalize_confidence(r.confidence)
        if conf < _HIGH_CONF_MIN:
            continue
        return RecentMiss(
            home_team=r.home_team,
            away_team=r.away_team,
            predicted_winner=r.predicted_winner,
            confidence_pct=round(conf * 100, 1),
            actual_winner=r.actual_winner or "",
            match_date=r.match_date,
        )
    return None


# --------------------------------------------------------------------------- #
# Debate generation for one fixture
# --------------------------------------------------------------------------- #


class RequestPacer:
    """Spaces provider calls to stay under a requests-per-minute budget.

    The free-tier RPM window is enforced per minute, so bounded exponential
    backoff alone cannot recover from a sustained burst — proactive pacing can.
    """

    def __init__(
        self,
        rpm: float,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._interval = 60.0 / rpm if rpm > 0 else 0.0
        self._sleep = sleep
        self._clock = clock
        self._last: Optional[float] = None

    def __call__(self) -> None:
        if self._interval <= 0:
            return
        now = self._clock()
        if self._last is not None:
            wait = self._interval - (now - self._last)
            if wait > 0:
                self._sleep(wait)
                now = self._clock()
        self._last = now


def generate_debate(
    provider: Provider,
    bundle: BoardroomBundle,
    pace: Callable[[], None] = lambda: None,
) -> Optional[dict]:
    """Run the three personas over one bundle; return a debate entry or None."""
    personas: List[dict] = []
    implied: List[Dict[str, float]] = []
    for name in PERSONAS:
        system = boardroom_system_prompt(name)
        prompt = boardroom_user_prompt(bundle, name)
        try:
            pace()
            raw = provider.complete(
                prompt, system=system, max_tokens=1024, temperature=0.6, json_output=True
            )
        except Exception as exc:  # a single persona failing must not sink the match
            logger.warning("boardroom: %s generation failed for %s: %s", name, bundle.match_id, exc)
            continue
        parsed = parse_persona_output(raw)
        if parsed is None:
            logger.warning("boardroom: %s output unparseable for %s", name, bundle.match_id)
            continue
        verdict = verify_text(parsed["text"], bundle, extra_claims=parsed["claims"])
        if not verdict.ok:
            logger.info("boardroom: dropped %s for %s (%s)", name, bundle.match_id, verdict.reason)
            continue
        personas.append(
            {
                "name": PERSONA_TITLES[name],
                "key": name,
                "stance": parsed["stance"],
                "text": parsed["text"],
                "claims": parsed["claims"],
            }
        )
        implied.append(parsed["implied_probs"])

    if len(personas) < 2:
        return None

    idx = dissent_index(implied)
    return {
        "match_id": bundle.match_id,
        "home_team": bundle.home_team,
        "away_team": bundle.away_team,
        "league": bundle.league,
        "kickoff": bundle.kickoff,
        "gender": bundle.gender,
        "personas": personas,
        "dissent_index": idx,
        "dissent_level": dissent_level(idx),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


# --------------------------------------------------------------------------- #
# Fixture selection
# --------------------------------------------------------------------------- #


def _upcoming_fixtures(tracker, days: int) -> List[dict]:
    today = datetime.now(timezone.utc).date()
    end = today.toordinal() + days
    out = []
    for r in tracker.get_recent_predictions(limit=100000):
        try:
            d = datetime.fromisoformat(str(r.match_date)[:10]).date()
        except ValueError:
            continue
        if today.toordinal() <= d.toordinal() <= end:
            out.append(r.to_dict())
    return out


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #


def build(
    *,
    days: int,
    dry_run: bool,
    output: Path,
    limit: Optional[int] = None,
    rpm: float = 5.0,
) -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    pace: Callable[[], None] = lambda: None
    if dry_run:
        provider: Optional[Provider] = FakeProvider()
        logger.info("boardroom: --dry-run — using FakeProvider (no network, no key)")
    else:
        # Free-tier RPM windows reset per minute; short exponential backoff
        # cannot outlast them, so pace proactively and back off heavily.
        provider = get_provider(base_delay=15.0, max_retries=4)
        pace = RequestPacer(rpm)
        if provider is None:
            print(
                "boardroom: no LLM provider key configured (set GEMINI_API_KEY or "
                "GROQ_API_KEY, or run with --dry-run). Nothing written; exiting 0."
            )
            return 0
        logger.info("boardroom: using provider=%s model=%s", provider.name, provider.model)

    # Lazily import the tracker so --help / no-key paths stay light.
    from backend.services.prediction.tracker import get_prediction_tracker

    tracker = get_prediction_tracker()
    fixtures = _upcoming_fixtures(tracker, days)
    if limit:
        fixtures = fixtures[:limit]
    logger.info("boardroom: %d fixture(s) in the next %d day(s) with predictions", len(fixtures), days)

    rarity_states = _load_rarity_states()
    con = _open_warehouse_ro()
    metrics_cache: Dict[str, dict] = {}
    miss_cache: Dict[str, Optional[RecentMiss]] = {}

    debates: Dict[str, dict] = {}
    dropped = 0
    for match in fixtures:
        gender = (match.get("gender") or "M").upper()
        gender = "F" if gender in ("F", "WOMEN", "W") else "M"
        if gender not in metrics_cache:
            try:
                metrics_cache[gender] = tracker.calculate_accuracy_metrics(gender=gender).to_dict()
            except Exception:  # pragma: no cover - defensive
                metrics_cache[gender] = {}
            miss_cache[gender] = _recent_miss(tracker, gender)

        bundle = build_boardroom_bundle(
            match,
            gender=gender,
            metrics=metrics_cache[gender],
            rarity_states=rarity_states,
            home_form=_team_form(con, match.get("home_team", ""), gender, match.get("match_date", "")),
            away_form=_team_form(con, match.get("away_team", ""), gender, match.get("match_date", "")),
            recent_miss=miss_cache.get(gender),
        )
        entry = generate_debate(provider, bundle, pace=pace)
        if entry is None:
            dropped += 1
            continue
        debates[bundle.match_id] = entry

    if con is not None:
        con.close()

    artifact = {
        "schema": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "provider": provider.name,
        "model": provider.model,
        "count": len(debates),
        "debates": debates,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8") as fh:
        json.dump(artifact, fh, indent=2, ensure_ascii=False, sort_keys=True)
        fh.write("\n")
    logger.info(
        "boardroom: wrote %d debate(s) (%d fixtures had <2 surviving personas) -> %s",
        len(debates),
        dropped,
        output,
    )
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Build the Boardroom debate artifact.")
    parser.add_argument("--days", type=int, default=3, help="Fixture look-ahead window (default 3).")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Use the deterministic FakeProvider end-to-end (no network / key).",
    )
    parser.add_argument("--limit", type=int, default=None, help="Cap the number of fixtures processed.")
    parser.add_argument(
        "--output",
        type=Path,
        default=_DEFAULT_OUTPUT,
        help="Artifact path (default backend/data/boardroom/debates.json).",
    )
    parser.add_argument(
        "--rpm",
        type=float,
        default=5.0,
        help="Provider requests-per-minute budget (default 5 — free-tier limits vary by model).",
    )
    args = parser.parse_args(argv)
    return build(
        days=args.days, dry_run=args.dry_run, output=args.output, limit=args.limit, rpm=args.rpm
    )


if __name__ == "__main__":
    raise SystemExit(main())
