"""The vendor capture: what it records, and what it refuses to record.

A bought forecast is only comparable to ours if it was captured the same way
ours is — before kickoff, unmodified, append-only. These pin the three places
that can quietly stop being true: the point-in-time stamp, the parsing of a
percentage the vendor may not have given, and a rate limit the vendor reports
inside a 200 response.
"""
import json
from datetime import datetime, timedelta, timezone

import pytest

from backend.scripts import capture_vendor_predictions as cvp

KICKOFF = "2026-08-15T17:30:00+00:00"


def fixture(league="La Liga", country="Spain", fid=1, kickoff=KICKOFF):
    return {
        "fixture": {"id": fid, "date": kickoff, "status": {"short": "NS"}},
        "league": {"id": 140, "name": league, "country": country},
        "teams": {"home": {"name": "Alaves"}, "away": {"name": "Getafe"}},
    }


def prediction(percent):
    return {"response": [{"predictions": {"percent": percent}}]}


class TestParsePercent:
    def test_reads_the_vendors_string(self):
        assert cvp.parse_percent("45%") == pytest.approx(0.45)

    def test_keeps_a_zero_as_a_zero(self):
        # "0%" is a real answer and an impossible claim: if that outcome
        # happens, log loss is infinite. It must survive to be scored, not be
        # rounded into something defensible.
        assert cvp.parse_percent("0%") == 0.0

    def test_refuses_anything_it_cannot_read(self):
        for junk in (None, "", "45", 45, "n/a%", {}):
            assert cvp.parse_percent(junk) is None


class TestServedFixtures:
    def test_keeps_only_the_leagues_we_forecast(self):
        payload = {
            "response": [
                fixture(),
                fixture(league="Serie B", country="Italy", fid=2),
                fixture(league="Eredivisie", country="Netherlands", fid=3),
            ]
        }
        got = cvp.served_fixtures(payload)
        assert [g["competition_id"] for g in got] == ["esp.1", "ned.1"]

    def test_matches_on_country_as_well_as_name(self):
        # "Premier League" is also the name of competitions in Russia, Egypt
        # and a dozen other countries.
        payload = {"response": [fixture(league="Premier League", country="Russia")]}
        assert cvp.served_fixtures(payload) == []

    def test_survives_a_payload_with_nothing_in_it(self):
        assert cvp.served_fixtures({}) == []
        assert cvp.served_fixtures({"response": None}) == []


class TestRowFor:
    def test_records_the_triple_and_what_it_sums_to(self):
        row = cvp.row_for(
            {"fixture": fixture(), "competition_id": "esp.1"},
            prediction({"home": "45%", "draw": "45%", "away": "10%"}),
            datetime(2026, 8, 15, 12, 0, tzinfo=timezone.utc),
        )
        assert (row["p_home"], row["p_draw"], row["p_away"]) == (0.45, 0.45, 0.10)
        assert row["sums_to"] == pytest.approx(1.0)
        assert row["percent_raw"] == {"home": "45%", "draw": "45%", "away": "10%"}

    def test_marks_a_capture_that_beat_kickoff(self):
        row = cvp.row_for(
            {"fixture": fixture(), "competition_id": "esp.1"},
            prediction({"home": "45%", "draw": "45%", "away": "10%"}),
            datetime.fromisoformat(KICKOFF) - timedelta(hours=3),
        )
        assert row["before_kickoff"] is True

    def test_marks_a_capture_that_did_not(self):
        # The whole reason this file exists. A number fetched after the final
        # whistle is not a forecast, whoever sold it.
        row = cvp.row_for(
            {"fixture": fixture(), "competition_id": "esp.1"},
            prediction({"home": "45%", "draw": "45%", "away": "10%"}),
            datetime.fromisoformat(KICKOFF) + timedelta(hours=3),
        )
        assert row["before_kickoff"] is False

    def test_records_a_missing_prediction_as_missing(self):
        row = cvp.row_for(
            {"fixture": fixture(), "competition_id": "esp.1"},
            {"response": []},
            datetime(2026, 8, 15, 12, 0, tzinfo=timezone.utc),
        )
        assert row["p_home"] is None and row["sums_to"] is None


class TestIdempotence:
    def test_a_second_run_captures_nothing_twice(self, tmp_path):
        path = tmp_path / "v.jsonl"
        path.write_text(
            json.dumps({"vendor": "api-football", "fixture_id": 7}) + "\n", encoding="utf8"
        )
        assert ("api-football", 7) in cvp.already_captured(path)
        assert ("api-football", 8) not in cvp.already_captured(path)

    def test_a_half_written_line_does_not_lose_the_rest(self, tmp_path):
        path = tmp_path / "v.jsonl"
        path.write_text(
            '{"vendor": "api-football", "fixture_id": 1}\n{ broken\n'
            '{"vendor": "api-football", "fixture_id": 2}\n',
            encoding="utf8",
        )
        seen = cvp.already_captured(path)
        assert ("api-football", 1) in seen and ("api-football", 2) in seen

    def test_appends_rather_than_rewrites(self, tmp_path):
        path = tmp_path / "v.jsonl"
        cvp.append([{"vendor": "api-football", "fixture_id": 1}], path)
        cvp.append([{"vendor": "api-football", "fixture_id": 2}], path)
        assert len(path.read_text(encoding="utf8").strip().splitlines()) == 2


class TestRateLimit:
    def test_a_rate_limit_inside_a_200_is_not_an_empty_day(self, monkeypatch):
        # api-football reports a rate limit two ways, and one of them is HTTP
        # 200 with `{"errors": {"rateLimit": ...}}` and no fixtures. Reading
        # only the status code made a throttled run report "0 forecasts" and
        # look like a quiet day.
        calls = {"n": 0}

        class Resp:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                calls["n"] += 1
                return json.dumps({"errors": {"rateLimit": "too many"}, "response": []}).encode()

        monkeypatch.setattr(cvp.urllib.request, "urlopen", lambda *a, **k: Resp())
        monkeypatch.setattr(cvp.time, "sleep", lambda *_: None)
        monkeypatch.setattr(cvp.json, "load", lambda fh: json.loads(fh.read()))

        with pytest.raises(RuntimeError):
            cvp.get("fixtures?date=2026-08-15", "k", retries=2)
        assert calls["n"] == 2, "it should have retried rather than given up on the first"

    def test_a_suspended_account_is_not_retried_as_a_rate_limit(self, monkeypatch):
        # 2026-08-28: the account was suspended mid-run and the log read
        # "rate limited, waiting 20s ... 40s" before a traceback. Backoff
        # cannot lift a suspension — the first such answer must raise, in
        # the vendor's own words, without sleeping on it.
        calls = {"n": 0}

        class Resp:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                calls["n"] += 1
                return json.dumps(
                    {"errors": {"access": "Your account is suspended"}, "response": []}
                ).encode()

        def no_sleep(*_):
            raise AssertionError("an unretryable refusal must not back off")

        monkeypatch.setattr(cvp.urllib.request, "urlopen", lambda *a, **k: Resp())
        monkeypatch.setattr(cvp.time, "sleep", no_sleep)
        monkeypatch.setattr(cvp.json, "load", lambda fh: json.loads(fh.read()))

        with pytest.raises(cvp.VendorRefusal, match="suspended"):
            cvp.get("predictions?fixture=1", "k")
        assert calls["n"] == 1, "it should have raised on the first answer"

    def test_a_clean_body_is_returned_untouched(self, monkeypatch):
        body = {"errors": [], "response": [fixture()]}

        class Resp:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                return json.dumps(body).encode()

        monkeypatch.setattr(cvp.urllib.request, "urlopen", lambda *a, **k: Resp())
        monkeypatch.setattr(cvp.json, "load", lambda fh: json.loads(fh.read()))
        assert cvp.get("x", "k") == body
