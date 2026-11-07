"""A conservative, inspectable record of the final *verified* pre-event pick.

The legacy aggregate's synthetic noon and string comparisons are not evidence
of a kickoff. Join every saved snapshot to a unique warehouse event FIRST,
then select the last aware generated_at strictly before its authoritative UTC
kickoff. Historical/backfilled forecasts never enter the prospective numerator.
This module reads inputs only; it neither trains nor rewrites the ledger.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import sqlite3
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from backend.services.forecast.evaluate import club_vocabulary

SELECTION = "last_before_authoritative_kickoff"
OUTCOMES = ("H", "D", "A")
REGULATION = "regulation"


def declared_period(value: Any) -> str | None:
    return value if value in (REGULATION, "including_extra_time") else None


def score_forecast(chosen: dict, peers: list[dict]) -> tuple[dict | None, str]:
    """Keep the selected stored score; never round lambdas or fall back earlier."""
    signatures = {
        (
            type(s.get("top_scoreline")).__name__,
            repr(s.get("top_scoreline")),
            repr(s.get("scoreline_period")),
        )
        for s in peers
    }
    if len(signatures) > 1:
        return None, "ambiguous"
    raw = chosen.get("top_scoreline")
    if raw is None or raw == "":
        return None, "missing"
    if not isinstance(raw, str) or not re.fullmatch(r"[0-9]+-[0-9]+", raw):
        return None, "invalid"
    if any(len(part) > 16 for part in raw.split("-")):
        return None, "invalid"
    home, away = map(int, raw.split("-"))
    if max(home, away) > 2**53 - 1:
        return None, "invalid"
    return {"home": home, "away": away}, "recorded"


WAREHOUSE = Path(__file__).resolve().parents[2] / "data/warehouse.sqlite"


def instant(value: Any) -> datetime | None:
    """Never assign a timezone or a clock time to an unknown timestamp."""
    if not isinstance(value, str) or "T" not in value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            return None
        return parsed.astimezone(timezone.utc)
    except ValueError:
        return None


def day(value: Any) -> date | None:
    try:
        return date.fromisoformat(value) if isinstance(value, str) else None
    except ValueError:
        return None


def iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def probabilities(row: dict) -> list[float] | None:
    raw = [row.get("p_home"), row.get("p_draw"), row.get("p_away")]
    if any(
        isinstance(p, bool)
        or not isinstance(p, (int, float))
        or not math.isfinite(p)
        or not 0 <= p <= 1
        for p in raw
    ):
        return None
    total = sum(raw)
    if abs(total - 1) > 0.001:
        return None
    return [p / total for p in raw]


def regulation_receipt(event: dict, as_of: datetime) -> dict | None:
    """Validate retained original evidence, not a warehouse's normalized clock.

    This consumer never opens a provider client or refreshes a receipt. A reader
    must supply digest/invalidation/expiry validation for this exact audit clock.
    Existing warehouse rows have no such evidence and remain unscored. Only
    completed two-half full-time receipts are supported; extra-time/shootout
    scores and unvalidated period line scores are deliberately withheld.
    """
    try:
        receipt = event.get("regulation_receipt")
        if isinstance(receipt, str):
            receipt = json.loads(receipt)
        if not isinstance(receipt, dict):
            return None
        if (
            receipt.get("provider") != "espn"
            or receipt.get("competition_id") != event["competition_id"]
            or receipt.get("invalidated") is not False
            or receipt.get("expired") is not False
            or instant(receipt.get("validated_at")) != as_of
        ):
            return None
        eid = receipt["event_id"]
        aliases = event.get("aliases", [])
        if not any(
            a.get("event_id") == eid
            and a.get("provider") == "espn"
            and a.get("competition_id") == event["competition_id"]
            and a.get("match_id") == event["match_id"]
            for a in aliases
        ):
            return None
        body = receipt["body"]
        if not isinstance(body, str):
            return None
        digest = hashlib.sha256(body.encode("utf-8")).hexdigest()
        if digest != receipt["digest"]:
            return None
        data = json.loads(body)
        leagues = data.get("leagues")
        if (
            not isinstance(leagues, list)
            or len(leagues) != 1
            or leagues[0].get("slug") != event["competition_id"]
        ):
            return None
        if not isinstance(data.get("events"), list) or len(data["events"]) >= 1000:
            return None
        found = [
            e for e in data["events"] if isinstance(e, dict) and str(e.get("id")) == eid
        ]
        if len(found) != 1 or len(found[0]["competitions"]) != 1:
            return None
        raw = found[0]
        comp = raw["competitions"][0]
        regulation_periods = comp["format"]["regulation"]["periods"]
        if (
            str(comp["id"]) != eid
            or comp.get("timeValid") is not True
            or type(regulation_periods) is not int
            or regulation_periods != 2
        ):
            return None
        kickoff = instant(raw.get("date"))
        observed = instant(receipt.get("observed_at"))
        if (
            kickoff is None
            or observed is None
            or kickoff >= observed
            or observed > as_of
            or instant(comp.get("date")) != kickoff
            or instant(event.get("date_utc")) != kickoff
        ):
            return None
        for status in (raw["status"], comp["status"]):
            clock = status.get("clock")
            if (
                status["type"].get("completed") is not True
                or status["type"].get("state") != "post"
                or status["type"].get("name") != "STATUS_FULL_TIME"
                or type(status.get("period")) is not int
                or status["period"] != 2
                or isinstance(clock, bool)
                or not isinstance(clock, (int, float))
                or not math.isfinite(clock)
                or clock != 5400
            ):
                return None
        sides = comp["competitors"]
        if (
            not isinstance(sides, list)
            or len(sides) != 2
            or {s["homeAway"] for s in sides} != {"home", "away"}
            or len({str(s["team"]["id"]) for s in sides}) != 2
            or any(
                not re.fullmatch(r"[1-9][0-9]*", str(s["team"]["id"])) for s in sides
            )
        ):
            return None
        scores = {}
        for side in sides:
            score = side["score"]
            if not (
                type(score) is int
                and score >= 0
                or isinstance(score, str)
                and re.fullmatch(r"[0-9]+", score)
            ):
                return None
            scores[side["homeAway"]] = int(score)
        if (scores["home"], scores["away"]) != (
            event["home_score"],
            event["away_score"],
        ):
            return None  # Do not resolve contradictory or differently scoped scores by preference.
        return {
            "provider": "espn",
            "competitionId": event["competition_id"],
            "eventId": eid,
            "receiptSha256": digest,
            "observedAt": iso(observed),
            "period": REGULATION,
        }
    except (KeyError, TypeError, ValueError, AttributeError, OverflowError):
        return None


def event_proof(
    event: dict, as_of: datetime
) -> tuple[str, str, datetime | None, dict | None]:
    kickoff = instant(event.get("date_utc"))
    fetched = instant(event.get("fetched_at"))
    aliases = event.get("aliases", [])
    observations = [instant(a.get("observed_at")) for a in aliases]
    ids = {a.get("event_id") for a in aliases}
    if (
        event.get("source") != "espn"
        or len(ids) != 1
        or not aliases
        or any(
            not isinstance(i, str) or not re.fullmatch(r"[1-9][0-9]*", i) for i in ids
        )
        or any(
            a.get("provider") != "espn"
            or a.get("competition_id") != event.get("competition_id")
            or a.get("match_id") != event.get("match_id")
            for a in aliases
        )
    ):
        return (
            "unverified",
            "Event time has no unique verified provider identity",
            None,
            None,
        )
    if kickoff is None or fetched is None or any(t is None for t in observations):
        return (
            "unverified",
            "Event or observation timestamp is missing or has no timezone",
            None,
            None,
        )
    observed = max([fetched, *observations])
    if observed > as_of:
        return "unverified", "Event observation is after the audit cutoff", None, None
    goals = [event.get("home_score"), event.get("away_score")]
    if goals == [None, None]:
        return "pending", "Awaiting a verified regulation-time result", None, None
    if any(
        isinstance(g, bool) or not isinstance(g, int) or not 0 <= g <= 2**53 - 1
        for g in goals
    ):
        return "unverified", "Final score is missing or invalid", None, None
    if kickoff >= as_of or min([fetched, *observations]) < kickoff:
        return (
            "unverified",
            "Result was not verified after the actual kickoff",
            None,
            None,
        )
    evidence = regulation_receipt(event, as_of)
    if evidence is None:
        return (
            "unverified",
            "Regulation-time result receipt is missing or invalid",
            None,
            None,
        )
    return "scored", "", instant(evidence["observedAt"]), evidence


def build_record(
    snapshots: Iterable[dict], events: list[dict], vocabulary: dict, *, as_of: str
) -> dict:
    """One row per real event, using the existing last-before-kickoff rule.

    A same-time conflicting final forecast, ambiguous event identity, unknown
    time, or unverifiable training cutoff is withheld, not replaced by a more
    convenient earlier forecast. Only harmless identical duplicates collapse.
    """
    now = instant(as_of)
    if now is None:
        raise ValueError("Audit cutoff must include a real timezone-aware time")
    from backend.scripts.build_canonical import norm_team

    snapshots = list(snapshots)
    index: dict[tuple, list[dict]] = defaultdict(list)
    provider_events: dict[tuple, set[str]] = defaultdict(set)
    for event in events:
        index[
            (
                event["competition_id"],
                event["season"],
                event["home_team_id"],
                event["away_team_id"],
            )
        ].append(event)
        for alias in event.get("aliases", []):
            provider_events[(alias.get("provider"), alias.get("event_id"))].add(
                str(event["match_id"])
            )
    duplicate_events = {
        key for keys in provider_events.values() if len(keys) > 1 for key in keys
    }
    groups: dict[str, list[dict]] = defaultdict(list)
    unmatched: dict[str, list[dict]] = defaultdict(list)
    matched: dict[str, dict] = {}
    ambiguous_events: set[str] = set()
    snapshot_dates = []
    scopes = set()
    for row in snapshots:
        stamp = instant(row.get("generated_at"))
        if stamp and stamp <= now:
            snapshot_dates.append(stamp)
        comp, season = row.get("competition_id"), row.get("season")
        scopes.add((comp, season))
        vocab, fallback = vocabulary.get(comp, {}), vocabulary.get("*", {})
        hn, an = norm_team(str(row.get("home_team", ""))), norm_team(
            str(row.get("away_team", ""))
        )
        hid, aid = vocab.get(hn, fallback.get(hn)), vocab.get(an, fallback.get(an))
        nominal_day = day(str(row.get("kickoff_at", ""))[:10])
        candidates = []
        if hid is not None and aid is not None and hid != aid and nominal_day:
            for event in index.get((comp, season, hid, aid), []):
                event_day = day(str(event.get("date_utc", ""))[:10])
                if event_day and abs((event_day - nominal_day).days) <= 1:
                    candidates.append(event)
        if len(candidates) != 1:
            ambiguous_events.update(str(e["match_id"]) for e in candidates)
            unmatched[str(row.get("fixture_uid", ""))].append(row)
            continue
        event = candidates[0]
        key = str(event["match_id"])
        groups[key].append(row)
        matched[key] = event

    def public_row(key: str, candidates: list[dict], event: dict | None) -> dict:
        known = [
            s
            for s in candidates
            if instant(s.get("generated_at")) and instant(s["generated_at"]) <= now
        ]
        known.sort(
            key=lambda s: (instant(s["generated_at"]), str(s.get("model_version", "")))
        )
        chosen = known[-1] if known else candidates[0]
        kickoff = instant(event.get("date_utc")) if event else None
        status, reason, settled_at, result_evidence = (
            event_proof(event, now)
            if event
            else ("unverified", "No unique authoritative event match", None, None)
        )
        result_status = status
        if key in ambiguous_events:
            status, reason = (
                "unverified",
                "A saved forecast has ambiguous event identity",
            )
        if event and kickoff:
            pre = [s for s in known if instant(s["generated_at"]) < kickoff]
            if pre:
                last = max(instant(s["generated_at"]) for s in pre)
                finals = [s for s in pre if instant(s["generated_at"]) == last]
                # A model version is part of the immutable forecast identity.
                signatures = {
                    str(
                        (
                            s.get("model_version"),
                            probabilities(s),
                            s.get("trained_through"),
                            s.get("outcome_period"),
                        )
                    )
                    for s in finals
                }
                chosen = finals[-1]
                if len(signatures) != 1:
                    status, reason = (
                        "unverified",
                        "Conflicting final forecasts at the same time",
                    )
            elif known and status != "unverified":
                status, reason = (
                    "retrospective",
                    "Forecast was recorded at or after the actual kickoff",
                )
            elif not known:
                status, reason = (
                    "unverified",
                    "No timestamped forecast was known by the audit cutoff",
                )
        made = instant(chosen.get("generated_at"))
        trained = day(chosen.get("trained_through"))
        p = probabilities(chosen)
        forecast_period = declared_period(chosen.get("outcome_period"))
        scoreline_period = declared_period(chosen.get("scoreline_period"))
        peers = [
            s
            for s in candidates
            if instant(s.get("generated_at")) == made
            and s.get("model_version") == chosen.get("model_version")
        ]
        stored_score, stored_score_status = score_forecast(chosen, peers)
        if any(instant(s.get("generated_at")) is None for s in candidates):
            status, reason = "unverified", "A saved forecast has an unknown timestamp"
        if status in ("scored", "pending") and (
            made is None or kickoff is None or not made < kickoff or made > now
        ):
            status, reason = (
                "unverified",
                "Pre-event forecast timing is not established",
            )
        if status in ("scored", "pending") and (
            trained is None or trained >= made.date() or trained >= kickoff.date()
        ):
            status, reason = (
                "unverified",
                "Training cutoff is missing or not strictly before the forecast day",
            )
        version = chosen.get("model_version")
        if p is None or not isinstance(version, str) or not version.strip():
            status, reason = (
                "unverified",
                "Forecast probabilities or model version are invalid",
            )
        if event and key in duplicate_events:
            status, reason = (
                "unverified",
                "Provider event identity is shared by multiple warehouse games",
            )
        if status in ("scored", "pending") and forecast_period != REGULATION:
            status, reason = (
                "unverified",
                "Forecast outcome period is not verified regulation time",
            )
        actual = None
        # Forecast eligibility and result availability are different facts.
        # A retrospective or unverified forecast can still show what really
        # happened, without entering any accuracy numerator or denominator.
        if (
            result_status == "scored"
            and key not in duplicate_events
            and key not in ambiguous_events
        ):
            hs, aws = event["home_score"], event["away_score"]
            actual = {
                "home": hs,
                "away": aws,
                "outcome": "H" if hs > aws else "D" if hs == aws else "A",
            }
        nominal = day(str(chosen.get("kickoff_at", ""))[:10])
        return {
            "key": key,
            "fixtureUid": chosen.get("fixture_uid"),
            "competitionId": chosen.get("competition_id"),
            "season": chosen.get("season"),
            "phase": event.get("phase") if event else None,
            "date": (
                kickoff.date().isoformat()
                if kickoff
                else nominal.isoformat() if nominal else None
            ),
            "kickoffAt": iso(kickoff),
            "home": chosen.get("home_team"),
            "away": chosen.get("away_team"),
            "generatedAt": iso(made),
            "trainedThrough": trained.isoformat() if trained else None,
            "modelVersion": (
                version if isinstance(version, str) and version.strip() else None
            ),
            "probabilities": p,
            "forecastPeriod": forecast_period,
            "scorelinePeriod": scoreline_period,
            "scoreForecast": stored_score,
            "scoreForecastStatus": stored_score_status,
            "resultPeriod": REGULATION if actual is not None else None,
            "resultEvidence": result_evidence if actual is not None else None,
            "actual": actual,
            "settledAt": iso(settled_at) if actual is not None else None,
            "status": status,
            "reason": reason,
            "pick": OUTCOMES[max(range(3), key=lambda i: p[i])] if p else None,
        }

    rows = [
        public_row(key, candidates, matched[key]) for key, candidates in groups.items()
    ]
    rows += [
        public_row("unverified:" + key, candidates, None)
        for key, candidates in unmatched.items()
    ]
    # Coverage is over retained known events in ledger scopes since the ledger
    # began, not an invented denominator of every football match in the world.
    start = min(snapshot_dates).date() if snapshot_dates else now.date()
    for event in events:
        kickoff = instant(event.get("date_utc"))
        if (
            str(event["match_id"]) in groups
            or (event["competition_id"], event["season"]) not in scopes
        ):
            continue
        if kickoff is None or not start <= kickoff.date() <= now.date():
            continue
        status, _, observed, evidence = event_proof(event, now)
        rows.append(
            {
                "key": "missing:" + str(event["match_id"]),
                "fixtureUid": None,
                "competitionId": event["competition_id"],
                "season": event["season"],
                "phase": event.get("phase"),
                "date": kickoff.date().isoformat(),
                "kickoffAt": iso(kickoff),
                "home": event["home_team"],
                "away": event["away_team"],
                "generatedAt": None,
                "trainedThrough": None,
                "modelVersion": None,
                "probabilities": None,
                "forecastPeriod": None,
                "scorelinePeriod": None,
                "scoreForecast": None,
                "scoreForecastStatus": "missing",
                "resultPeriod": REGULATION if status == "scored" else None,
                "resultEvidence": evidence if status == "scored" else None,
                "actual": (
                    {
                        "home": event["home_score"],
                        "away": event["away_score"],
                        "outcome": (
                            "H"
                            if event["home_score"] > event["away_score"]
                            else (
                                "D"
                                if event["home_score"] == event["away_score"]
                                else "A"
                            )
                        ),
                    }
                    if status == "scored"
                    else None
                ),
                "settledAt": iso(observed) if status == "scored" else None,
                "status": "missing",
                "reason": "No saved forecast matched this known game",
                "pick": None,
            }
        )
    rows.sort(key=lambda r: (r["date"] or "", r["key"]))
    if len({r["key"] for r in rows}) != len(rows):
        raise ValueError("Duplicate event identity in track record")
    return {
        "schemaVersion": 2,
        "outcomePeriod": REGULATION,
        "cohort": "immutable_snapshot_history",
        "basis": "verified_live_published",
        "selection": SELECTION,
        "generatedAt": iso(now),
        "historyThrough": iso(max(snapshot_dates)) if snapshot_dates else None,
        "resultThrough": max(
            (r["settledAt"] for r in rows if r["status"] == "scored"), default=None
        ),
        "coverageFrom": start.isoformat(),
        "snapshotRows": len(snapshots),
        "snapshotFixtures": len({s.get("fixture_uid") for s in snapshots}),
        "rows": rows,
    }


def from_database(
    database: Path, *, as_of: str, snapshots: list[dict] | None = None
) -> dict:
    """No CREATE/UPDATE/DELETE, even on a missing file. Never open SnapshotStore.

    Reuse the canonical club vocabulary and ledger, with a stricter temporal
    result join. The source database and exported history remain unchanged.
    """
    with sqlite3.connect(f"file:{database}?mode=ro", uri=True) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA query_only=ON")
        conn.execute("BEGIN")
        vocabulary = club_vocabulary(conn, database)
        if snapshots is None:
            snapshots = [
                dict(r) for r in conn.execute("SELECT * FROM prediction_snapshots")
            ]
        names = {
            r["team_id"]: r["canonical_name"]
            for r in conn.execute("SELECT team_id, canonical_name FROM teams")
        }
        aliases: dict[str, list[dict]] = defaultdict(list)
        try:
            for a in conn.execute(
                "SELECT * FROM provider_match_ids WHERE provider='espn'"
            ):
                aliases[a["match_id"]].append(dict(a))
        except sqlite3.OperationalError:
            pass  # Old sources are explicitly unverified, never defaulted valid.
        events = []
        for raw in conn.execute("SELECT * FROM matches"):
            event = dict(raw)
            event["aliases"] = [
                a
                for a in aliases[event["match_id"]]
                if a["competition_id"] == event["competition_id"]
            ]
            event["home_team"] = names.get(event["home_team_id"], "")
            event["away_team"] = names.get(event["away_team_id"], "")
            events.append(event)
    return build_record(snapshots, events, vocabulary, as_of=as_of)
