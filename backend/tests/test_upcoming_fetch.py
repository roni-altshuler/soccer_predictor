"""Offline coverage of the ESPN schedule contract and publication failure gate."""

from pathlib import Path

import httpx
import pytest
import yaml

from backend.scripts.predict_upcoming import fetch_upcoming_matches


def event(event_id="123"):
    return {
        "id": event_id, "date": "2026-10-03T15:00Z",
        "competitions": [{"status": {"type": {"name": "STATUS_SCHEDULED"}},
                          "competitors": [
                              {"homeAway": "home", "team": {"displayName": "Home"}},
                              {"homeAway": "away", "team": {"displayName": "Away"}},
                          ]}],
    }


@pytest.mark.asyncio
async def test_range_rejection_retries_each_day_and_deduplicates():
    dates = []

    def respond(request):
        date = request.url.params["dates"]
        dates.append(date)
        if "-" in date:
            return httpx.Response(400)
        return httpx.Response(200, json={"events": [event()]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        matches = await fetch_upcoming_matches(client, "eng.1", days_ahead=1)
    assert len(dates) == 3
    assert dates[1:] == dates[0].split("-")
    assert [m["id"] for m in matches] == ["123"]


@pytest.mark.asyncio
async def test_valid_empty_schedule_is_successful():
    async with httpx.AsyncClient(transport=httpx.MockTransport(
        lambda request: httpx.Response(200, json={"events": []})
    )) as client:
        assert await fetch_upcoming_matches(client, "eng.1") == []


@pytest.mark.asyncio
@pytest.mark.parametrize("response", [
    httpx.Response(503), httpx.Response(200, json={}),
    httpx.Response(200, json={"events": None}),
    httpx.Response(200, text="not json"),
    httpx.Response(200, json={"events": [{}]}),
])
async def test_failures_are_not_empty_schedules(response):
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: response)) as client:
        with pytest.raises(RuntimeError, match="eng.1"):
            await fetch_upcoming_matches(client, "eng.1")


@pytest.mark.asyncio
async def test_daily_failure_cannot_publish_a_partial_schedule():
    calls = 0

    def respond(request):
        nonlocal calls
        calls += 1
        if calls == 1:
            return httpx.Response(400)
        if calls == 2:
            return httpx.Response(200, json={"events": [event()]})
        return httpx.Response(503)

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        with pytest.raises(RuntimeError):
            await fetch_upcoming_matches(client, "eng.1", days_ahead=1)


def test_prediction_failure_blocks_feedback_and_publication():
    path = Path(__file__).resolve().parents[2] / ".github/workflows/prediction_pipeline.yml"
    steps = yaml.safe_load(path.read_text())["jobs"]["prediction-pipeline"]["steps"]
    generate = next(s for s in steps if s.get("name") == "Generate new predictions")
    assert not generate.get("continue-on-error", False)
    for name in ("Run training feedback", "Commit updated predictions"):
        step = next(s for s in steps if s.get("name") == name)
        assert step.get("if", "success()") == "success()"
