#!/usr/bin/env python3
"""Score the model against the bookmaker closing line.

This is the scoreboard demanded by `docs/PIVOT_2026-08.md` §3. The market is
the state of the art in football forecasting, so "how accurate is the model"
is only a meaningful question when it is asked as *"how does the model score
against closing odds, on the same fixtures, with the vig removed"*.

The script produces two independent things, because they answer two different
questions:

1. **The paired benchmark** (``paired_benchmark``). Every settled prediction in
   ``backend/data/predictions/`` that can be joined to a warehouse fixture
   carrying closing odds is scored twice — once with the model's probabilities
   and once with the de-vigged market probabilities — plus two baselines on the
   identical fixture set. A fixture is only counted when **both** sides exist,
   so the comparison is genuinely paired and the reported ``n`` is the number of
   fixtures actually compared, never the number of predictions on file.

2. **The market corpus** (``market_corpus``). The odds in the warehouse cover
   far more fixtures than the model has ever predicted (11 seasons vs a few
   months). Scoring the market alone over that whole corpus establishes the
   *target number* — the Brier/log-loss/RPS this project has to reach, measured
   on our own data for our own leagues, instead of quoted from a paper about
   somebody else's. This is the number that defines "state of the art" for
   each Wave A league.

Both sections report calibration (a 10-bucket reliability table plus ECE) and
both are honest about coverage: the coverage block records how many settled
predictions existed, how many were in scope, how many joined a warehouse
fixture, and how many of those had usable closing odds.

Degradation
-----------
The warehouse is gitignored and is rebuilt out of band, so it can be absent,
empty, or odds-free at any moment. Every one of those cases produces a valid
report with ``n: 0`` and an explanatory note in ``notes`` — never a traceback
and never an invented number.

Usage
-----
    python -m backend.scripts.benchmark_market
    python -m backend.scripts.benchmark_market --league eng.1 --league esp.1
    python -m backend.scripts.benchmark_market --since 2026-01-01 --devig shin
    python -m backend.scripts.benchmark_market --output /tmp/market.json
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
import sqlite3
import sys
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Set, Tuple

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:  # allow `python backend/scripts/benchmark_market.py`
    sys.path.insert(0, str(REPO_ROOT))

from backend.services.prediction.market import (  # noqa: E402
    DEVIG_METHODS,
    OUTCOMES,
    argmax_outcome,
    brier_score,
    closing_line_value,
    coerce_probabilities,
    devig_proportional,
    devig_shin,
    expected_calibration_error,
    flatten_multiclass,
    has_complete_odds,
    log_loss_single,
    outcome_from_scores,
    outcome_index,
    overround,
    reliability_table,
    rps,
    shin_z,
    top_class_pairs,
)

DEFAULT_WAREHOUSE = REPO_ROOT / "backend" / "data" / "warehouse.sqlite"
DEFAULT_PREDICTIONS_DIR = REPO_ROOT / "backend" / "data" / "predictions"
DEFAULT_OUTPUT = REPO_ROOT / "backend" / "data" / "diagnostics" / "market_benchmark.json"

#: Display names used in the prediction JSON that differ from the warehouse
#: `competitions.name`. Everything else is matched on the normalised name, so
#: this table only carries genuine divergences.
LEAGUE_NAME_ALIASES: Dict[str, str] = {
    "champions league": "uefa.champions",
    "europa league": "uefa.europa",
    "uefa champions league": "uefa.champions",
    "uefa europa league": "uefa.europa",
    "mls": "usa.1",
    "major league soccer": "usa.1",
    "euros": "uefa.euro",
    "european championship": "uefa.euro",
    "copa america": "conmebol.america",
}

#: Tokens stripped before comparing club names across sources. Every one of
#: these is a legal-form or filler word that one provider prints and another
#: does not ("FC Cologne" vs "Koln", "Sporting CP" vs "Sporting").
_NAME_STOPWORDS = {
    "fc", "cf", "afc", "sc", "ac", "ssc", "as", "rc", "cd", "ud", "sv", "vfl",
    "vfb", "tsg", "bsc", "cp", "sad", "if", "bk", "ss", "us", "calcio", "club",
    "de", "futbol", "football", "the", "1", "1846", "1899", "1900",
}

#: Minimum per-team name similarity for a fixture join. Both sides must clear
#: it, on the same competition, within `_DATE_WINDOW` days — three independent
#: constraints, which is why a threshold this permissive is still safe.
_NAME_THRESHOLD = 0.72
_DATE_WINDOW = (0, -1, 1, -2, 2)


# ==========================================================================
# Small helpers
# ==========================================================================

def _normalise_name(value: Optional[str]) -> str:
    """Lowercase, strip accents/punctuation, drop legal-form tokens."""
    text = unicodedata.normalize("NFKD", value or "").encode("ascii", "ignore").decode()
    text = re.sub(r"[^a-z0-9 ]", " ", text.lower())
    tokens = [tok for tok in text.split() if tok not in _NAME_STOPWORDS]
    return " ".join(tokens) if tokens else re.sub(r"\s+", " ", text).strip()


def _name_similarity(left: str, right: str) -> float:
    """Similarity in ``[0, 1]`` between two normalised club names.

    Exact match wins outright; a token-set containment ("Ajax" inside "Ajax
    Amsterdam") scores just below exact; otherwise the best of the whole-string
    ratio and the best single-token pairing, which is what rescues
    "Stade Rennais" / "Rennes" and "Internazionale" / "Inter".
    """
    if not left or not right:
        return 0.0
    if left == right:
        return 1.0
    left_tokens, right_tokens = set(left.split()), set(right.split())
    if left_tokens <= right_tokens or right_tokens <= left_tokens:
        return 0.95
    best = difflib.SequenceMatcher(None, left, right).ratio()
    for a in left_tokens:
        for b in right_tokens:
            if len(a) >= 4 and len(b) >= 4:
                best = max(best, 0.95 * difflib.SequenceMatcher(None, a, b).ratio())
    return best


def _mean(values: Sequence[float]) -> Optional[float]:
    return (sum(values) / len(values)) if values else None


def _round(value: Optional[float], digits: int = 4) -> Optional[float]:
    return None if value is None else round(value, digits)


def _parse_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


# ==========================================================================
# Inputs
# ==========================================================================

@dataclass
class PredictionRow:
    """One settled model prediction, normalised for scoring."""

    match_id: str
    league: str
    competition_id: Optional[str]
    match_date: date
    home_team: str
    away_team: str
    probs: Tuple[float, float, float]
    outcome: str


@dataclass
class PairedRow:
    """A fixture where a model forecast and closing odds both exist."""

    competition_id: str
    league: str
    match_date: date
    home_team: str
    away_team: str
    outcome: str
    model_probs: Tuple[float, float, float]
    odds: Tuple[float, float, float]
    market_proportional: Tuple[float, float, float]
    market_shin: Tuple[float, float, float]
    overround: float
    shin_z: float


@dataclass
class CorpusRow:
    """A warehouse fixture with a final score and complete closing odds."""

    competition_id: str
    league: str
    season: int
    match_date: date
    outcome: str
    odds: Tuple[float, float, float]
    market_proportional: Tuple[float, float, float]
    market_shin: Tuple[float, float, float]
    overround: float
    shin_z: float


@dataclass
class Coverage:
    """Honest bookkeeping for the join. Every prediction lands in exactly one bucket."""

    settled_predictions: int = 0
    filtered_out: int = 0
    unmapped_league: int = 0
    in_scope: int = 0
    joined_to_warehouse: int = 0
    no_warehouse_fixture: int = 0
    joined_without_odds: int = 0
    paired_with_odds: int = 0
    unmatched_examples: List[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        rate = (self.paired_with_odds / self.in_scope) if self.in_scope else 0.0
        join_rate = (self.joined_to_warehouse / self.in_scope) if self.in_scope else 0.0
        return {
            "settled_predictions": self.settled_predictions,
            "filtered_out_by_flags": self.filtered_out,
            "unmapped_league": self.unmapped_league,
            "in_scope": self.in_scope,
            "joined_to_warehouse_fixture": self.joined_to_warehouse,
            "no_warehouse_fixture": self.no_warehouse_fixture,
            "joined_but_no_closing_odds": self.joined_without_odds,
            "paired_with_closing_odds": self.paired_with_odds,
            "join_rate": round(join_rate, 4),
            "odds_coverage_rate": round(rate, 4),
            "unmatched_examples": self.unmatched_examples[:20],
        }


def load_settled_predictions(
    predictions_dir: Path,
    *,
    since: Optional[date] = None,
    until: Optional[date] = None,
    model_prefixes: Optional[Sequence[str]] = None,
) -> Tuple[List[PredictionRow], int, int]:
    """Read every ``predictions_YYYY-MM.json`` and return the settled rows.

    Returns ``(rows, n_settled_total, n_filtered_out)``. A record is settled
    when ``actual_winner`` is non-null; records missing any of the three
    probability fields are dropped and counted as filtered, since there is
    nothing to score.

    ``model_prefixes`` restricts the corpus to a model generation, matched
    case-insensitively against ``model_used``. Without it the paired benchmark
    scores every model that ever ran as if it were one forecaster: the
    2026-08-09 artifact pooled 821 fixtures across the pre-pivot net, the
    retired ELO-Poisson fallback and Dixon-Coles, and published the result as
    "the model" against the closing line. A gap to market means nothing unless
    it is a gap for a named model.
    """
    wanted = tuple(m.lower() for m in model_prefixes) if model_prefixes else None
    rows: List[PredictionRow] = []
    settled_total = 0
    filtered = 0

    if not predictions_dir.is_dir():
        return rows, 0, 0

    for path in sorted(predictions_dir.glob("predictions_*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        for record in payload.get("predictions", []) or []:
            if not record.get("actual_winner"):
                continue
            settled_total += 1

            if wanted is not None:
                model = str(record.get("model_used") or "").lower()
                if not model.startswith(wanted):
                    filtered += 1
                    continue

            match_date = _parse_date(record.get("match_date"))
            if match_date is None:
                filtered += 1
                continue
            if since and match_date < since:
                filtered += 1
                continue
            if until and match_date > until:
                filtered += 1
                continue

            triple = (
                record.get("predicted_home_win"),
                record.get("predicted_draw"),
                record.get("predicted_away_win"),
            )
            try:
                probs = coerce_probabilities(triple)
                outcome = OUTCOMES[outcome_index(record["actual_winner"])]
            except Exception:
                filtered += 1
                continue

            rows.append(
                PredictionRow(
                    match_id=str(record.get("match_id", "")),
                    league=record.get("league") or "unknown",
                    competition_id=None,
                    match_date=match_date,
                    home_team=record.get("home_team") or "",
                    away_team=record.get("away_team") or "",
                    probs=probs,
                    outcome=outcome,
                )
            )
    return rows, settled_total, filtered


class WarehouseIndex:
    """Read-only view over the warehouse, indexed for fixture lookup.

    Opened with ``mode=ro`` so a concurrent rebuild can never be blocked or
    corrupted by this script.
    """

    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn
        self.competitions: Dict[str, str] = {}
        self.league_lookup: Dict[str, str] = {}
        self.team_forms: Dict[int, Set[str]] = defaultdict(set)
        self.fixtures: Dict[Tuple[str, str], List[sqlite3.Row]] = defaultdict(list)
        self._build()

    @classmethod
    def open(cls, path: Path) -> Optional["WarehouseIndex"]:
        if not path.exists() or path.stat().st_size == 0:
            return None
        try:
            conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
            conn.row_factory = sqlite3.Row
            conn.execute("SELECT 1 FROM matches LIMIT 1")
        except sqlite3.Error:
            return None
        return cls(conn)

    def _build(self) -> None:
        for row in self.conn.execute("SELECT competition_id, name FROM competitions"):
            self.competitions[row["competition_id"]] = row["name"]
            self.league_lookup[_normalise_name(row["name"])] = row["competition_id"]
            self.league_lookup[row["competition_id"].lower()] = row["competition_id"]
        self.league_lookup.update(LEAGUE_NAME_ALIASES)

        for row in self.conn.execute("SELECT team_id, canonical_name FROM teams"):
            self.team_forms[row["team_id"]].add(_normalise_name(row["canonical_name"]))
        for row in self.conn.execute("SELECT alias, team_id FROM team_aliases"):
            self.team_forms[row["team_id"]].add(_normalise_name(row["alias"]))

        for row in self.conn.execute(
            """
            SELECT match_id, competition_id, season, date_utc,
                   home_team_id, away_team_id, home_score, away_score,
                   odds_home, odds_draw, odds_away
            FROM matches
            """
        ):
            self.fixtures[(row["competition_id"], row["date_utc"][:10])].append(row)

    # -- lookups -------------------------------------------------------

    def resolve_league(self, label: str) -> Optional[str]:
        """Map a display name or competition id onto a competition id."""
        if not label:
            return None
        key = label.strip().lower()
        if key in self.league_lookup:
            return self.league_lookup[key]
        return self.league_lookup.get(_normalise_name(label))

    def team_similarity(self, name: str, team_id: int) -> float:
        forms = self.team_forms.get(team_id)
        if not forms:
            return 0.0
        return max(_name_similarity(name, form) for form in forms)

    def find_fixture(
        self, competition_id: str, match_date: date, home: str, away: str
    ) -> Optional[sqlite3.Row]:
        """Best fixture on the same competition within +/-2 days, or ``None``.

        Both club names must clear ``_NAME_THRESHOLD``. Among the candidates,
        an odds-carrying row wins over an odds-free one — the same fixture can
        exist twice in the warehouse when the cross-source team resolver failed
        to merge an ESPN row with its football-data.co.uk twin, and only the
        latter carries prices.
        """
        norm_home, norm_away = _normalise_name(home), _normalise_name(away)
        candidates: List[Tuple[int, float, sqlite3.Row]] = []
        for offset in _DATE_WINDOW:
            day = (match_date + timedelta(days=offset)).isoformat()
            for row in self.fixtures.get((competition_id, day), []):
                sim_home = self.team_similarity(norm_home, row["home_team_id"])
                if sim_home < _NAME_THRESHOLD:
                    continue
                sim_away = self.team_similarity(norm_away, row["away_team_id"])
                if sim_away < _NAME_THRESHOLD:
                    continue
                priced = 1 if has_complete_odds(
                    row["odds_home"], row["odds_draw"], row["odds_away"]
                ) else 0
                candidates.append((priced, sim_home + sim_away, row))
            if candidates:
                break
        if not candidates:
            return None
        candidates.sort(key=lambda item: (item[0], item[1]), reverse=True)
        return candidates[0][2]

    # -- summary -------------------------------------------------------

    def summary(self) -> dict:
        total = self.conn.execute("SELECT COUNT(*) FROM matches").fetchone()[0]
        with_odds = self.conn.execute(
            """
            SELECT COUNT(*) FROM matches
            WHERE odds_home > 1 AND odds_draw > 1 AND odds_away > 1
            """
        ).fetchone()[0]
        settled_with_odds = self.conn.execute(
            """
            SELECT COUNT(*) FROM matches
            WHERE odds_home > 1 AND odds_draw > 1 AND odds_away > 1
              AND home_score IS NOT NULL AND away_score IS NOT NULL
            """
        ).fetchone()[0]
        span = self.conn.execute("SELECT MIN(season), MAX(season) FROM matches").fetchone()
        return {
            "matches": total,
            "matches_with_closing_odds": with_odds,
            "settled_matches_with_closing_odds": settled_with_odds,
            "season_min": span[0],
            "season_max": span[1],
        }


# ==========================================================================
# Scoring
# ==========================================================================

def _score_forecasts(
    prob_rows: Sequence[Tuple[float, float, float]],
    outcomes: Sequence[str],
    *,
    buckets: int = 10,
    with_reliability: bool = True,
) -> dict:
    """Brier / log loss / RPS / accuracy / ECE for one forecaster on one set."""
    n = len(prob_rows)
    if n == 0:
        return {
            "n": 0,
            "brier": None,
            "log_loss": None,
            "rps": None,
            "accuracy": None,
            "ece": None,
            "ece_top_class": None,
            "reliability": [],
        }

    briers, losses, ranked, hits = [], [], [], 0
    for probs, outcome in zip(prob_rows, outcomes):
        briers.append(brier_score(probs, outcome))
        losses.append(log_loss_single(probs, outcome))
        ranked.append(rps(probs, outcome))
        hits += 1 if argmax_outcome(probs) == outcome else 0

    pooled = flatten_multiclass(prob_rows, outcomes)
    top = top_class_pairs(prob_rows, outcomes)

    result = {
        "n": n,
        "brier": _round(_mean(briers)),
        "log_loss": _round(_mean(losses)),
        "rps": _round(_mean(ranked)),
        "accuracy": _round(hits / n),
        "ece": _round(expected_calibration_error(pooled, n_buckets=buckets)),
        "ece_top_class": _round(expected_calibration_error(top, n_buckets=buckets)),
    }
    if with_reliability:
        result["reliability"] = [
            bucket.as_dict() for bucket in reliability_table(pooled, n_buckets=buckets)
        ]
    return result


def _base_rate(outcomes: Sequence[str]) -> Tuple[float, float, float]:
    """Empirical H/D/A frequency of the scored set.

    Deliberately computed **in sample**. That makes it the strongest possible
    constant forecaster — the one that already knows the outcome distribution
    it is about to be graded on — which is exactly the bar the pivot doc sets:
    a model that cannot beat this has learned nothing about individual matches.
    """
    if not outcomes:
        return (1 / 3, 1 / 3, 1 / 3)
    counts = Counter(outcomes)
    total = len(outcomes)
    return tuple(counts.get(label, 0) / total for label in OUTCOMES)  # type: ignore[return-value]


def _gap(model: dict, market: dict) -> dict:
    """Model minus market. Positive Brier/log-loss/RPS gap = the model is worse."""
    def diff(key: str, invert: bool = False) -> Optional[float]:
        a, b = model.get(key), market.get(key)
        if a is None or b is None:
            return None
        return _round((b - a) if invert else (a - b))

    return {
        "brier": diff("brier"),
        "log_loss": diff("log_loss"),
        "rps": diff("rps"),
        # Accuracy is positively oriented, so flip it: positive = model better.
        "accuracy": diff("accuracy", invert=True),
        "interpretation": (
            "brier/log_loss/rps: model minus market, positive means the model is "
            "WORSE. accuracy: model minus market, positive means the model is BETTER."
        ),
    }


def _clv_block(rows: Sequence[PairedRow], method: str) -> dict:
    """Closing-line value of the model's own pick against the no-vig close."""
    if not rows:
        return {"n": 0, "mean_relative_clv": None, "mean_absolute_clv": None,
                "share_positive": None, "method": method}

    relative, absolute, positive = [], [], 0
    for row in rows:
        pick = argmax_outcome(row.model_probs)
        idx = outcome_index(pick)
        market = row.market_shin if method == "shin" else row.market_proportional
        model_p = row.model_probs[idx]
        market_p = market[idx]
        if market_p <= 0:
            continue
        rel = closing_line_value(model_p, market_p)
        relative.append(rel)
        absolute.append(closing_line_value(model_p, market_p, mode="absolute"))
        positive += 1 if rel > 0 else 0

    if not relative:
        return {"n": 0, "mean_relative_clv": None, "mean_absolute_clv": None,
                "share_positive": None, "method": method}

    return {
        "n": len(relative),
        "method": method,
        "mean_relative_clv": _round(_mean(relative)),
        "mean_absolute_clv": _round(_mean(absolute)),
        "share_positive": _round(positive / len(relative)),
        "note": (
            "CLV of the model's argmax pick vs the de-vigged closing probability. "
            "Positive mean CLV is a necessary condition for a profitable edge; it "
            "is NOT evidence of one on its own, and says nothing about whether a "
            "bet was available at that price."
        ),
    }


def _score_paired_scope(rows: Sequence[PairedRow], *, primary: str, buckets: int) -> dict:
    """Full model-vs-market block for one scope (a league, or overall)."""
    outcomes = [row.outcome for row in rows]
    model_probs = [row.model_probs for row in rows]
    prop_probs = [row.market_proportional for row in rows]
    shin_probs = [row.market_shin for row in rows]

    base = _base_rate(outcomes)
    base_probs = [base] * len(rows)
    uniform_probs = [(1 / 3, 1 / 3, 1 / 3)] * len(rows)

    scored = {
        "model": _score_forecasts(model_probs, outcomes, buckets=buckets),
        "market_proportional": _score_forecasts(prop_probs, outcomes, buckets=buckets),
        "market_shin": _score_forecasts(shin_probs, outcomes, buckets=buckets),
        "baseline_base_rate": _score_forecasts(
            base_probs, outcomes, buckets=buckets, with_reliability=False
        ),
        "baseline_uniform": _score_forecasts(
            uniform_probs, outcomes, buckets=buckets, with_reliability=False
        ),
    }
    market_key = "market_shin" if primary == "shin" else "market_proportional"

    return {
        "n": len(rows),
        "date_range": (
            [min(r.match_date for r in rows).isoformat(),
             max(r.match_date for r in rows).isoformat()] if rows else None
        ),
        "outcome_distribution": {
            label: _round(value) for label, value in zip(OUTCOMES, base)
        },
        "mean_overround": _round(_mean([r.overround for r in rows])),
        "mean_shin_z": _round(_mean([r.shin_z for r in rows]), 5),
        "metrics": scored,
        "gap_model_vs_market": _gap(scored["model"], scored[market_key]),
        "gap_model_vs_base_rate": _gap(scored["model"], scored["baseline_base_rate"]),
        "primary_market_method": primary,
        "closing_line_value": _clv_block(rows, primary),
    }


def _score_corpus_scope(
    rows: Sequence[CorpusRow], *, buckets: int, with_reliability: bool = True
) -> dict:
    """Market-only block: what the closing line itself scores on a fixture set."""
    outcomes = [row.outcome for row in rows]
    prop_probs = [row.market_proportional for row in rows]
    shin_probs = [row.market_shin for row in rows]
    base = _base_rate(outcomes)

    return {
        "n": len(rows),
        "date_range": (
            [min(r.match_date for r in rows).isoformat(),
             max(r.match_date for r in rows).isoformat()] if rows else None
        ),
        "outcome_distribution": {
            label: _round(value) for label, value in zip(OUTCOMES, base)
        },
        "mean_overround": _round(_mean([r.overround for r in rows])),
        "mean_shin_z": _round(_mean([r.shin_z for r in rows]), 5),
        "metrics": {
            "market_proportional": _score_forecasts(
                prop_probs, outcomes, buckets=buckets, with_reliability=with_reliability
            ),
            "market_shin": _score_forecasts(
                shin_probs, outcomes, buckets=buckets, with_reliability=with_reliability
            ),
            "baseline_base_rate": _score_forecasts(
                [base] * len(rows), outcomes, buckets=buckets, with_reliability=False
            ),
            "baseline_uniform": _score_forecasts(
                [(1 / 3, 1 / 3, 1 / 3)] * len(rows), outcomes,
                buckets=buckets, with_reliability=False,
            ),
        },
    }


# ==========================================================================
# Assembly
# ==========================================================================

def _devigged(odds: Tuple[float, float, float]) -> Optional[dict]:
    """De-vig one price triple both ways, or ``None`` if the prices are unusable."""
    try:
        return {
            "proportional": devig_proportional(*odds),
            "shin": devig_shin(*odds),
            "overround": overround(*odds),
            "z": shin_z(*odds),
        }
    except ValueError:
        return None


def build_paired_rows(
    predictions: Sequence[PredictionRow],
    index: Optional[WarehouseIndex],
    *,
    leagues: Optional[Set[str]],
    coverage: Coverage,
) -> List[PairedRow]:
    """Join settled predictions to warehouse fixtures that carry closing odds."""
    paired: List[PairedRow] = []
    if index is None:
        coverage.in_scope = 0
        return paired

    for pred in predictions:
        competition_id = index.resolve_league(pred.league)
        if competition_id is None:
            coverage.unmapped_league += 1
            continue
        if leagues and competition_id not in leagues:
            coverage.filtered_out += 1
            continue

        coverage.in_scope += 1
        row = index.find_fixture(
            competition_id, pred.match_date, pred.home_team, pred.away_team
        )
        if row is None:
            coverage.no_warehouse_fixture += 1
            if len(coverage.unmatched_examples) < 20:
                coverage.unmatched_examples.append(
                    f"{pred.match_date} {competition_id} "
                    f"{pred.home_team} vs {pred.away_team}"
                )
            continue

        coverage.joined_to_warehouse += 1
        odds = (row["odds_home"], row["odds_draw"], row["odds_away"])
        if not has_complete_odds(*odds):
            coverage.joined_without_odds += 1
            continue
        devig = _devigged(odds)
        if devig is None:
            coverage.joined_without_odds += 1
            continue

        coverage.paired_with_odds += 1
        paired.append(
            PairedRow(
                competition_id=competition_id,
                league=index.competitions.get(competition_id, pred.league),
                match_date=pred.match_date,
                home_team=pred.home_team,
                away_team=pred.away_team,
                outcome=pred.outcome,
                model_probs=pred.probs,
                odds=(float(odds[0]), float(odds[1]), float(odds[2])),
                market_proportional=devig["proportional"],
                market_shin=devig["shin"],
                overround=devig["overround"],
                shin_z=devig["z"],
            )
        )
    return paired


def build_corpus_rows(
    index: Optional[WarehouseIndex],
    *,
    leagues: Optional[Set[str]],
    since: Optional[date],
    until: Optional[date],
) -> Tuple[List[CorpusRow], int]:
    """Every settled warehouse fixture with usable closing odds, in scope.

    Returns ``(rows, n_rejected_prices)`` where the second value counts rows
    that had all three odds columns populated but failed validation (a zero, a
    sub-1.0 price, or a book so broken that de-vigging is meaningless).
    """
    rows: List[CorpusRow] = []
    rejected = 0
    if index is None:
        return rows, 0

    for row in index.conn.execute(
        """
        SELECT competition_id, season, date_utc, home_score, away_score,
               odds_home, odds_draw, odds_away
        FROM matches
        WHERE odds_home IS NOT NULL AND odds_draw IS NOT NULL AND odds_away IS NOT NULL
          AND home_score IS NOT NULL AND away_score IS NOT NULL
        ORDER BY date_utc
        """
    ):
        competition_id = row["competition_id"]
        if leagues and competition_id not in leagues:
            continue
        match_date = _parse_date(row["date_utc"])
        if match_date is None:
            continue
        if since and match_date < since:
            continue
        if until and match_date > until:
            continue

        odds = (row["odds_home"], row["odds_draw"], row["odds_away"])
        if not has_complete_odds(*odds):
            rejected += 1
            continue
        devig = _devigged(odds)
        if devig is None:
            rejected += 1
            continue

        rows.append(
            CorpusRow(
                competition_id=competition_id,
                league=index.competitions.get(competition_id, competition_id),
                season=int(row["season"]),
                match_date=match_date,
                outcome=outcome_from_scores(row["home_score"], row["away_score"]),
                odds=(float(odds[0]), float(odds[1]), float(odds[2])),
                market_proportional=devig["proportional"],
                market_shin=devig["shin"],
                overround=devig["overround"],
                shin_z=devig["z"],
            )
        )
    return rows, rejected


# ==========================================================================
# Reporting
# ==========================================================================

def _fmt(value: Optional[float], width: int = 8, digits: int = 4) -> str:
    return " " * width if value is None else f"{value:>{width}.{digits}f}"


def print_paired_summary(report: dict) -> None:
    paired = report["paired_benchmark"]
    coverage = paired["coverage"]
    print("\n" + "=" * 78)
    print("MODEL vs MARKET  —  paired on identical fixtures")
    print("=" * 78)
    print(
        f"settled predictions {coverage['settled_predictions']}  |  "
        f"in scope {coverage['in_scope']}  |  "
        f"joined {coverage['joined_to_warehouse_fixture']}  |  "
        f"paired with odds {coverage['paired_with_closing_odds']} "
        f"({coverage['odds_coverage_rate']:.1%} of in-scope)"
    )
    overall = paired["overall"]
    if not overall["n"]:
        print("\nNo paired fixtures. Nothing to compare.")
        return

    print(f"\nOVERALL  n={overall['n']}   "
          f"mean overround {overall['mean_overround']:.4f}   "
          f"mean Shin z {overall['mean_shin_z']:.5f}")
    print(f"\n{'forecaster':<24}{'Brier':>10}{'log loss':>11}{'RPS':>10}"
          f"{'accuracy':>10}{'ECE':>9}")
    print("-" * 78)
    for key, label in (
        ("model", "model"),
        ("market_proportional", "market (proportional)"),
        ("market_shin", "market (Shin)"),
        ("baseline_base_rate", "baseline: base rate"),
        ("baseline_uniform", "baseline: uniform 1/3"),
    ):
        m = overall["metrics"][key]
        print(f"{label:<24}{_fmt(m['brier'], 10)}{_fmt(m['log_loss'], 11)}"
              f"{_fmt(m['rps'], 10)}{_fmt(m['accuracy'], 10)}{_fmt(m['ece'], 9)}")

    gap = overall["gap_model_vs_market"]
    print(f"\ngap model - market ({overall['primary_market_method']}):  "
          f"Brier {gap['brier']:+.4f}   log loss {gap['log_loss']:+.4f}   "
          f"RPS {gap['rps']:+.4f}   accuracy {gap['accuracy']:+.4f}")
    print("(positive Brier/log-loss/RPS = model worse; positive accuracy = model better)")

    if paired["by_league"]:
        print(f"\n{'league':<26}{'n':>5}{'Brier mdl':>11}{'Brier mkt':>11}"
              f"{'gap':>9}{'acc mdl':>9}{'acc mkt':>9}")
        print("-" * 78)
        for league, block in sorted(
            paired["by_league"].items(), key=lambda kv: -kv[1]["n"]
        ):
            market_key = ("market_shin" if block["primary_market_method"] == "shin"
                          else "market_proportional")
            mdl, mkt = block["metrics"]["model"], block["metrics"][market_key]
            print(f"{league[:25]:<26}{block['n']:>5}{_fmt(mdl['brier'], 11)}"
                  f"{_fmt(mkt['brier'], 11)}"
                  f"{_fmt(block['gap_model_vs_market']['brier'], 9)}"
                  f"{_fmt(mdl['accuracy'], 9)}{_fmt(mkt['accuracy'], 9)}")


def print_corpus_summary(report: dict) -> None:
    corpus = report.get("market_corpus") or {}
    overall = corpus.get("overall") or {}
    if not overall.get("n"):
        return
    print("\n" + "=" * 78)
    print("MARKET CORPUS  —  what the closing line itself scores (the target)")
    print("=" * 78)
    print(f"n={overall['n']}   {overall['date_range'][0]} .. {overall['date_range'][1]}"
          f"   mean overround {overall['mean_overround']:.4f}")
    print(f"\n{'forecaster':<24}{'Brier':>10}{'log loss':>11}{'RPS':>10}"
          f"{'accuracy':>10}{'ECE':>9}")
    print("-" * 78)
    for key, label in (
        ("market_proportional", "market (proportional)"),
        ("market_shin", "market (Shin)"),
        ("baseline_base_rate", "baseline: base rate"),
        ("baseline_uniform", "baseline: uniform 1/3"),
    ):
        m = overall["metrics"][key]
        print(f"{label:<24}{_fmt(m['brier'], 10)}{_fmt(m['log_loss'], 11)}"
              f"{_fmt(m['rps'], 10)}{_fmt(m['accuracy'], 10)}{_fmt(m['ece'], 9)}")

    print(f"\n{'league':<26}{'n':>6}{'mkt Brier':>11}{'base rate':>11}"
          f"{'mkt acc':>9}{'over':>8}")
    print("-" * 78)
    for league, block in sorted(
        corpus.get("by_league", {}).items(), key=lambda kv: -kv[1]["n"]
    ):
        mkt = block["metrics"]["market_shin"]
        base = block["metrics"]["baseline_base_rate"]
        print(f"{league[:25]:<26}{block['n']:>6}{_fmt(mkt['brier'], 11)}"
              f"{_fmt(base['brier'], 11)}{_fmt(mkt['accuracy'], 9)}"
              f"{_fmt(block['mean_overround'], 8)}")


# ==========================================================================
# CLI
# ==========================================================================

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="benchmark_market",
        description="Score the prediction model against bookmaker closing odds.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--league",
        action="append",
        default=None,
        metavar="LEAGUE",
        help="Competition id (eng.1) or display name ('Premier League'). "
             "Repeat or comma-separate for several. Default: all.",
    )
    parser.add_argument(
        "--model-prefix",
        action="append",
        default=None,
        metavar="PREFIX",
        help="Only score predictions whose model_used starts with this "
             "(e.g. dixon_coles). Repeat for several. Default: every model "
             "that ever ran, which pools retired generations into one number.",
    )
    parser.add_argument("--since", metavar="YYYY-MM-DD",
                        help="Only score fixtures on or after this date.")
    parser.add_argument("--until", metavar="YYYY-MM-DD",
                        help="Only score fixtures on or before this date.")
    parser.add_argument("--devig", choices=DEVIG_METHODS, default="shin",
                        help="Which de-vig method drives the headline "
                             "model-vs-market gap. Both are always reported. "
                             "(default: shin)")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT,
                        help=f"Where to write the report (default: {DEFAULT_OUTPUT})")
    parser.add_argument("--warehouse", type=Path, default=DEFAULT_WAREHOUSE,
                        help="Path to warehouse.sqlite.")
    parser.add_argument("--predictions-dir", type=Path, default=DEFAULT_PREDICTIONS_DIR,
                        help="Directory of predictions_YYYY-MM.json files.")
    parser.add_argument("--buckets", type=int, default=10,
                        help="Reliability-table buckets (default: 10).")
    parser.add_argument("--min-league-n", type=int, default=10,
                        help="Suppress per-league blocks below this many paired "
                             "fixtures; they are noise. (default: 10)")
    parser.add_argument("--no-market-corpus", action="store_true",
                        help="Skip the market-only corpus section.")
    parser.add_argument("--quiet", action="store_true",
                        help="Write the JSON without printing the summary.")
    return parser


def _resolve_league_filter(
    raw: Optional[Sequence[str]], index: Optional[WarehouseIndex]
) -> Tuple[Optional[Set[str]], List[str]]:
    if not raw:
        return None, []
    requested: List[str] = []
    for item in raw:
        requested.extend(part.strip() for part in item.split(",") if part.strip())
    resolved: Set[str] = set()
    unknown: List[str] = []
    for label in requested:
        competition_id = index.resolve_league(label) if index else None
        if competition_id:
            resolved.add(competition_id)
        else:
            unknown.append(label)
    return (resolved or None), unknown


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)

    since = _parse_date(args.since)
    until = _parse_date(args.until)
    if args.since and since is None:
        print(f"error: --since {args.since!r} is not YYYY-MM-DD", file=sys.stderr)
        return 2
    if args.until and until is None:
        print(f"error: --until {args.until!r} is not YYYY-MM-DD", file=sys.stderr)
        return 2

    notes: List[str] = []
    index = WarehouseIndex.open(args.warehouse)
    if index is None:
        notes.append(
            f"Warehouse at {args.warehouse} is missing, empty, or unreadable. "
            "No market comparison is possible; every metric below is null. "
            "Rebuild with `python -m backend.scripts.build_warehouse --full`."
        )

    leagues, unknown_leagues = _resolve_league_filter(args.league, index)
    if args.league and leagues is None:
        # Every requested league failed to resolve. Falling through would score
        # the whole corpus and silently answer a question nobody asked.
        print(
            f"error: no recognised competition in --league {unknown_leagues}. "
            "Use a competition id (eng.1) or a display name ('Premier League').",
            file=sys.stderr,
        )
        return 2
    if unknown_leagues:
        notes.append(f"Unrecognised --league values ignored: {unknown_leagues}")

    predictions, settled_total, filtered = load_settled_predictions(
        args.predictions_dir, since=since, until=until,
        model_prefixes=args.model_prefix,
    )
    if not predictions:
        notes.append(
            f"No settled predictions found under {args.predictions_dir} "
            "for the requested filters."
        )

    coverage = Coverage(settled_predictions=settled_total, filtered_out=filtered)
    paired = build_paired_rows(predictions, index, leagues=leagues, coverage=coverage)

    by_league_rows: Dict[str, List[PairedRow]] = defaultdict(list)
    for row in paired:
        by_league_rows[row.league].append(row)

    paired_section = {
        "coverage": coverage.as_dict(),
        "overall": _score_paired_scope(paired, primary=args.devig, buckets=args.buckets),
        "by_league": {
            league: _score_paired_scope(rows, primary=args.devig, buckets=args.buckets)
            for league, rows in by_league_rows.items()
            if len(rows) >= args.min_league_n
        },
        "leagues_below_threshold": {
            league: len(rows)
            for league, rows in by_league_rows.items()
            if len(rows) < args.min_league_n
        },
    }
    if index is not None and not paired:
        notes.append(
            "Zero fixtures were paired: the warehouse holds no closing odds for "
            "any fixture the model has predicted and settled. The paired section "
            "reports n=0 rather than a number."
        )

    corpus_section = None
    if not args.no_market_corpus:
        corpus_rows, rejected = build_corpus_rows(
            index, leagues=leagues, since=since, until=until
        )
        if rejected:
            notes.append(
                f"{rejected} warehouse rows had odds columns populated but "
                "unusable values (zero or sub-1.0 prices); excluded."
            )
        by_league_corpus: Dict[str, List[CorpusRow]] = defaultdict(list)
        by_season_corpus: Dict[int, List[CorpusRow]] = defaultdict(list)
        for row in corpus_rows:
            by_league_corpus[row.league].append(row)
            by_season_corpus[row.season].append(row)

        corpus_section = {
            "description": (
                "Market-only scoring over every settled warehouse fixture with "
                "closing odds. This is the target the model must reach: it is "
                "measured on this project's own leagues and seasons, not quoted "
                "from published literature."
            ),
            "overall": _score_corpus_scope(corpus_rows, buckets=args.buckets),
            "by_league": {
                league: _score_corpus_scope(rows, buckets=args.buckets)
                for league, rows in by_league_corpus.items()
            },
            "by_season": {
                str(season): _score_corpus_scope(
                    rows, buckets=args.buckets, with_reliability=False
                )
                for season, rows in sorted(by_season_corpus.items())
            },
        }
        if index is not None and not corpus_rows:
            notes.append(
                "The warehouse contains no settled fixture with complete closing "
                "odds in scope, so the market corpus is empty."
            )

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "schema": "market_benchmark/1",
        "filters": {
            "leagues": sorted(leagues) if leagues else None,
            "model_prefixes": list(args.model_prefix) if args.model_prefix else None,
            "since": since.isoformat() if since else None,
            "until": until.isoformat() if until else None,
            "primary_devig": args.devig,
            "reliability_buckets": args.buckets,
            "min_league_n": args.min_league_n,
        },
        "warehouse": {
            "path": str(args.warehouse),
            "available": index is not None,
            **(index.summary() if index is not None else {}),
        },
        "paired_benchmark": paired_section,
        "market_corpus": corpus_section,
        "notes": notes,
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

    if not args.quiet:
        print_paired_summary(report)
        print_corpus_summary(report)
        for note in notes:
            print(f"\nNOTE: {note}")
        print(f"\nWrote {args.output}")

    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
