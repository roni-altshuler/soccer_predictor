"""Synthetic 30-club/34-match proof cases; never historical forecast rows."""

from collections import Counter
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone

import pytest

from backend.scripts import capture_projection_history
from backend.services.forecast import completed_season as cs

NOW = datetime(2026, 11, 9, 12, tzinfo=timezone.utc)
OBSERVED = "2026-11-08T12:00:00+00:00"
VERIFIED = "2026-08-11T09:49:52+00:00"


def make_evidence():
    # Circle scheduling gives 29 rounds, then five return rounds. Every club
    # plays exactly once per round. Outcomes and standings below are synthetic.
    circle = list(range(30))
    rounds = []
    for rnd in range(29):
        rounds.append(
            [
                (
                    (circle[i], circle[-i - 1])
                    if rnd % 2 == 0
                    else (circle[-i - 1], circle[i])
                )
                for i in range(15)
            ]
        )
        circle = [circle[0], circle[-1], *circle[1:-1]]
    rounds.extend([[(a, h) for h, a in r] for r in rounds[:5]])
    start, end = date(2026, 2, 21), date(2026, 11, 7)
    totals = {i: Counter() for i in range(30)}
    played, schedule = [], []
    for rnd, pairs in enumerate(rounds):
        day = start + timedelta(days=(end - start).days * rnd // 33)
        result_day = day + timedelta(days=int(rnd == 33))
        for h, a in pairs:
            index = len(played)
            hk, ak = ("usa.1::" + cs.norm_team(f"Club {team:02}") for team in (h, a))
            hg, ag = (h + rnd) % 4, (a + rnd) % 3
            played.append(
                {
                    "match_uid": f"result-{index}",
                    "competition_id": "usa.1",
                    "season": 2026,
                    "phase": "regular-season",
                    "local_date": result_day,
                    "home_key": hk,
                    "away_key": ak,
                    "home_name": f"Club {h:02}",
                    "away_name": f"Club {a:02}",
                    "home_score": hg,
                    "away_score": ag,
                    "kickoff_at": f"{result_day}T00:00:00+00:00",
                }
            )
            schedule.append(
                {
                    "competition_id": "usa.1",
                    "season": 2026,
                    "row_key": f"scheduled-{index}",
                    "local_date": day,
                    "home_key": hk,
                    "away_key": ak,
                    "round": "Regular Season",
                }
            )
            for team, gf, ga in ((h, hg, ag), (a, ag, hg)):
                totals[team].update(
                    played=1,
                    wins=int(gf > ga),
                    draws=int(gf == ga),
                    losses=int(gf < ga),
                    points=3 if gf > ga else int(gf == ga),
                    gf=gf,
                    ga=ga,
                    gd=gf - ga,
                )
    groups, raw = [], []
    fields = {
        "position": "rank",
        "played": "gamesPlayed",
        "wins": "wins",
        "draws": "ties",
        "losses": "losses",
        "points": "points",
        "gf": "pointsFor",
        "ga": "pointsAgainst",
        "gd": "pointDifferential",
    }
    for name, offset in [("Eastern Conference", 0), ("Western Conference", 15)]:
        order = sorted(
            range(offset, offset + 15),
            key=lambda i: (
                -totals[i]["points"],
                -totals[i]["wins"],
                -totals[i]["gd"],
                -totals[i]["gf"],
                i,
            ),
        )
        entries = []
        for rank, team in enumerate(order, 1):
            values = dict(totals[team], position=rank)
            entries.append(
                {
                    "team": {"id": str(team + 1), "displayName": f"Club {team:02}"},
                    "stats": [
                        {"name": field, "value": values[key]}
                        for key, field in fields.items()
                    ],
                    "note": (
                        {"description": "Qualifies for MLS Cup Playoffs", "rank": rank}
                        if rank <= 9
                        else {}
                    ),
                }
            )
        raw.append(
            {
                "name": name,
                "season": 2026,
                "season_type": 1,
                "source_url": cs.ENDPOINT,
                "observed_at": OBSERVED,
                "entries": entries,
            }
        )
        groups.append(
            {"name": name, "short": name.split()[0], "teams": 15, "qualify": 9}
        )
    return {
        "season": 2026,
        "played": played,
        "schedule": schedule,
        "standings": cs.standings_observation(raw, 2026),
        "aliases": {},
        "schedule_verified_at": VERIFIED,
        "groups": groups,
        "now": NOW,
        "raw": raw,
    }


@pytest.fixture
def evidence():
    return make_evidence()


def complete(evidence):
    return cs.completed_mls(**{k: v for k, v in evidence.items() if k != "raw"})


def test_completed_record_is_observed_and_keeps_source_clocks_separate(evidence):
    result = complete(evidence)
    assert result["state"] == cs.STATE and result["table"] == []
    assert result["fixtures_remaining"] == 0 and result["teams"] == 30
    assert len(result["observed_table"]) == 30
    assert all(row["played"] == 34 for row in result["observed_table"])
    assert sum(row["qualified"] for row in result["observed_table"]) == 18
    assert not any(
        key.startswith(("p_", "exp_"))
        for row in result["observed_table"]
        for key in row
    )
    obs = result["observation"]
    assert obs["observed_at"] == OBSERVED
    assert obs["proof_checked_at"] == NOW.isoformat()
    assert obs["schedule_last_verified_at"] == VERIFIED
    assert obs["results_through"] == "2026-11-08"
    assert obs["matches_reconciled"] == obs["schedule_fixtures"] == 510
    assert obs["date_discrepancies"] == []


@pytest.mark.parametrize(
    "case",
    [
        "missing_result",
        "missing_schedule",
        "duplicate_result_id",
        "duplicate_result_game",
        "duplicate_schedule_id",
        "duplicate_schedule_game",
        "reverse_home_away",
        "self_game",
        "wrong_phase",
        "unknown_phase",
        "wrong_result_year",
        "wrong_schedule_year",
        "future_result",
        "future_same_day_kickoff",
        "missing_kickoff",
        "naive_kickoff",
        "missing_standings",
        "wrong_standings_year",
        "wrong_standings_phase",
        "duplicate_standing_id",
        "duplicate_rank",
        "missing_group",
        "wrong_cut",
        "standings_disagreement",
        "still_playing",
        "future_observation",
        "naive_observation",
        "before_endpoint",
        "future_schedule_verification",
        "missing_schedule_verification",
        "different_away_club",
        "unreviewed_format",
    ],
)
def test_incomplete_or_conflicting_evidence_never_certifies_completion(evidence, case):
    e = evidence
    if case == "missing_result":
        e["played"].pop()
    elif case == "missing_schedule":
        e["schedule"].pop()
    elif case == "duplicate_result_id":
        e["played"][-1]["match_uid"] = e["played"][0]["match_uid"]
    elif case == "duplicate_result_game":
        e["played"][-1].update(
            {
                k: e["played"][0][k]
                for k in ["home_key", "away_key", "local_date", "kickoff_at"]
            }
        )
    elif case == "duplicate_schedule_id":
        e["schedule"][-1]["row_key"] = e["schedule"][0]["row_key"]
    elif case == "duplicate_schedule_game":
        e["schedule"][-1].update(
            {k: e["schedule"][0][k] for k in ["home_key", "away_key", "local_date"]}
        )
    elif case == "reverse_home_away":
        m = e["played"][0]
        m["home_key"], m["away_key"] = m["away_key"], m["home_key"]
    elif case == "self_game":
        e["played"][0]["away_key"] = e["played"][0]["home_key"]
    elif case in ("wrong_phase", "unknown_phase"):
        e["played"][0]["phase"] = "MLS Cup" if case == "wrong_phase" else None
    elif case == "wrong_result_year":
        e["played"][0]["season"] = 2025
    elif case == "wrong_schedule_year":
        e["schedule"][0]["season"] = 2025
    elif case == "future_result":
        e["played"][0]["local_date"] = date(2026, 11, 10)
    elif case == "future_same_day_kickoff":
        e["played"][-1]["kickoff_at"] = "2026-11-08T17:00:00+00:00"
    elif case == "missing_kickoff":
        e["played"][0].pop("kickoff_at")
    elif case == "naive_kickoff":
        e["played"][0]["kickoff_at"] = "2026-02-21T00:00:00"
    elif case == "missing_standings":
        e["standings"] = None
    elif case == "wrong_standings_year":
        e["standings"]["season"] = 2025
    elif case == "wrong_standings_phase":
        e["standings"]["season_type"] = 3
    elif case == "duplicate_standing_id":
        e["standings"]["rows"][-1]["team_id"] = e["standings"]["rows"][0]["team_id"]
    elif case == "duplicate_rank":
        e["standings"]["rows"][1]["position"] = e["standings"]["rows"][0]["position"]
    elif case == "missing_group":
        e["groups"].pop()
    elif case == "wrong_cut":
        e["groups"][0]["qualify"] = 10
    elif case == "standings_disagreement":
        row = e["standings"]["rows"][0]
        row["gf"] += 1
        row["gd"] += 1
    elif case == "still_playing":
        row = e["standings"]["rows"][0]
        row["played"] -= 1
        row["losses"] -= 1
    elif case == "future_observation":
        e["standings"]["observed_at"] = "2026-11-10T12:00:00+00:00"
    elif case == "naive_observation":
        e["standings"]["observed_at"] = "2026-11-08T12:00:00"
    elif case == "before_endpoint":
        e["standings"]["observed_at"] = "2026-11-07T23:59:59+00:00"
    elif case == "future_schedule_verification":
        e["schedule_verified_at"] = "2026-11-10T00:00:00+00:00"
    elif case == "missing_schedule_verification":
        e["schedule_verified_at"] = None
    elif case == "different_away_club":
        e["schedule"][0]["away_key"] = e["schedule"][1]["away_key"]
    elif case == "unreviewed_format":
        e["season"] = 2027
    with pytest.raises(cs.CompletionUnavailable):
        complete(e)


@pytest.mark.parametrize(
    "value", [None, True, "34", 33.5, float("nan"), float("inf"), -1]
)
def test_standings_statistics_are_not_coerced(evidence, value):
    evidence["raw"][0]["entries"][0]["stats"][1]["value"] = value
    with pytest.raises(cs.CompletionUnavailable):
        cs.standings_observation(evidence["raw"], 2026)


def test_unique_remaining_pair_retains_both_dates_without_certifying_a_reschedule(
    evidence,
):
    original = evidence["schedule"][0]["local_date"]
    evidence["schedule"][0]["local_date"] = original + timedelta(days=3)
    result = complete(evidence)
    gap = result["observation"]["date_discrepancies"][0]
    assert gap == {
        "schedule_row_key": "scheduled-0",
        "scheduled_date": str(original + timedelta(days=3)),
        "canonical_result_uid": "result-0",
        "result_date": str(original),
        "home_key": evidence["played"][0]["home_key"],
        "away_key": evidence["played"][0]["away_key"],
        "match_method": "unique_remaining_home_away_pair",
    }
    assert result["observation"]["schedule_last_verified_at"] == VERIFIED
    reordered = deepcopy(evidence)
    reordered["played"].reverse()
    reordered["schedule"].reverse()
    assert complete(reordered) == result


def repeated_pair(evidence):
    first = evidence["played"][0]
    i = next(
        i
        for i, m in enumerate(evidence["played"])
        if m["home_key"] == first["away_key"] and m["away_key"] == first["home_key"]
    )
    second = evidence["played"][i]
    second["home_key"], second["away_key"] = second["away_key"], second["home_key"]
    second["home_score"], second["away_score"] = (
        second["away_score"],
        second["home_score"],
    )
    evidence["schedule"][i]["home_key"] = second["home_key"]
    evidence["schedule"][i]["away_key"] = second["away_key"]
    return i


def test_ambiguous_residual_repeated_pair_is_not_sorted_into_a_guessed_match(evidence):
    i = repeated_pair(evidence)
    for index in [0, i]:
        evidence["schedule"][index]["local_date"] += timedelta(days=3)
    with pytest.raises(cs.CompletionUnavailable, match="ambiguous"):
        complete(evidence)


def test_exact_matches_precede_timezone_matches_independently_of_row_order(evidence):
    i = repeated_pair(evidence)
    for index, day in [(0, 2), (i, 3)]:
        evidence["played"][index]["local_date"] = date(2026, 5, day)
        evidence["played"][index]["kickoff_at"] = f"2026-05-{day:02}T00:00:00+00:00"
        evidence["schedule"][index]["local_date"] = date(2026, 5, day - 1)
    result = complete(evidence)
    gap = result["observation"]["date_discrepancies"]
    assert len(gap) == 1 and gap[0]["schedule_row_key"] == "scheduled-0"
    assert gap[0]["canonical_result_uid"] == f"result-{i}"
    evidence["played"].reverse()
    evidence["schedule"].reverse()
    assert complete(evidence) == result


def test_completed_outcomes_do_not_enter_forecast_history_with_stray_probabilities(
    evidence,
):
    completed = complete(evidence)
    completed["table"] = [{"team": "Injected outcome", "p_title": 1.0}]
    past = {
        "competition_id": "eng.1",
        "season": 2026,
        "table": [{"team": "Past forecast", "p_title": 0.34, "played": 5}],
    }
    source = {"generated_at": NOW.isoformat(), "leagues": [past, completed]}
    original = deepcopy(source)
    rows = capture_projection_history.rows_for(source)
    assert len(rows) == 1 and rows[0]["p_title"] == 0.34
    assert source == original
