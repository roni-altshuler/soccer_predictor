"""The event corpus has to survive a warehouse republish.

`match_events` and `match_event_coverage` cost one verified ESPN request per
match and accumulate over months. They live in `warehouse.sqlite`, a single
release asset that four scheduled jobs download, modify and re-upload with no
merge — a lost update waiting to happen. On 2026-08-09 it happened: a job that
had downloaded the warehouse before that day's backfill re-uploaded it
afterwards, and 3,140 verified timelines stopped existing.

These tests pin the property that makes the corpus recoverable: a round trip
through the published export adds and never removes, in either direction and
in any order.
"""
from __future__ import annotations

import sqlite3

import pytest

from backend.scripts.sync_events import export, restore

SCHEMA = """
CREATE TABLE match_events(
    match_id TEXT, seq INTEGER, event_type TEXT, minute INTEGER,
    added_time INTEGER, team_side TEXT, player TEXT, source TEXT,
    PRIMARY KEY (match_id, seq, source));
CREATE TABLE match_event_coverage(
    match_id TEXT, source TEXT, events INTEGER, verified_at TEXT,
    PRIMARY KEY (match_id, source));
"""


def _warehouse(path, matches=()):
    conn = sqlite3.connect(path)
    conn.executescript(SCHEMA)
    for i in matches:
        conn.execute("INSERT INTO match_event_coverage VALUES (?,?,?,?)",
                     (f"m{i}", "espn", 2, "2026-08-13T00:00:00Z"))
        for seq, kind in enumerate(("goal", "red_card")):
            conn.execute("INSERT INTO match_events VALUES (?,?,?,?,?,?,?,?)",
                         (f"m{i}", seq, kind, 10 + seq, 0, "home",
                          f"player{i}", "espn"))
    conn.commit()
    conn.close()
    return path


def _covered(path):
    conn = sqlite3.connect(path)
    n = conn.execute("SELECT COUNT(*) FROM match_event_coverage").fetchone()[0]
    conn.close()
    return n


def test_a_round_trip_preserves_the_corpus(tmp_path):
    src = _warehouse(tmp_path / "src.sqlite", range(20))
    dump = tmp_path / "events.csv.gz"
    export(dump, src)

    empty = _warehouse(tmp_path / "empty.sqlite")
    assert _covered(empty) == 0
    restore(dump, empty)
    assert _covered(empty) == 20


def test_restoring_an_older_export_never_deletes_newer_work(tmp_path):
    """The actual 2026-08-09 shape: a stale copy meets a fresher warehouse.

    The stale export must top up what is missing and leave the rest alone —
    which is what makes the order the four jobs happen to run in irrelevant.
    """
    stale = _warehouse(tmp_path / "stale.sqlite", range(10))
    dump = tmp_path / "stale.csv.gz"
    export(dump, stale)

    fresh = _warehouse(tmp_path / "fresh.sqlite", range(30))
    restore(dump, fresh)
    assert _covered(fresh) == 30, "a stale restore deleted verified timelines"


def test_a_restore_tops_up_a_warehouse_that_lost_history(tmp_path):
    """The recovery direction: the republished warehouse is the thin one."""
    full = _warehouse(tmp_path / "full.sqlite", range(30))
    dump = tmp_path / "full.csv.gz"
    export(dump, full)

    thin = _warehouse(tmp_path / "thin.sqlite", range(10))
    restored = restore(dump, thin)
    assert restored == 20
    assert _covered(thin) == 30


def test_importing_twice_changes_nothing(tmp_path):
    src = _warehouse(tmp_path / "src.sqlite", range(15))
    dump = tmp_path / "e.csv.gz"
    export(dump, src)
    target = _warehouse(tmp_path / "t.sqlite")
    restore(dump, target)
    assert restore(dump, target) == 0
    assert _covered(target) == 15


def test_a_missing_export_is_only_allowed_when_declared(tmp_path):
    target = _warehouse(tmp_path / "t.sqlite")
    assert restore(tmp_path / "nope.csv.gz", target, allow_missing=True) == 0
    with pytest.raises(SystemExit):
        restore(tmp_path / "nope.csv.gz", target)


def test_coverage_rows_survive_even_with_no_events(tmp_path):
    """A match verified as genuinely eventless is still a match not to refetch.

    Exporting only the timeline would restore the data and lose the memory of
    what work is already done, so the backfill would grind the same matches
    forever.
    """
    src = tmp_path / "src.sqlite"
    conn = sqlite3.connect(src)
    conn.executescript(SCHEMA)
    conn.execute("INSERT INTO match_event_coverage VALUES "
                 "('m1','espn',0,'2026-08-13T00:00:00Z')")
    conn.commit()
    conn.close()

    dump = tmp_path / "e.csv.gz"
    export(dump, src)
    target = _warehouse(tmp_path / "t.sqlite")
    restore(dump, target)
    assert _covered(target) == 1
