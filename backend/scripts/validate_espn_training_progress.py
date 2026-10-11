"""Validate an ESPN receipt checkpoint offline; it is never a training warehouse."""

import argparse
import asyncio
import hashlib
import json
import sqlite3
from contextlib import closing
from datetime import datetime
from pathlib import Path

from backend.services.data.espn_training_refresh import (
    TRAINING_RECEIPTS_PATH,
    TrainingSeasonRefresh,
)
from backend.services.data.provider_status import ProviderUnavailable, observation_time


async def validate(path, *, now=None):
    # Check before the refresh object can create missing tables. A warehouse or
    # wrong-schema database must never be uploaded under the checkpoint name.
    with closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)) as db:
        for kind, name, table, sql in db.execute(
            "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type!='table'"
        ):
            if (
                kind != "index"
                or table not in {"receipts", "invalidated", "calendars"}
                or name != f"sqlite_autoindex_{table}_1"
                or sql is not None
            ):
                raise ProviderUnavailable("unexpected receipt schema object")
        if db.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise ProviderUnavailable("receipt SQLite integrity failed")
        tables = {
            row[0]
            for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        if tables != {"receipts", "invalidated", "calendars"}:
            raise ProviderUnavailable("not a training receipt checkpoint")
        expected = {
            "receipts": (
                ["competition", "season", "day", "fetched_at", "body", "digest"],
                [1, 2, 3, 0, 0, 0],
            ),
            "invalidated": (["competition", "season", "day"], [1, 2, 3]),
            "calendars": (
                ["competition", "season", "fetched_at", "body", "digest"],
                [1, 2, 0, 0, 0],
            ),
        }
        for table, (columns, primary_key) in expected.items():
            info = db.execute(f"PRAGMA table_info({table})").fetchall()
            if [row[1] for row in info] != columns or [
                row[5] for row in info
            ] != primary_key:
                raise ProviderUnavailable("receipt schema/unique identity mismatch")
    refresh = TrainingSeasonRefresh(path, now=now)
    try:
        count = 0
        for comp, season, day, stamp, encoded, digest in refresh.db.execute(
            "SELECT * FROM receipts"
        ):
            if comp not in refresh.competition_keys or type(season) is not int:
                raise ProviderUnavailable("unknown receipt scope")
            fetched = observation_time(stamp)
            date = datetime.strptime(day, "%Y%m%d").date()
            if (
                fetched > refresh.now
                or date > refresh.now.date()
                or not any(
                    start.date() <= date <= end.date()
                    for start, end in refresh._windows(comp, season)
                )
                or hashlib.sha256(encoded.encode()).hexdigest() != digest
            ):
                raise ProviderUnavailable("receipt digest/date/clock mismatch")
            body = json.loads(encoded)
            refresh._calendar(body, comp, season)
            refresh._events(body, comp, season, day, observed_at=fetched)
            count += 1
        for comp, season, stamp, encoded, digest in refresh.db.execute(
            "SELECT * FROM calendars"
        ):
            if (
                comp not in refresh.competition_keys
                or type(season) is not int
                or observation_time(stamp) > refresh.now
                or hashlib.sha256(encoded.encode()).hexdigest() != digest
            ):
                raise ProviderUnavailable("calendar digest/scope/clock mismatch")
            body = json.loads(encoded)
            refresh._calendar(body, comp, season)
            start = min(start for start, _ in refresh._windows(comp, season))
            refresh._events(
                body,
                comp,
                season,
                start.strftime("%Y%m%d"),
                observed_at=observation_time(stamp),
            )
        missing = refresh.db.execute(
            "SELECT competition,season,day FROM invalidated "
            "EXCEPT SELECT competition,season,day FROM receipts"
        ).fetchone()
        if missing:
            raise ProviderUnavailable("invalidated receipt has no retained evidence")
        print(
            f"Validated {count} dated progress receipts; "
            "this does not certify full coverage or a warehouse."
        )
    finally:
        await refresh.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=TRAINING_RECEIPTS_PATH)
    args = parser.parse_args(argv)
    try:
        asyncio.run(validate(args.db))
        return 0
    except (
        ProviderUnavailable,
        sqlite3.Error,
        OSError,
        ValueError,
        TypeError,
        AttributeError,
    ) as exc:
        print(f"Checkpoint refused: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
