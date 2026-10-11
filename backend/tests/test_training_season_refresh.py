"""Offline training ingestion: broad scope, bounded progress, no partial release."""

import asyncio
import gzip
import os
import sqlite3
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest
import yaml

from backend.scripts import build_warehouse as build
from backend.scripts import validate_espn_training_progress as checkpoint
from backend.services.data import espn_loader
from backend.services.data.espn_training_refresh import TrainingSeasonRefresh
from backend.services.data.provider_status import ProviderUnavailable
from backend.services.data.warehouse import MatchRow, open_warehouse
from backend.services.prediction.historical_data import (
    HistoricalDataCollector,
    seasons_for,
)

NOW = datetime(2026, 10, 11, tzinfo=timezone.utc)


def event(day, mid="1", final=True):
    return {
        "id": mid,
        "date": f"{day[:4]}-{day[4:6]}-{day[6:]}T12:00:00Z",
        "competitions": [
            {
                "status": {"type": {"completed": final}},
                "competitors": [
                    {
                        "homeAway": "home",
                        "score": "1",
                        "team": {"id": "a", "displayName": "Arsenal"},
                    },
                    {
                        "homeAway": "away",
                        "score": "0",
                        "team": {"id": "b", "displayName": "Chelsea"},
                    },
                ],
            }
        ],
    }


def calendar(comp, season, days, events=()):
    return {
        "leagues": [
            {
                "slug": comp,
                "season": {"year": season},
                "calendarType": "day",
                "calendarIsWhitelist": True,
                "calendarStartDate": f"{season}-01-01T00:00:00Z",
                "calendarEndDate": f"{season + 1}-07-31T00:00:00Z",
                "calendar": [
                    f"{day[:4]}-{day[4:6]}-{day[6:]}T00:00:00Z" for day in days
                ],
            }
        ],
        "events": list(events),
    }


@pytest.fixture(autouse=True)
def no_network_delay(monkeypatch):
    async def no_sleep(_):
        pass

    monkeypatch.setattr("backend.services.data.espn_refresh.asyncio.sleep", no_sleep)


def refresh(tmp_path, handler, **kwargs):
    calls = []

    def transport(request):
        calls.append(request)
        return handler(request)

    instance = TrainingSeasonRefresh(
        tmp_path / "receipts.sqlite",
        now=kwargs.pop("now", NOW),
        client=httpx.AsyncClient(transport=httpx.MockTransport(transport)),
        **kwargs,
    )
    return instance, calls


def fetch(instance, scope):
    async def run():
        try:
            return await instance.fetch_seasons(scope)
        finally:
            await instance.close()

    return asyncio.run(run())


def test_full_historical_window_resumes_across_weeks_instead_of_restarting_empty_prefix(
    tmp_path,
):
    legacy_calls = []

    def provider(request):
        day = request.url.params["dates"]
        if "-" in day:
            legacy_calls.append(day)
            return httpx.Response(400)
        return httpx.Response(
            200, json={"events": [event(day)] if day == "20250920" else []}
        )

    # Reproduce the precise failing production range and bounded fallback.
    async def legacy_failure():
        collector = HistoricalDataCollector(tmp_path / "legacy", persist_cache=False)
        collector._client = httpx.AsyncClient(transport=httpx.MockTransport(provider))
        try:
            await collector._fetch_espn_windows(
                "eng.1",
                "premier_league",
                2025,
                collector._season_windows("premier_league", 2025),
            )
        finally:
            await collector.close()

    with pytest.raises(
        ProviderUnavailable, match="daily fallback needs 365 requests, budget 93"
    ):
        asyncio.run(legacy_failure())
    assert legacy_calls == ["20250801-20250831"]
    attempts = []
    for invocation in range(4):
        instance, calls = refresh(
            tmp_path, provider, now=NOW + timedelta(weeks=invocation)
        )
        if invocation < 3:
            with pytest.raises(ProviderUnavailable, match="budget exhausted"):
                fetch(instance, [("eng.1", 2025)])
        else:
            rows = fetch(instance, [("eng.1", 2025)])["eng.1", 2025]
            assert len(rows) == 1
            assert rows[0]["_observed_at"] == NOW.isoformat()
        attempts.append(len(calls))
        assert all(request.url.host == "site.web.api.espn.com" for request in calls)
        assert all("-" not in request.url.params["dates"] for request in calls)
    assert attempts == [93, 93, 93, 86]
    with sqlite3.connect(tmp_path / "receipts.sqlite") as db:
        assert db.execute("SELECT COUNT(*) FROM receipts").fetchone()[0] == 365
        assert db.execute("SELECT MIN(day),MAX(day) FROM receipts").fetchone() == (
            "20250801",
            "20260731",
        )
    # The fourth invocation's simulated observation clock is three weeks later.
    asyncio.run(
        checkpoint.validate(tmp_path / "receipts.sqlite", now=NOW + timedelta(weeks=3))
    )


def test_proven_historical_whitelist_is_archival_but_current_calendar_is_fresh(
    tmp_path,
):
    hist_days, current_days = ["20250920"], ["20260821"]

    def provider(request):
        day = request.url.params["dates"]
        season = int(day[:4])
        days = hist_days if season == 2025 else current_days
        return httpx.Response(
            200,
            json=calendar(
                "eng.1", season, days, [event(day, mid=day)] if day in days else []
            ),
        )

    scope = [("eng.1", 2025), ("eng.1", 2026)]
    instance, _ = refresh(tmp_path, provider)
    first = fetch(instance, scope)
    current_days.append("20261011")
    instance, calls = refresh(tmp_path, provider, now=NOW + timedelta(hours=2))
    second = fetch(instance, scope)
    assert [r.url.params["dates"] for r in calls] == ["20260801", "20261011"]
    assert second["eng.1", 2025] == first["eng.1", 2025]
    assert len(second["eng.1", 2026]) == 2


def test_fallback_never_excludes_dates_using_wrong_season_metadata(tmp_path):
    instance, _ = refresh(tmp_path, lambda _: httpx.Response(503))
    try:
        body = calendar("eng.1", 2026, ["20260821"])
        days = instance._calendar(body, "eng.1", 2025)
        assert len(days) == 365 and days[0] == "20250801" and days[-1] == "20260731"
        body["leagues"][0]["slug"] = "esp.1"
        with pytest.raises(ProviderUnavailable, match="identity"):
            instance._calendar(body, "eng.1", 2025)
    finally:
        asyncio.run(instance.close())


def test_retries_still_consume_the_same_global_cap(tmp_path):
    instance, calls = refresh(tmp_path, lambda _: httpx.Response(503), budget=2)
    with pytest.raises(ProviderUnavailable, match="budget"):
        fetch(instance, [("eng.1", 2025)])
    assert len(calls) == 2
    with pytest.raises(ValueError, match="budget"):
        TrainingSeasonRefresh(tmp_path / "other.sqlite", budget=94)


@pytest.mark.parametrize(
    "comp, season, first, last, count",
    [
        ("eng.1", 2025, "20250801", "20260731", 365),
        ("bra.1", 2025, "20250101", "20251231", 365),
        ("usa.1", 2024, "20240101", "20241231", 366),
        ("fifa.world", 2022, "20221120", "20221220", 31),
        ("fifa.world", 2026, "20260601", "20260720", 50),
    ],
)
def test_dense_coverage_keeps_existing_season_and_tournament_windows(
    tmp_path, comp, season, first, last, count
):
    instance, _ = refresh(tmp_path, lambda _: httpx.Response(503))
    try:
        days = instance._calendar({"events": []}, comp, season)
        assert (days[0], days[-1], len(days)) == (first, last, count)
    finally:
        asyncio.run(instance.close())


def test_current_dense_window_excludes_future_dates_and_empty_days_still_expire(
    tmp_path,
):
    instance, _ = refresh(tmp_path, lambda _: httpx.Response(503))
    try:
        days = instance._calendar({"events": []}, "eng.1", 2026)
        assert days[0] == "20260801" and days[-1] == "20261011"
        instance._save("eng.1", 2026, "20260801", {"events": []})
        instance.now += timedelta(hours=2)
        assert instance._receipt("eng.1", 2026, "20260801") is None
        # A future international edition has no past coverage to request.
        instance.now = datetime(2026, 1, 1, tzinfo=timezone.utc)
        assert asyncio.run(instance.fetch_seasons([("fifa.world", 2026)])) == {
            ("fifa.world", 2026): []
        }
        assert instance.requests == 0
    finally:
        asyncio.run(instance.close())


@pytest.mark.parametrize("comp", ["usa.1", "bra.1"])
def test_american_local_fixture_date_can_cross_utc_midnight(tmp_path, comp):
    instance, _ = refresh(tmp_path, lambda _: httpx.Response(503))
    try:
        body = {"events": [event("20250102")]}
        rows, _ = instance._events(body, comp, 2025, "20250101")
        assert len(rows) == 1
        with pytest.raises(ProviderUnavailable, match="queried fixture day"):
            instance._events(body, comp, 2025, "20241231")
    finally:
        asyncio.run(instance.close())


def test_multiple_historical_scopes_resume_without_skipping_or_double_counting(
    tmp_path,
):
    scope = [("eng.2", 2025), ("usa.1", 2025)]
    eng_days = [f"202508{n:02d}" for n in range(1, 4)]
    mls_days = ["20250101", "20250102"]

    def provider(request):
        comp = request.url.path.split("/")[-2]
        day = request.url.params["dates"]
        days = eng_days if comp == "eng.2" else mls_days
        # ESPN can repeat one locally dated event on adjacent queried dates.
        result = (
            event(day, mid=day) if comp == "eng.2" else event("20250102", mid="mls")
        )
        return httpx.Response(200, json=calendar(comp, 2025, days, [result]))

    instance, calls = refresh(tmp_path, provider, budget=3)
    with pytest.raises(ProviderUnavailable, match="budget exhausted"):
        fetch(instance, scope)
    assert len(calls) == 3
    instance, calls = refresh(
        tmp_path, provider, budget=3, now=NOW + timedelta(weeks=1)
    )
    selected = fetch(instance, scope)
    assert set(selected) == set(scope)
    assert len(selected["eng.2", 2025]) == 3 and len(selected["usa.1", 2025]) == 1
    assert len(calls) == 2 and all("usa.1" in str(c.url) for c in calls)
    assert all(
        row["_observed_at"] == NOW.isoformat() for row in selected["eng.2", 2025]
    )


def test_training_loader_reuses_receipts_without_overwriting_newer_warehouse_correction(
    tmp_path, monkeypatch
):
    receipts, path = tmp_path / "receipts.sqlite", tmp_path / "warehouse.sqlite"

    def provider(request):
        day = request.url.params["dates"]
        return httpx.Response(
            200,
            json=calendar(
                "eng.1", 2025, ["20250920"], [event(day)] if day == "20250920" else []
            ),
        )

    original_init = TrainingSeasonRefresh.__init__

    def init(self, target):
        original_init(
            self,
            target,
            now=NOW,
            client=httpx.AsyncClient(transport=httpx.MockTransport(provider)),
        )

    monkeypatch.setattr(TrainingSeasonRefresh, "__init__", init)
    with open_warehouse(path) as wh:
        espn_loader.register_competitions(wh)
        for _ in range(2):
            asyncio.run(
                espn_loader.load_training_competitions(
                    wh,
                    min_season=2025,
                    max_season=2025,
                    competitions=["eng.1"],
                    receipts_path=receipts,
                )
            )
        assert wh._conn.execute("SELECT COUNT(*) FROM matches").fetchone()[0] == 1
        wh._conn.execute(
            "UPDATE matches SET home_score=3, fetched_at=?",
            ((NOW + timedelta(days=1)).isoformat(),),
        )
        wh._conn.commit()
        asyncio.run(
            espn_loader.load_training_competitions(
                wh,
                min_season=2025,
                max_season=2025,
                competitions=["eng.1"],
                receipts_path=receipts,
            )
        )
        row = wh._conn.execute("SELECT home_score,fetched_at FROM matches").fetchone()
        assert tuple(row) == (3, (NOW + timedelta(days=1)).isoformat())


def test_historical_calendar_corruption_requires_discovery_again(tmp_path):
    def provider(request):
        day = request.url.params["dates"]
        return httpx.Response(
            200, json=calendar("eng.1", 2025, ["20250801"], [event(day)])
        )

    instance, _ = refresh(tmp_path, provider)
    fetch(instance, [("eng.1", 2025)])
    with sqlite3.connect(tmp_path / "receipts.sqlite") as db:
        db.execute("UPDATE calendars SET digest='broken'")
    assert checkpoint.main(["--db", str(tmp_path / "receipts.sqlite")]) == 1
    instance, calls = refresh(tmp_path, provider, now=NOW + timedelta(hours=2))
    assert len(fetch(instance, [("eng.1", 2025)])["eng.1", 2025]) == 1
    assert len(calls) == 1


def test_corrupt_or_future_checkpoint_cannot_certify_progress(tmp_path):
    def provider(request):
        day = request.url.params["dates"]
        return httpx.Response(
            200, json=calendar("eng.1", 2025, ["20250801"], [event(day)])
        )

    instance, _ = refresh(tmp_path, provider)
    fetch(instance, [("eng.1", 2025)])
    with sqlite3.connect(tmp_path / "receipts.sqlite") as db:
        db.execute("UPDATE receipts SET body='{}'")
    assert checkpoint.main(["--db", str(tmp_path / "receipts.sqlite")]) == 1
    instance, calls = refresh(tmp_path, provider, now=NOW + timedelta(hours=2))
    assert len(fetch(instance, [("eng.1", 2025)])["eng.1", 2025]) == 1
    assert len(calls) == 1  # Damaged dated bytes are refetched, not counted.
    with sqlite3.connect(tmp_path / "receipts.sqlite") as db:
        db.execute(
            "UPDATE calendars SET fetched_at=?",
            ((NOW + timedelta(days=10)).isoformat(),),
        )
    instance, calls = refresh(tmp_path, provider)
    with pytest.raises(ProviderUnavailable, match="newer observations"):
        fetch(instance, [("eng.1", 2025)])
    assert not calls


def test_completed_empty_season_and_warehouse_masquerading_as_checkpoint_are_refused(
    tmp_path,
):
    instance, _ = refresh(
        tmp_path, lambda _: httpx.Response(200, json=calendar("eng.1", 2025, []))
    )
    with pytest.raises(ProviderUnavailable, match="completed season"):
        fetch(instance, [("eng.1", 2025)])
    with open_warehouse(tmp_path / "warehouse.sqlite"):
        pass
    assert checkpoint.main(["--db", str(tmp_path / "warehouse.sqlite")]) == 1


def test_checkpoint_requires_unique_date_keys_not_just_expected_table_names(tmp_path):
    instance, _ = refresh(tmp_path, lambda _: httpx.Response(503))
    asyncio.run(instance.close())
    path = tmp_path / "receipts.sqlite"
    with sqlite3.connect(path) as db:
        db.execute("ALTER TABLE receipts RENAME TO old_receipts")
        db.execute("CREATE TABLE receipts AS SELECT * FROM old_receipts")
        db.execute("DROP TABLE old_receipts")
        assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert checkpoint.main(["--db", str(path)]) == 1


def test_training_selection_keeps_every_legacy_competition_season(
    tmp_path, monkeypatch
):
    available = {
        comp["key"]: seasons_for(comp["key"], NOW)
        for comp in espn_loader.MEN_COMPETITIONS
    }
    monkeypatch.setattr(espn_loader, "AVAILABLE_SEASONS", available)
    seen = []

    async def observed(self, scope):
        seen.extend(scope)
        return {item: [] for item in scope}

    monkeypatch.setattr(TrainingSeasonRefresh, "fetch_seasons", observed)
    with open_warehouse(tmp_path / "warehouse.sqlite") as wh:
        espn_loader.register_competitions(wh)
        asyncio.run(
            espn_loader.load_training_competitions(
                wh, min_season=2025, receipts_path=tmp_path / "receipts.sqlite"
            )
        )
    expected = [
        (comp["competition_id"], season)
        for comp in espn_loader.MEN_COMPETITIONS
        for season in available[comp["key"]]
        if season >= 2025
    ]
    assert (
        seen == expected and len(seen) == 35 and len({comp for comp, _ in seen}) == 18
    )
    assert (
        ("ned.1", 2025) in seen
        and ("fifa.world", 2026) in seen
        and ("eng.2", 2026) in seen
    )


def seed(path):
    with open_warehouse(path) as wh:
        espn_loader.register_competitions(wh)
        resolver = espn_loader.TeamResolver(wh, gender_default="M")
        home = resolver.resolve("Arsenal", gender="M").team_id
        away = resolver.resolve("Chelsea", gender="M").team_id
        wh.upsert_matches(
            [
                MatchRow(
                    "original",
                    "espn",
                    "eng.1",
                    2026,
                    "2026-08-21T00:00:00Z",
                    home,
                    away,
                    2,
                    0,
                )
            ]
        )


@pytest.mark.parametrize("budget", [2, 93])
def test_capped_fetch_or_complete_but_short_history_never_replaces_last_good_warehouse(
    tmp_path, monkeypatch, budget
):
    path, receipts = tmp_path / "warehouse.sqlite", tmp_path / "receipts.sqlite"
    seed(path)
    before = path.read_bytes(), path.stat().st_mtime_ns, path.stat().st_ino
    days = ["20250801", "20250802", "20250803"]

    def provider(request):
        day = request.url.params["dates"]
        return httpx.Response(
            200, json=calendar("eng.1", 2025, days, [event(day, mid=day)])
        )

    original_init = TrainingSeasonRefresh.__init__

    def init(self, target):
        original_init(
            self,
            target,
            now=NOW,
            budget=budget,
            client=httpx.AsyncClient(transport=httpx.MockTransport(provider)),
        )

    monkeypatch.setattr(TrainingSeasonRefresh, "__init__", init)
    code = build.main(
        [
            "--db",
            str(path),
            "--espn",
            "--resume-espn",
            "--competitions",
            "eng.1",
            "--min-season",
            "2025",
            "--max-season",
            "2025",
            "--receipts-db",
            str(receipts),
        ]
    )
    assert code == 1
    assert (path.read_bytes(), path.stat().st_mtime_ns, path.stat().st_ino) == before
    with sqlite3.connect(receipts) as db:
        assert db.execute("SELECT COUNT(*) FROM receipts").fetchone()[0] == min(
            budget, 3
        )


@pytest.mark.parametrize(
    "args",
    [
        [
            "--espn",
            "--resume-current",
            "--current-season",
            "--resume-espn",
            "--competitions",
            "eng.1",
        ],
        ["--full", "--resume-espn"],
        ["--espn", "--force", "--resume-espn"],
        ["--espn", "--resume-espn", "--competitions", "eng.1,eng.1"],
        ["--espn", "--resume-espn", "--competitions", "usa.1.w"],
    ],
)
def test_resume_modes_cannot_change_scope_silently(args):
    with pytest.raises(SystemExit):
        build.main(args)


def test_workflow_preserves_checkpoint_training_and_promotion_gates():
    workflow = yaml.safe_load(Path(".github/workflows/train_unified.yml").read_text())
    steps = workflow["jobs"]["train"]["steps"]
    by_name = {step["name"]: step for step in steps if "name" in step}
    refresh_step = by_name["Refresh warehouse sources"]
    assert (
        "--espn --resume-espn --football-data --min-season 2025" in refresh_step["run"]
    )
    assert (
        "--competitions" not in refresh_step["run"] and "--full" in refresh_step["run"]
    )
    assert not refresh_step.get("continue-on-error", False)
    retain = by_name[
        "Retain validated training ESPN progress after capped or failed refresh"
    ]
    assert retain["if"] == "always() && steps.training-progress.outcome == 'success'"
    assert retain["run"].index("validate_espn_training_progress") < retain["run"].index(
        "gh release upload"
    )
    assert (
        "warehouse-ingestion-progress" in retain["run"]
        and "models-latest" not in retain["run"]
    )
    assert (
        "--clobber" not in retain["run"]
    )  # Old checkpoint survives a failed new upload.
    restore = by_name["Restore validated training ESPN progress"]
    assert not restore.get("continue-on-error", False)
    assert "max_by(.id)" in restore["run"]
    for name in [
        "Repair the warehouse to a fixpoint",
        "Verify Wave A integrity before training",
        "Train men's model",
        "Train women's model",
    ]:
        assert not by_name[name].get("continue-on-error", False)
    assert (
        by_name["Publish men's artifacts"]["if"]
        == "steps.gate_men.outcome == 'success'"
    )
    assert (
        by_name["Publish women's artifacts"]["if"]
        == "steps.gate_women.outcome == 'success'"
    )


def workflow_step(name):
    workflow = yaml.safe_load(Path(".github/workflows/train_unified.yml").read_text())
    return next(
        step["run"]
        for step in workflow["jobs"]["train"]["steps"]
        if step.get("name") == name
    )


def checkpoint_shell(tmp_path):
    """Run the real workflow shell, validator and gzip; replace only GitHub I/O."""
    binary = tmp_path / "bin"
    binary.mkdir()
    (binary / "python").symlink_to(sys.executable)
    gh = binary / "gh"
    gh.write_text(f"#!{sys.executable}\n" + """
import json, os, pathlib, shutil, subprocess, sys
args = sys.argv[1:]
release = pathlib.Path(os.environ["MOCK_RELEASE"])
with (release / "calls.jsonl").open("a") as log:
    log.write(json.dumps(args) + "\\n")
if args[0] == "api":
    if os.environ.get("MOCK_API_FAILURE"):
        sys.exit(1)
    name = os.environ["MOCK_CHECKPOINT"]
    payload = {"assets": [
        {"name": "warehouse.sqlite.gz", "id": 9999},
        {"name": name, "id": 200},
        {"name": "espn_training_receipts-1-1.sqlite.gz", "id": 100}
    ]}
    # Exercise the exact gh --jq expression with real jq, including irrelevant
    # assets and an older receipt upload. No network or GitHub mutation occurs.
    query = args[args.index("--jq") + 1]
    filtered = subprocess.run(["jq", "-r", query], input=json.dumps(payload),
                              capture_output=True, text=True)
    sys.stdout.write(filtered.stdout)
    sys.exit(filtered.returncode)
elif args[:2] == ["release", "download"]:
    name = args[args.index("--pattern") + 1]
    shutil.copyfile(release / name, pathlib.Path("/tmp") / name)
elif args[:2] == ["release", "upload"]:
    if "--clobber" in args or args[2] != "warehouse-ingestion-progress":
        sys.exit(9)
    if os.environ.get("MOCK_UPLOAD_FAILURE"):
        sys.exit(1)
    target = pathlib.Path(args[-1])
    shutil.copyfile(target, release / target.name)
else:
    sys.exit(9)
""")
    gh.chmod(0o755)
    release = tmp_path / "release"
    release.mkdir()
    repo = Path.cwd()
    env = dict(
        os.environ,
        PATH=str(binary) + os.pathsep + os.environ["PATH"],
        PYTHONPATH=str(repo) + os.pathsep + os.environ.get("PYTHONPATH", ""),
        MOCK_RELEASE=str(release),
        GITHUB_REPOSITORY="fixture/soccer",
        GITHUB_RUN_ID=str(os.getpid()),
        GITHUB_RUN_ATTEMPT="1",
    )
    return release, env


@pytest.mark.parametrize("failure", [None, "corrupt", "upload"])
def test_workflow_checkpoint_preserves_previous_asset_and_requires_valid_progress(
    tmp_path, failure
):
    instance, _ = refresh(
        tmp_path,
        lambda request: httpx.Response(
            200, json=calendar("eng.1", 2025, ["20250801"], [event("20250801")])
        ),
    )
    fetch(instance, [("eng.1", 2025)])
    target = tmp_path / "backend/data/ingestion/espn_training_receipts.sqlite"
    target.parent.mkdir(parents=True)
    target.write_bytes((tmp_path / "receipts.sqlite").read_bytes())
    release, env = checkpoint_shell(tmp_path)
    previous = release / "espn_training_receipts-1-1.sqlite.gz"
    previous.write_bytes(gzip.compress(target.read_bytes()))
    retained = previous.read_bytes()
    if failure == "corrupt":
        with sqlite3.connect(target) as db:
            db.execute("UPDATE receipts SET digest='bad'")
    if failure == "upload":
        env["MOCK_UPLOAD_FAILURE"] = "1"
    script = workflow_step(
        "Retain validated training ESPN progress after capped or failed refresh"
    )
    new_name = f"espn_training_receipts-{env['GITHUB_RUN_ID']}-1.sqlite.gz"
    try:
        result = subprocess.run(
            ["bash", "-e", "-o", "pipefail", "-c", script],
            cwd=tmp_path,
            env=env,
            capture_output=True,
            text=True,
        )
        assert (result.returncode == 0) == (failure is None), (
            result.stdout + result.stderr
        )
        assert previous.read_bytes() == retained
        if failure is None:
            assert (
                gzip.decompress((release / new_name).read_bytes())
                == target.read_bytes()
            )
        else:
            assert not (release / new_name).exists()
        if failure == "corrupt":
            assert not (
                release / "calls.jsonl"
            ).exists()  # Refused before any GitHub operation.
    finally:
        (Path("/tmp") / new_name).unlink(missing_ok=True)


@pytest.mark.parametrize("failure", [None, "corrupt", "api"])
def test_workflow_restore_fails_closed_on_invalid_checkpoint_or_transport(
    tmp_path, failure
):
    instance, _ = refresh(
        tmp_path,
        lambda request: httpx.Response(
            200, json=calendar("eng.1", 2025, ["20250801"], [event("20250801")])
        ),
    )
    fetch(instance, [("eng.1", 2025)])
    release, env = checkpoint_shell(tmp_path)
    name = f"espn_training_receipts-{os.getpid()}-2.sqlite.gz"
    env["MOCK_CHECKPOINT"] = name
    data = (tmp_path / "receipts.sqlite").read_bytes()
    (release / name).write_bytes(
        gzip.compress(b"not SQLite" if failure == "corrupt" else data)
    )
    if failure == "api":
        env["MOCK_API_FAILURE"] = "1"
    try:
        result = subprocess.run(
            [
                "bash",
                "-e",
                "-o",
                "pipefail",
                "-c",
                workflow_step("Restore validated training ESPN progress"),
            ],
            cwd=tmp_path,
            env=env,
            capture_output=True,
            text=True,
        )
        assert (result.returncode == 0) == (failure is None), (
            result.stdout + result.stderr
        )
        if failure is None:
            assert (
                tmp_path / "backend/data/ingestion/espn_training_receipts.sqlite"
            ).read_bytes() == data
    finally:
        (Path("/tmp") / name).unlink(missing_ok=True)
