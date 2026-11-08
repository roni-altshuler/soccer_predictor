"""Verified observed MLS results, never zero-fixture model predictions.

The 2026 format is deliberately explicit. MLS changes calendars in 2027;
an unknown format must stay unavailable instead of inheriting 34 games.
"""

from __future__ import annotations

import math
import re
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone

from backend.scripts.build_canonical import norm_team

STATE = "regular_season_completed"
ENDPOINT = (
    "https://site.web.api.espn.com/apis/v2/sports/soccer/usa.1/standings" "?season=2026"
)
# Official regular-season endpoint, not the MLS Cup endpoint:
# https://www.mlssoccer.com/news/audi-2026-mls-cup-playoffs-key-dates-schedule-information
FORMATS = {2026: {"teams": 30, "games": 34, "qualify": 9, "end": date(2026, 11, 7)}}
GROUPS = {"Eastern Conference", "Western Conference"}
POSTSEASON = {
    "Wild Card Round",
    "Round One",
    "Conference Semifinals",
    "Conference Finals",
    "MLS Cup",
}


class CompletionUnavailable(ValueError):
    """Incomplete or conflicting evidence must retain last-good publication."""


def _require(condition, reason):
    if not condition:
        raise CompletionUnavailable(reason)


def _integer(value, *, signed=False):
    _require(
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
        and value == int(value),
        "non-integer standings statistic",
    )
    value = int(value)
    _require(signed or value >= 0, "negative standings statistic")
    return value


def _stamp(value):
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError("timezone missing")
        return parsed.astimezone(timezone.utc)
    except (AttributeError, TypeError, ValueError) as exc:
        raise CompletionUnavailable("invalid observation timestamp") from exc


def standings_observation(groups, season):
    """Reduce the existing standings response to a strict observed snapshot.

    This can be retained mid-season too; only reconciliation below can turn
    it into a completed record. Missing fields never become empty/zero data.
    """
    _require(season in FORMATS, "unreviewed MLS season format")
    fmt = FORMATS[season]
    _require(
        isinstance(groups, list) and len(groups) == 2, "incomplete conference standings"
    )
    rows, names, ids, stamps = [], set(), set(), set()
    for group in groups:
        _require(isinstance(group, dict), "conference schema")
        name = group.get("name")
        _require(name in GROUPS and name not in names, "conference identity")
        names.add(name)
        _require(
            group.get("season") == season
            and type(group.get("season")) is int
            and type(group.get("season_type")) is int
            and group["season_type"] == 1,
            "standings season/phase",
        )
        _require(group.get("source_url") == ENDPOINT, "standings source")
        observed_at = _stamp(group.get("observed_at"))
        stamps.add(observed_at.isoformat())
        entries = group.get("entries")
        _require(
            isinstance(entries, list) and len(entries) == fmt["teams"] // 2,
            "conference coverage",
        )
        ranks = set()
        for entry in entries:
            _require(isinstance(entry, dict), "standings entry")
            team = entry.get("team")
            _require(isinstance(team, dict), "standings team")
            tid, display = team.get("id"), team.get("displayName")
            _require(
                isinstance(tid, str)
                and re.fullmatch(r"[1-9][0-9]*", tid) is not None
                and tid not in ids,
                "duplicate/invalid standings team",
            )
            _require(
                isinstance(display, str) and bool(display.strip()),
                "standings team name",
            )
            ids.add(tid)
            raw = entry.get("stats")
            _require(
                isinstance(raw, list) and all(isinstance(s, dict) for s in raw),
                "standings statistics",
            )
            keys = [s.get("name") for s in raw]
            _require(
                all(isinstance(k, str) for k in keys) and len(keys) == len(set(keys)),
                "duplicate statistic",
            )
            stats = {s["name"]: s.get("value") for s in raw}
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
            row = {
                key: _integer(stats.get(field), signed=key == "gd")
                for key, field in fields.items()
            }
            _require(
                1 <= row["position"] <= len(entries) and row["position"] not in ranks,
                "standings ranks",
            )
            ranks.add(row["position"])
            _require(
                row["wins"] + row["draws"] + row["losses"] == row["played"]
                and 3 * row["wins"] + row["draws"] == row["points"]
                and row["gf"] - row["ga"] == row["gd"],
                "inconsistent standings totals",
            )
            row.update(team=display.strip(), team_id=tid, group=name)
            rows.append(row)
        _require(ranks == set(range(1, len(entries) + 1)), "standings ranks")
    _require(names == GROUPS and len(stamps) == 1, "standings observation")
    _require(
        len({norm_team(r["team"]) for r in rows}) == len(rows),
        "ambiguous standings names",
    )
    return {
        "competition_id": "usa.1",
        "season": season,
        "season_type": 1,
        "observed_at": stamps.pop(),
        "source_url": ENDPOINT,
        "rows": rows,
    }


def _row_keys(rows, candidates, aliases):
    """Exact reviewed aliases, then the existing unambiguous short-name rule."""
    mapped, free = {}, set(candidates)
    for row in rows:
        normalized = norm_team(row["team"])
        key = "usa.1::" + aliases.get(("usa.1", normalized), normalized)
        if key in free:
            mapped[row["team_id"]] = key
            free.remove(key)
    unresolved = [r for r in rows if r["team_id"] not in mapped]
    for key in sorted(free):
        tokens = set(key.split("::", 1)[1].split())
        hits = [
            r
            for r in unresolved
            if tokens and tokens < set(norm_team(r["team"]).split())
        ]
        _require(len(hits) == 1, "unresolved/ambiguous standings identity")
        row = hits[0]
        mapped[row["team_id"]] = key
        unresolved.remove(row)
    _require(
        not unresolved and len(mapped) == len(candidates),
        "standings/result participant mismatch",
    )
    return mapped


def completed_mls(
    *, season, played, schedule, standings, aliases, schedule_verified_at, groups, now
):
    """Publish observations only after a one-to-one schedule/result proof.

    `played` has already passed the existing non-participant filter. Every
    retained match must be positively regular-season; playoffs cannot add
    points. Dates may differ by one day because MLS uses local fixture days.
    """
    _require(season in FORMATS, "unreviewed MLS season format")
    fmt = FORMATS[season]
    _require(now.tzinfo is not None, "generation clock has no timezone")
    _require(
        isinstance(standings, dict)
        and standings.get("competition_id") == "usa.1"
        and type(standings.get("season")) is int
        and standings.get("season") == season
        and type(standings.get("season_type")) is int
        and standings.get("season_type") == 1
        and standings.get("source_url") == ENDPOINT,
        "missing current regular-season standings",
    )
    observed = _stamp(standings.get("observed_at"))
    _require(
        fmt["end"] < observed.date() <= now.date() and observed <= now,
        "completion observation timing",
    )
    verified = _stamp(schedule_verified_at)
    _require(verified <= now, "future schedule verification")
    rows = standings.get("rows")
    _require(
        isinstance(rows, list) and len(rows) == fmt["teams"], "missing standings rows"
    )
    # Revalidate retained evidence rather than trusting a serialized flag.
    reconstructed = []
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
    _require(isinstance(groups, list) and len(groups) == 2, "conference config")
    for group in groups:
        _require(
            isinstance(group, dict)
            and group.get("name") in GROUPS
            and group.get("short") == group["name"].split()[0]
            and type(group.get("teams")) is int
            and group.get("teams") == fmt["teams"] // 2
            and type(group.get("qualify")) is int
            and group["qualify"] == fmt["qualify"],
            "conference cut",
        )
        members = [
            r for r in rows if isinstance(r, dict) and r.get("group") == group["name"]
        ]
        reconstructed.append(
            {
                "name": group["name"],
                "season": season,
                "season_type": 1,
                "source_url": ENDPOINT,
                "observed_at": observed.isoformat(),
                "entries": [
                    {
                        "team": {"id": r.get("team_id"), "displayName": r.get("team")},
                        "stats": [
                            {"name": field, "value": r.get(key)}
                            for key, field in fields.items()
                        ],
                    }
                    for r in members
                ],
            }
        )
    rows = standings_observation(reconstructed, season)["rows"]
    _require(
        all(r["played"] == fmt["games"] for r in rows),
        "regular season still in progress",
    )
    expected = fmt["teams"] * fmt["games"] // 2
    _require(
        len(played) == expected and len(schedule) == expected,
        "incomplete regular-season result/schedule ledger",
    )
    candidates = {m[k] for m in played for k in ("home_key", "away_key")}
    _require(len(candidates) == fmt["teams"], "regular-season participants")
    mapped = _row_keys(rows, candidates, aliases)
    official = {mapped[r["team_id"]]: r for r in rows}
    totals = {key: Counter() for key in candidates}
    results, seen_ids, seen_games = defaultdict(list), set(), set()
    through = date.min
    latest_kickoff = datetime.min.replace(tzinfo=timezone.utc)
    for match in played:
        _require(
            match.get("competition_id") == "usa.1"
            and match.get("season") == season
            and match.get("phase") == "regular-season",
            "result season/phase mismatch",
        )
        mid = match.get("match_uid")
        _require(
            isinstance(mid, str) and mid and mid not in seen_ids,
            "duplicate/missing result identity",
        )
        seen_ids.add(mid)
        day = match.get("local_date")
        _require(
            type(day) is date and day.year == season and day <= observed.date(),
            "result observation timing",
        )
        kickoff = _stamp(match.get("kickoff_at"))
        _require(
            kickoff <= observed
            and kickoff <= now
            and 0 <= (kickoff.date() - day).days <= 1,
            "result kickoff after observation",
        )
        latest_kickoff = max(latest_kickoff, kickoff)
        through = max(through, day)
        h, a = match["home_key"], match["away_key"]
        _require(h != a, "self fixture")
        identity = (h, a, day)
        _require(identity not in seen_games, "duplicate result fixture")
        seen_games.add(identity)
        results[(h, a)].append(match)
        hg, ag = (_integer(match.get(k)) for k in ("home_score", "away_score"))
        for key, gf, ga in ((h, hg, ag), (a, ag, hg)):
            totals[key].update(
                played=1,
                wins=int(gf > ga),
                draws=int(gf == ga),
                losses=int(gf < ga),
                points=3 if gf > ga else int(gf == ga),
                gf=gf,
                ga=ga,
                gd=gf - ga,
            )
    scheduled_ids, scheduled_games = set(), set()
    unmatched = []
    for fixture in schedule:
        row_id = fixture.get("row_key")
        _require(
            isinstance(row_id, str) and row_id and row_id not in scheduled_ids,
            "duplicate/missing schedule identity",
        )
        scheduled_ids.add(row_id)
        _require(
            fixture.get("competition_id") == "usa.1"
            and fixture.get("season") == season
            and fixture.get("round") in (None, "", "Regular Season"),
            "schedule season/phase mismatch",
        )
        day, h, a = fixture["local_date"], fixture["home_key"], fixture["away_key"]
        _require(
            type(day) is date
            and day.year == season
            and day <= fmt["end"]
            and h in candidates
            and a in candidates
            and h != a,
            "invalid regular-season schedule fixture",
        )
        identity = (h, a, day)
        _require(identity not in scheduled_games, "duplicate schedule fixture")
        scheduled_games.add(identity)
        unmatched.append(fixture)
    # Exhaust exact matches before timezone tolerance. An early stale row
    # must never consume a later exact identity, regardless of input order.
    for tolerance in (0, 1):
        remaining = []
        for fixture in unmatched:
            pair = fixture["home_key"], fixture["away_key"]
            hits = [
                m
                for m in results.get(pair, [])
                if (m["local_date"] - fixture["local_date"]).days == tolerance
            ]
            _require(len(hits) <= 1, "ambiguous dated regular-season fixture")
            if hits:
                results[pair].remove(hits[0])
            else:
                remaining.append(fixture)
        unmatched = remaining
    pending = defaultdict(list)
    for fixture in unmatched:
        pending[(fixture["home_key"], fixture["away_key"])].append(fixture)
    date_discrepancies = []
    for pair in sorted(pending):
        fixtures = pending[pair]
        matches = results[pair]
        _require(
            len(fixtures) == len(matches) == 1,
            "unreconciled/ambiguous regular-season fixture",
        )
        fixture, match = fixtures[0], matches.pop()
        # Counts and all club totals below must agree too. This establishes
        # one-to-one identity, not that a particular postponement happened.
        # Keep both dates and the retained calendar's verification timestamp.
        date_discrepancies.append(
            {
                "schedule_row_key": fixture["row_key"],
                "scheduled_date": fixture["local_date"].isoformat(),
                "canonical_result_uid": match["match_uid"],
                "result_date": match["local_date"].isoformat(),
                "home_key": pair[0],
                "away_key": pair[1],
                "match_method": "unique_remaining_home_away_pair",
            }
        )
    _require(not any(results.values()), "unmatched regular-season result")
    _require(
        fmt["end"] <= through <= fmt["end"] + timedelta(days=1),
        "regular-season endpoint mismatch",
    )
    _require(
        fmt["end"] <= latest_kickoff.date() <= fmt["end"] + timedelta(days=1),
        "regular-season kickoff endpoint mismatch",
    )
    for key, row in official.items():
        _require(
            all(totals[key][field] == row[field] for field in totals[key]),
            "standings/result totals disagree",
        )
        _require(totals[key]["played"] == fmt["games"], "missing club fixture")
    observed_rows = []
    for group in groups:
        members = sorted(
            (r for r in rows if r["group"] == group["name"]),
            key=lambda r: r["position"],
        )
        order = [(r["points"], r["wins"], r["gd"], r["gf"]) for r in members]
        _require(
            order == sorted(order, reverse=True), "inconsistent authoritative ranks"
        )
        observed_rows.extend(
            {**r, "qualified": r["position"] <= group["qualify"]} for r in members
        )
    return {
        "competition_id": "usa.1",
        "name": "Major League Soccer",
        "country": "United States",
        "season": season,
        "state": STATE,
        "fixtures_remaining": 0,
        "teams": fmt["teams"],
        "table": [],
        "observed_table": observed_rows,
        "groups": groups,
        "relegation_places": 0,
        "schedule_completeness": None,
        "observation": {
            "source": "espn",
            "scope": "regular-season",
            "season_type": 1,
            "observed_at": observed.isoformat(),
            "proof_checked_at": now.isoformat(),
            "latest_result_kickoff_at": latest_kickoff.isoformat(),
            "results_through": through.isoformat(),
            "matches_reconciled": expected,
            "schedule_fixtures": len(schedule),
            "schedule_last_verified_at": schedule_verified_at,
            "date_discrepancies": date_discrepancies,
            "endpoint": ENDPOINT,
        },
    }
