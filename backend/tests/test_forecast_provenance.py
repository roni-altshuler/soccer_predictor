"""Provenance guarantees, enforced rather than intended.

Each test here pins a property that the product's credibility rests on and
that nothing else would catch:

  append-only          a re-run must not rewrite what users were already shown
  final-before-kickoff the scored record is the last forecast published BEFORE
                       the match, never one stamped after it
  version identity     the same config hashes the same; a changed model does not
  validity             a stored probability is a probability

The failure mode these guard against is silent. A snapshot table that quietly
updates rows still answers every query — with the wrong answer, forever, and
with no way to notice.
"""
from __future__ import annotations

import pytest

from backend.services.forecast import version as mv
from backend.services.forecast.snapshots import (
    Snapshot,
    SnapshotStore,
    fixture_uid,
    snapshots_from_fixtures,
)


@pytest.fixture()
def store(tmp_path):
    with SnapshotStore(tmp_path / "w.sqlite") as s:
        yield s


def snap(**kw) -> Snapshot:
    """A valid snapshot, with p_home overridable.

    Overriding p_home alone rebalances draw/away in proportion, so a test that
    means "the forecast moved" does not accidentally become a test of the
    validator. Pass all three explicitly to build a deliberately invalid one.
    """
    base = dict(
        fixture_uid="abc123", generated_at="2026-08-20T06:00:00+00:00",
        model_version="2026.08.1+deadbeef", competition_id="eng.1", season=2026,
        kickoff_at="2026-08-21T19:00:00+00:00",
        home_team="Liverpool", away_team="Arsenal",
        p_home=0.42, p_draw=0.27, p_away=0.31,
        lambda_home=1.62, lambda_away=1.34,
    )
    if "p_home" in kw and "p_draw" not in kw and "p_away" not in kw:
        rest = 1.0 - float(kw["p_home"])
        share = base["p_draw"] / (base["p_draw"] + base["p_away"])
        base["p_draw"], base["p_away"] = rest * share, rest * (1 - share)
    base.update(kw)
    return Snapshot(**base)


# ------------------------------------------------------------- append-only
def test_a_rerun_does_not_rewrite_what_was_already_published(store):
    store.record([snap()])
    # Same fixture, same instant, same model, DIFFERENT probability — the sort
    # of thing a re-run with a changed input would produce.
    store.record([snap(p_home=0.99, p_draw=0.005, p_away=0.005)])

    rows = store.history("abc123")
    assert len(rows) == 1, "a duplicate key must be ignored, not upserted"
    assert rows[0]["p_home"] == pytest.approx(0.42), (
        "the originally published probability was overwritten — the whole "
        "point of this table is that it cannot be")


def test_a_later_run_appends_rather_than_replacing(store):
    store.record([snap()])
    store.record([snap(generated_at="2026-08-21T06:00:00+00:00", p_home=0.47)])

    rows = store.history("abc123")
    assert len(rows) == 2
    assert [r["p_home"] for r in rows] == [pytest.approx(0.42), pytest.approx(0.47)]


def test_a_new_model_version_is_a_new_row_not_an_overwrite(store):
    store.record([snap()])
    store.record([snap(model_version="2026.09.1+cafe0000", p_home=0.5,
                       p_draw=0.25, p_away=0.25)])
    assert len(store.history("abc123")) == 2


def test_the_module_never_issues_update_or_delete():
    """Convention is not a guarantee; this reads the source."""
    from pathlib import Path

    src = (Path(__file__).resolve().parent.parent / "services" / "forecast"
           / "snapshots.py").read_text().upper()
    for verb in ("UPDATE PREDICTION_SNAPSHOTS", "DELETE FROM PREDICTION_SNAPSHOTS",
                 "INSERT OR REPLACE"):
        assert verb not in src, f"snapshots.py contains {verb!r}"


# ------------------------------------------------- final before kickoff
def test_final_before_kickoff_picks_the_last_forecast_a_user_could_see(store):
    store.record([
        snap(generated_at="2026-08-14T06:00:00+00:00", p_home=0.40),
        snap(generated_at="2026-08-20T06:00:00+00:00", p_home=0.42),
        snap(generated_at="2026-08-21T14:00:00+00:00", p_home=0.45),
    ])
    rows = store.final_before_kickoff()
    assert len(rows) == 1
    assert rows[0]["p_home"] == pytest.approx(0.45)
    assert rows[0]["generated_at"] == "2026-08-21T14:00:00+00:00"


def test_a_snapshot_generated_after_kickoff_is_never_scored(store):
    """The one that would flatter the model. It is not a forecast."""
    store.record([
        snap(generated_at="2026-08-20T06:00:00+00:00", p_home=0.42),
        # Stamped after the match started — the job ran late, or a backfill.
        snap(generated_at="2026-08-21T22:00:00+00:00", p_home=0.95,
             p_draw=0.03, p_away=0.02),
    ])
    rows = store.final_before_kickoff()
    assert len(rows) == 1
    assert rows[0]["p_home"] == pytest.approx(0.42)


def test_a_fixture_with_only_post_kickoff_snapshots_is_excluded(store):
    store.record([snap(generated_at="2026-08-22T06:00:00+00:00")])
    assert store.final_before_kickoff() == []


def test_history_keeps_every_forecast_in_order(store):
    for i, p in enumerate((0.40, 0.42, 0.45)):
        store.record([snap(generated_at=f"2026-08-1{i}T06:00:00+00:00", p_home=p)])
    assert [r["p_home"] for r in store.history("abc123")] == [
        pytest.approx(0.40), pytest.approx(0.42), pytest.approx(0.45)]


# -------------------------------------------------------------- validity
@pytest.mark.parametrize("bad", [
    {"p_home": 0.5, "p_draw": 0.3, "p_away": 0.3},     # sums to 1.1
    {"p_home": 0.0, "p_draw": 0.5, "p_away": 0.5},     # a certainty
    {"p_home": -0.1, "p_draw": 0.6, "p_away": 0.5},    # negative
])
def test_an_invalid_probability_is_refused_at_the_door(store, bad):
    with pytest.raises(ValueError):
        store.record([snap(**bad)])
    assert store.history("abc123") == []


def test_an_implausible_goal_rate_is_refused(store):
    with pytest.raises(ValueError, match="plausible goal rate"):
        store.record([snap(lambda_home=40.0)])


# --------------------------------------------------------------- version
def test_the_same_configuration_hashes_the_same():
    kw = dict(head="logistic", features=["elo_", "form_"], leagues=["eng.1"],
              min_season=2000, sims=20000, strength_shock_sd=0.1305)
    assert mv.compute(**kw).id == mv.compute(**kw).id


def test_reordering_the_feature_list_is_not_a_model_change():
    a = mv.compute(head="logistic", features=["elo_", "form_"], leagues=["eng.1"],
                   min_season=2000, sims=20000, strength_shock_sd=0.1305)
    b = mv.compute(head="logistic", features=["form_", "elo_"], leagues=["eng.1"],
                   min_season=2000, sims=20000, strength_shock_sd=0.1305)
    assert a.id == b.id


@pytest.mark.parametrize("change", [
    {"features": ["elo_", "form_", "ref_"]},
    {"strength_shock_sd": 0.20},
    {"min_season": 2010},
    {"head": "lgbm"},
])
def test_changing_what_determines_a_forecast_changes_the_hash(change):
    """The guarantee that makes the release string safe to forget."""
    kw = dict(head="logistic", features=["elo_", "form_"], leagues=["eng.1"],
              min_season=2000, sims=20000, strength_shock_sd=0.1305)
    assert mv.compute(**kw).id != mv.compute(**{**kw, **change}).id


# ----------------------------------------------------------------- adapt
def test_fixture_uid_is_stable_and_survives_a_kickoff_time_correction():
    a = fixture_uid("eng.1", 2026, "2026-08-21", "Liverpool", "Arsenal")
    b = fixture_uid("eng.1", 2026, "2026-08-21T19:00", "liverpool", "ARSENAL")
    assert a == b, "a uid that moves with the clock forks a fixture's history"
    assert a != fixture_uid("eng.1", 2026, "2026-08-21", "Arsenal", "Liverpool")


def test_snapshots_are_built_from_the_same_dicts_the_api_serves():
    fixtures = [{
        "competition_id": "eng.1", "season": 2026, "date": "2026-08-21",
        "kickoff": "19:00", "home": "Liverpool", "away": "Arsenal",
        "p_home": 0.42, "p_draw": 0.27, "p_away": 0.31,
        "xg_home": 1.62, "xg_away": 1.34,
        "scorelines": [{"score": "1-1", "p": 0.121}],
        "elo_home": 1690.4, "elo_away": 1799.6,
    }]
    got = snapshots_from_fixtures(
        fixtures, generated_at="2026-08-20T06:00:00+00:00",
        model_version="2026.08.1+deadbeef", trained_through="2026-08-19")
    assert len(got) == 1
    s = got[0]
    s.validate()
    assert s.p_home == pytest.approx(0.42)
    assert s.lambda_home == pytest.approx(1.62)
    assert s.elo_away == pytest.approx(1799.6)
    assert s.top_scoreline == "1-1"
    assert s.kickoff_at.startswith("2026-08-21T19:00")


def test_stats_reports_what_is_stored(store):
    store.record([snap(), snap(fixture_uid="def456", home_team="Chelsea")])
    st = store.stats()
    assert st["rows"] == 2
    assert st["fixtures"] == 2
    assert st["by_version"] == {"2026.08.1+deadbeef": 2}


# --------------------------------------------------- surviving the container
#
# The scheduled job runs on a fresh container whose warehouse comes from a
# release asset that has no `prediction_snapshots`, and the export upload uses
# `--clobber`. Without an import step, every run replaces the whole published
# history with its own. The table would still be append-only and still answer
# every query — one run deep, forever. These pin the round trip that closes it.


def _roundtrip(tmp_path, source_store, *, into):
    from backend.scripts.export_snapshots import main as export
    from backend.scripts.import_snapshots import main as import_

    source_store.close()
    csv_path = tmp_path / "snaps.csv.gz"
    import backend.services.forecast.snapshots as snap_mod

    original = snap_mod.WAREHOUSE
    snap_mod.WAREHOUSE = source_store.path
    try:
        assert export(["--output", str(csv_path)]) == 0
    finally:
        snap_mod.WAREHOUSE = original
    assert import_(["--input", str(csv_path), "--database", str(into)]) == 0
    return csv_path


def test_a_fresh_container_restores_the_history_it_was_given(tmp_path, store):
    store.record([snap(), snap(fixture_uid="def456", home_team="Chelsea")])
    fresh = tmp_path / "fresh.sqlite"
    _roundtrip(tmp_path, store, into=fresh)

    with SnapshotStore(fresh) as s:
        assert s.stats()["rows"] == 2
        rows = s.connect().execute(
            "SELECT * FROM prediction_snapshots ORDER BY fixture_uid").fetchall()
    assert [r["home_team"] for r in rows] == ["Liverpool", "Chelsea"]
    assert rows[0]["p_home"] == pytest.approx(0.42)
    assert rows[0]["elo_home"] is None or isinstance(rows[0]["elo_home"], float)


def test_importing_the_same_history_twice_adds_nothing(tmp_path, store):
    store.record([snap()])
    fresh = tmp_path / "fresh.sqlite"
    csv_path = _roundtrip(tmp_path, store, into=fresh)

    from backend.scripts.import_snapshots import main as import_
    assert import_(["--input", str(csv_path), "--database", str(fresh)]) == 0
    with SnapshotStore(fresh) as s:
        assert s.stats()["rows"] == 1


def test_an_import_never_overwrites_a_row_that_is_already_there(tmp_path, store):
    """The published CSV must not be able to rewrite local history.

    Same primary key, different probability. `INSERT OR IGNORE` means the row
    already on disk wins — an import can only ever add.
    """
    fresh = tmp_path / "fresh.sqlite"
    with SnapshotStore(fresh) as s:
        s.record([snap(p_home=0.42)])
    store.record([snap(p_home=0.99)])
    _roundtrip(tmp_path, store, into=fresh)

    with SnapshotStore(fresh) as s:
        rows = s.connect().execute(
            "SELECT p_home FROM prediction_snapshots").fetchall()
    assert len(rows) == 1
    assert rows[0]["p_home"] == pytest.approx(0.42)


def test_a_truncated_export_is_refused_rather_than_half_imported(tmp_path):
    """A corrupted download must not write half a history and call it done."""
    import csv as _csv
    import gzip as _gzip

    from backend.scripts.import_snapshots import parse

    bad = tmp_path / "bad.csv.gz"
    with _gzip.open(bad, "wt", newline="") as fh:
        w = _csv.writer(fh)
        w.writerow(["fixture_uid", "generated_at", "model_version"])
        w.writerow(["abc", "2026-08-20T06:00:00+00:00", "v1"])
    with pytest.raises(ValueError, match="not a prediction snapshot export"):
        parse(bad)


def test_a_snapshot_with_impossible_probabilities_never_enters_the_record(tmp_path):
    import csv as _csv
    import gzip as _gzip

    from backend.scripts.import_snapshots import REQUIRED, parse

    bad = tmp_path / "bad.csv.gz"
    row = dict(zip(REQUIRED, ["abc", "2026-08-20T06:00:00+00:00", "v1", "eng.1",
                              "2026", "2026-08-21T19:00:00+00:00", "A", "B",
                              "0.9", "0.9", "0.9", "1.6", "1.4"]))
    with _gzip.open(bad, "wt", newline="") as fh:
        w = _csv.DictWriter(fh, fieldnames=list(REQUIRED))
        w.writeheader()
        w.writerow(row)
    with pytest.raises(ValueError, match="probabilities sum to"):
        parse(bad)


def test_a_missing_history_is_fine_on_the_first_ever_run(tmp_path):
    from backend.scripts.import_snapshots import main as import_
    assert import_(["--input", str(tmp_path / "nope.csv.gz"),
                    "--allow-missing",
                    "--database", str(tmp_path / "w.sqlite")]) == 0
    assert import_(["--input", str(tmp_path / "nope.csv.gz"),
                    "--database", str(tmp_path / "w.sqlite")]) == 1


# ------------------------------------------------------ the scraped kickoff
#
# FBref's schedule cell prints one kickoff in two timezones: "20:15 (22:15)".
# Concatenated onto a date that is `2026-08-14T20:15 (22:15)`, which is not a
# timestamp. It reached `kickoff_utc` on 67,704 canonical rows and rendered as
# the literal string "Invalid Date" on 709 of 2,346 published fixtures.


@pytest.mark.parametrize("raw,want", [
    ("20:15 (22:15)", "20:15"),
    ("20:15", "20:15"),
    ("9:05 (10:05)", "09:05"),
    ("  16:00  ", "16:00"),
    ("", None),
    (None, None),
    ("TBD", None),
    ("25:00", None),
    ("12:75", None),
])
def test_a_kickoff_printed_in_two_timezones_yields_one_time(raw, want):
    from backend.scripts.build_canonical import fbref_time
    assert fbref_time(raw) == want


def test_a_snapshot_kickoff_is_a_timestamp_something_can_be_compared_against():
    """`final_before_kickoff` compares generated_at against this string."""
    fixtures = [{
        "competition_id": "por.1", "season": 2026, "date": "2026-08-14",
        "kickoff": "20:15", "home": "Sporting CP", "away": "Vit. Guimarães",
        "p_home": 0.55, "p_draw": 0.25, "p_away": 0.20,
        "xg_home": 1.8, "xg_away": 1.0, "scorelines": [{"score": "2-1", "p": 0.1}],
    }]
    s = snapshots_from_fixtures(fixtures, generated_at="2026-08-14T07:30:00+00:00",
                                model_version="v1")[0]
    assert s.kickoff_at == "2026-08-14T20:15:00+00:00"
    assert s.generated_at < s.kickoff_at
