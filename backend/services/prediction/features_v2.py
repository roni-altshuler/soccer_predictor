"""Candidate match features (v2) with structurally-enforced point-in-time safety.

Why this module exists
----------------------
`backend/services/prediction/features.py` (41 features) and
`backend/services/prediction/feature_builder_v2.py` (87 features) both already
ship a large feature vector, and the engine still scores Brier .6324 against a
.6414 constant baseline. The bottleneck is therefore *evidence*, not feature
count: nothing in the repo proves which of those 87 columns earn their place.

This module is deliberately **not** wired into training or inference. It is the
candidate pool for `backend/scripts/ablate_features.py`, which measures each
group out-of-sample on strictly temporal splits. A group graduates into
`feature_builder_v2.FEATURE_NAMES` only after it demonstrably improves
out-of-sample Brier / log loss.

Point-in-time correctness is structural, not a convention
---------------------------------------------------------
Three mechanisms, all tested in `backend/tests/test_features_v2.py`:

1. **Split types.** A match is represented by two disjoint objects.
   :class:`PreMatchInfo` holds only what a bookmaker knows before kickoff
   (ids, kickoff, venue, referee, closing odds, weather forecast).
   :class:`MatchOutcome` holds the result and every post-kickoff statistic.
   `PointInTimeFeatureBuilder.features_for()` accepts *only* a `PreMatchInfo`,
   so the current match's score, cards or xG are not reachable from the
   feature code — no discipline required.

2. **Write-after-read ordering.** All history lives in builder state that is
   mutated exclusively by `observe(info, outcome)`. `features_for()` is a pure
   read. `build_dataset()` drives the two in the only safe order.

3. **A monotone clock.** The builder tracks the latest local match date it has
   observed and raises :class:`TemporalOrderError` if asked to (a) observe a
   match older than that date, or (b) emit features for a match on or before
   it. Matches sharing a local date are treated as *simultaneous*: the whole
   day is featurised before any of it is observed, so a Saturday 12:30 kickoff
   can never see a Saturday 17:30 result.

Known data limits in the current warehouse (measured 2026-08-08, Wave A only)
----------------------------------------------------------------------------
* `weather` table: **0 rows**. The weather group is emitted with a
  `wx_has_weather` coverage flag that is currently 0 everywhere.
* `matches.referee_id`: **eng.1 only** (4,090 / 20,050 Wave A rows, 20.4%).
* `matches.venue`: 13.8% of Wave A rows and inconsistent between sources, so
  venue identity is keyed on the home club for domestic competitions (see
  :func:`venue_key_for`) rather than on the free-text column.
* `matches.attendance`: 138 Wave A rows (0.7%) — not modelled.
* `teams.venue_lat/venue_lon`: **all NULL** — true travel distance is not
  computable; travel burden is proxied by consecutive-away-fixture runs.
* `matches.home_xg`: 0 rows at time of writing (an Understat backfill was
  running). The xG group carries a `xg_has_data` flag and degrades to zeros.
* `date_utc` for `source='fdcouk'` rows (86% of Wave A) is **local midnight of
  the match day**, not the kickoff instant — see :attr:`PreMatchInfo.local_date`
  and `cal_has_real_kickoff_time`.
"""

from __future__ import annotations

import hashlib
import math
import sqlite3
from bisect import bisect_left
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import (
    Deque,
    Dict,
    Iterable,
    Iterator,
    List,
    Mapping,
    MutableMapping,
    Optional,
    Sequence,
    Tuple,
)

__all__ = [
    "TemporalOrderError",
    "PreMatchInfo",
    "MatchOutcome",
    "FEATURE_GROUPS",
    "ALL_FEATURE_NAMES",
    "PointInTimeFeatureBuilder",
    "load_match_pairs",
    "build_feature_frame",
    "venue_key_for",
    "no_vig_probabilities",
]


class TemporalOrderError(RuntimeError):
    """Raised when history would be read out of chronological order."""


# --------------------------------------------------------------------------
# competition metadata
# --------------------------------------------------------------------------

WAVE_A_COMPETITIONS: Tuple[str, ...] = ("eng.1", "esp.1", "ger.1", "ita.1", "fra.1")

#: Competitions that generate midweek continental load for Wave A clubs.
EUROPEAN_COMPETITIONS: Tuple[str, ...] = (
    "uefa.champions",
    "uefa.europa",
    "uefa.europa.conf",
)

#: Competitions routinely played at neutral grounds; for these the free-text
#: `venue` column is the only sane venue identity.
NEUTRAL_VENUE_COMPETITIONS: Tuple[str, ...] = (
    "fifa.world",
    "uefa.euro",
    "conmebol.america",
)

#: Sources whose `date_utc` is local midnight of the match day rather than the
#: real kickoff instant. Kickoff-time features are meaningless for these rows.
SYNTHETIC_KICKOFF_SOURCES: Tuple[str, ...] = ("fdcouk", "openfootball")

_DERBY_PAIRS: Tuple[Tuple[str, str], ...] = (
    ("Manchester United", "Manchester City"),
    ("Manchester United", "Liverpool"),
    ("Liverpool", "Everton"),
    ("Arsenal", "Tottenham"),
    ("Arsenal", "Chelsea"),
    ("Chelsea", "Tottenham"),
    ("Tottenham", "West Ham"),
    ("Real Madrid", "Barcelona"),
    ("Real Madrid", "Atletico Madrid"),
    ("Barcelona", "Espanyol"),
    ("Sevilla", "Real Betis"),
    ("AC Milan", "Inter"),
    ("Juventus", "Inter"),
    ("Juventus", "Torino"),
    ("Roma", "Lazio"),
    ("Napoli", "Roma"),
    ("Bayern Munich", "Borussia Dortmund"),
    ("Borussia Dortmund", "Schalke 04"),
    ("Hamburger SV", "Werder Bremen"),
    ("Paris Saint-Germain", "Marseille"),
    ("Lyon", "Saint-Etienne"),
    ("Nice", "Monaco"),
)


# --------------------------------------------------------------------------
# split input types — the leakage firewall
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class PreMatchInfo:
    """Everything knowable BEFORE kickoff. The only input to feature code."""

    match_id: str
    source: str
    competition_id: str
    season: int
    kickoff: datetime
    home_team_id: int
    away_team_id: int
    phase: Optional[str] = None
    referee_id: Optional[int] = None
    venue: Optional[str] = None
    # closing odds — pre-kickoff by definition, but NOT available on the live
    # inference path today (see the train/serve-skew note in the audit).
    odds_home: Optional[float] = None
    odds_draw: Optional[float] = None
    odds_away: Optional[float] = None
    odds_over_2_5: Optional[float] = None
    # weather forecast
    temp_c: Optional[float] = None
    precip_mm: Optional[float] = None
    wind_kmh: Optional[float] = None
    humidity: Optional[float] = None
    is_outdoor: Optional[int] = None

    @property
    def has_real_kickoff_time(self) -> bool:
        return self.source not in SYNTHETIC_KICKOFF_SOURCES

    @property
    def local_date(self) -> date:
        """Calendar date the match was played on.

        `fdcouk` rows store local midnight of the match day converted to UTC
        (e.g. a 2026-03-04 fixture lands on ``2026-03-03T22:00:00+00:00``),
        which shifts both the calendar date and the weekday back by one.
        Nudging forward three hours recovers the true date without disturbing
        genuine kickoff instants from ESPN.
        """
        if self.has_real_kickoff_time:
            return self.kickoff.date()
        return (self.kickoff + timedelta(hours=3)).date()

    @property
    def is_european(self) -> bool:
        return self.competition_id in EUROPEAN_COMPETITIONS


@dataclass(frozen=True)
class MatchOutcome:
    """Everything only knowable AFTER kickoff. Never visible to feature code."""

    match_id: str
    home_score: int
    away_score: int
    home_yellows: Optional[int] = None
    away_yellows: Optional[int] = None
    home_reds: Optional[int] = None
    away_reds: Optional[int] = None
    home_shots: Optional[float] = None
    away_shots: Optional[float] = None
    home_sot: Optional[float] = None
    away_sot: Optional[float] = None
    home_xg: Optional[float] = None
    away_xg: Optional[float] = None
    attendance: Optional[int] = None

    @property
    def label(self) -> int:
        """0 = home win, 1 = draw, 2 = away win."""
        if self.home_score > self.away_score:
            return 0
        if self.home_score == self.away_score:
            return 1
        return 2


def venue_key_for(info: PreMatchInfo) -> str:
    """Stable venue identity.

    `matches.venue` is populated for only 13.8% of Wave A rows and disagrees
    between sources (ESPN writes "Villa Park", football-data.co.uk writes
    NULL), so keying on the string would shatter each ground's history. In a
    domestic league the home club *is* the ground, so the club id is both
    complete and correct. Neutral-venue competitions fall back to the string.
    """
    if info.competition_id in NEUTRAL_VENUE_COMPETITIONS:
        name = (info.venue or "").strip()
        return f"neutral:{name}" if name else f"neutral:unknown:{info.competition_id}"
    return f"club:{info.home_team_id}"


# --------------------------------------------------------------------------
# feature group registry
# --------------------------------------------------------------------------

FEATURE_GROUPS: Dict[str, Tuple[str, ...]] = {
    # ---- reference set: an honest stand-in for what the engine already has --
    "baseline": (
        "elo_home",
        "elo_away",
        "elo_diff",
        "home_form5_ppg",
        "away_form5_ppg",
        "home_form10_ppg",
        "away_form10_ppg",
        "home_gf5",
        "home_ga5",
        "away_gf5",
        "away_ga5",
        "home_season_ppg",
        "away_season_ppg",
        "home_season_gf_pg",
        "home_season_ga_pg",
        "away_season_gf_pg",
        "away_season_ga_pg",
        "home_home_ppg",
        "away_away_ppg",
        "home_home_gf_avg",
        "away_away_gf_avg",
        "h2h_home_wins",
        "h2h_draws",
        "h2h_away_wins",
        "h2h_home_goals_avg",
        "h2h_away_goals_avg",
        "home_rest_days",
        "away_rest_days",
        "is_derby",
        "season_progress",
    ),
    # ---- candidate groups ---------------------------------------------------
    "venue": (
        "ven_matches_seen",
        "ven_home_win_rate",
        "ven_home_win_rate_vs_league",
        "ven_avg_total_goals",
        "ven_avg_total_goals_vs_league",
        "ven_away_visits",
        "ven_away_ppg_here",
        "ven_away_gd_here",
    ),
    "referee": (
        "ref_has_referee",
        "ref_matches_seen",
        "ref_avg_cards",
        "ref_avg_reds",
        "ref_home_win_rate",
        "ref_draw_rate",
        "ref_home_win_rate_vs_league",
        "ref_home_team_appearances",
        "ref_away_team_appearances",
        "ref_home_team_ppg_delta",
        "ref_away_team_ppg_delta",
    ),
    "weather": (
        "wx_has_weather",
        "wx_temp_c",
        "wx_precip_mm",
        "wx_is_wet",
        "wx_wind_kmh",
        "wx_humidity",
        "wx_is_outdoor",
    ),
    "calendar": (
        "cal_has_real_kickoff_time",
        "cal_kickoff_hour",
        "cal_hour_sin",
        "cal_hour_cos",
        "cal_is_early_slot",
        "cal_is_evening_slot",
        "cal_is_saturday",
        "cal_is_sunday",
        "cal_is_weekend",
        "cal_is_midweek",
        "cal_month_sin",
        "cal_month_cos",
    ),
    "h2h_deep": (
        "h2h_n",
        "h2h_recency_home_score",
        "h2h_recency_gd",
        "h2h_gd_trend",
        "h2h_avg_total_goals",
        "h2h_days_since_last",
        "h2h_venue_n",
        "h2h_venue_home_ppg",
        "h2h_venue_gd",
    ),
    "congestion": (
        "cg_home_matches_14d",
        "cg_away_matches_14d",
        "cg_matches_14d_diff",
        "cg_home_matches_30d",
        "cg_away_matches_30d",
        "cg_home_euro_14d",
        "cg_away_euro_14d",
        "cg_euro_14d_diff",
        "cg_home_rest_diff",
        "cg_home_consecutive_away",
        "cg_away_consecutive_away",
        "cg_home_short_rest",
        "cg_away_short_rest",
    ),
    "xg_form": (
        "xg_has_data",
        "xg_home_for5",
        "xg_away_for5",
        "xg_home_against5",
        "xg_away_against5",
        "xg_home_diff5",
        "xg_away_diff5",
        "xg_home_overperf5",
        "xg_away_overperf5",
    ),
    "clubelo": (
        "ce_has_rating",
        "ce_home",
        "ce_away",
        "ce_diff",
    ),
    "market": (
        "mkt_has_odds",
        "mkt_implied_home",
        "mkt_implied_draw",
        "mkt_implied_away",
        "mkt_overround",
        "mkt_implied_over25",
    ),
    # ---- control ------------------------------------------------------------
    # Stand-in for the four `*_news_sentiment` / `*_news_factor` columns in
    # features.py. Historical news sentiment was never persisted anywhere in
    # the warehouse, so those columns cannot be backtested directly. What CAN
    # be measured is the cost of adding four uninformative columns of the same
    # shape — which is the null hypothesis for the news block.
    "news_sentiment_proxy": (
        "news_home_sentiment_proxy",
        "news_away_sentiment_proxy",
        "news_home_factor_proxy",
        "news_away_factor_proxy",
    ),
}

ALL_FEATURE_NAMES: Tuple[str, ...] = tuple(
    name for names in FEATURE_GROUPS.values() for name in names
)
assert len(ALL_FEATURE_NAMES) == len(set(ALL_FEATURE_NAMES)), "duplicate feature name"

CANDIDATE_GROUPS: Tuple[str, ...] = tuple(g for g in FEATURE_GROUPS if g != "baseline")


# --------------------------------------------------------------------------
# small helpers
# --------------------------------------------------------------------------


def _safe_div(num: float, den: float, default: float = 0.0) -> float:
    return num / den if den else default


def no_vig_probabilities(
    odds_home: Optional[float],
    odds_draw: Optional[float],
    odds_away: Optional[float],
) -> Optional[Tuple[float, float, float, float]]:
    """Proportional (basic) de-vigging. Returns (pH, pD, pA, overround)."""
    if not odds_home or not odds_draw or not odds_away:
        return None
    if min(odds_home, odds_draw, odds_away) <= 1.0:
        return None
    inv = (1.0 / odds_home, 1.0 / odds_draw, 1.0 / odds_away)
    total = sum(inv)
    if total <= 0:
        return None
    return (inv[0] / total, inv[1] / total, inv[2] / total, total - 1.0)


def _stable_uniform(seed_text: str) -> float:
    """Deterministic pseudo-random value in [0, 1) from a string.

    Used only by the `news_sentiment_proxy` control group. Deterministic so
    ablation runs are reproducible, and derived from the match id so the value
    carries no information about the outcome.
    """
    digest = hashlib.blake2b(seed_text.encode("utf-8"), digest_size=8).digest()
    return int.from_bytes(digest, "big") / float(1 << 64)


# --------------------------------------------------------------------------
# streaming state
# --------------------------------------------------------------------------


@dataclass
class _TeamResult:
    day: date
    competition_id: str
    is_home: bool
    gf: int
    ga: int
    points: int
    xg_for: Optional[float]
    xg_against: Optional[float]


@dataclass
class _TeamState:
    results: Deque[_TeamResult] = field(default_factory=lambda: deque(maxlen=40))
    match_days: List[date] = field(default_factory=list)
    euro_days: List[date] = field(default_factory=list)
    consecutive_away: int = 0
    # (season, competition) -> [played, points, gf, ga, home_played, home_points,
    #                           home_gf, away_played, away_points, away_gf]
    season: MutableMapping[Tuple[int, str], List[float]] = field(default_factory=dict)
    ref_stats: MutableMapping[int, List[float]] = field(default_factory=dict)  # ref -> [n, pts]
    all_played: int = 0
    all_points: int = 0


@dataclass
class _VenueState:
    matches: int = 0
    home_wins: int = 0
    total_goals: int = 0
    # away-team id -> [visits, points, goal_diff]
    visitors: MutableMapping[int, List[float]] = field(default_factory=dict)


@dataclass
class _RefState:
    matches: int = 0
    cards: float = 0.0
    reds: float = 0.0
    carded_matches: int = 0
    home_wins: int = 0
    draws: int = 0


@dataclass
class _H2HMeeting:
    day: date
    home_team_id: int
    home_goals: int
    away_goals: int
    venue_key: str


# --------------------------------------------------------------------------
# the builder
# --------------------------------------------------------------------------

_ELO_K = 20.0
_ELO_HOME_ADV = 60.0
_ELO_START = 1500.0


class PointInTimeFeatureBuilder:
    """Streaming feature builder. Reads are pure; writes go through `observe`.

    Typical use is :meth:`build_dataset`, which handles ordering. Calling
    :meth:`features_for` / :meth:`observe` by hand is supported but the clock
    guards still apply.
    """

    def __init__(
        self,
        *,
        team_names: Optional[Mapping[int, str]] = None,
        clubelo: Optional[Mapping[int, Tuple[List[str], List[float]]]] = None,
    ) -> None:
        self._teams: Dict[int, _TeamState] = defaultdict(_TeamState)
        self._venues: Dict[str, _VenueState] = defaultdict(_VenueState)
        self._refs: Dict[int, _RefState] = defaultdict(_RefState)
        self._ref_team: Dict[Tuple[int, int], List[float]] = defaultdict(lambda: [0.0, 0.0])
        self._h2h: Dict[Tuple[int, int], List[_H2HMeeting]] = defaultdict(list)
        self._elo: Dict[int, float] = {}
        # league-level running context, keyed by competition
        self._league: Dict[str, List[float]] = defaultdict(lambda: [0.0, 0.0, 0.0])  # n, home_wins, goals
        self._team_names = dict(team_names or {})
        self._derby: set = set()
        for a, b in _DERBY_PAIRS:
            self._derby.add((a.lower(), b.lower()))
            self._derby.add((b.lower(), a.lower()))
        self._clubelo = dict(clubelo or {})
        # the monotone clock
        self._last_observed_day: Optional[date] = None

    # -- clock ------------------------------------------------------------

    @property
    def last_observed_day(self) -> Optional[date]:
        return self._last_observed_day

    def _check_readable(self, info: PreMatchInfo) -> None:
        if self._last_observed_day is not None and info.local_date <= self._last_observed_day:
            raise TemporalOrderError(
                f"refusing to featurise {info.match_id} on {info.local_date}: state already "
                f"contains matches through {self._last_observed_day}; same-day results would leak"
            )

    def _check_writable(self, info: PreMatchInfo) -> None:
        if self._last_observed_day is not None and info.local_date < self._last_observed_day:
            raise TemporalOrderError(
                f"refusing to observe {info.match_id} on {info.local_date}: state is already "
                f"at {self._last_observed_day} (matches must be observed in date order)"
            )

    # -- driver -----------------------------------------------------------

    def build_dataset(
        self,
        pairs: Sequence[Tuple[PreMatchInfo, MatchOutcome]],
        *,
        emit_competitions: Optional[Iterable[str]] = None,
        warmup_days: int = 0,
    ) -> Iterator[Tuple[PreMatchInfo, MatchOutcome, Dict[str, float]]]:
        """Featurise then observe, one calendar day at a time.

        `pairs` must be sorted by local date. Every pair is *observed* (so
        continental load and cross-competition form are complete), but rows are
        only *emitted* for `emit_competitions`.

        Matches sharing a local date are featurised as a block before any of
        them is observed, so no fixture can see a same-day result.
        """
        emit = set(emit_competitions) if emit_competitions is not None else None
        by_day: Dict[date, List[Tuple[PreMatchInfo, MatchOutcome]]] = {}
        for info, outcome in pairs:
            by_day.setdefault(info.local_date, []).append((info, outcome))

        first_day = min(by_day) if by_day else None
        for day in sorted(by_day):
            todays = by_day[day]
            emitted: List[Tuple[PreMatchInfo, MatchOutcome, Dict[str, float]]] = []
            for info, outcome in todays:
                if emit is not None and info.competition_id not in emit:
                    continue
                if (
                    warmup_days
                    and first_day is not None
                    and (day - first_day).days < warmup_days
                ):
                    continue
                emitted.append((info, outcome, self.features_for(info)))
            for info, outcome in todays:
                self.observe(info, outcome)
            yield from emitted

    # -- read -------------------------------------------------------------

    def features_for(self, info: PreMatchInfo) -> Dict[str, float]:
        """Pure read over accumulated history. Takes no outcome data at all."""
        self._check_readable(info)
        out: Dict[str, float] = {}
        out.update(self._baseline_features(info))
        out.update(self._venue_features(info))
        out.update(self._referee_features(info))
        out.update(self._weather_features(info))
        out.update(self._calendar_features(info))
        out.update(self._h2h_deep_features(info))
        out.update(self._congestion_features(info))
        out.update(self._xg_features(info))
        out.update(self._clubelo_features(info))
        out.update(self._market_features(info))
        out.update(self._news_proxy_features(info))
        missing = set(ALL_FEATURE_NAMES) - set(out)
        if missing:  # pragma: no cover - guards against registry drift
            raise RuntimeError(f"feature builder did not emit: {sorted(missing)}")
        return out

    # -- write ------------------------------------------------------------

    def observe(self, info: PreMatchInfo, outcome: MatchOutcome) -> None:
        """Fold a finished match into history. The only mutator."""
        self._check_writable(info)
        day = info.local_date
        hs, as_ = int(outcome.home_score), int(outcome.away_score)
        h_pts = 3 if hs > as_ else (1 if hs == as_ else 0)
        a_pts = 3 if as_ > hs else (1 if hs == as_ else 0)

        # team form / season / rest
        for team_id, is_home, gf, ga, pts, xgf, xga in (
            (info.home_team_id, True, hs, as_, h_pts, outcome.home_xg, outcome.away_xg),
            (info.away_team_id, False, as_, hs, a_pts, outcome.away_xg, outcome.home_xg),
        ):
            st = self._teams[team_id]
            st.results.append(
                _TeamResult(day, info.competition_id, is_home, gf, ga, pts, xgf, xga)
            )
            st.match_days.append(day)
            if info.is_european:
                st.euro_days.append(day)
            st.consecutive_away = 0 if is_home else st.consecutive_away + 1
            st.all_played += 1
            st.all_points += pts
            key = (info.season, info.competition_id)
            agg = st.season.setdefault(key, [0.0] * 10)
            agg[0] += 1
            agg[1] += pts
            agg[2] += gf
            agg[3] += ga
            if is_home:
                agg[4] += 1
                agg[5] += pts
                agg[6] += gf
            else:
                agg[7] += 1
                agg[8] += pts
                agg[9] += gf
            if info.referee_id is not None:
                rt = self._ref_team[(int(info.referee_id), team_id)]
                rt[0] += 1
                rt[1] += pts

        # venue
        vkey = venue_key_for(info)
        vst = self._venues[vkey]
        vst.matches += 1
        vst.home_wins += 1 if hs > as_ else 0
        vst.total_goals += hs + as_
        vis = vst.visitors.setdefault(info.away_team_id, [0.0, 0.0, 0.0])
        vis[0] += 1
        vis[1] += a_pts
        vis[2] += as_ - hs

        # referee
        if info.referee_id is not None:
            rst = self._refs[int(info.referee_id)]
            rst.matches += 1
            rst.home_wins += 1 if hs > as_ else 0
            rst.draws += 1 if hs == as_ else 0
            if outcome.home_yellows is not None and outcome.away_yellows is not None:
                rst.cards += float(outcome.home_yellows) + float(outcome.away_yellows)
                rst.reds += float(outcome.home_reds or 0) + float(outcome.away_reds or 0)
                rst.carded_matches += 1

        # h2h
        pair = (min(info.home_team_id, info.away_team_id), max(info.home_team_id, info.away_team_id))
        self._h2h[pair].append(_H2HMeeting(day, info.home_team_id, hs, as_, vkey))

        # league context
        lg = self._league[info.competition_id]
        lg[0] += 1
        lg[1] += 1 if hs > as_ else 0
        lg[2] += hs + as_

        # elo
        eh = self._elo.get(info.home_team_id, _ELO_START)
        ea = self._elo.get(info.away_team_id, _ELO_START)
        exp_h = 1.0 / (1.0 + 10 ** (-((eh + _ELO_HOME_ADV) - ea) / 400.0))
        score_h = 1.0 if hs > as_ else (0.5 if hs == as_ else 0.0)
        margin = 1.0 + math.log1p(abs(hs - as_))
        delta = _ELO_K * margin * (score_h - exp_h)
        self._elo[info.home_team_id] = eh + delta
        self._elo[info.away_team_id] = ea - delta

        self._last_observed_day = day if self._last_observed_day is None else max(
            self._last_observed_day, day
        )

    # -- feature groups ----------------------------------------------------

    def _recent(self, team_id: int, n: int) -> List[_TeamResult]:
        st = self._teams.get(team_id)
        if not st or not st.results:
            return []
        return list(st.results)[-n:]

    def _rest_days(self, team_id: int, day: date) -> float:
        st = self._teams.get(team_id)
        if not st or not st.match_days:
            return 14.0
        return float(min(60, (day - st.match_days[-1]).days))

    def _baseline_features(self, info: PreMatchInfo) -> Dict[str, float]:
        h, a = info.home_team_id, info.away_team_id
        out: Dict[str, float] = {}
        out["elo_home"] = self._elo.get(h, _ELO_START)
        out["elo_away"] = self._elo.get(a, _ELO_START)
        out["elo_diff"] = out["elo_home"] - out["elo_away"]

        for tag, team_id in (("home", h), ("away", a)):
            r5 = self._recent(team_id, 5)
            r10 = self._recent(team_id, 10)
            out[f"{tag}_form5_ppg"] = _safe_div(sum(x.points for x in r5), len(r5), 1.3)
            out[f"{tag}_form10_ppg"] = _safe_div(sum(x.points for x in r10), len(r10), 1.3)
            out[f"{tag}_gf5"] = _safe_div(sum(x.gf for x in r5), len(r5), 1.3)
            out[f"{tag}_ga5"] = _safe_div(sum(x.ga for x in r5), len(r5), 1.3)
            st = self._teams.get(team_id)
            agg = (st.season.get((info.season, info.competition_id)) if st else None) or [0.0] * 10
            played = agg[0]
            out[f"{tag}_season_ppg"] = _safe_div(agg[1], played, 1.3)
            out[f"{tag}_season_gf_pg"] = _safe_div(agg[2], played, 1.3)
            out[f"{tag}_season_ga_pg"] = _safe_div(agg[3], played, 1.3)

        # venue splits, pooled across seasons within this competition
        hst, ast_ = self._teams.get(h), self._teams.get(a)
        h_home = [0.0, 0.0, 0.0]
        if hst:
            for (season, comp), agg in hst.season.items():
                if comp == info.competition_id:
                    h_home[0] += agg[4]
                    h_home[1] += agg[5]
                    h_home[2] += agg[6]
        a_away = [0.0, 0.0, 0.0]
        if ast_:
            for (season, comp), agg in ast_.season.items():
                if comp == info.competition_id:
                    a_away[0] += agg[7]
                    a_away[1] += agg[8]
                    a_away[2] += agg[9]
        out["home_home_ppg"] = _safe_div(h_home[1], h_home[0], 1.6)
        out["away_away_ppg"] = _safe_div(a_away[1], a_away[0], 1.1)
        out["home_home_gf_avg"] = _safe_div(h_home[2], h_home[0], 1.5)
        out["away_away_gf_avg"] = _safe_div(a_away[2], a_away[0], 1.1)

        # simple h2h counts (mirrors the columns already in features.py)
        meetings = self._h2h.get((min(h, a), max(h, a)), [])[-10:]
        hw = dr = aw = 0
        hg = ag = 0
        for m in meetings:
            if m.home_team_id == h:
                gh, ga_ = m.home_goals, m.away_goals
            else:
                gh, ga_ = m.away_goals, m.home_goals
            hg += gh
            ag += ga_
            if gh > ga_:
                hw += 1
            elif gh == ga_:
                dr += 1
            else:
                aw += 1
        out["h2h_home_wins"] = float(hw)
        out["h2h_draws"] = float(dr)
        out["h2h_away_wins"] = float(aw)
        out["h2h_home_goals_avg"] = _safe_div(hg, len(meetings), 1.4)
        out["h2h_away_goals_avg"] = _safe_div(ag, len(meetings), 1.1)

        day = info.local_date
        out["home_rest_days"] = self._rest_days(h, day)
        out["away_rest_days"] = self._rest_days(a, day)

        hn = (self._team_names.get(h) or "").lower()
        an = (self._team_names.get(a) or "").lower()
        out["is_derby"] = 1.0 if (hn, an) in self._derby else 0.0

        st_h = self._teams.get(h)
        played = 0.0
        if st_h:
            agg = st_h.season.get((info.season, info.competition_id))
            played = agg[0] if agg else 0.0
        out["season_progress"] = min(1.0, played / 38.0)
        return out

    def _venue_features(self, info: PreMatchInfo) -> Dict[str, float]:
        vkey = venue_key_for(info)
        vst = self._venues.get(vkey)
        lg = self._league.get(info.competition_id)
        lg_hwr = _safe_div(lg[1], lg[0], 0.45) if lg else 0.45
        lg_goals = _safe_div(lg[2], lg[0], 2.6) if lg else 2.6
        if not vst or vst.matches == 0:
            return {
                "ven_matches_seen": 0.0,
                "ven_home_win_rate": lg_hwr,
                "ven_home_win_rate_vs_league": 0.0,
                "ven_avg_total_goals": lg_goals,
                "ven_avg_total_goals_vs_league": 0.0,
                "ven_away_visits": 0.0,
                "ven_away_ppg_here": 1.1,
                "ven_away_gd_here": 0.0,
            }
        hwr = vst.home_wins / vst.matches
        goals = vst.total_goals / vst.matches
        vis = vst.visitors.get(info.away_team_id)
        return {
            "ven_matches_seen": float(min(vst.matches, 250)),
            "ven_home_win_rate": hwr,
            "ven_home_win_rate_vs_league": hwr - lg_hwr,
            "ven_avg_total_goals": goals,
            "ven_avg_total_goals_vs_league": goals - lg_goals,
            "ven_away_visits": float(vis[0]) if vis else 0.0,
            "ven_away_ppg_here": _safe_div(vis[1], vis[0], 1.1) if vis else 1.1,
            "ven_away_gd_here": _safe_div(vis[2], vis[0], 0.0) if vis else 0.0,
        }

    def _referee_features(self, info: PreMatchInfo) -> Dict[str, float]:
        lg = self._league.get(info.competition_id)
        lg_hwr = _safe_div(lg[1], lg[0], 0.45) if lg else 0.45
        blank = {
            "ref_has_referee": 0.0,
            "ref_matches_seen": 0.0,
            "ref_avg_cards": 3.5,
            "ref_avg_reds": 0.1,
            "ref_home_win_rate": lg_hwr,
            "ref_draw_rate": 0.25,
            "ref_home_win_rate_vs_league": 0.0,
            "ref_home_team_appearances": 0.0,
            "ref_away_team_appearances": 0.0,
            "ref_home_team_ppg_delta": 0.0,
            "ref_away_team_ppg_delta": 0.0,
        }
        if info.referee_id is None:
            return blank
        rid = int(info.referee_id)
        rst = self._refs.get(rid)
        if not rst or rst.matches == 0:
            blank["ref_has_referee"] = 1.0
            return blank
        hwr = rst.home_wins / rst.matches

        def _team_delta(team_id: int) -> Tuple[float, float]:
            rt = self._ref_team.get((rid, team_id))
            st = self._teams.get(team_id)
            if not rt or rt[0] < 1 or not st or st.all_played == 0:
                return 0.0, 0.0
            under = rt[1] / rt[0]
            overall = st.all_points / st.all_played
            return float(rt[0]), under - overall

        h_n, h_delta = _team_delta(info.home_team_id)
        a_n, a_delta = _team_delta(info.away_team_id)
        return {
            "ref_has_referee": 1.0,
            "ref_matches_seen": float(min(rst.matches, 400)),
            "ref_avg_cards": _safe_div(rst.cards, rst.carded_matches, 3.5),
            "ref_avg_reds": _safe_div(rst.reds, rst.carded_matches, 0.1),
            "ref_home_win_rate": hwr,
            "ref_draw_rate": rst.draws / rst.matches,
            "ref_home_win_rate_vs_league": hwr - lg_hwr,
            "ref_home_team_appearances": h_n,
            "ref_away_team_appearances": a_n,
            "ref_home_team_ppg_delta": h_delta,
            "ref_away_team_ppg_delta": a_delta,
        }

    def _weather_features(self, info: PreMatchInfo) -> Dict[str, float]:
        has = 1.0 if info.temp_c is not None or info.precip_mm is not None else 0.0
        precip = float(info.precip_mm) if info.precip_mm is not None else 0.0
        return {
            "wx_has_weather": has,
            "wx_temp_c": float(info.temp_c) if info.temp_c is not None else 14.0,
            "wx_precip_mm": precip,
            "wx_is_wet": 1.0 if precip >= 0.5 else 0.0,
            "wx_wind_kmh": float(info.wind_kmh) if info.wind_kmh is not None else 12.0,
            "wx_humidity": float(info.humidity) if info.humidity is not None else 70.0,
            "wx_is_outdoor": 1.0 if (info.is_outdoor is None or info.is_outdoor) else 0.0,
        }

    def _calendar_features(self, info: PreMatchInfo) -> Dict[str, float]:
        day = info.local_date
        dow = day.weekday()  # Mon=0 .. Sun=6
        real = info.has_real_kickoff_time
        hour = float(info.kickoff.hour) if real else -1.0
        ang = 2 * math.pi * (info.kickoff.hour / 24.0)
        month_ang = 2 * math.pi * ((day.month - 1) / 12.0)
        return {
            "cal_has_real_kickoff_time": 1.0 if real else 0.0,
            "cal_kickoff_hour": hour,
            "cal_hour_sin": math.sin(ang) if real else 0.0,
            "cal_hour_cos": math.cos(ang) if real else 0.0,
            "cal_is_early_slot": 1.0 if real and info.kickoff.hour < 14 else 0.0,
            "cal_is_evening_slot": 1.0 if real and info.kickoff.hour >= 18 else 0.0,
            "cal_is_saturday": 1.0 if dow == 5 else 0.0,
            "cal_is_sunday": 1.0 if dow == 6 else 0.0,
            "cal_is_weekend": 1.0 if dow >= 5 else 0.0,
            "cal_is_midweek": 1.0 if dow in (1, 2, 3) else 0.0,
            "cal_month_sin": math.sin(month_ang),
            "cal_month_cos": math.cos(month_ang),
        }

    def _h2h_deep_features(self, info: PreMatchInfo) -> Dict[str, float]:
        h, a = info.home_team_id, info.away_team_id
        meetings = self._h2h.get((min(h, a), max(h, a)), [])
        if not meetings:
            return {
                "h2h_n": 0.0,
                "h2h_recency_home_score": 0.5,
                "h2h_recency_gd": 0.0,
                "h2h_gd_trend": 0.0,
                "h2h_avg_total_goals": 2.6,
                "h2h_days_since_last": 1500.0,
                "h2h_venue_n": 0.0,
                "h2h_venue_home_ppg": 1.4,
                "h2h_venue_gd": 0.0,
            }
        vkey = venue_key_for(info)
        day = info.local_date
        half_life_days = 730.0
        w_sum = score_sum = gd_sum = 0.0
        goals_sum = 0.0
        gds: List[float] = []  # oldest -> newest, from the home team's perspective
        v_n = v_pts = v_gd = 0.0
        for m in meetings[-20:]:
            age = max(0.0, (day - m.day).days)
            w = 0.5 ** (age / half_life_days)
            if m.home_team_id == h:
                gf, ga = m.home_goals, m.away_goals
            else:
                gf, ga = m.away_goals, m.home_goals
            res = 1.0 if gf > ga else (0.5 if gf == ga else 0.0)
            w_sum += w
            score_sum += w * res
            gd_sum += w * (gf - ga)
            goals_sum += m.home_goals + m.away_goals
            gds.append(float(gf - ga))
            if m.venue_key == vkey and m.home_team_id == h:
                v_n += 1
                v_pts += 3 if gf > ga else (1 if gf == ga else 0)
                v_gd += gf - ga
        # Trend = later half minus earlier half of the meeting history. A
        # fixed "last 3 vs the rest" split collapses to 0 whenever a pair has
        # met three times or fewer, which is most pairs.
        half = len(gds) // 2
        older, recent = gds[:half], gds[half:]
        trend = (
            (sum(recent) / len(recent)) - (sum(older) / len(older))
            if older and recent
            else 0.0
        )
        used = meetings[-20:]
        return {
            "h2h_n": float(len(used)),
            "h2h_recency_home_score": _safe_div(score_sum, w_sum, 0.5),
            "h2h_recency_gd": _safe_div(gd_sum, w_sum, 0.0),
            "h2h_gd_trend": trend,
            "h2h_avg_total_goals": goals_sum / len(used),
            "h2h_days_since_last": float(min(1500, (day - used[-1].day).days)),
            "h2h_venue_n": v_n,
            "h2h_venue_home_ppg": _safe_div(v_pts, v_n, 1.4),
            "h2h_venue_gd": _safe_div(v_gd, v_n, 0.0),
        }

    def _count_since(self, days: List[date], cutoff: date, day: date) -> int:
        # days is append-only in chronological order
        idx = bisect_left(days, cutoff)
        return len(days) - idx

    def _congestion_features(self, info: PreMatchInfo) -> Dict[str, float]:
        day = info.local_date
        c14 = day - timedelta(days=14)
        c30 = day - timedelta(days=30)
        out: Dict[str, float] = {}
        vals: Dict[str, Tuple[float, float, float, float, float]] = {}
        for tag, team_id in (("home", info.home_team_id), ("away", info.away_team_id)):
            st = self._teams.get(team_id)
            if not st:
                vals[tag] = (0.0, 0.0, 0.0, 0.0, 14.0)
                continue
            vals[tag] = (
                float(self._count_since(st.match_days, c14, day)),
                float(self._count_since(st.match_days, c30, day)),
                float(self._count_since(st.euro_days, c14, day)),
                float(min(st.consecutive_away, 8)),
                self._rest_days(team_id, day),
            )
        h, a = vals["home"], vals["away"]
        out["cg_home_matches_14d"] = h[0]
        out["cg_away_matches_14d"] = a[0]
        out["cg_matches_14d_diff"] = h[0] - a[0]
        out["cg_home_matches_30d"] = h[1]
        out["cg_away_matches_30d"] = a[1]
        out["cg_home_euro_14d"] = h[2]
        out["cg_away_euro_14d"] = a[2]
        out["cg_euro_14d_diff"] = h[2] - a[2]
        out["cg_home_rest_diff"] = h[4] - a[4]
        out["cg_home_consecutive_away"] = h[3]
        out["cg_away_consecutive_away"] = a[3]
        out["cg_home_short_rest"] = 1.0 if h[4] <= 3 else 0.0
        out["cg_away_short_rest"] = 1.0 if a[4] <= 3 else 0.0
        return out

    def _xg_features(self, info: PreMatchInfo) -> Dict[str, float]:
        out: Dict[str, float] = {}
        have = 0
        for tag, team_id in (("home", info.home_team_id), ("away", info.away_team_id)):
            rows = [r for r in self._recent(team_id, 8) if r.xg_for is not None]
            rows = rows[-5:]
            if not rows:
                out[f"xg_{tag}_for5"] = 1.35
                out[f"xg_{tag}_against5"] = 1.35
                out[f"xg_{tag}_diff5"] = 0.0
                out[f"xg_{tag}_overperf5"] = 0.0
                continue
            have += 1
            xf = sum(float(r.xg_for or 0.0) for r in rows) / len(rows)
            xa = sum(float(r.xg_against or 0.0) for r in rows) / len(rows)
            gf = sum(r.gf for r in rows) / len(rows)
            out[f"xg_{tag}_for5"] = xf
            out[f"xg_{tag}_against5"] = xa
            out[f"xg_{tag}_diff5"] = xf - xa
            out[f"xg_{tag}_overperf5"] = gf - xf
        out["xg_has_data"] = 1.0 if have == 2 else 0.0
        return out

    def _clubelo_features(self, info: PreMatchInfo) -> Dict[str, float]:
        def rating(team_id: int) -> Optional[float]:
            entry = self._clubelo.get(team_id)
            if not entry:
                return None
            dates, elos = entry
            stamp = info.local_date.isoformat()
            idx = bisect_left(dates, stamp)
            # strictly before the match date
            if idx == 0:
                return None
            return elos[idx - 1]

        rh = rating(info.home_team_id)
        ra = rating(info.away_team_id)
        has = 1.0 if rh is not None and ra is not None else 0.0
        rh_v = rh if rh is not None else 1500.0
        ra_v = ra if ra is not None else 1500.0
        return {
            "ce_has_rating": has,
            "ce_home": rh_v,
            "ce_away": ra_v,
            "ce_diff": rh_v - ra_v,
        }

    def _market_features(self, info: PreMatchInfo) -> Dict[str, float]:
        devig = no_vig_probabilities(info.odds_home, info.odds_draw, info.odds_away)
        over = info.odds_over_2_5
        return {
            "mkt_has_odds": 1.0 if devig else 0.0,
            "mkt_implied_home": devig[0] if devig else 0.45,
            "mkt_implied_draw": devig[1] if devig else 0.26,
            "mkt_implied_away": devig[2] if devig else 0.29,
            "mkt_overround": devig[3] if devig else 0.0,
            "mkt_implied_over25": (1.0 / over) if over and over > 1.0 else 0.5,
        }

    def _news_proxy_features(self, info: PreMatchInfo) -> Dict[str, float]:
        h = _stable_uniform(f"news-h:{info.match_id}")
        a = _stable_uniform(f"news-a:{info.match_id}")
        return {
            "news_home_sentiment_proxy": 2.0 * h - 1.0,
            "news_away_sentiment_proxy": 2.0 * a - 1.0,
            "news_home_factor_proxy": 0.95 + 0.1 * h,
            "news_away_factor_proxy": 0.95 + 0.1 * a,
        }


# --------------------------------------------------------------------------
# warehouse loading
# --------------------------------------------------------------------------

_MATCH_SQL = """
    SELECT m.match_id, m.source, m.competition_id, m.season, m.date_utc,
           m.home_team_id, m.away_team_id, m.home_score, m.away_score, m.phase,
           m.referee_id, m.venue,
           m.odds_home, m.odds_draw, m.odds_away, m.odds_over_2_5,
           m.home_yellows, m.away_yellows, m.home_reds, m.away_reds,
           m.home_shots, m.away_shots, m.home_sot, m.away_sot,
           m.home_xg, m.away_xg, m.attendance,
           w.temp_c, w.precip_mm, w.wind_kmh, w.humidity, w.is_outdoor
    FROM matches m
    LEFT JOIN weather w ON w.match_id = m.match_id
    WHERE m.home_score IS NOT NULL AND m.away_score IS NOT NULL
"""


def _parse_dt(raw: str) -> Optional[datetime]:
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def load_match_pairs(
    conn: sqlite3.Connection,
    *,
    competitions: Optional[Sequence[str]] = None,
    min_season: Optional[int] = None,
    max_season: Optional[int] = None,
) -> List[Tuple[PreMatchInfo, MatchOutcome]]:
    """Read settled matches from the warehouse, sorted by local date.

    Sorting is `(local_date, kickoff, match_id)` — see `PreMatchInfo.local_date`
    for why the raw `date_utc` cannot be trusted as a calendar date.
    """
    conn.row_factory = sqlite3.Row
    sql = _MATCH_SQL
    params: List[object] = []
    if competitions:
        sql += " AND m.competition_id IN (%s)" % ",".join("?" * len(competitions))
        params.extend(competitions)
    if min_season is not None:
        sql += " AND m.season >= ?"
        params.append(min_season)
    if max_season is not None:
        sql += " AND m.season <= ?"
        params.append(max_season)

    pairs: List[Tuple[PreMatchInfo, MatchOutcome]] = []
    for row in conn.execute(sql, params):
        kickoff = _parse_dt(row["date_utc"])
        if kickoff is None:
            continue
        info = PreMatchInfo(
            match_id=row["match_id"],
            source=row["source"],
            competition_id=row["competition_id"],
            season=int(row["season"] or 0),
            kickoff=kickoff,
            home_team_id=int(row["home_team_id"]),
            away_team_id=int(row["away_team_id"]),
            phase=row["phase"],
            referee_id=row["referee_id"],
            venue=row["venue"],
            odds_home=row["odds_home"],
            odds_draw=row["odds_draw"],
            odds_away=row["odds_away"],
            odds_over_2_5=row["odds_over_2_5"],
            temp_c=row["temp_c"],
            precip_mm=row["precip_mm"],
            wind_kmh=row["wind_kmh"],
            humidity=row["humidity"],
            is_outdoor=row["is_outdoor"],
        )
        outcome = MatchOutcome(
            match_id=row["match_id"],
            home_score=int(row["home_score"]),
            away_score=int(row["away_score"]),
            home_yellows=row["home_yellows"],
            away_yellows=row["away_yellows"],
            home_reds=row["home_reds"],
            away_reds=row["away_reds"],
            home_shots=row["home_shots"],
            away_shots=row["away_shots"],
            home_sot=row["home_sot"],
            away_sot=row["away_sot"],
            home_xg=row["home_xg"],
            away_xg=row["away_xg"],
            attendance=row["attendance"],
        )
        pairs.append((info, outcome))

    pairs.sort(key=lambda p: (p[0].local_date, p[0].kickoff, p[0].match_id))
    return pairs


def load_team_names(conn: sqlite3.Connection) -> Dict[int, str]:
    conn.row_factory = sqlite3.Row
    return {
        int(r["team_id"]): r["canonical_name"]
        for r in conn.execute("SELECT team_id, canonical_name FROM teams")
    }


def load_clubelo(conn: sqlite3.Connection) -> Dict[int, Tuple[List[str], List[float]]]:
    conn.row_factory = sqlite3.Row
    out: Dict[int, Tuple[List[str], List[float]]] = {}
    for r in conn.execute(
        "SELECT team_id, date, elo FROM clubelo_ratings ORDER BY team_id, date"
    ):
        tid = int(r["team_id"])
        dates, elos = out.setdefault(tid, ([], []))
        dates.append(str(r["date"]))
        elos.append(float(r["elo"]))
    return out


def build_feature_frame(
    conn: sqlite3.Connection,
    *,
    emit_competitions: Sequence[str] = WAVE_A_COMPETITIONS,
    observe_competitions: Optional[Sequence[str]] = None,
    min_season: int = 2015,
    max_season: Optional[int] = None,
    warmup_days: int = 365,
):
    """Build the full candidate matrix for the ablation harness.

    Returns ``(X, y, meta)`` where ``X`` is an ``(n, len(ALL_FEATURE_NAMES))``
    float array in `ALL_FEATURE_NAMES` order, ``y`` is the 0/1/2 label array,
    and ``meta`` is a list of per-row dicts (match_id, season, competition_id,
    local_date, closing odds) used for splitting and market comparison.
    """
    import numpy as np  # local import so the module stays import-light

    observe = list(observe_competitions) if observe_competitions is not None else None
    pairs = load_match_pairs(
        conn, competitions=observe, min_season=min_season, max_season=max_season
    )
    builder = PointInTimeFeatureBuilder(
        team_names=load_team_names(conn), clubelo=load_clubelo(conn)
    )
    rows: List[List[float]] = []
    labels: List[int] = []
    meta: List[Dict[str, object]] = []
    for info, outcome, feats in builder.build_dataset(
        pairs, emit_competitions=emit_competitions, warmup_days=warmup_days
    ):
        rows.append([feats[name] for name in ALL_FEATURE_NAMES])
        labels.append(outcome.label)
        meta.append(
            {
                "match_id": info.match_id,
                "season": info.season,
                "competition_id": info.competition_id,
                "date": info.local_date.isoformat(),
                "odds_home": info.odds_home,
                "odds_draw": info.odds_draw,
                "odds_away": info.odds_away,
            }
        )
    X = np.asarray(rows, dtype=np.float64)
    y = np.asarray(labels, dtype=np.int64)
    return X, y, meta
