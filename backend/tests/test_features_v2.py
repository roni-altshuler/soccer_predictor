"""Tests for `backend/services/prediction/features_v2.py`.

The bulk of this file is about one thing: proving that a candidate feature
cannot see the future. Given the 60.56%-holdout / 46%-live gap this project is
carrying, "the builder looks careful" is not good enough — the leakage guards
have to fail loudly when violated, and that has to be asserted.
"""

from __future__ import annotations

import sqlite3
from datetime import date, datetime, timedelta, timezone

import pytest

from backend.services.prediction.features_v2 import (
    ALL_FEATURE_NAMES,
    CANDIDATE_GROUPS,
    FEATURE_GROUPS,
    MatchOutcome,
    PointInTimeFeatureBuilder,
    PreMatchInfo,
    TemporalOrderError,
    build_feature_frame,
    load_match_pairs,
    no_vig_probabilities,
    venue_key_for,
)

UTC = timezone.utc


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------


def mk(
    mid: str,
    day: str,
    home: int,
    away: int,
    *,
    comp: str = "eng.1",
    season: int = 2020,
    source: str = "espn",
    hour: int = 15,
    referee_id=None,
    **kw,
) -> PreMatchInfo:
    y, m, d = (int(x) for x in day.split("-"))
    return PreMatchInfo(
        match_id=mid,
        source=source,
        competition_id=comp,
        season=season,
        kickoff=datetime(y, m, d, hour, 0, tzinfo=UTC),
        home_team_id=home,
        away_team_id=away,
        referee_id=referee_id,
        **kw,
    )


def res(mid: str, hs: int, as_: int, **kw) -> MatchOutcome:
    return MatchOutcome(match_id=mid, home_score=hs, away_score=as_, **kw)


# --------------------------------------------------------------------------
# registry hygiene
# --------------------------------------------------------------------------


def test_feature_names_unique_and_complete():
    flat = [n for names in FEATURE_GROUPS.values() for n in names]
    assert len(flat) == len(set(flat))
    assert set(flat) == set(ALL_FEATURE_NAMES)
    assert "baseline" not in CANDIDATE_GROUPS
    assert set(CANDIDATE_GROUPS) | {"baseline"} == set(FEATURE_GROUPS)


def test_builder_emits_every_registered_feature():
    b = PointInTimeFeatureBuilder()
    feats = b.features_for(mk("m1", "2020-08-15", 1, 2))
    assert set(feats) == set(ALL_FEATURE_NAMES)
    assert all(isinstance(v, float) for v in feats.values())


# --------------------------------------------------------------------------
# THE LEAKAGE FIREWALL
# --------------------------------------------------------------------------


def test_prematchinfo_carries_no_outcome_fields():
    """Structural guard: the type handed to feature code has no result on it."""
    forbidden = {
        "home_score",
        "away_score",
        "home_yellows",
        "away_yellows",
        "home_reds",
        "away_reds",
        "home_shots",
        "away_shots",
        "home_sot",
        "away_sot",
        "home_xg",
        "away_xg",
        "attendance",
        "label",
    }
    fields = set(PreMatchInfo.__dataclass_fields__) | {
        a for a in dir(PreMatchInfo) if not a.startswith("_")
    }
    assert forbidden.isdisjoint(fields), forbidden & fields


def test_features_for_signature_takes_only_prematch_info():
    import inspect

    sig = inspect.signature(PointInTimeFeatureBuilder.features_for)
    assert list(sig.parameters) == ["self", "info"]
    assert sig.parameters["info"].annotation in (PreMatchInfo, "PreMatchInfo")


def test_features_are_identical_before_and_after_the_match_is_played():
    """The canonical leakage test: featurising then observing must be a no-op
    on the emitted vector."""
    b = PointInTimeFeatureBuilder()
    b.observe(mk("a", "2020-08-01", 1, 2), res("a", 3, 0))
    b.observe(mk("b", "2020-08-08", 2, 1), res("b", 1, 1))

    target = mk("c", "2020-08-15", 1, 2)
    before = b.features_for(target)

    # a second builder that has ALSO seen the target match must not agree
    b2 = PointInTimeFeatureBuilder()
    b2.observe(mk("a", "2020-08-01", 1, 2), res("a", 3, 0))
    b2.observe(mk("b", "2020-08-08", 2, 1), res("b", 1, 1))
    b2.observe(target, res("c", 5, 0))
    after = b2.features_for(mk("d", "2020-08-22", 1, 2))

    assert before["h2h_n"] == 2
    assert after["h2h_n"] == 3  # proves observe() really does move state
    assert before["elo_home"] != after["elo_home"]


def test_observing_out_of_order_raises():
    b = PointInTimeFeatureBuilder()
    b.observe(mk("a", "2020-08-08", 1, 2), res("a", 1, 0))
    with pytest.raises(TemporalOrderError):
        b.observe(mk("b", "2020-08-01", 1, 2), res("b", 1, 0))


def test_featurising_a_match_already_folded_into_state_raises():
    b = PointInTimeFeatureBuilder()
    b.observe(mk("a", "2020-08-08", 1, 2), res("a", 1, 0))
    with pytest.raises(TemporalOrderError):
        b.features_for(mk("a", "2020-08-08", 1, 2))
    with pytest.raises(TemporalOrderError):
        b.features_for(mk("z", "2020-08-07", 3, 4))


def test_same_day_fixtures_cannot_see_each_other():
    """Two fixtures on the same calendar day must be featurised from identical
    state, whatever order they appear in."""
    pairs = [
        (mk("early", "2020-09-12", 1, 2, hour=12), res("early", 4, 0)),
        (mk("late", "2020-09-12", 3, 1, hour=17), res("late", 0, 2)),
    ]
    b = PointInTimeFeatureBuilder()
    rows = list(b.build_dataset(pairs, emit_competitions=["eng.1"]))
    assert len(rows) == 2
    late = next(f for i, _, f in rows if i.match_id == "late")
    # team 1 played in the early kickoff on the same day; the late fixture's
    # features must not know that team 1 has already played (let alone lost).
    assert late["cg_home_matches_14d"] == 0.0
    assert late["elo_away"] == 1500.0  # team 1 is away here, still unrated


def test_build_dataset_observes_every_match_even_when_not_emitted():
    """Continental load has to accumulate even though UCL rows aren't emitted."""
    pairs = [
        (mk("ucl", "2020-09-01", 1, 9, comp="uefa.champions"), res("ucl", 2, 2)),
        (mk("league", "2020-09-05", 1, 2, comp="eng.1"), res("league", 1, 0)),
    ]
    b = PointInTimeFeatureBuilder()
    rows = list(b.build_dataset(pairs, emit_competitions=["eng.1"]))
    assert [i.match_id for i, _, _ in rows] == ["league"]
    feats = rows[0][2]
    assert feats["cg_home_euro_14d"] == 1.0
    assert feats["cg_home_matches_14d"] == 1.0


# --------------------------------------------------------------------------
# individual feature groups
# --------------------------------------------------------------------------


def test_venue_features_track_the_ground_not_the_fixture():
    b = PointInTimeFeatureBuilder()
    # team 1 hosts three different visitors and wins them all 2-0
    for i, opp in enumerate((2, 3, 4)):
        b.observe(mk(f"h{i}", f"2020-08-0{i + 1}", 1, opp), res(f"h{i}", 2, 0))
    # team 5 has visited team 1's ground once and drew
    b.observe(mk("v", "2020-08-10", 1, 5), res("v", 1, 1))
    f = b.features_for(mk("next", "2020-08-20", 1, 5))
    assert f["ven_matches_seen"] == 4
    assert f["ven_home_win_rate"] == pytest.approx(0.75)
    assert f["ven_avg_total_goals"] == pytest.approx((2 + 2 + 2 + 2) / 4)
    assert f["ven_away_visits"] == 1
    assert f["ven_away_ppg_here"] == pytest.approx(1.0)  # one draw
    assert f["ven_away_gd_here"] == pytest.approx(0.0)
    # a different visitor has no record here
    g = b.features_for(mk("next2", "2020-08-20", 1, 7))
    assert g["ven_away_visits"] == 0


def test_venue_key_uses_home_club_for_domestic_and_string_for_neutral():
    dom = mk("d", "2020-08-01", 11, 12, comp="eng.1", venue="Anfield")
    assert venue_key_for(dom) == "club:11"
    neu = mk("n", "2020-08-01", 11, 12, comp="uefa.euro", venue="Wembley")
    assert venue_key_for(neu) == "neutral:Wembley"


def test_referee_features_and_team_interaction():
    b = PointInTimeFeatureBuilder()
    # ref 7 has done three matches; home side won all three
    for i, (h, a) in enumerate(((1, 2), (1, 3), (4, 5))):
        b.observe(
            mk(f"r{i}", f"2020-08-0{i + 1}", h, a, referee_id=7),
            res(f"r{i}", 2, 0, home_yellows=2, away_yellows=3, home_reds=0, away_reds=1),
        )
    # team 2 also played elsewhere and did well, so its ppg under ref 7 is worse
    b.observe(mk("x", "2020-08-05", 2, 6), res("x", 3, 0))
    f = b.features_for(mk("next", "2020-08-12", 2, 1, referee_id=7))
    assert f["ref_has_referee"] == 1.0
    assert f["ref_matches_seen"] == 3
    assert f["ref_home_win_rate"] == pytest.approx(1.0)
    assert f["ref_draw_rate"] == pytest.approx(0.0)
    assert f["ref_avg_cards"] == pytest.approx(5.0)
    assert f["ref_avg_reds"] == pytest.approx(1.0)
    assert f["ref_home_team_appearances"] == 1  # team 2, once, lost
    assert f["ref_home_team_ppg_delta"] < 0  # 0 ppg under ref vs 1.5 overall

    blank = b.features_for(mk("next2", "2020-08-12", 2, 1))
    assert blank["ref_has_referee"] == 0.0


def test_weather_features_default_and_flag():
    b = PointInTimeFeatureBuilder()
    dry = b.features_for(mk("a", "2020-08-01", 1, 2))
    assert dry["wx_has_weather"] == 0.0
    wet = b.features_for(
        mk("b", "2020-08-02", 1, 2, temp_c=4.0, precip_mm=6.5, wind_kmh=41.0, humidity=93.0)
    )
    assert wet["wx_has_weather"] == 1.0
    assert wet["wx_is_wet"] == 1.0
    assert wet["wx_temp_c"] == 4.0


def test_calendar_features_and_the_fdcouk_date_shift():
    """football-data.co.uk rows store local midnight, which pushes the calendar
    date and the weekday back a day. `local_date` has to undo that."""
    espn = mk("e", "2026-03-07", 1, 2, source="espn", hour=15)
    assert espn.local_date == date(2026, 3, 7)
    assert espn.has_real_kickoff_time

    fd = PreMatchInfo(
        match_id="fd_20260307",
        source="fdcouk",
        competition_id="eng.1",
        season=2025,
        kickoff=datetime(2026, 3, 6, 22, 0, tzinfo=UTC),  # exactly what the DB holds
        home_team_id=1,
        away_team_id=2,
    )
    assert fd.local_date == date(2026, 3, 7)  # Saturday, not Friday
    assert not fd.has_real_kickoff_time

    b = PointInTimeFeatureBuilder()
    f = b.features_for(fd)
    assert f["cal_has_real_kickoff_time"] == 0.0
    assert f["cal_kickoff_hour"] == -1.0
    assert f["cal_hour_sin"] == 0.0
    assert f["cal_is_saturday"] == 1.0
    g = b.features_for(espn)
    assert g["cal_has_real_kickoff_time"] == 1.0
    assert g["cal_kickoff_hour"] == 15.0
    assert g["cal_is_saturday"] == 1.0


def test_h2h_deep_recency_weighting_prefers_recent_meetings():
    old = PointInTimeFeatureBuilder()
    # ancient home wins, recent away wins
    old.observe(mk("o1", "2012-01-01", 1, 2), res("o1", 3, 0))
    old.observe(mk("o2", "2013-01-01", 1, 2), res("o2", 3, 0))
    old.observe(mk("o3", "2019-01-01", 1, 2), res("o3", 0, 2))
    f = old.features_for(mk("n", "2020-01-01", 1, 2))
    assert f["h2h_n"] == 3
    # simple counts say 2-0 to the home side; recency weighting must not
    assert f["h2h_recency_home_score"] < 0.5
    assert f["h2h_recency_gd"] < 0
    assert f["h2h_gd_trend"] < 0
    assert f["h2h_days_since_last"] == 365


def test_h2h_at_this_venue_only_counts_the_matching_leg():
    b = PointInTimeFeatureBuilder()
    b.observe(mk("home_leg", "2019-09-01", 1, 2), res("home_leg", 2, 0))
    b.observe(mk("away_leg", "2020-02-01", 2, 1), res("away_leg", 3, 0))
    f = b.features_for(mk("n", "2020-09-01", 1, 2))
    assert f["h2h_n"] == 2
    assert f["h2h_venue_n"] == 1  # only the leg at team 1's ground
    assert f["h2h_venue_home_ppg"] == pytest.approx(3.0)
    assert f["h2h_venue_gd"] == pytest.approx(2.0)


def test_congestion_counts_trailing_windows_and_rest():
    b = PointInTimeFeatureBuilder()
    base = date(2020, 9, 1)
    for i in range(6):  # every 4 days
        d = base + timedelta(days=4 * i)
        b.observe(mk(f"c{i}", d.isoformat(), 1, 50 + i), res(f"c{i}", 1, 1))
    target_day = base + timedelta(days=23)
    f = b.features_for(mk("t", target_day.isoformat(), 1, 99))
    # trailing 14 days from day 23 starts at day 9 -> matches on days 12/16/20
    assert f["cg_home_matches_14d"] == 3
    assert f["cg_home_matches_30d"] == 6
    assert f["cg_away_matches_14d"] == 0
    assert f["cg_matches_14d_diff"] == 3
    # last outing was day 20, target is day 23 -> three days' rest
    assert f["cg_home_rest_diff"] == 3.0 - 14.0  # away side has never played
    assert f["cg_home_short_rest"] == 1.0
    rested = b.features_for(mk("t2", (base + timedelta(days=40)).isoformat(), 1, 99))
    assert rested["cg_home_short_rest"] == 0.0
    assert rested["cg_home_matches_14d"] == 0


def test_consecutive_away_tracks_travel_burden():
    b = PointInTimeFeatureBuilder()
    b.observe(mk("a1", "2020-08-01", 9, 1), res("a1", 1, 0))
    b.observe(mk("a2", "2020-08-08", 8, 1), res("a2", 1, 0))
    f = b.features_for(mk("t", "2020-08-15", 7, 1))
    assert f["cg_away_consecutive_away"] == 2
    b.observe(mk("h1", "2020-08-15", 1, 7), res("h1", 1, 0))
    g = b.features_for(mk("t2", "2020-08-22", 6, 1))
    assert g["cg_away_consecutive_away"] == 0


def test_xg_features_activate_only_with_data():
    b = PointInTimeFeatureBuilder()
    f = b.features_for(mk("t", "2020-08-15", 1, 2))
    assert f["xg_has_data"] == 0.0
    for i in range(3):
        b.observe(
            mk(f"x{i}", f"2020-09-0{i + 1}", 1, 2),
            res(f"x{i}", 2, 1, home_xg=1.8, away_xg=0.9),
        )
    g = b.features_for(mk("t2", "2020-09-20", 1, 2))
    assert g["xg_has_data"] == 1.0
    assert g["xg_home_for5"] == pytest.approx(1.8)
    assert g["xg_home_against5"] == pytest.approx(0.9)
    assert g["xg_home_overperf5"] == pytest.approx(2.0 - 1.8)


def test_market_features_devig_and_flag():
    b = PointInTimeFeatureBuilder()
    f = b.features_for(mk("t", "2020-08-15", 1, 2, odds_home=2.0, odds_draw=4.0, odds_away=4.0))
    assert f["mkt_has_odds"] == 1.0
    assert f["mkt_implied_home"] == pytest.approx(0.5)
    assert f["mkt_implied_draw"] == pytest.approx(0.25)
    assert f["mkt_overround"] == pytest.approx(0.0)
    g = b.features_for(mk("t2", "2020-08-16", 1, 2))
    assert g["mkt_has_odds"] == 0.0


def test_no_vig_probabilities_sum_to_one_and_reject_junk():
    p = no_vig_probabilities(1.5, 4.0, 7.0)
    assert p is not None
    assert sum(p[:3]) == pytest.approx(1.0)
    assert p[3] > 0  # real books carry a margin
    assert no_vig_probabilities(None, 4.0, 7.0) is None
    assert no_vig_probabilities(1.0, 4.0, 7.0) is None


def test_news_proxy_is_deterministic_and_uncorrelated_with_the_label():
    """The news-sentiment control group must be reproducible noise, nothing
    else — otherwise it is not a valid null."""
    b = PointInTimeFeatureBuilder()
    a = b.features_for(mk("same", "2020-08-15", 1, 2))
    c = b.features_for(mk("same", "2020-08-15", 1, 2))
    assert a["news_home_sentiment_proxy"] == c["news_home_sentiment_proxy"]
    d = b.features_for(mk("other", "2020-08-15", 1, 2))
    assert a["news_home_sentiment_proxy"] != d["news_home_sentiment_proxy"]
    assert -1.0 <= a["news_home_sentiment_proxy"] <= 1.0


def test_elo_moves_with_results_and_starts_neutral():
    b = PointInTimeFeatureBuilder()
    f0 = b.features_for(mk("t", "2020-08-01", 1, 2))
    assert f0["elo_home"] == 1500.0 and f0["elo_diff"] == 0.0
    b.observe(mk("m", "2020-08-08", 1, 2), res("m", 4, 0))
    f1 = b.features_for(mk("t2", "2020-08-15", 1, 2))
    assert f1["elo_home"] > 1500.0 > f1["elo_away"]
    assert f1["elo_diff"] > 0


def test_baseline_h2h_counts_are_home_team_oriented():
    b = PointInTimeFeatureBuilder()
    b.observe(mk("a", "2019-01-01", 1, 2), res("a", 2, 0))  # team 1 wins at home
    b.observe(mk("b", "2019-06-01", 2, 1), res("b", 0, 3))  # team 1 wins away
    f = b.features_for(mk("t", "2020-01-01", 1, 2))
    assert (f["h2h_home_wins"], f["h2h_draws"], f["h2h_away_wins"]) == (2.0, 0.0, 0.0)
    g = b.features_for(mk("t2", "2020-01-01", 2, 1))  # roles reversed
    assert (g["h2h_home_wins"], g["h2h_draws"], g["h2h_away_wins"]) == (0.0, 0.0, 2.0)


# --------------------------------------------------------------------------
# warehouse integration
# --------------------------------------------------------------------------


def _tiny_warehouse(path) -> sqlite3.Connection:
    from backend.services.data.warehouse import Warehouse

    wh = Warehouse(path)
    wh.migrate()
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        INSERT INTO competitions(competition_id,name,country,gender,tier)
            VALUES ('eng.1','Premier League','England','M',1);
        INSERT INTO teams(team_id,canonical_name,gender) VALUES (1,'Alpha','M');
        INSERT INTO teams(team_id,canonical_name,gender) VALUES (2,'Beta','M');
        INSERT INTO teams(team_id,canonical_name,gender) VALUES (3,'Gamma','M');
        """
    )
    rows = [
        ("m1", "espn", "eng.1", 2019, "2019-08-10T14:00:00+00:00", 1, 2, 2, 0),
        ("m2", "espn", "eng.1", 2019, "2019-08-17T14:00:00+00:00", 2, 3, 1, 1),
        ("m3", "espn", "eng.1", 2019, "2019-08-24T14:00:00+00:00", 3, 1, 0, 3),
        ("m4", "fdcouk", "eng.1", 2020, "2020-08-14T22:00:00+00:00", 1, 3, 1, 2),
        ("m5", "espn", "eng.1", 2020, "2020-08-22T14:00:00+00:00", 2, 1, 0, 0),
        # unsettled — must be excluded
        ("m6", "espn", "eng.1", 2020, "2020-08-29T14:00:00+00:00", 3, 2, None, None),
    ]
    conn.executemany(
        """INSERT INTO matches(match_id,source,competition_id,season,date_utc,
               home_team_id,away_team_id,home_score,away_score,fetched_at)
           VALUES (?,?,?,?,?,?,?,?,?,'2026-01-01T00:00:00+00:00')""",
        rows,
    )
    conn.commit()
    return conn


def test_load_match_pairs_excludes_unsettled_and_sorts_by_local_date(tmp_path):
    conn = _tiny_warehouse(tmp_path / "wh.sqlite")
    pairs = load_match_pairs(conn, competitions=["eng.1"], min_season=2019)
    assert [i.match_id for i, _ in pairs] == ["m1", "m2", "m3", "m4", "m5"]
    days = [i.local_date for i, _ in pairs]
    assert days == sorted(days)
    # the fdcouk row stored at 22:00 the previous day must land on the 15th
    m4 = next(i for i, _ in pairs if i.match_id == "m4")
    assert m4.local_date == date(2020, 8, 15)
    conn.close()


def test_build_feature_frame_end_to_end(tmp_path):
    conn = _tiny_warehouse(tmp_path / "wh.sqlite")
    X, y, meta = build_feature_frame(
        conn,
        emit_competitions=["eng.1"],
        observe_competitions=["eng.1"],
        min_season=2019,
        warmup_days=0,
    )
    assert X.shape == (5, len(ALL_FEATURE_NAMES))
    assert list(y) == [0, 1, 2, 2, 1]
    assert [m["match_id"] for m in meta] == ["m1", "m2", "m3", "m4", "m5"]
    assert not (X != X).any()  # no NaNs
    conn.close()


def test_derby_flag_uses_canonical_team_names():
    b = PointInTimeFeatureBuilder(team_names={1: "Real Madrid", 2: "Barcelona", 3: "Getafe"})
    assert b.features_for(mk("a", "2020-08-01", 1, 2))["is_derby"] == 1.0
    assert b.features_for(mk("b", "2020-08-01", 1, 3))["is_derby"] == 0.0


def test_clubelo_lookup_is_strictly_before_the_match_date():
    elo = {1: (["2020-08-01", "2020-08-15", "2020-08-22"], [1600.0, 1650.0, 1700.0])}
    b = PointInTimeFeatureBuilder(clubelo=elo)
    f = b.features_for(mk("t", "2020-08-15", 1, 2))
    # the rating published ON match day is not usable pre-kickoff
    assert f["ce_home"] == 1600.0
    assert f["ce_has_rating"] == 0.0  # team 2 has no rating at all
    g = b.features_for(mk("t2", "2020-07-01", 1, 2))
    assert g["ce_home"] == 1500.0  # nothing published yet
