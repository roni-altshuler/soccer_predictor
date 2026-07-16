"""Pluggable walk-forward backtest core — shared by every 1X2 predictor.

Extracted from ``backtest_dixon_coles.py`` so that the Dixon-Coles baseline and
the Match Engine (and any future model) are scored by ONE loop on
byte-identical fixtures with identical information sets:

* the same season / matchday-block construction,
* the same walk-forward training cut per block
  (``load_competition_matches(..., until=block_start)``),
* the same skip rule (``MIN_FIT_MATCHES``) applied centrally — a block that is
  skipped is skipped for *every* predictor, so all models score the exact same
  fixture list,
* the same Brier (multiclass, Σ_k (p_k - y_k)², range 0-2), log-loss and
  top-1 accuracy, on ALL matches and on the odds subset against the de-vigged
  bookmaker market.

Predictor contract
------------------
A predictor is any object with:

    name: str                                # e.g. "dixon_coles"
    fit_block(ctx: BlockContext) -> None     # called once per matchday block
    predict(home, away, ref_date) -> Optional[(p_home, p_draw, p_away)]

``fit_block`` receives the block's walk-forward training cut (matches strictly
before the block's first kickoff) and may fit/refit/fine-tune however it
likes; ``predict`` is then called for every fixture in the block. Returning
``None`` from ``predict`` drops that fixture from *all* predictors'
accumulators (pairing is preserved); with the shipped predictors this never
happens (both cold-start unseen teams).

``BlockContext.dc_model`` lazily fits Dixon-Coles on the block's cut exactly
as the historical yardstick script did (same call, same arguments) and caches
it, so the DC baseline and any DC-anchored model share one fit per block —
this is what guarantees the refactor reproduces the previously reported DC
numbers to numerical precision.

The warehouse is ALWAYS opened strictly read-only.
"""

from __future__ import annotations

import math
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

from backend.scripts.train_dixon_coles import (
    dominant_source,
    load_competition_matches,
)
from backend.services.prediction.dixon_coles import (
    DixonColesModel,
    fit_dixon_coles,
)

_EPS = 1e-12
MIN_FIT_MATCHES = 100
# A season counts as "complete" only if its last match is at least this many
# days in the past (guards against scoring a season still in progress).
SEASON_COMPLETE_GRACE_DAYS = 21

Probs = Tuple[float, float, float]


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------
def outcome_index(home_goals: int, away_goals: int) -> int:
    """0 = home win, 1 = draw, 2 = away win."""
    if home_goals > away_goals:
        return 0
    if home_goals == away_goals:
        return 1
    return 2


def brier(probs: Sequence[float], outcome: int) -> float:
    """Multiclass Brier score: sum over the 3 outcomes of (p - y)^2."""
    return sum(
        (p - (1.0 if k == outcome else 0.0)) ** 2 for k, p in enumerate(probs)
    )


def log_loss(probs: Sequence[float], outcome: int) -> float:
    return -math.log(max(probs[outcome], _EPS))


def devig(
    odds_h: float, odds_d: float, odds_a: float
) -> Optional[Probs]:
    """Bookmaker implied probabilities with the overround normalised away."""
    if min(odds_h, odds_d, odds_a) <= 1.0:
        return None
    inv = (1.0 / odds_h, 1.0 / odds_d, 1.0 / odds_a)
    s = sum(inv)
    return (inv[0] / s, inv[1] / s, inv[2] / s)


@dataclass
class ScoreAccumulator:
    name: str
    brier_sum: float = 0.0
    logloss_sum: float = 0.0
    n: int = 0
    hits: int = 0

    def add(self, probs: Sequence[float], outcome: int) -> None:
        self.brier_sum += brier(probs, outcome)
        self.logloss_sum += log_loss(probs, outcome)
        self.n += 1
        if max(range(3), key=lambda k: probs[k]) == outcome:
            self.hits += 1

    @property
    def brier(self) -> float:
        return self.brier_sum / self.n if self.n else float("nan")

    @property
    def logloss(self) -> float:
        return self.logloss_sum / self.n if self.n else float("nan")

    @property
    def accuracy(self) -> float:
        return self.hits / self.n if self.n else float("nan")


# ---------------------------------------------------------------------------
# Season / matchday plumbing
# ---------------------------------------------------------------------------
def latest_complete_season(
    con: sqlite3.Connection, competition_id: str, source: str
) -> Optional[int]:
    cutoff = (
        datetime.now(timezone.utc) - timedelta(days=SEASON_COMPLETE_GRACE_DAYS)
    ).isoformat()
    row = con.execute(
        """
        SELECT season, MAX(date_utc) AS last_date, COUNT(*) AS n
        FROM matches
        WHERE competition_id = ? AND source = ?
          AND home_score IS NOT NULL AND away_score IS NOT NULL
        GROUP BY season HAVING last_date < ?
        ORDER BY season DESC LIMIT 1
        """,
        (competition_id, source, cutoff),
    ).fetchone()
    return int(row["season"]) if row else None


def load_season_matches(
    con: sqlite3.Connection, competition_id: str, source: str, season: int
) -> List[sqlite3.Row]:
    return con.execute(
        """
        SELECT m.match_id, m.date_utc, m.home_score, m.away_score,
               m.odds_home, m.odds_draw, m.odds_away,
               h.canonical_name AS home, a.canonical_name AS away
        FROM matches m
        JOIN teams h ON h.team_id = m.home_team_id
        JOIN teams a ON a.team_id = m.away_team_id
        WHERE m.competition_id = ? AND m.source = ? AND m.season = ?
          AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
        ORDER BY m.date_utc ASC, m.match_id ASC
        """,
        (competition_id, source, season),
    ).fetchall()


def matchday_blocks(rows: List[sqlite3.Row]) -> List[List[sqlite3.Row]]:
    """Group season fixtures into matchday-like blocks.

    Consecutive fixture *dates* (gap of <= 1 blank day) belong to one block; a
    gap of 2+ days starts the next. Reconstructs Fri-Mon weekend rounds and
    midweek rounds without needing a round column.
    """
    blocks: List[List[sqlite3.Row]] = []
    current: List[sqlite3.Row] = []
    prev_day: Optional[datetime] = None
    for row in rows:
        day = datetime.fromisoformat(str(row["date_utc"])[:10])
        if prev_day is not None and (day - prev_day).days >= 2:
            blocks.append(current)
            current = []
        current.append(row)
        prev_day = day
    if current:
        blocks.append(current)
    return blocks


def competition_gender(con: sqlite3.Connection, competition_id: str) -> str:
    row = con.execute(
        "SELECT gender FROM competitions WHERE competition_id = ?",
        (competition_id,),
    ).fetchone()
    return str(row["gender"]) if row else "M"


# ---------------------------------------------------------------------------
# Predictor plumbing
# ---------------------------------------------------------------------------
@dataclass
class BlockContext:
    """Everything a predictor may use for one matchday block — nothing more.

    ``train`` contains only matches dated strictly before ``block_start``
    (enforced by the ``until=`` cut in the loader), so no model can see a
    fixture it is about to be scored on.
    """

    competition_id: str
    season: int
    source: str
    gender: str
    block_index: int
    block_start: str
    train: List[Dict[str, object]]
    n_seasons: int
    half_life_days: float
    _dc_model: Optional[DixonColesModel] = None

    @property
    def dc_model(self) -> DixonColesModel:
        """Dixon-Coles fitted on this block's cut — the exact historical call."""
        if self._dc_model is None:
            self._dc_model = fit_dixon_coles(
                self.train,
                half_life_days=self.half_life_days,
                ref_date=self.block_start,
            )
        return self._dc_model


class DixonColesPredictor:
    """The committed DC baseline, scored through the pluggable path."""

    name = "dixon_coles"

    def __init__(self) -> None:
        self._model: Optional[DixonColesModel] = None

    def fit_block(self, ctx: BlockContext) -> None:
        self._model = ctx.dc_model

    def predict(self, home: str, away: str, ref_date: str) -> Optional[Probs]:
        assert self._model is not None, "fit_block must be called first"
        pred = self._model.predict(home, away)
        return (pred["p_home"], pred["p_draw"], pred["p_away"])


# ---------------------------------------------------------------------------
# Reports / per-match records
# ---------------------------------------------------------------------------
@dataclass
class MatchRecord:
    """One scored fixture — the substrate for paired bootstrap analysis."""

    competition_id: str
    season: int
    block_index: int
    match_id: str
    date_utc: str
    outcome: int
    probs: Dict[str, Probs]
    market: Optional[Probs]


@dataclass
class CompetitionReport:
    competition_id: str
    season: int
    source: str
    predictor_names: List[str]
    n_blocks: int = 0
    skipped: int = 0
    all_acc: Dict[str, ScoreAccumulator] = field(default_factory=dict)
    uni_all: ScoreAccumulator = field(
        default_factory=lambda: ScoreAccumulator("uniform")
    )
    # Head-to-head on the odds subset only (fair comparison).
    odds_acc: Dict[str, ScoreAccumulator] = field(default_factory=dict)
    mkt: ScoreAccumulator = field(default_factory=lambda: ScoreAccumulator("market"))
    uni_mkt: ScoreAccumulator = field(
        default_factory=lambda: ScoreAccumulator("uniform_on_odds")
    )

    def __post_init__(self) -> None:
        for name in self.predictor_names:
            self.all_acc.setdefault(name, ScoreAccumulator(name))
            self.odds_acc.setdefault(name, ScoreAccumulator(f"{name}_on_odds"))


# ---------------------------------------------------------------------------
# The walk-forward loop (extracted verbatim in structure from the yardstick)
# ---------------------------------------------------------------------------
def backtest_competition(
    con: sqlite3.Connection,
    predictors: Sequence,
    competition_id: str,
    season: Optional[int],
    n_seasons: int,
    half_life_days: float,
) -> Tuple[Optional[CompetitionReport], List[MatchRecord]]:
    source = dominant_source(con, competition_id)
    if source is None:
        print(f"!! {competition_id}: no data")
        return None, []
    if season is None:
        season = latest_complete_season(con, competition_id, source)
        if season is None:
            print(f"!! {competition_id}: no complete season found")
            return None, []

    rows = load_season_matches(con, competition_id, source, season)
    if not rows:
        print(f"!! {competition_id} season {season}: no completed matches")
        return None, []

    gender = competition_gender(con, competition_id)
    names = [p.name for p in predictors]
    report = CompetitionReport(competition_id, season, source, names)
    records: List[MatchRecord] = []
    blocks = matchday_blocks(rows)
    report.n_blocks = len(blocks)

    for block_index, block in enumerate(blocks):
        block_start = str(block[0]["date_utc"])
        train = load_competition_matches(
            con, competition_id, n_seasons, source=source, until=block_start
        )
        if len(train) < MIN_FIT_MATCHES:
            # Central skip rule: skipped for EVERY predictor, identically.
            report.skipped += len(block)
            continue
        ctx = BlockContext(
            competition_id=competition_id,
            season=season,
            source=source,
            gender=gender,
            block_index=block_index,
            block_start=block_start,
            train=train,
            n_seasons=n_seasons,
            half_life_days=half_life_days,
        )
        for predictor in predictors:
            predictor.fit_block(ctx)
        for row in block:
            probs_by_name: Dict[str, Probs] = {}
            failed = False
            for predictor in predictors:
                probs = predictor.predict(row["home"], row["away"], block_start)
                if probs is None:
                    failed = True
                    break
                probs_by_name[predictor.name] = probs
            if failed:
                report.skipped += 1
                continue
            out = outcome_index(int(row["home_score"]), int(row["away_score"]))
            for name, probs in probs_by_name.items():
                report.all_acc[name].add(probs, out)
            report.uni_all.add((1 / 3, 1 / 3, 1 / 3), out)
            market: Optional[Probs] = None
            if (
                row["odds_home"] is not None
                and row["odds_draw"] is not None
                and row["odds_away"] is not None
            ):
                market = devig(
                    float(row["odds_home"]),
                    float(row["odds_draw"]),
                    float(row["odds_away"]),
                )
                if market is not None:
                    for name, probs in probs_by_name.items():
                        report.odds_acc[name].add(probs, out)
                    report.mkt.add(market, out)
                    report.uni_mkt.add((1 / 3, 1 / 3, 1 / 3), out)
            records.append(
                MatchRecord(
                    competition_id=competition_id,
                    season=season,
                    block_index=block_index,
                    match_id=str(row["match_id"]),
                    date_utc=str(row["date_utc"]),
                    outcome=out,
                    probs=probs_by_name,
                    market=market,
                )
            )
    return report, records


def run_backtest(
    con: sqlite3.Connection,
    predictors: Sequence,
    competitions: Sequence[str],
    season: Optional[int],
    n_seasons: int,
    half_life_days: float,
) -> Tuple[List[CompetitionReport], List[MatchRecord]]:
    reports: List[CompetitionReport] = []
    records: List[MatchRecord] = []
    for comp in competitions:
        print(f"Backtesting {comp} ...")
        rep, recs = backtest_competition(
            con, predictors, comp, season, n_seasons, half_life_days
        )
        if rep is not None:
            reports.append(rep)
            records.extend(recs)
    return reports, records


# ---------------------------------------------------------------------------
# Paired block bootstrap on ΔBrier
# ---------------------------------------------------------------------------
def paired_block_bootstrap(
    records: Sequence[MatchRecord],
    name_a: str,
    name_b: str,
    n_boot: int = 10_000,
    seed: int = 20260715,
) -> Optional[Dict[str, object]]:
    """CI on mean ΔBrier = Brier(name_b) - Brier(name_a) (negative => b better).

    Matches are PAIRED (same fixture scored by both models) and resampled at
    the matchday-block level — scores within a matchday share a fitting cut and
    are not independent, so blocks are the honest resampling unit.
    """
    by_block: Dict[Tuple[str, int, int], List[float]] = {}
    for rec in records:
        if name_a not in rec.probs or name_b not in rec.probs:
            continue
        delta = brier(rec.probs[name_b], rec.outcome) - brier(
            rec.probs[name_a], rec.outcome
        )
        key = (rec.competition_id, rec.season, rec.block_index)
        by_block.setdefault(key, []).append(delta)
    if not by_block:
        return None
    block_sums = np.array([sum(v) for v in by_block.values()], dtype=np.float64)
    block_ns = np.array([len(v) for v in by_block.values()], dtype=np.float64)
    n_blocks = len(block_sums)
    point = float(block_sums.sum() / block_ns.sum())

    rng = np.random.default_rng(seed)
    idx = rng.integers(0, n_blocks, size=(n_boot, n_blocks))
    sums = block_sums[idx].sum(axis=1)
    ns = block_ns[idx].sum(axis=1)
    deltas = sums / np.maximum(ns, 1.0)
    lo, hi = np.percentile(deltas, [2.5, 97.5])
    return {
        "delta_brier_mean": point,
        "ci_low": float(lo),
        "ci_high": float(hi),
        "p_better": float(np.mean(deltas < 0.0)),
        "n_blocks": int(n_blocks),
        "n_matches": int(block_ns.sum()),
        "n_boot": int(n_boot),
        "definition": f"brier({name_b}) - brier({name_a}); negative favours {name_b}",
    }
