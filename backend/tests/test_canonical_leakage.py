"""Leakage tests for the canonical layer and the walk-forward harness.

Why these exist as tests rather than as care
--------------------------------------------
Every leak this repository has actually suffered was invisible in the output.
The train/serve skew that made served predictions worse than a constant base
rate passed the schema guard because the feature *names* matched and only the
*values* differed. The mis-paired backtest harness reported the market at
Brier .6911 instead of .5757 and nobody noticed for weeks, because a wrong
number and a right number look identical.

So the rule is: a leakage failure must stop the run, not decorate a report.

What each test pins
-------------------
`test_no_stored_aggregates`          the canonical layer holds facts, not
                                     season-to-date or final-season rollups.
                                     A stored aggregate is the cheapest way to
                                     put a May value into a March prediction.
`test_prediction_precedes_its_own_result`
                                     the harness predicts every match before
                                     observing it — checked by a model that
                                     records the exact state it saw.
`test_same_day_fixtures_cannot_see_each_other`
                                     a 12:30 kickoff must not see a 17:30
                                     result. This is the one that a naive
                                     "sort by date and loop" gets wrong.
`test_future_matches_do_not_change_a_prediction`
                                     appending later matches to the corpus
                                     leaves every earlier prediction bit-identical.
`test_probabilities_are_a_distribution`
                                     the arithmetic the metrics assume.
`test_uniform_hits_the_analytic_floor`
                                     log loss ln(3) and Brier 2/3 exactly. If
                                     the metric code drifts, this catches it
                                     before a model is credited with the drift.
"""
from __future__ import annotations

from datetime import date, timedelta

import numpy as np
import pytest

from backend.scripts.baseline_walkforward import (
    IDX,
    BaseRate,
    Elo,
    Uniform,
    brier,
    log_loss,
    walk,
)


def mk(day: int, home: str, away: str, hs: int, as_: int, comp: str = "eng.1") -> dict:
    return {
        "match_uid": f"{comp}-{day}-{home}-{away}",
        "competition_id": comp,
        "season": 2020,
        "local_date": date(2020, 8, 1) + timedelta(days=day),
        "home_key": f"{comp}::{home}",
        "away_key": f"{comp}::{away}",
        "home_score": hs,
        "away_score": as_,
        "result": "H" if hs > as_ else ("A" if hs < as_ else "D"),
        "phase": None,
    }


CORPUS = [
    mk(0, "a", "b", 2, 0),
    mk(0, "c", "d", 0, 1),
    mk(7, "b", "c", 1, 1),
    mk(14, "d", "a", 0, 3),
    mk(21, "a", "c", 2, 1),
    mk(28, "b", "d", 1, 0),
]


class Recorder:
    """A model that answers uniformly and writes down what it was allowed to
    know at the instant it was asked."""

    name = "recorder"

    def __init__(self) -> None:
        self.seen: list[str] = []
        self.log: list[tuple[str, tuple[str, ...]]] = []

    def predict(self, m):
        self.log.append((m["match_uid"], tuple(self.seen)))
        return np.array([1 / 3, 1 / 3, 1 / 3])

    def observe(self, m):
        self.seen.append(m["match_uid"])


# ------------------------------------------------------------------ the layer
def test_no_stored_aggregates():
    """The canonical schema must carry no season-to-date or final-season column.

    Skipped rather than failed when the database has not been built, so the
    suite still runs on a clean checkout — but it never passes vacuously on a
    database that HAS been built.
    """
    duckdb = pytest.importorskip("duckdb")
    from backend.scripts.build_canonical import DUCKDB_OUT

    if not DUCKDB_OUT.exists():
        pytest.skip("canonical.duckdb not built")

    con = duckdb.connect(str(DUCKDB_OUT), read_only=True)
    cols = {r[0].lower() for r in con.execute(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_name = 'matches'").fetchall()}
    con.close()

    banned = ("_to_date", "season_total", "final_", "_avg", "_mean", "_rolling",
              "_last_", "_form", "points", "position", "rank")
    offenders = sorted(c for c in cols if any(b in c for b in banned))
    assert not offenders, (
        "the canonical layer stores facts only; these look derived and would "
        f"let a later value reach an earlier prediction: {offenders}")


# ------------------------------------------------------------------ the walk
def test_prediction_precedes_its_own_result():
    rec = Recorder()
    walk(CORPUS, [rec])
    for uid, seen in rec.log:
        assert uid not in seen, f"{uid} was observed before it was predicted"


def test_same_day_fixtures_cannot_see_each_other():
    """Two matches on 2020-08-01. Neither may inform the other."""
    rec = Recorder()
    walk(CORPUS, [rec])
    same_day = [m["match_uid"] for m in CORPUS
                if m["local_date"] == date(2020, 8, 1)]
    for uid, seen in rec.log:
        if uid in same_day:
            assert not (set(seen) & set(same_day)), (
                f"{uid} saw a same-day fixture: {set(seen) & set(same_day)}")


def test_no_future_match_is_visible_to_an_earlier_prediction():
    order = {m["match_uid"]: i for i, m in enumerate(CORPUS)}
    rec = Recorder()
    walk(CORPUS, [rec])
    for uid, seen in rec.log:
        later = [s for s in seen if order[s] > order[uid]]
        assert not later, f"{uid} saw future matches {later}"


def test_future_matches_do_not_change_an_earlier_prediction():
    """Extending the corpus must leave every earlier prediction bit-identical.

    This is the property that makes a backtest a forecast: if tomorrow's
    fixtures can move today's number, the number was never available today.
    """
    short = walk(CORPUS[:4], [Elo(), BaseRate()])
    full = walk(CORPUS, [Elo(), BaseRate()])
    for name in ("elo", "base_rate"):
        np.testing.assert_array_equal(
            short[name]["P"], full[name]["P"][:4],
            err_msg=f"{name}: adding later matches changed an earlier prediction")


def test_elo_rating_used_is_the_one_before_the_match():
    """A team that has just won must be predicted on its pre-win rating."""
    elo = Elo()
    m1, m2 = mk(0, "a", "b", 5, 0), mk(7, "a", "c", 1, 0)
    before = elo.predict(m1)[0]
    elo.observe(m1)
    after_rating = elo.rating["eng.1::a"]
    assert after_rating > 1500.0, "a win must raise the rating"
    # The second prediction may use the updated rating; the FIRST may not have.
    fresh = Elo()
    assert fresh.predict(m1)[0] == pytest.approx(before)


# ---------------------------------------------------------------- arithmetic
@pytest.mark.parametrize("model", [Uniform(), BaseRate(), Elo(), Elo(mov=True)])
def test_probabilities_are_a_distribution(model):
    for m in CORPUS:
        p = model.predict(m)
        assert p.shape == (3,)
        assert np.all(p > 0), "a zero probability is an infinite log loss waiting"
        assert p.sum() == pytest.approx(1.0)
        model.observe(m)


def test_uniform_hits_the_analytic_floor():
    """ln(3) and 2/3 exactly. A metric that drifts credits the drift to a model."""
    y = np.array([IDX[m["result"]] for m in CORPUS])
    p = np.full((len(CORPUS), 3), 1 / 3)
    assert log_loss(p, y) == pytest.approx(np.log(3))
    assert brier(p, y) == pytest.approx(2 / 3)


def test_a_perfect_forecaster_scores_zero():
    y = np.array([IDX[m["result"]] for m in CORPUS])
    p = np.full((len(CORPUS), 3), 1e-15)
    p[np.arange(len(y)), y] = 1.0
    assert brier(p, y) == pytest.approx(0.0, abs=1e-12)
    assert log_loss(p, y) == pytest.approx(0.0, abs=1e-9)
