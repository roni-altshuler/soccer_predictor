"""Regression tests for the 2026-08-08 data-integrity fixes (PIVOT §4c).

Each defect these cover was found by hand-auditing a benchmark, not by any
automated check, and each silently corrupted training labels or evaluation
truth. The tests below build a small synthetic warehouse that reproduces
the defect, then assert both that the validator FAILS on it and that the
repair fixes it — a validator that cannot fail is not a guard.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from backend.scripts.repair_warehouse import (
    drop_non_participants,
    fix_dates,
    fix_season_labels,
)
from backend.scripts.validate_warehouse_integrity import IntegrityValidator
from backend.services.data.warehouse import MatchRow, Warehouse


@pytest.fixture()
def wh(tmp_path):
    warehouse = Warehouse(tmp_path / "test.sqlite")
    warehouse.migrate()
    warehouse.upsert_competition("eng.1", "Premier League", "M", country="GB", tier=1)
    warehouse.upsert_competition("ita.1", "Serie A", "M", country="IT", tier=1)
    yield warehouse
    warehouse.close()


def _team(wh: Warehouse, name: str) -> int:
    return wh.upsert_team(canonical_name=name, gender="M")


def _match(
    wh: Warehouse, match_id, comp, season, date_utc, home, away, *, source="espn", **kw
) -> None:
    wh.upsert_matches([
        MatchRow(
            match_id=match_id, source=source, competition_id=comp, season=season,
            date_utc=date_utc, home_team_id=home, away_team_id=away,
            home_score=kw.pop("home_score", 1), away_score=kw.pop("away_score", 0), **kw,
        )
    ])


def _full_season(wh: Warehouse, comp="eng.1", season=2020, n_teams=4, source="espn"):
    """A complete double round-robin so season-level checks have a baseline."""
    ids = [_team(wh, f"Club {i}") for i in range(n_teams)]
    day = 1
    for home in ids:
        for away in ids:
            if home == away:
                continue
            _match(
                wh, f"{source}_{comp}_{season}_{home}_{away}", comp, season,
                f"{season}-09-{day % 28 + 1:02d}T15:00:00+00:00", home, away, source=source,
            )
            day += 1
    return ids


def _check(wh: Warehouse, name: str):
    return next(r for r in IntegrityValidator(wh).run_all() if r.name == name)


# --------------------------------------------------------------------------
# 4. date_utc timezone shift
# --------------------------------------------------------------------------

class TestDateShift:
    def test_naive_football_data_date_is_anchored_to_utc(self):
        """The whole bug in one assertion: a naive date must not be read as
        host-local time. On an Asia/Jerusalem box `.astimezone(utc)` turned
        2026-03-04 into 2026-03-03T22:00Z."""
        from backend.services.data.footballdata_loader import _parse_fd_date

        parsed = _parse_fd_date("2026-03-04T00:00:00")
        assert parsed == datetime(2026, 3, 4, tzinfo=timezone.utc)
        assert parsed.strftime("%Y-%m-%d") == "2026-03-04"

    def test_aware_input_is_converted_not_reanchored(self):
        from backend.services.data.footballdata_loader import _parse_fd_date

        assert _parse_fd_date("2026-03-04T01:30:00+02:00") == datetime(
            2026, 3, 3, 23, 30, tzinfo=timezone.utc
        )

    def test_kickoff_time_respects_dst(self):
        """football-data's Time is venue-local, so BST and CEST must be
        applied — not a fixed offset."""
        from zoneinfo import ZoneInfo

        from backend.services.data.footballdata_loader import _combine_local_kickoff

        winter = _combine_local_kickoff(
            datetime(2026, 3, 4, tzinfo=timezone.utc), "15:00", ZoneInfo("Europe/London")
        )
        summer = _combine_local_kickoff(
            datetime(2025, 8, 16, tzinfo=timezone.utc), "15:00", ZoneInfo("Europe/London")
        )
        assert winter.hour == 15  # GMT
        assert summer.hour == 14  # BST

    def test_unparsable_kickoff_returns_none_not_a_guess(self):
        from zoneinfo import ZoneInfo

        from backend.services.data.footballdata_loader import _combine_local_kickoff

        assert _combine_local_kickoff(
            datetime(2026, 3, 4, tzinfo=timezone.utc), "not-a-time", ZoneInfo("UTC")
        ) is None

    def test_repair_unshifts_stored_dates_and_leaves_real_kickoffs(self, wh):
        a, b, c, d = (_team(wh, n) for n in ("A", "B", "C", "D"))
        # Damaged: local midnight in Asia/Jerusalem (UTC+2 in March).
        _match(wh, "m1", "eng.1", 2026, "2026-03-03T22:00:00+00:00", a, b, source="fdcouk")
        # Healthy: a real kickoff that must not be touched.
        _match(wh, "m2", "eng.1", 2026, "2026-03-04T15:00:00+00:00", c, d, source="fdcouk")

        result = fix_dates(wh, dry_run=False)
        assert result["shifted"] == 1
        assert result["already_correct_or_real_kickoff"] == 1

        rows = dict(wh._conn.execute("SELECT match_id, date_utc FROM matches").fetchall())
        assert rows["m1"].startswith("2026-03-04T00:00:00")
        assert rows["m2"].startswith("2026-03-04T15:00:00")

    def test_repair_is_idempotent(self, wh):
        a, b = _team(wh, "A"), _team(wh, "B")
        _match(wh, "m1", "eng.1", 2026, "2026-03-03T22:00:00+00:00", a, b, source="fdcouk")
        fix_dates(wh, dry_run=False)
        assert fix_dates(wh, dry_run=False)["shifted"] == 0

    def test_validator_rejects_a_naive_date(self, wh):
        _full_season(wh)
        a, b = _team(wh, "X"), _team(wh, "Y")
        _match(wh, "naive", "eng.1", 2020, "2020-09-05T15:00:00", a, b)
        result = _check(wh, "date_utc_sanity")
        assert not result.passed
        assert any("naive" in f or "non-UTC" in f for f in result.failures)


# --------------------------------------------------------------------------
# 5 + 6. split identities and the duplicate fixtures they hide
# --------------------------------------------------------------------------

class TestSplitIdentities:
    def test_validator_flags_a_name_contained_in_another(self, wh):
        """'Swansea' vs 'Swansea City' is the exact shape of the bug: two
        ids, one competition, one real club."""
        _full_season(wh)
        short, long_ = _team(wh, "Swansea"), _team(wh, "Swansea City")
        other = _team(wh, "Other FC")
        _match(wh, "s1", "eng.1", 2020, "2020-09-05T15:00:00+00:00", short, other)
        _match(wh, "s2", "eng.1", 2020, "2020-09-12T15:00:00+00:00", long_, other)

        result = _check(wh, "split_identities")
        assert not result.passed
        assert any("Swansea" in f for f in result.failures)

    def test_verified_distinct_clubs_are_not_flagged(self, wh):
        """The allowlist must let genuinely different clubs coexist."""
        _full_season(wh)
        psg, pfc = _team(wh, "Paris Saint-Germain"), _team(wh, "Paris FC")
        other = _team(wh, "Other FC")
        _match(wh, "p1", "eng.1", 2020, "2020-09-05T15:00:00+00:00", psg, other)
        _match(wh, "p2", "eng.1", 2020, "2020-09-12T15:00:00+00:00", pfc, other)
        assert _check(wh, "split_identities").passed

    def test_merge_moves_history_and_removes_the_duplicate_team(self, wh):
        short, long_, other = _team(wh, "Swansea"), _team(wh, "Swansea City"), _team(wh, "Other")
        _match(wh, "s1", "eng.1", 2020, "2020-09-05T15:00:00+00:00", short, other)
        _match(wh, "s2", "eng.1", 2020, "2020-09-12T15:00:00+00:00", other, short)

        counts = wh.merge_teams(short, long_)
        assert counts["matches"] == 2
        assert wh._conn.execute(
            "SELECT COUNT(*) FROM teams WHERE team_id = ?", (short,)
        ).fetchone()[0] == 0
        assert wh._conn.execute(
            "SELECT COUNT(*) FROM matches WHERE home_team_id = ? OR away_team_id = ?",
            (long_, long_),
        ).fetchone()[0] == 2

    def test_merged_name_survives_as_an_alias(self, wh):
        short, long_, other = _team(wh, "Swansea"), _team(wh, "Swansea City"), _team(wh, "Other")
        _match(wh, "s1", "eng.1", 2020, "2020-09-05T15:00:00+00:00", short, other)
        wh.merge_teams(short, long_)
        assert wh.find_team_id_by_alias("Swansea", "M") == long_

    def test_merge_refuses_to_cross_genders(self, wh):
        men = _team(wh, "Arsenal")
        women = wh.upsert_team(canonical_name="Arsenal", gender="F")
        with pytest.raises(ValueError, match="across genders"):
            wh.merge_teams(women, men)

    def test_merge_exposes_the_duplicate_fixture_it_was_hiding(self, wh):
        """This is why the duplicate count was an undercount: before the
        merge the two rows differ in home_team_id, so no GROUP BY sees them."""
        short, long_, other = _team(wh, "Swansea"), _team(wh, "Swansea City"), _team(wh, "Other")
        _match(wh, "fd", "eng.1", 2020, "2020-09-05T00:00:00+00:00", short, other, source="fdcouk")
        _match(wh, "espn", "eng.1", 2020, "2020-09-05T15:00:00+00:00", long_, other)

        assert wh.find_duplicate_fixtures() == []
        wh.merge_teams(short, long_)
        assert len(wh.find_duplicate_fixtures()) == 1


# --------------------------------------------------------------------------
# 8. duplicate fixtures
# --------------------------------------------------------------------------

class TestDuplicateFixtures:
    def test_dedupe_keeps_the_richer_row(self, wh):
        a, b = _team(wh, "A"), _team(wh, "B")
        _match(wh, "poor", "eng.1", 2020, "2020-09-05T15:00:00+00:00", a, b, source="fdcouk")
        _match(wh, "rich", "eng.1", 2020, "2020-09-05T15:00:00+00:00", a, b,
               odds_home=2.0, odds_draw=3.0, odds_away=4.0, venue="Stadium")

        result = wh.merge_duplicate_fixtures()
        assert result["rows_removed"] == 1
        survivors = [r[0] for r in wh._conn.execute("SELECT match_id FROM matches").fetchall()]
        assert survivors == ["rich"]

    def test_dedupe_coalesces_columns_so_nothing_is_lost(self, wh):
        """The football-data row carries the odds and the ESPN row carries
        the venue; the survivor must end up with both."""
        a, b = _team(wh, "A"), _team(wh, "B")
        _match(wh, "espn1", "eng.1", 2020, "2020-09-05T15:00:00+00:00", a, b,
               venue="Old Trafford", attendance=70000)
        _match(wh, "fd1", "eng.1", 2020, "2020-09-05T00:00:00+00:00", a, b, source="fdcouk",
               odds_home=2.5, odds_draw=3.4, odds_away=2.9)

        wh.merge_duplicate_fixtures()
        row = wh._conn.execute("SELECT * FROM matches").fetchone()
        assert row["venue"] == "Old Trafford"
        assert row["attendance"] == 70000
        assert row["odds_home"] == 2.5
        assert row["odds_draw"] == 3.4

    def test_dry_run_writes_nothing(self, wh):
        a, b = _team(wh, "A"), _team(wh, "B")
        _match(wh, "d1", "eng.1", 2020, "2020-09-05T15:00:00+00:00", a, b)
        _match(wh, "d2", "eng.1", 2020, "2020-09-06T15:00:00+00:00", a, b, source="fdcouk")
        before = wh._conn.execute("SELECT COUNT(*) FROM matches").fetchone()[0]
        assert wh.merge_duplicate_fixtures(dry_run=True)["rows_removed"] == 1
        assert wh._conn.execute("SELECT COUNT(*) FROM matches").fetchone()[0] == before

    def test_validator_flags_duplicates(self, wh):
        _full_season(wh)
        a, b = _team(wh, "A"), _team(wh, "B")
        _match(wh, "d1", "eng.1", 2020, "2020-09-05T15:00:00+00:00", a, b)
        _match(wh, "d2", "eng.1", 2020, "2020-09-06T15:00:00+00:00", a, b, source="fdcouk")
        assert not _check(wh, "duplicate_fixtures").passed

    def test_clean_warehouse_passes(self, wh):
        _full_season(wh)
        assert _check(wh, "duplicate_fixtures").passed


# --------------------------------------------------------------------------
# 7. orphan teams
# --------------------------------------------------------------------------

class TestOrphanTeams:
    def test_loading_aliases_creates_no_team_rows(self, wh):
        """The old resolver materialised every YAML entry, leaving one
        zero-match row per pinned club."""
        from backend.services.data.team_resolver import TeamResolver

        TeamResolver(wh, gender_default="M")
        TeamResolver(wh, gender_default="F")
        assert wh._conn.execute("SELECT COUNT(*) FROM teams").fetchone()[0] == 0

    def test_team_is_created_only_when_a_match_resolves_to_it(self, wh):
        from backend.services.data.team_resolver import TeamResolver

        resolver = TeamResolver(wh, gender_default="M")
        assert wh._conn.execute("SELECT COUNT(*) FROM teams").fetchone()[0] == 0
        resolved = resolver.resolve("Man United", gender="M")
        assert resolved.canonical_name == "Manchester United"
        assert wh._conn.execute("SELECT COUNT(*) FROM teams").fetchone()[0] == 1

    def test_orphans_are_detected_and_removed(self, wh):
        a, b = _team(wh, "A"), _team(wh, "B")
        _team(wh, "Ghost")
        _match(wh, "m1", "eng.1", 2020, "2020-09-05T15:00:00+00:00", a, b)

        assert [o["canonical_name"] for o in wh.find_orphan_teams()] == ["Ghost"]
        assert wh.delete_orphan_teams() == 1
        assert wh.find_orphan_teams() == []

    def test_validator_flags_orphans(self, wh):
        _full_season(wh)
        _team(wh, "Ghost")
        assert not _check(wh, "orphan_teams").passed


# --------------------------------------------------------------------------
# 5. season labelling
# --------------------------------------------------------------------------

class TestSeasonLabels:
    def test_match_before_previous_season_ended_is_relabelled(self, wh):
        """Serie A 2019-20 finished on 1-2 August 2020; ESPN filed the
        1 August fixtures as 2020-21."""
        a, b, c, d = (_team(wh, n) for n in ("A", "B", "C", "D"))
        _match(wh, "old1", "ita.1", 2019, "2019-09-01T15:00:00+00:00", a, b)
        _match(wh, "old2", "ita.1", 2019, "2020-08-02T15:00:00+00:00", c, d)
        _match(wh, "stray", "ita.1", 2020, "2020-08-01T15:00:00+00:00", a, c)
        _match(wh, "new1", "ita.1", 2020, "2020-09-20T15:00:00+00:00", b, d)

        assert fix_season_labels(wh, dry_run=False)["moved"] == 1
        assert wh._conn.execute(
            "SELECT season FROM matches WHERE match_id = 'stray'"
        ).fetchone()[0] == 2019

    def test_normal_season_boundary_is_left_alone(self, wh):
        a, b, c, d = (_team(wh, n) for n in ("A", "B", "C", "D"))
        _match(wh, "old", "ita.1", 2019, "2020-05-20T15:00:00+00:00", a, b)
        _match(wh, "new", "ita.1", 2020, "2020-09-20T15:00:00+00:00", c, d)
        assert fix_season_labels(wh, dry_run=False)["moved"] == 0

    def test_validator_flags_an_overlapping_season(self, wh):
        _full_season(wh, comp="eng.1", season=2019)
        _full_season(wh, comp="eng.1", season=2020)
        a, b = _team(wh, "Stray A"), _team(wh, "Stray B")
        # Season 2019's synthetic fixtures run through September 2019.
        _match(wh, "overlap", "eng.1", 2020, "2019-09-10T15:00:00+00:00", a, b)
        assert not _check(wh, "season_boundaries").passed

    def test_non_participant_rows_are_dropped(self, wh):
        ids = _full_season(wh, comp="eng.1", season=2020, n_teams=20)
        ghost_a, ghost_b = _team(wh, "Ligue 2 Club A"), _team(wh, "Ligue 2 Club B")
        _match(wh, "wrong-comp", "eng.1", 2020, "2021-05-15T15:00:00+00:00", ghost_a, ghost_b)

        assert drop_non_participants(wh, dry_run=False)["rows"] == 1
        assert wh._conn.execute(
            "SELECT COUNT(*) FROM matches WHERE match_id = 'wrong-comp'"
        ).fetchone()[0] == 0
        # Real participants untouched.
        assert wh._conn.execute("SELECT COUNT(*) FROM matches").fetchone()[0] == len(ids) * (len(ids) - 1)

    def test_partial_season_is_never_pruned(self, wh):
        """An in-progress season legitimately has clubs with few games."""
        a, b, c, d = (_team(wh, n) for n in ("A", "B", "C", "D"))
        _match(wh, "p1", "eng.1", 2026, "2026-08-15T15:00:00+00:00", a, b)
        _match(wh, "p2", "eng.1", 2026, "2026-08-22T15:00:00+00:00", c, d)
        assert drop_non_participants(wh, dry_run=False)["rows"] == 0


# --------------------------------------------------------------------------
# validator plumbing
# --------------------------------------------------------------------------

class TestValidator:
    def test_clean_warehouse_passes_every_structural_check(self, wh):
        _full_season(wh, comp="eng.1", season=2020, n_teams=20)
        results = {r.name: r for r in IntegrityValidator(wh).run_all()}
        for name in (
            "duplicate_fixtures", "split_identities", "orphan_teams",
            "season_boundaries", "referential",
        ):
            assert results[name].passed, f"{name} failed: {results[name].failures}"

    def test_referential_check_catches_a_self_play_row(self, wh):
        a = _team(wh, "A")
        _match(wh, "self", "eng.1", 2020, "2020-09-05T15:00:00+00:00", a, a)
        result = _check(wh, "referential")
        assert not result.passed
        assert any("self-play" in f for f in result.failures)

    def test_coverage_reports_shares_without_failing_on_sparse_columns(self, wh):
        _full_season(wh, n_teams=20)
        result = _check(wh, "coverage")
        assert result.data["matches"] == 380
        assert result.data["matches.date_utc"]["share"] == 1.0
        # referee_id is 0% here and must NOT be a failure — sparse coverage
        # is a source limitation, not a bug.
        assert result.passed

    def test_strict_mode_promotes_empty_table_warnings_to_failures(self, wh):
        _full_season(wh, n_teams=20)
        assert _check(wh, "coverage").passed
        strict = next(
            r for r in IntegrityValidator(wh, strict=True).run_all() if r.name == "coverage"
        )
        assert not strict.passed


class TestRealWarehouse:
    """Guard the actual warehouse when one is present.

    `backend/data/warehouse.sqlite` is gitignored, so this skips in CI and
    on a fresh clone. Locally it is the check that stops any of §4c
    quietly coming back after a rebuild.
    """

    @pytest.fixture(scope="class")
    def real(self):
        from backend.services.data.warehouse import WAREHOUSE_PATH, Warehouse

        if not WAREHOUSE_PATH.exists() or WAREHOUSE_PATH.stat().st_size == 0:
            pytest.skip("no local warehouse")
        warehouse = Warehouse(WAREHOUSE_PATH)
        if warehouse._conn.execute("SELECT COUNT(*) FROM matches").fetchone()[0] == 0:
            warehouse.close()
            pytest.skip("warehouse is empty")
        yield warehouse
        warehouse.close()

    # `season_team_counts` and `season_row_counts` are asserted separately
    # below, scoped to Wave A: ned.1 and por.1 have partial upstream coverage
    # (por.1 2008 has 27 of 306 fixtures) and were descoped in the pivot, so
    # holding the whole suite red on leagues the product does not serve buries
    # the checks that matter.
    @pytest.mark.parametrize("check", [
        "duplicate_fixtures", "split_identities",
        "orphan_teams", "date_utc_sanity",
        "season_boundaries", "referential",
    ])
    def test_check_passes_on_the_real_warehouse(self, real, check):
        # min_season=2005 because upstream history is genuinely partial before
        # it — football-data.co.uk starts in 2005 — so those seasons report as
        # short no matter how many times the warehouse is repaired. A guard that
        # can never go green is a guard nobody reads.
        result = next(
            r for r in IntegrityValidator(real, min_season=2005).run_all() if r.name == check
        )
        assert result.passed, f"{check}: {result.detail}\n" + "\n".join(result.failures[:10])

    @pytest.mark.parametrize("check", ["season_team_counts", "season_row_counts"])
    def test_season_shape_is_correct_for_every_wave_a_season(self, real, check):
        """The five leagues the product serves must reconstruct exactly.

        This is the check that catches a re-split identity: a duplicated club
        inflates both the team count and the row count for its league-season,
        and it is what made Dortmund "win" the 2018-19 Bundesliga. The weekly
        `--full` build re-introduces the defect from a third source, so this
        needs to stay green across rebuilds, not just once.
        """
        from backend.scripts.validate_warehouse_integrity import WAVE_A

        result = next(
            r for r in IntegrityValidator(real, min_season=2005).run_all() if r.name == check
        )
        wave_a_failures = [
            f for f in result.failures if f.split(":")[0].split()[0] in WAVE_A
        ]
        assert not wave_a_failures, (
            f"{check} failed for Wave A league-seasons:\n" + "\n".join(wave_a_failures[:10])
        )


class TestDedupeSurvivesTheNextIngest:
    """A dedupe that deletes the row tomorrow's ingest rewrites is not a dedupe.

    Survivor choice used to be "most populated columns, ESPN on ties".
    football-data rows carry closing odds, so they counted as richer and won:
    of the 380 eng.1 2025 fixtures, 298 football-data rows survived the
    2026-08-13 repair and only 82 ESPN ones did. The daily ingest then wrote
    those 298 ESPN fixtures straight back — `ESPN/M eng.1 2025 -> 380 matches
    written` into a season that already held 380 — and every duplicate was
    back within hours of being removed.

    ESPN is re-ingested daily and is the only source with a true kickoff, so
    its row has to be the survivor. Nothing is lost by preferring it: the
    columns it lacks are coalesced in from the rows being dropped.
    """

    def test_the_espn_row_survives_even_when_the_other_has_more_columns(self, wh):
        a, b = _team(wh, "Man City"), _team(wh, "Liverpool")
        _match(wh, "espn_1", "eng.1", 2025, "2025-11-09T16:30:00+00:00", a, b,
               source="espn", home_score=2, away_score=1)
        # football-data knows only the day, but carries the closing prices.
        _match(wh, "fd_1", "eng.1", 2025, "2025-11-09T00:00:00+00:00", a, b,
               source="fdcouk", home_score=2, away_score=1,
               odds_home=1.9, odds_draw=3.5, odds_away=4.2, odds_over_2_5=1.8)

        wh.merge_duplicate_fixtures()

        rows = wh._conn.execute(
            "SELECT match_id, source, odds_home FROM matches "
            "WHERE competition_id='eng.1' AND season=2025").fetchall()
        assert len(rows) == 1, "the duplicate was not collapsed"
        assert rows[0]["source"] == "espn", (
            "the football-data row survived; the next ESPN ingest will "
            "re-insert the fixture and the duplicate returns")
        assert rows[0]["odds_home"] == 1.9, (
            "preferring ESPN dropped the closing odds instead of coalescing "
            "them into the survivor")

    def test_a_real_repeat_meeting_is_left_alone(self, wh):
        """Same two clubs, same season, weeks apart — two real matches.

        This is the shape that made `phase` part of the key in the first
        place: Egypt beat Ivory Coast in the 2006 Africa Cup of Nations group
        stage and again in the final. The date gap is what separates them now,
        so the rule has to hold with no phase set at all.
        """
        a, b = _team(wh, "Egypt"), _team(wh, "Ivory Coast")
        _match(wh, "g", "eng.1", 2006, "2006-01-20T15:00:00+00:00", a, b,
               source="espn")
        _match(wh, "f", "eng.1", 2006, "2006-02-10T15:00:00+00:00", a, b,
               source="espn")
        wh.merge_duplicate_fixtures()
        n = wh._conn.execute(
            "SELECT COUNT(*) FROM matches WHERE competition_id='eng.1' "
            "AND season=2006").fetchone()[0]
        assert n == 2, "the second meeting was merged into the first"
