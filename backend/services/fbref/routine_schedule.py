"""Six existing current-season schedules, without the optional browser stack.

Uses URLs from the downloaded FBref database and the established schedule
parser. A denied page is a failed check, never a reason to bypass the provider
or retry faster. The original database is replaced only after all six pass.
"""
from __future__ import annotations

from collections import Counter
from datetime import date, datetime, timezone
import os
from pathlib import Path
import sqlite3
import tempfile
import time
from urllib.parse import urlsplit

import httpx

from backend.scripts.ingest_fbref_schedules import parse_schedule, schedule_url
from backend.services.fbref.client import FBrefClient, MIN_INTERVAL_SECONDS, unwrap_comments
from backend.services.prediction.historical_data import current_season
from bs4 import BeautifulSoup

SCOPE = {
    "eng.1": "England Premier League", "esp.1": "Spain La Liga",
    "ger.1": "Germany Bundesliga", "ita.1": "Italy Serie A",
    "fra.1": "France Ligue 1", "usa.1": "USA MLS",
}
MAX_REQUESTS = len(SCOPE)


class IncompleteSchedule(Exception):
    pass


def refresh(db_path: Path, *, now: datetime | None = None,
            transport: httpx.BaseTransport | None = None, sleep=time.sleep) -> dict:
    fixed_clock = now is not None
    now = now or datetime.now(timezone.utc)
    stamp = now.isoformat()
    report = {"schema_version": 1, "state": "degraded", "attempted_at": stamp,
              "requests": 0, "request_limit": MAX_REQUESTS, "leagues": [],
              "reason": "database_unavailable"}
    for comp, league in SCOPE.items():
        start = current_season("mls" if comp == "usa.1" else "premier_league", now)
        season = str(start) if comp == "usa.1" else f"{start}-{start + 1}"
        report["leagues"].append({"competition_id": comp, "season": season,
                                 "last_verified_at": None})
    try:
        # mode=ro prevents a missing input from silently creating an empty DB.
        with sqlite3.connect(db_path.resolve().as_uri() + "?mode=ro", uri=True) as source:
            source.row_factory = sqlite3.Row
            selected = []
            for row in report["leagues"]:
                meta = source.execute(
                    "SELECT * FROM fbref_seasons WHERE league=? AND season=?",
                    (SCOPE[row["competition_id"]], row["season"]),
                ).fetchone()
                if meta is None:
                    raise IncompleteSchedule("missing_current_schedule")
                row["last_verified_at"] = meta["scraped_at"]
                url = meta["schedule_url"] or schedule_url(meta["stats_url"])
                parsed = urlsplit(url)
                if (parsed.scheme != "https" or parsed.netloc != "fbref.com"
                        or not parsed.path.startswith("/en/comps/") or parsed.query or parsed.fragment):
                    raise IncompleteSchedule("invalid_schedule_url")
                selected.append((row, url))

            with tempfile.TemporaryDirectory(prefix="schedule-", dir=db_path.parent) as directory:
                candidate_path = Path(directory) / "fbref.sqlite"
                with sqlite3.connect(candidate_path) as candidate:
                    source.backup(candidate)
                    last_request = None
                    with httpx.Client(transport=transport, timeout=20, follow_redirects=False,
                                      headers={"User-Agent": "Pitchverse schedule check"}) as client:
                        for row, url in selected:
                            if last_request is not None:
                                sleep(max(0, MIN_INTERVAL_SECONDS - (time.monotonic() - last_request)))
                            last_request = time.monotonic()
                            report["requests"] += 1
                            response = client.get(url)
                            if response.status_code != 200:
                                raise IncompleteSchedule(f"http_{response.status_code}")
                            if FBrefClient().rejection(response.text):
                                raise IncompleteSchedule("provider_rejection")
                            league, season = SCOPE[row["competition_id"]], row["season"]
                            rows = parse_schedule(BeautifulSoup(unwrap_comments(response.text), "html.parser"),
                                                  league, season)
                            old = Counter((r[0], r[1]) for r in source.execute(
                                "SELECT home,away FROM fbref_fixtures WHERE league=? AND season=?",
                                (league, season),
                            ).fetchall())
                            pairs = Counter((r[8], r[9]) for r in rows)
                            if (not rows or len({r[2] for r in rows}) != len(rows)
                                    or any(r[8] == r[9] for r in rows) or old - pairs):
                                raise IncompleteSchedule("incomplete_schedule")
                            try:
                                for fixture in rows:
                                    kickoff = date.fromisoformat(fixture[4])
                                    kickoff_season = current_season(
                                        "mls" if row["competition_id"] == "usa.1" else "premier_league",
                                        datetime(kickoff.year, kickoff.month, kickoff.day))
                                    if kickoff_season != int(season[:4]):
                                        raise ValueError("wrong season")
                            except (ValueError, TypeError):
                                raise IncompleteSchedule("invalid_fixture_date") from None
                            # Full validated replacement removes superseded dates/row keys.
                            candidate.execute("DELETE FROM fbref_fixtures WHERE league=? AND season=?",
                                              (league, season))
                            candidate.executemany("INSERT INTO fbref_fixtures VALUES "
                                                  "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
                            candidate.execute("UPDATE fbref_seasons SET schedule_url=?,fixtures=?,"
                                              "scraped_at=?,error=NULL WHERE league=? AND season=?",
                                              (url, len(rows), stamp, league, season))
                    # Verification is stamped after the responses, never backdated
                    # to the start of a multi-page request sequence.
                    stamp = (now if fixed_clock else datetime.now(timezone.utc)).isoformat()
                    report["attempted_at"] = stamp
                    for row, _ in selected:
                        candidate.execute("UPDATE fbref_seasons SET scraped_at=? WHERE league=? AND season=?",
                                          (stamp, SCOPE[row["competition_id"]], row["season"]))
                    candidate.commit()
                # Candidate writes are closed; replace the downloaded copy atomically.
                os.replace(candidate_path, db_path)
        for row in report["leagues"]:
            row["last_verified_at"] = stamp
        report.update(state="checked", reason=None)
    except IncompleteSchedule as exc:
        report["reason"] = str(exc)
    except httpx.HTTPError:
        report["reason"] = "transport_unavailable"
    except (OSError, sqlite3.Error):
        report["reason"] = "database_unavailable"
    return report
