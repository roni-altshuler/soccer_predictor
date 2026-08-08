"""Market maths for the bookmaker benchmark.

This module is the arithmetic core of the market scoreboard described in
`docs/PIVOT_2026-08.md` §3: *"the market is the benchmark. Any accuracy claim
is stated as paired Brier/log-loss against closing odds on named fixtures, or
it is not stated."*

Everything here is a **pure function**. No I/O, no globals, no logging, no
dependency beyond the standard library. That is deliberate — the benchmark
harness (`backend/scripts/benchmark_market.py`) does all the reading and
writing, and this module does all the maths, so the maths can be unit-tested
to known values without a database.

Three groups of functions:

**De-vigging.** Decimal odds carry the bookmaker's margin, so the raw implied
probabilities ``1/odds`` sum to more than 1. The excess is the *overround*
(a.k.a. vig / juice). Two removal methods are provided because they disagree
where it matters and the pivot doc requires reporting both:

* :func:`devig_proportional` — divide by the booksum. Assumes the margin is
  loaded uniformly across outcomes. Simple, standard, and biased at the
  extremes: it over-states longshots.
* :func:`devig_shin` — Shin's (1993) model, which treats the margin as the
  bookmaker's defence against a proportion ``z`` of insider traders. Because
  insiders concentrate on mispriced longshots, Shin removes *more* margin from
  short prices and less from long ones. Empirically more accurate at the tails
  (Štrumbelj 2014, "On determining probability forecasts from betting odds").

**Scoring.** :func:`brier_score`, :func:`log_loss_single` and :func:`rps` score
a single 3-way forecast against the realised outcome. All three are *negatively
oriented* — lower is better. RPS is included because it is the standard in the
football-forecasting literature and, unlike Brier, it is sensitive to the
natural H > D > A ordering: predicting a home win when the away team wins is
punished harder than predicting a draw.

**Value.** :func:`closing_line_value`, :func:`expected_value` and
:func:`kelly_fraction` back the value surface (pivot doc §2, deliverable 3).
Per §2.1 these are gated per league on market-benchmark evidence; this module
supplies the numbers, not the decision to display them.

Conventions used throughout
---------------------------
* Outcomes are ordered ``(home, draw, away)`` and probability triples are
  plain ``(float, float, float)`` tuples in that order.
* "Odds" always means **decimal** (European) odds, strictly greater than 1.0.
* Every function validates its inputs and raises :class:`InvalidOddsError` or
  :class:`ProbabilityError` (both subclasses of ``ValueError``) rather than
  returning a silent ``nan``. Missing odds is the common case in the warehouse,
  so callers should gate on :func:`has_complete_odds` instead of catching.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable, List, Mapping, Optional, Sequence, Tuple, Union

__all__ = [
    "OUTCOMES",
    "HOME",
    "DRAW",
    "AWAY",
    "MarketError",
    "InvalidOddsError",
    "ProbabilityError",
    "outcome_index",
    "outcome_from_scores",
    "argmax_outcome",
    "validate_odds",
    "has_complete_odds",
    "coerce_probabilities",
    "implied_probabilities",
    "booksum",
    "overround",
    "devig_proportional",
    "devig_shin",
    "shin_z",
    "devig",
    "DEVIG_METHODS",
    "brier_score",
    "log_loss_single",
    "rps",
    "closing_line_value",
    "expected_value",
    "kelly_fraction",
    "ReliabilityBucket",
    "flatten_multiclass",
    "top_class_pairs",
    "reliability_table",
    "expected_calibration_error",
]

# --------------------------------------------------------------------------
# Outcome vocabulary
# --------------------------------------------------------------------------

#: Canonical outcome ordering. RPS depends on this being the *ordered* scale
#: home > draw > away, so do not reorder it.
OUTCOMES: Tuple[str, str, str] = ("home", "draw", "away")

HOME, DRAW, AWAY = 0, 1, 2

_OUTCOME_ALIASES = {
    "home": HOME, "h": HOME, "1": HOME, "home_win": HOME, "homewin": HOME,
    "draw": DRAW, "d": DRAW, "x": DRAW, "tie": DRAW,
    "away": AWAY, "a": AWAY, "2": AWAY, "away_win": AWAY, "awaywin": AWAY,
}

Probabilities = Tuple[float, float, float]
ProbInput = Union[Sequence[float], Mapping[str, float]]
Outcome = Union[str, int]

#: Smallest decimal odds we accept. A price of exactly 1.00 implies certainty
#: and a price below 1.00 implies a probability above 1 — both are data errors,
#: never real quotes.
_MIN_ODDS = 1.0

_LOG_EPS = 1e-15

DEVIG_METHODS: Tuple[str, str] = ("proportional", "shin")


class MarketError(ValueError):
    """Base class for market-maths input errors."""


class InvalidOddsError(MarketError):
    """Raised for missing, non-numeric, non-finite or sub-1.0 decimal odds."""


class ProbabilityError(MarketError):
    """Raised for malformed probability vectors or out-of-range scalars."""


def outcome_index(outcome: Outcome) -> int:
    """Map an outcome label or index onto ``0`` (home) / ``1`` (draw) / ``2`` (away).

    Accepts ``"home" | "draw" | "away"``, the short forms ``H/D/A`` and
    ``1/X/2``, and the bare integers ``0/1/2``. Case and surrounding
    whitespace are ignored, so the raw strings stored in
    ``backend/data/predictions/*.json`` drop straight in.
    """
    if isinstance(outcome, bool):  # bool is an int subclass; reject explicitly
        raise ProbabilityError(f"invalid outcome: {outcome!r}")
    if isinstance(outcome, int):
        if outcome in (HOME, DRAW, AWAY):
            return int(outcome)
        raise ProbabilityError(f"outcome index out of range: {outcome!r}")
    if isinstance(outcome, str):
        key = outcome.strip().lower()
        if key in _OUTCOME_ALIASES:
            return _OUTCOME_ALIASES[key]
    raise ProbabilityError(f"unrecognised outcome: {outcome!r}")


def outcome_from_scores(home_goals: int, away_goals: int) -> str:
    """Return the 1X2 label implied by a final score."""
    if home_goals is None or away_goals is None:
        raise ProbabilityError("cannot derive an outcome from a missing score")
    if home_goals > away_goals:
        return "home"
    if home_goals < away_goals:
        return "away"
    return "draw"


def argmax_outcome(probs: ProbInput) -> str:
    """Return the label of the highest-probability outcome.

    Ties break toward the earlier outcome in :data:`OUTCOMES` (home, then
    draw), which matches ``max()``/``argmax`` semantics elsewhere in the repo.
    """
    values = coerce_probabilities(probs)
    best = max(range(3), key=lambda i: values[i])
    return OUTCOMES[best]


# --------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------

def validate_odds(value: object, *, name: str = "odds") -> float:
    """Coerce ``value`` to a valid decimal price or raise :class:`InvalidOddsError`.

    Rejects ``None`` (missing quote), non-numeric values, ``nan``/``inf``, and
    anything ``<= 1.0`` — including ``0.0``, which is how some CSV feeds encode
    "no price available" and which would otherwise divide by zero.
    """
    if value is None:
        raise InvalidOddsError(f"{name} is missing (None)")
    if isinstance(value, bool):
        raise InvalidOddsError(f"{name} is not numeric: {value!r}")
    try:
        odds = float(value)
    except (TypeError, ValueError) as exc:
        raise InvalidOddsError(f"{name} is not numeric: {value!r}") from exc
    if not math.isfinite(odds):
        raise InvalidOddsError(f"{name} is not finite: {value!r}")
    if odds <= _MIN_ODDS:
        raise InvalidOddsError(
            f"{name} must be decimal odds greater than {_MIN_ODDS}, got {odds!r}"
        )
    return odds


def has_complete_odds(odds_home: object, odds_draw: object, odds_away: object) -> bool:
    """``True`` when all three prices are usable. Never raises.

    The warehouse is sparse — most rows have no odds at all — so the benchmark
    harness uses this as a filter rather than wrapping every row in a
    try/except.
    """
    try:
        validate_odds(odds_home, name="odds_home")
        validate_odds(odds_draw, name="odds_draw")
        validate_odds(odds_away, name="odds_away")
    except InvalidOddsError:
        return False
    return True


def coerce_probabilities(
    probs: ProbInput,
    *,
    normalise: bool = True,
    tolerance: float = 1e-6,
) -> Probabilities:
    """Validate a 3-way probability vector and return it as an ordered triple.

    Accepts either a sequence in ``(home, draw, away)`` order or a mapping
    keyed by outcome label (``{"home": ..., "draw": ..., "away": ...}``).

    Vectors that do not sum to 1 are the normal case, not an exception: the
    committed prediction JSON stores probabilities rounded to four decimals, so
    sums land a few parts in 10,000 off. With ``normalise=True`` (the default)
    the vector is rescaled to sum to exactly 1. With ``normalise=False`` a sum
    outside ``tolerance`` raises :class:`ProbabilityError`, which is what you
    want when asserting that an upstream model is well-formed.

    Negative entries, ``nan``, and a non-positive total always raise — those
    are bugs, not rounding.
    """
    if isinstance(probs, Mapping):
        try:
            raw = [probs[key] for key in OUTCOMES]
        except KeyError as exc:
            raise ProbabilityError(
                f"probability mapping must contain keys {OUTCOMES}, missing {exc}"
            ) from exc
    else:
        raw = list(probs)  # type: ignore[arg-type]

    if len(raw) != 3:
        raise ProbabilityError(f"expected 3 probabilities (home, draw, away), got {len(raw)}")

    values: List[float] = []
    for label, item in zip(OUTCOMES, raw):
        if item is None:
            raise ProbabilityError(f"probability for {label!r} is missing (None)")
        try:
            value = float(item)
        except (TypeError, ValueError) as exc:
            raise ProbabilityError(f"probability for {label!r} is not numeric: {item!r}") from exc
        if not math.isfinite(value):
            raise ProbabilityError(f"probability for {label!r} is not finite: {item!r}")
        if value < 0.0:
            raise ProbabilityError(f"probability for {label!r} is negative: {value!r}")
        values.append(value)

    total = math.fsum(values)
    if total <= 0.0:
        raise ProbabilityError("probabilities sum to zero; no distribution to score")

    if abs(total - 1.0) <= tolerance:
        return (values[0], values[1], values[2])
    if not normalise:
        raise ProbabilityError(
            f"probabilities sum to {total!r}, outside tolerance {tolerance!r} of 1.0"
        )
    return (values[0] / total, values[1] / total, values[2] / total)


def _validate_probability(value: object, *, name: str) -> float:
    """Validate a single scalar probability in ``[0, 1]``."""
    if value is None:
        raise ProbabilityError(f"{name} is missing (None)")
    if isinstance(value, bool):
        raise ProbabilityError(f"{name} is not numeric: {value!r}")
    try:
        prob = float(value)
    except (TypeError, ValueError) as exc:
        raise ProbabilityError(f"{name} is not numeric: {value!r}") from exc
    if not math.isfinite(prob):
        raise ProbabilityError(f"{name} is not finite: {value!r}")
    if not 0.0 <= prob <= 1.0:
        raise ProbabilityError(f"{name} must lie in [0, 1], got {prob!r}")
    return prob


# --------------------------------------------------------------------------
# Implied probabilities and the overround
# --------------------------------------------------------------------------

def implied_probabilities(
    odds_home: object, odds_draw: object, odds_away: object
) -> Probabilities:
    """Raw implied probabilities ``1/odds``, **with the vig still in**.

    These deliberately sum to more than 1 for any real book — that excess *is*
    the bookmaker's margin. Do not score against these; de-vig first.

    >>> [round(p, 4) for p in implied_probabilities(2.0, 4.0, 4.0)]
    [0.5, 0.25, 0.25]
    """
    home = validate_odds(odds_home, name="odds_home")
    draw = validate_odds(odds_draw, name="odds_draw")
    away = validate_odds(odds_away, name="odds_away")
    return (1.0 / home, 1.0 / draw, 1.0 / away)


def booksum(odds_home: object, odds_draw: object, odds_away: object) -> float:
    """Sum of the raw implied probabilities (the "book"). Fair book == 1.0."""
    return math.fsum(implied_probabilities(odds_home, odds_draw, odds_away))


def overround(odds_home: object, odds_draw: object, odds_away: object) -> float:
    """Bookmaker margin as a fraction: ``booksum - 1``.

    A book quoted with 5% overround returns ``0.05``. Negative values mean an
    arbitrage (booksum < 1) — possible when the three prices come from
    different books, impossible within one honest book, and worth flagging
    rather than silently de-vigging.
    """
    return booksum(odds_home, odds_draw, odds_away) - 1.0


# --------------------------------------------------------------------------
# De-vigging
# --------------------------------------------------------------------------

def devig_proportional(
    odds_home: object, odds_draw: object, odds_away: object
) -> Probabilities:
    """Remove the margin by proportional (multiplicative) normalisation.

    Each raw implied probability is divided by the booksum, so every outcome
    surrenders the same *relative* share of the margin. The result always sums
    to exactly 1.

    This is the standard baseline. Its known weakness is the favourite–longshot
    bias: assuming a uniform relative margin over-states longshots, because
    bookmakers in fact load proportionally more margin onto long prices.
    Compare against :func:`devig_shin`, which corrects in that direction.

    >>> p = devig_proportional(2.0, 4.0, 4.0)
    >>> round(sum(p), 12)
    1.0
    """
    raw = implied_probabilities(odds_home, odds_draw, odds_away)
    total = math.fsum(raw)
    return (raw[0] / total, raw[1] / total, raw[2] / total)


def _shin_probabilities(z: float, raw: Sequence[float], book: float) -> Probabilities:
    """Shin's inversion at a given insider proportion ``z``.

    ``p_i = (sqrt(z^2 + 4(1-z) * pi_i^2 / B) - z) / (2(1-z))``

    where ``pi_i`` is the raw implied probability and ``B`` the booksum. This
    is the closed-form inverse of Shin's pricing rule; the free parameter ``z``
    is pinned by requiring the result to sum to 1 (see :func:`shin_z`).
    """
    denom = 2.0 * (1.0 - z)
    out = []
    for pi in raw:
        inner = z * z + 4.0 * (1.0 - z) * pi * pi / book
        out.append((math.sqrt(max(inner, 0.0)) - z) / denom)
    return (out[0], out[1], out[2])


def shin_z(
    odds_home: object,
    odds_draw: object,
    odds_away: object,
    *,
    max_iter: int = 200,
    tol: float = 1e-12,
) -> float:
    """Solve for Shin's insider-trading proportion ``z``.

    ``z`` is the share of money the bookmaker assumes comes from traders who
    already know the result. It is the single parameter of Shin's model, and it
    is what the margin is defending against — so it rises with the overround
    and is typically 0.01–0.04 for a mainstream 1X2 book.

    Solved by bisection on ``sum_i p_i(z) - 1``, which is guaranteed to
    converge: at ``z = 0`` the sum is ``sqrt(B) > 1`` for any real book, and as
    ``z -> 1`` the sum tends to ``sum_i pi_i^2 / B <= max_i pi_i < 1``. Bisection
    is preferred over the usual fixed-point iteration because it cannot
    oscillate on a pathological book.

    Returns ``0.0`` for a fair or sub-fair book (``booksum <= 1``), where the
    model degenerates and Shin coincides with proportional de-vigging.
    """
    raw = implied_probabilities(odds_home, odds_draw, odds_away)
    book = math.fsum(raw)
    if book <= 1.0:
        # No margin to attribute to insiders. z would have to be negative,
        # which is outside the model's support.
        return 0.0

    lo, hi = 0.0, 1.0 - 1e-9

    def excess(z: float) -> float:
        return math.fsum(_shin_probabilities(z, raw, book)) - 1.0

    f_lo, f_hi = excess(lo), excess(hi)
    if f_lo <= 0.0:
        return 0.0
    if f_hi > 0.0:  # pragma: no cover - unreachable for odds > 1, kept as a guard
        return 0.0

    for _ in range(max_iter):
        mid = 0.5 * (lo + hi)
        f_mid = excess(mid)
        if abs(f_mid) < tol or (hi - lo) < tol:
            return mid
        if f_mid > 0.0:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


def devig_shin(
    odds_home: object,
    odds_draw: object,
    odds_away: object,
    *,
    max_iter: int = 200,
    tol: float = 1e-12,
) -> Probabilities:
    """Remove the margin with Shin's method.

    Shin (1993) models the margin as the bookmaker's protection against
    insiders. Because insiders bet the outcomes the book has mispriced, the
    implied margin is not spread uniformly: short prices carry less of it and
    long prices carry more. De-vigging under that model therefore *shortens*
    longshots relative to the proportional method and lengthens favourites —
    the correction that matters at the extremes, which is exactly where the
    proportional method is known to be wrong.

    The result always sums to 1 (to floating-point tolerance). When the book
    has no margin the method degenerates gracefully to proportional
    normalisation.
    """
    raw = implied_probabilities(odds_home, odds_draw, odds_away)
    book = math.fsum(raw)
    z = shin_z(odds_home, odds_draw, odds_away, max_iter=max_iter, tol=tol)
    if z <= 0.0:
        return (raw[0] / book, raw[1] / book, raw[2] / book)
    probs = _shin_probabilities(z, raw, book)
    # Renormalise away the residual bisection error so the contract "sums to 1"
    # holds exactly rather than to ~1e-12.
    total = math.fsum(probs)
    return (probs[0] / total, probs[1] / total, probs[2] / total)


def devig(
    odds_home: object,
    odds_draw: object,
    odds_away: object,
    method: str = "proportional",
) -> Probabilities:
    """Dispatch to :func:`devig_proportional` or :func:`devig_shin` by name."""
    if method == "proportional":
        return devig_proportional(odds_home, odds_draw, odds_away)
    if method == "shin":
        return devig_shin(odds_home, odds_draw, odds_away)
    raise ValueError(f"unknown de-vig method {method!r}; expected one of {DEVIG_METHODS}")


# --------------------------------------------------------------------------
# Proper scoring rules (all negatively oriented: lower is better)
# --------------------------------------------------------------------------

def brier_score(probs: ProbInput, outcome: Outcome, *, normalise: bool = True) -> float:
    """Multiclass Brier score for one 3-way forecast.

    ``sum_i (p_i - o_i)^2`` where ``o`` is the one-hot realised outcome. This is
    the *original* (Brier 1950) multi-category definition — the sum, not the
    mean, over classes — which is the convention used throughout this repo and
    in the football-forecasting literature. Range ``[0, 2]``.

    Reference values worth remembering:

    * perfect forecast -> ``0.0``
    * uniform 1/3 -> ``0.6667``
    * constant base rate H .456 / D .236 / A .308 -> ``.6414`` on our picks
    * bookmaker closing line, top-5 leagues -> ``~.59``

    >>> round(brier_score((1/3, 1/3, 1/3), "home"), 4)
    0.6667
    """
    values = coerce_probabilities(probs, normalise=normalise)
    idx = outcome_index(outcome)
    return math.fsum(
        (values[i] - (1.0 if i == idx else 0.0)) ** 2 for i in range(3)
    )


def log_loss_single(
    probs: ProbInput,
    outcome: Outcome,
    *,
    eps: float = _LOG_EPS,
    normalise: bool = True,
) -> float:
    """Negative log likelihood of the realised outcome, ``-ln(p_outcome)``.

    The probability is clipped to ``[eps, 1]`` before the log so that a
    confident miss costs a large finite number instead of ``inf`` — an
    unclipped zero would make a whole league's mean log loss infinite because
    of one row.

    Uniform 1/3 gives ``ln 3 = 1.0986``.
    """
    values = coerce_probabilities(probs, normalise=normalise)
    idx = outcome_index(outcome)
    return -math.log(max(values[idx], eps))


def rps(probs: ProbInput, outcome: Outcome, *, normalise: bool = True) -> float:
    """Ranked Probability Score over the ordered scale home > draw > away.

    ``RPS = 1/(r-1) * sum_{i=1}^{r-1} ( sum_{j<=i} (p_j - o_j) )^2`` with
    ``r = 3`` categories, i.e. the mean squared error of the *cumulative*
    distribution, dropping the final (always-zero) term.

    Unlike Brier, RPS respects the ordering of the outcome scale: forecasting a
    home win when the away side wins is penalised more than forecasting a draw,
    because the error accumulates across both cumulative terms. That property
    is why RPS is the default metric for football forecasts (Constantinou &
    Fenton 2012). Range ``[0, 1]``.

    Worked values for the uniform forecast ``(1/3, 1/3, 1/3)``:
    ``5/18 = 0.2778`` for home, ``1/9 = 0.1111`` for draw, ``5/18`` for away —
    a draw is "closer to everything" on an ordered scale, so it scores best.
    """
    values = coerce_probabilities(probs, normalise=normalise)
    idx = outcome_index(outcome)
    total = 0.0
    cum_p = 0.0
    cum_o = 0.0
    for i in range(2):  # r - 1 = 2 cumulative terms
        cum_p += values[i]
        cum_o += 1.0 if i == idx else 0.0
        total += (cum_p - cum_o) ** 2
    return total / 2.0


# --------------------------------------------------------------------------
# Value: CLV, EV, Kelly
# --------------------------------------------------------------------------

def closing_line_value(
    model_prob: object,
    market_prob: object,
    *,
    mode: str = "relative",
) -> float:
    """Closing-line value: the model's edge over the no-vig closing price.

    ``market_prob`` must be a **de-vigged** closing probability — comparing
    against a raw ``1/odds`` would bake the bookmaker's margin into the edge
    and make almost everything look like a loser.

    Two conventions, both supported:

    * ``mode="relative"`` (default) — ``model_prob / market_prob - 1``. This is
      the price-space edge: it equals ``closing_fair_odds / model_fair_odds - 1``,
      so ``+0.05`` means the model rates the outcome 5% more likely than the
      close did. Relative CLV is the standard reporting unit because it is
      comparable across favourites and longshots, and because a bettor's
      long-run return tracks it far more closely than any accuracy figure does.
    * ``mode="absolute"`` — ``model_prob - market_prob``, the plain
      probability-point difference. Useful for plotting the value surface,
      misleading for aggregation (5 points on a 0.10 shot is not 5 points on a
      0.50 shot).

    Positive means the model disagrees with the close in the direction of
    value. Sustained positive CLV against closing odds is the single measure
    that predicts profitability; a model that beats the close on Brier but has
    zero CLV has no exploitable edge.
    """
    p_model = _validate_probability(model_prob, name="model_prob")
    p_market = _validate_probability(market_prob, name="market_prob")
    if mode == "absolute":
        return p_model - p_market
    if mode != "relative":
        raise ValueError(f"unknown CLV mode {mode!r}; expected 'relative' or 'absolute'")
    if p_market <= 0.0:
        raise ProbabilityError("relative CLV is undefined against a zero market probability")
    return p_model / p_market - 1.0


def expected_value(model_prob: object, decimal_odds: object) -> float:
    """Expected profit per unit staked at ``decimal_odds``, under ``model_prob``.

    ``EV = p * (odds - 1) - (1 - p) = p * odds - 1``

    ``0.0`` is a break-even price. ``+0.07`` means the model expects 7 units of
    profit per 100 staked, *if the model is calibrated* — which is precisely
    what the market benchmark exists to establish before any of this is shown
    to a user (pivot doc §2.1).
    """
    prob = _validate_probability(model_prob, name="model_prob")
    odds = validate_odds(decimal_odds, name="decimal_odds")
    return prob * odds - 1.0


def kelly_fraction(
    model_prob: object,
    decimal_odds: object,
    *,
    fraction: float = 1.0,
    cap: Optional[float] = None,
) -> float:
    """Kelly stake as a fraction of bankroll, clamped at 0 for no edge.

    ``f* = (p * odds - 1) / (odds - 1)``, the classic ``(bp - q)/b`` with
    ``b = odds - 1``. Full Kelly maximises the long-run growth rate of the
    bankroll and is famously too aggressive in practice, because it assumes
    ``p`` is known exactly; with an estimated ``p`` the variance is brutal.

    * ``fraction`` applies a fractional-Kelly multiplier — ``0.25`` for
      quarter-Kelly is the usual defensive choice, and is what any staking
      surface here should default to.
    * ``cap`` optionally clamps the returned stake (e.g. ``0.05`` for a hard
      5%-of-bankroll ceiling), applied *after* the fractional multiplier.

    Returns exactly ``0.0`` whenever the edge is zero or negative — no negative
    stakes, because a negative Kelly means "lay the bet", which is a different
    instrument and not something this function will imply by returning a
    negative number.
    """
    prob = _validate_probability(model_prob, name="model_prob")
    odds = validate_odds(decimal_odds, name="decimal_odds")
    if not math.isfinite(fraction) or fraction <= 0.0:
        raise ValueError(f"fraction must be a positive multiplier, got {fraction!r}")
    if cap is not None and (not math.isfinite(cap) or cap <= 0.0):
        raise ValueError(f"cap must be a positive fraction of bankroll, got {cap!r}")

    edge = prob * odds - 1.0
    if edge <= 0.0:
        return 0.0
    stake = (edge / (odds - 1.0)) * fraction
    if cap is not None:
        stake = min(stake, cap)
    return stake


# --------------------------------------------------------------------------
# Calibration
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class ReliabilityBucket:
    """One row of a reliability (calibration) table.

    ``mean_predicted`` vs ``observed_frequency`` is the calibration curve; a
    perfectly calibrated forecaster has them equal in every bucket. Empty
    buckets are retained with ``count = 0`` and ``None`` statistics so the
    table always has the same shape and plots without gaps shifting.
    """

    lower: float
    upper: float
    count: int
    mean_predicted: Optional[float] = None
    observed_frequency: Optional[float] = None

    def as_dict(self) -> dict:
        return {
            "lower": self.lower,
            "upper": self.upper,
            "count": self.count,
            "mean_predicted": self.mean_predicted,
            "observed_frequency": self.observed_frequency,
            "gap": (
                None
                if self.mean_predicted is None or self.observed_frequency is None
                else self.mean_predicted - self.observed_frequency
            ),
        }


def flatten_multiclass(
    prob_rows: Iterable[ProbInput],
    outcomes: Iterable[Outcome],
    *,
    normalise: bool = True,
) -> List[Tuple[float, int]]:
    """Pool all three class probabilities into ``(probability, hit)`` pairs.

    A 3-way forecast makes three probabilistic claims, and all three should be
    calibrated. Pooling them one-vs-rest gives ``3N`` points spanning the whole
    ``[0, 1]`` range — much more informative than only scoring the top class,
    which never populates the low buckets.
    """
    pairs: List[Tuple[float, int]] = []
    for probs, outcome in zip(prob_rows, outcomes):
        values = coerce_probabilities(probs, normalise=normalise)
        idx = outcome_index(outcome)
        for i in range(3):
            pairs.append((values[i], 1 if i == idx else 0))
    return pairs


def top_class_pairs(
    prob_rows: Iterable[ProbInput],
    outcomes: Iterable[Outcome],
    *,
    normalise: bool = True,
) -> List[Tuple[float, int]]:
    """``(confidence, correct)`` pairs for the argmax class only.

    This is the "confidence vs accuracy" convention used by
    ``backend/services/prediction/calibration.ece_10bin`` and by the published
    walk-forward diagnostics, kept here so the market benchmark can report a
    figure directly comparable with those artefacts.
    """
    pairs: List[Tuple[float, int]] = []
    for probs, outcome in zip(prob_rows, outcomes):
        values = coerce_probabilities(probs, normalise=normalise)
        idx = outcome_index(outcome)
        best = max(range(3), key=lambda i: values[i])
        pairs.append((values[best], 1 if best == idx else 0))
    return pairs


def reliability_table(
    pairs: Iterable[Tuple[float, int]],
    n_buckets: int = 10,
) -> List[ReliabilityBucket]:
    """Bin ``(probability, hit)`` pairs into an equal-width reliability table.

    Buckets are ``[0, 0.1), [0.1, 0.2), ... [0.9, 1.0]`` for the default
    ``n_buckets=10``; the top bucket is closed so ``p = 1.0`` lands in it.
    """
    if n_buckets < 1:
        raise ValueError(f"n_buckets must be >= 1, got {n_buckets}")

    sums = [0.0] * n_buckets
    hits = [0] * n_buckets
    counts = [0] * n_buckets

    for prob, hit in pairs:
        p = _validate_probability(prob, name="bucket probability")
        if hit not in (0, 1, True, False):
            raise ProbabilityError(f"hit indicator must be 0 or 1, got {hit!r}")
        idx = min(int(p * n_buckets), n_buckets - 1)
        counts[idx] += 1
        sums[idx] += p
        hits[idx] += int(hit)

    table: List[ReliabilityBucket] = []
    for i in range(n_buckets):
        lower = i / n_buckets
        upper = (i + 1) / n_buckets
        if counts[i] == 0:
            table.append(ReliabilityBucket(lower=lower, upper=upper, count=0))
        else:
            table.append(
                ReliabilityBucket(
                    lower=lower,
                    upper=upper,
                    count=counts[i],
                    mean_predicted=sums[i] / counts[i],
                    observed_frequency=hits[i] / counts[i],
                )
            )
    return table


def expected_calibration_error(
    pairs: Iterable[Tuple[float, int]],
    n_buckets: int = 10,
) -> float:
    """Count-weighted mean absolute gap between predicted and observed frequency.

    ``ECE = sum_b (n_b / N) * |mean_predicted_b - observed_frequency_b|``.

    ``0.0`` is perfect calibration. Returns ``0.0`` for an empty input rather
    than ``nan`` so that aggregation over leagues with no paired fixtures does
    not poison the whole report — the accompanying ``n`` tells you the bucket
    was empty.
    """
    materialised = list(pairs)
    table = reliability_table(materialised, n_buckets=n_buckets)
    total = sum(bucket.count for bucket in table)
    if total == 0:
        return 0.0
    return math.fsum(
        bucket.count * abs(bucket.mean_predicted - bucket.observed_frequency)
        for bucket in table
        if bucket.count > 0
    ) / total
