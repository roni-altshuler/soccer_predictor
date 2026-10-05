"""Offline source excerpts and adversarial provider/cache contract replays."""

import asyncio
import hashlib
import json
from copy import deepcopy
from dataclasses import FrozenInstanceError
from pathlib import Path

import httpx
import pytest

from backend.scripts.audit_openfootball import main as audit_main
from backend.services.data.fixture_contract import SCHEMA_VERSION
from backend.services.data.openfootball_adapter import (
    CC0_LICENSE_SHA256,
    MAX_BYTES,
    OpenFootballAdapter,
    OpenFootballError,
    normalize,
)

FIXTURES = Path(__file__).parent / "fixtures" / "openfootball"
EXCERPTS = json.loads((FIXTURES / "samples.json").read_text())
SHA = EXCERPTS["source_commit"]
NEXT_SHA = "b" * 40
OBSERVED = EXCERPTS["observed_at"]
LICENSE = (FIXTURES / "LICENSE.md").read_bytes()


def encoded(data):
    return json.dumps(data, ensure_ascii=False).encode()


def sample(index=0):
    return deepcopy(EXCERPTS["samples"][index]["payload"])


def parse(data=None, *, index=0, sha=SHA):
    selected = EXCERPTS["samples"][index]
    return normalize(
        encoded(data if data is not None else sample(index)),
        source_commit=sha,
        competition=selected["competition"],
        season_start_year=selected["year"],
        observed_at=OBSERVED,
    )


def client_for(handler):
    requests = []

    def transport(request):
        requests.append(request)
        if request.url.path.endswith("/LICENSE.md"):
            return httpx.Response(200, content=LICENSE)
        return handler(request)

    return httpx.AsyncClient(transport=httpx.MockTransport(transport)), requests


def read(adapter, sha=SHA):
    return asyncio.run(
        adapter.read(source_commit=sha, competition="en.1", season_start_year=2026)
    )


def test_verified_license_fixture():
    assert hashlib.sha256(LICENSE).hexdigest() == CC0_LICENSE_SHA256


@pytest.mark.parametrize("index", range(len(EXCERPTS["samples"])))
def test_measured_source_shapes_and_provenance(index):
    selected = EXCERPTS["samples"][index]
    snapshot = parse(index=index)
    assert snapshot.schema_version == SCHEMA_VERSION
    assert snapshot.coverage.fixture_count == len(selected["payload"]["matches"])
    assert snapshot.coverage.result_count == selected["expected_results"]
    assert snapshot.provenance.source_commit == SHA
    assert snapshot.provenance.license_spdx == "CC0-1.0"
    assert snapshot.provenance.observed_at == OBSERVED
    assert (
        snapshot.provenance.payload_sha256
        == hashlib.sha256(encoded(selected["payload"])).hexdigest()
    )
    assert snapshot.provenance.source_path == selected["source_path"]
    assert snapshot.provenance.upstream_updated_at is None
    assert snapshot.coverage.upstream_freshness == "unknown"
    assert (
        not snapshot.coverage.schedule_grid_complete
    )  # Small excerpts, not a complete season.
    for fixture in snapshot.fixtures:
        assert fixture.kickoff_utc is None and fixture.timezone is None
        assert fixture.provenance.source_pointer.startswith("/matches/")
    assert all(m.warehouse_id is None for m in snapshot.identities)


def test_zero_draw_array_is_a_result_and_cancellation_is_preserved():
    historical = parse(index=1)
    assert any(f.score.full_time == (0, 0) for f in historical.fixtures)
    cancelled = parse(index=5)
    fixture = next(f for f in cancelled.fixtures if f.status == "cancelled")
    assert fixture.source_status == "canceled" and fixture.score is None
    assert cancelled.coverage.cancelled_count == 1


def test_empty_is_incomplete_observation_not_missing_source():
    data = sample()
    data["matches"] = []
    snapshot = parse(data)
    assert snapshot.fixtures == () and snapshot.coverage.result_count == 0
    assert not snapshot.coverage.schedule_grid_complete
    assert snapshot.coverage.latest_result_date is None


def test_missing_date_time_score_and_postponement_do_not_invent_facts():
    data = sample()
    data["matches"] = [data["matches"][0]]
    m = data["matches"][0]
    for key in ("date", "time", "score"):
        del m[key]
    fixture = parse(data).fixtures[0]
    assert (fixture.date, fixture.local_time, fixture.kickoff_utc, fixture.score) == (
        None,
    ) * 4
    assert fixture.status == "unknown"
    assert "missing_status_or_result" in fixture.quality_flags
    m["status"] = "postponed"
    postponed = parse(data)
    assert postponed.fixtures[0].status == "postponed"
    assert postponed.coverage.postponed_count == 1


def test_half_time_only_is_not_a_final_or_a_zero_score():
    data = sample()
    data["matches"] = [data["matches"][0]]
    data["matches"][0]["score"] = {"ht": [0, 0]}
    fixture = parse(data).fixtures[0]
    assert fixture.status == "unknown" and fixture.score.full_time is None
    assert fixture.score.half_time == (0, 0)


def test_ids_survive_reordering_new_commit_rescheduling_and_score_correction():
    before = parse()
    data = sample()
    data["matches"][0].update(date="2026-10-10", time="15:00", score={"ft": [2, 1]})
    data["matches"].reverse()
    after = parse(data, sha=NEXT_SHA)
    assert {f.fixture_id for f in before.fixtures} == {
        f.fixture_id for f in after.fixtures
    }
    assert {m.normalized_id for m in before.identities} == {
        m.normalized_id for m in after.identities
    }
    assert (
        before.provenance.source_commit == SHA
        and after.provenance.source_commit == NEXT_SHA
    )
    renamed = sample()
    renamed["matches"][0]["team1"] = "Arsenal"
    assert parse(renamed).fixtures[0].home.team_id != before.fixtures[0].home.team_id
    # No fuzzy alias or automatic cross-provider identity merge.


def test_observation_and_mapping_are_deeply_immutable():
    snapshot = parse()
    with pytest.raises(FrozenInstanceError):
        snapshot.fixtures[0].date = "2026-10-10"
    with pytest.raises(FrozenInstanceError):
        snapshot.identities[0].warehouse_id = "1"
    serialized = snapshot.to_dict()
    serialized["fixtures"][0]["home"]["source_name"] = "changed"
    assert snapshot.fixtures[0].home.source_name != "changed"
    json.dumps(snapshot.to_dict(), allow_nan=False)


@pytest.mark.parametrize(
    "bad",
    [
        None,
        {},
        {"matches": []},
        {"name": "wrong", "matches": []},
        {"name": "English Premier League 2026/27", "matches": None},
    ],
)
def test_bad_root_is_schema_failure(bad):
    with pytest.raises(OpenFootballError, match="schema"):
        normalize(
            encoded(bad),
            source_commit=SHA,
            competition="en.1",
            season_start_year=2026,
            observed_at=OBSERVED,
        )


@pytest.mark.parametrize(
    "changes",
    [
        {"team1": None},
        {"team1": ""},
        {"team2": 7},
        {"date": "2026-02-30"},
        {"date": "20260101"},
        {"date": "2024-08-01"},
        {"time": "24:00"},
        {"score": [True, 0]},
        {"score": [1.5, 0]},
        {"score": [-1, 0]},
        {"score": [1]},
        {"score": {"ft": [1, "0"]}},
        {"score": {"FT": [1, 0]}},
        {"score": {"ft": [1, 0], "et": [2, 0]}},
        {"status": "live"},
        {"status": "postponed"},
        {"status": "canceled"},
        {"timezone": "UTC"},
    ],
)
def test_bad_late_row_fails_entire_observation(changes):
    data = sample()
    data["matches"][1].update(changes)
    with pytest.raises(OpenFootballError):
        parse(data)


def test_repeated_pair_or_self_match_is_an_identity_failure():
    data = sample()
    data["matches"].append(deepcopy(data["matches"][0]))
    with pytest.raises(OpenFootballError, match="identity"):
        parse(data)
    data = sample()
    data["matches"][0]["team2"] = data["matches"][0]["team1"]
    with pytest.raises(OpenFootballError, match="identity"):
        parse(data)


def test_pair_grid_completeness_requires_all_teams_and_ordered_pairs():
    data = sample()
    data["matches"] = [
        {"team1": f"Club {home}", "team2": f"Club {away}"}
        for home in range(20)
        for away in range(20)
        if home != away
    ]
    complete = parse(data)
    assert complete.coverage.schedule_grid_complete
    assert complete.coverage.missing_full_time_count == 380
    assert complete.coverage.missing_date_count == 380
    data["matches"].pop()
    incomplete = parse(data)
    assert incomplete.coverage.missing_ordered_pairs == 1
    assert not incomplete.coverage.schedule_grid_complete


def test_row_and_payload_limits_fail_before_normalization():
    data = sample()
    data["matches"] *= 300
    with pytest.raises(OpenFootballError, match="limit"):
        parse(data)
    with pytest.raises(OpenFootballError, match="limit"):
        normalize(
            b"x" * (MAX_BYTES + 1),
            source_commit=SHA,
            competition="en.1",
            season_start_year=2026,
            observed_at=OBSERVED,
        )


@pytest.mark.parametrize("observed", [None, "2026-10-05", "not a date"])
def test_observation_date_requires_valid_timezone(observed):
    with pytest.raises(OpenFootballError, match="schema"):
        normalize(
            encoded(sample()),
            source_commit=SHA,
            competition="en.1",
            season_start_year=2026,
            observed_at=observed,
        )


@pytest.mark.parametrize(
    "response, code",
    [
        (httpx.Response(404), "missing_source"),
        (httpx.Response(429), "http"),
        (httpx.Response(500), "http"),
        (httpx.Response(302, headers={"Location": "https://other.example"}), "http"),
        (httpx.Response(200, text="not JSON"), "schema"),
        (httpx.Response(200, json={}), "schema"),
        (httpx.Response(200, content=b"x" * (MAX_BYTES + 1)), "limit"),
    ],
)
def test_http_schema_and_size_failures_preserve_previous_commit_cache(
    tmp_path, response, code
):
    mode = [httpx.Response(200, json=sample())]
    client, requests = client_for(lambda _: mode[0])
    adapter = OpenFootballAdapter(client, cache_dir=tmp_path)
    previous = read(adapter)
    before = {
        p: (p.read_bytes(), p.stat().st_mtime_ns) for p in tmp_path.rglob("*.json")
    }
    mode[0] = response
    with pytest.raises(OpenFootballError) as failure:
        read(adapter, NEXT_SHA)
    assert failure.value.code == code
    assert all(
        (p.read_bytes(), p.stat().st_mtime_ns) == state for p, state in before.items()
    )
    assert not (tmp_path / NEXT_SHA / "2026-27/en.1.json.observation.json").exists()
    assert read(adapter) == previous


def test_transport_timeout_has_typed_error(tmp_path):
    def timeout(request):
        raise httpx.ReadTimeout("offline", request=request)

    client, _ = client_for(timeout)
    with pytest.raises(OpenFootballError, match="transport"):
        read(OpenFootballAdapter(client, cache_dir=tmp_path))


def test_license_changes_fail_before_data_request_or_cache_write(tmp_path):
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(200, text="a different license")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    with pytest.raises(OpenFootballError, match="license_changed"):
        read(OpenFootballAdapter(client, cache_dir=tmp_path))
    assert len(requests) == 1 and list(tmp_path.iterdir()) == []


@pytest.mark.parametrize("disk", [False, True])
def test_incremental_cache_reuses_original_observation_and_requests_no_network(
    tmp_path, disk
):
    client, requests = client_for(lambda _: httpx.Response(200, json=sample()))
    adapter = OpenFootballAdapter(client, cache_dir=tmp_path if disk else None)
    first = read(adapter)
    assert len(requests) == 2
    assert read(adapter) == first and len(requests) == 2
    if disk:
        restarted = OpenFootballAdapter(client, cache_dir=tmp_path)
        assert read(restarted) == first and restarted.requests_used == 0
    next_snapshot = read(adapter, NEXT_SHA)
    assert len(requests) == 4
    assert next_snapshot.provenance.source_commit == NEXT_SHA
    assert next_snapshot.provenance.payload_sha256 == first.provenance.payload_sha256


def test_corrupt_cache_fails_without_overwriting_or_refetching(tmp_path):
    client, requests = client_for(lambda _: httpx.Response(200, json=sample()))
    read(OpenFootballAdapter(client, cache_dir=tmp_path))
    path = tmp_path / SHA / "2026-27/en.1.json.observation.json"
    data = json.loads(path.read_text())
    data["source_commit"] = NEXT_SHA
    path.write_text(json.dumps(data))
    content = path.read_bytes()
    with pytest.raises(OpenFootballError, match="cache"):
        read(OpenFootballAdapter(client, cache_dir=tmp_path))
    assert path.read_bytes() == content and len(requests) == 2


def test_cache_publish_cannot_overwrite_an_existing_observation(tmp_path):
    client, _ = client_for(lambda _: httpx.Response(200, json=sample()))
    adapter = OpenFootballAdapter(client, cache_dir=tmp_path)
    first = read(adapter)
    path = tmp_path / SHA / "2026-27/en.1.json.observation.json"
    before = (path.read_bytes(), path.stat().st_mtime_ns)
    adapter._publish(
        SHA, "2026-27/en.1.json", encoded(sample()), "2026-10-06T01:00:00+00:00"
    )
    assert (path.read_bytes(), path.stat().st_mtime_ns) == before
    assert read(adapter) == first


def test_request_budget_is_a_hard_cap_and_does_not_retry():
    client, requests = client_for(lambda _: httpx.Response(200, json=sample()))
    adapter = OpenFootballAdapter(client, max_requests=2)
    read(adapter)
    with pytest.raises(OpenFootballError, match="budget"):
        read(adapter, NEXT_SHA)
    assert len(requests) == 2


@pytest.mark.parametrize(
    "sha,competition,year",
    [
        ("master", "en.1", 2026),
        (SHA, "../en.1", 2026),
        (SHA, "en.1", True),
        (SHA, "en.1", 1900),
    ],
)
def test_selection_is_validated_before_any_network(sha, competition, year):
    client, requests = client_for(lambda _: httpx.Response(200, json=sample()))
    with pytest.raises(OpenFootballError, match="selection"):
        asyncio.run(
            OpenFootballAdapter(client).read(
                source_commit=sha, competition=competition, season_start_year=year
            )
        )
    assert requests == []


def test_cli_rejects_bulk_selection_before_network(capsys):
    args = ["--source-commit", SHA]
    for year in range(2020, 2026):
        args += ["--sample", f"en.1:{year}"]
    assert audit_main(args) == 1
    assert "at most five" in capsys.readouterr().err


def test_cli_audits_explicit_selection_and_reuses_cache(tmp_path, monkeypatch, capsys):
    client, requests = client_for(lambda _: httpx.Response(200, json=sample()))
    monkeypatch.setattr(
        "backend.scripts.audit_openfootball.httpx.AsyncClient", lambda **_: client
    )
    args = [
        "--source-commit",
        SHA,
        "--sample",
        "en.1:2026",
        "--sample",
        "en.1:2026",
        "--cache-dir",
        str(tmp_path),
    ]
    assert audit_main(args) == 0
    report = json.loads(capsys.readouterr().out)
    assert report["requests_used"] == 2 and len(report["samples"]) == 1
    assert report["samples"][0]["coverage"]["upstream_freshness"] == "unknown"
    assert len(requests) == 2
