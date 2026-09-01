"""The vendor capture: what it records, and what it refuses to record.

A bought forecast is only comparable to ours if it was captured the same way
ours is — before kickoff, unmodified, append-only. These pin the three places
that can quietly stop being true: the point-in-time stamp, the parsing of a
percentage the vendor may not have given, and a rate limit the vendor reports
inside a 200 response.
"""
import io
import json
import urllib.error
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
            headers = {}

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
            headers = {}

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
            headers = {}

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                return json.dumps(body).encode()

        monkeypatch.setattr(cvp.urllib.request, "urlopen", lambda *a, **k: Resp())
        monkeypatch.setattr(cvp.json, "load", lambda fh: json.loads(fh.read()))
        assert cvp.get("x", "k") == body


class TestDailyQuota:
    def test_get_reads_the_days_remaining_from_the_headers(self, monkeypatch):
        class Resp:
            headers = {"x-ratelimit-requests-remaining": "63"}

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                return json.dumps({"errors": [], "response": []}).encode()

        monkeypatch.setattr(cvp.urllib.request, "urlopen", lambda *a, **k: Resp())
        monkeypatch.setattr(cvp.json, "load", lambda fh: json.loads(fh.read()))
        meter = {"remaining": None}
        cvp.get("x", "k", meter=meter)
        assert meter["remaining"] == 63

    def test_capture_stops_at_the_reserve_instead_of_spending_it(
        self, monkeypatch, tmp_path
    ):
        # The 100/day quota belongs to the KEY, and the schedule alone is
        # eight invocations against it. `--max-requests` cannot see the other
        # seven — the vendor's remaining-count header can, so a day that is
        # nearly spent captures nothing rather than reaching the cap, which
        # is what got the account suspended on 2026-08-28.
        asked = []

        def fake_get(path, key, *, pause=0.0, retries=3, meter=None):
            asked.append(path)
            if meter is not None:
                meter["remaining"] = cvp.DAILY_RESERVE  # already at the floor
            return {"errors": [], "response": [fixture(fid=1), fixture(fid=2)]}

        monkeypatch.setattr(cvp, "get", fake_get)
        rows, used, left = cvp.capture("2026-08-28", "k", 30, tmp_path / "v.jsonl")
        assert rows == [] and used == 1 and left == cvp.DAILY_RESERVE
        assert asked == ["fixtures?date=2026-08-28"], "no predictions may be bought"

    def test_capture_proceeds_when_the_day_has_room(self, monkeypatch, tmp_path):
        def fake_get(path, key, *, pause=0.0, retries=3, meter=None):
            if meter is not None:
                meter["remaining"] = 80
            if path.startswith("fixtures"):
                return {"errors": [], "response": [fixture(fid=1), fixture(fid=2)]}
            return prediction({"home": "45%", "draw": "45%", "away": "10%"})

        monkeypatch.setattr(cvp, "get", fake_get)
        rows, used, left = cvp.capture("2026-08-28", "k", 30, tmp_path / "v.jsonl")
        assert len(rows) == 2 and used == 3 and left == 80


SUSPENDED = {"access": "Your account is suspended, check on https://dashboard.api-football.com."}


class TestVendorRefusal:
    def test_carries_the_vendors_key_and_prose(self):
        exc = cvp.VendorRefusal("fixtures?date=2026-08-29", SUSPENDED)
        assert exc.reason == "access"
        assert exc.message == SUSPENDED["access"]
        assert "suspended" in str(exc) and "fixtures?date=2026-08-29" in str(exc)


class TestHttpRefusals:
    """The vendor also says no as a bare status code, with no JSON `errors`.

    Measured 2026-09-01: an invalid key is HTTP 403 with an empty body. Left as
    a traceback, a revoked key would fail every scheduled run exactly the way
    the suspension did — so the codes that mean "the vendor will not serve
    us" become the same recorded refusal, and only a wrong request of OURS
    (any other 4xx) is still a crash.
    """

    @staticmethod
    def raising(monkeypatch, code, reason="", body=b""):
        def boom(*a, **k):
            raise urllib.error.HTTPError("https://x", code, reason, {}, io.BytesIO(body))

        monkeypatch.setattr(cvp.urllib.request, "urlopen", boom)
        monkeypatch.setattr(cvp.time, "sleep", lambda *_: None)

    def test_a_bare_403_is_a_refusal_keyed_on_the_status(self, monkeypatch):
        self.raising(monkeypatch, 403, "Forbidden")
        with pytest.raises(cvp.VendorRefusal) as info:
            cvp.get("fixtures?date=2026-09-01", "bogus")
        assert info.value.reason == "http_403" and info.value.message == "Forbidden"

    def test_a_json_body_keeps_the_vendors_own_key(self, monkeypatch):
        self.raising(monkeypatch, 403, "Forbidden", json.dumps({"errors": SUSPENDED}).encode())
        with pytest.raises(cvp.VendorRefusal) as info:
            cvp.get("fixtures?date=2026-09-01", "k")
        assert info.value.reason == "access"

    def test_a_vendor_outage_is_a_refusal(self, monkeypatch):
        self.raising(monkeypatch, 503, "Service Unavailable")
        with pytest.raises(cvp.VendorRefusal) as info:
            cvp.get("fixtures?date=2026-09-01", "k")
        assert info.value.reason == "http_503"

    def test_our_own_bad_request_is_still_a_crash(self, monkeypatch):
        self.raising(monkeypatch, 404, "Not Found")
        with pytest.raises(urllib.error.HTTPError):
            cvp.get("fixturez?date=2026-09-01", "k")

    def test_a_429_is_retried_then_recorded_if_it_persists(self, monkeypatch):
        self.raising(monkeypatch, 429, "Too Many Requests")
        with pytest.raises(cvp.VendorRefusal) as info:
            cvp.get("fixtures?date=2026-09-01", "k", retries=2)
        assert info.value.reason == "http_429"


class TestVendorStatus:
    """The record that turns a refusal from a daily alarm into a state.

    The account was suspended on 2026-08-28 and the schedule then failed the
    same way four times a day. What the workflow needs to know is not "did the
    vendor refuse" but "is this the same refusal I already reported" — and
    that is exactly what `since` being carried forward encodes.
    """

    NOW = datetime(2026, 9, 1, 8, 0, tzinfo=timezone.utc)
    EARLIER = datetime(2026, 8, 28, 13, 49, tzinfo=timezone.utc)

    def test_a_first_refusal_starts_the_clock_now(self, tmp_path):
        status, previous = cvp.record_status(
            tmp_path / "s.json", cvp.VendorRefusal("x", SUSPENDED), self.NOW
        )
        assert previous is None
        assert status["state"] == "refused" and status["reason"] == "access"
        assert status["since"] == "2026-09-01T08:00:00+00:00"
        assert not cvp.same_state(status, previous)

    def test_the_same_refusal_keeps_the_original_since(self, tmp_path):
        path = tmp_path / "s.json"
        cvp.record_status(path, cvp.VendorRefusal("x", SUSPENDED), self.EARLIER)
        status, previous = cvp.record_status(path, cvp.VendorRefusal("y", SUSPENDED), self.NOW)
        assert status["since"] == "2026-08-28T13:49:00+00:00"
        assert cvp.same_state(status, previous)

    def test_the_prose_may_change_without_it_being_news(self, tmp_path):
        # Same key, reworded notice: still the same suspension.
        path = tmp_path / "s.json"
        cvp.record_status(path, cvp.VendorRefusal("x", SUSPENDED), self.EARLIER)
        status, previous = cvp.record_status(
            path, cvp.VendorRefusal("x", {"access": "Account suspended."}), self.NOW
        )
        assert cvp.same_state(status, previous)
        assert status["since"] == "2026-08-28T13:49:00+00:00"

    def test_a_different_reason_is_a_new_refusal(self, tmp_path):
        path = tmp_path / "s.json"
        cvp.record_status(path, cvp.VendorRefusal("x", SUSPENDED), self.EARLIER)
        quota = cvp.VendorRefusal("predictions?fixture=1", {"requests": "daily limit reached"})
        status, previous = cvp.record_status(path, quota, self.NOW)
        assert not cvp.same_state(status, previous)
        assert status["reason"] == "requests"
        assert status["since"] == "2026-09-01T08:00:00+00:00"

    def test_recovery_is_recorded_as_ok(self, tmp_path):
        path = tmp_path / "s.json"
        cvp.record_status(path, cvp.VendorRefusal("x", SUSPENDED), self.EARLIER)
        status, previous = cvp.record_status(path, None, self.NOW)
        assert status["state"] == "ok"
        assert status["reason"] is None and status["message"] is None
        assert previous["state"] == "refused"

    def test_the_file_only_changes_on_a_transition(self, tmp_path):
        # The workflow commits this file. A check that finds the same state
        # must leave the bytes alone, or every six-hourly run becomes a commit.
        path = tmp_path / "s.json"
        cvp.record_status(path, cvp.VendorRefusal("x", SUSPENDED), self.EARLIER)
        before = path.read_bytes()
        cvp.record_status(path, cvp.VendorRefusal("x", SUSPENDED), self.NOW)
        assert path.read_bytes() == before

    def test_an_unreadable_record_counts_as_no_record(self, tmp_path):
        path = tmp_path / "s.json"
        path.write_text("{ not json", encoding="utf8")
        assert cvp.read_status(path) is None
        path.write_text("[]", encoding="utf8")
        assert cvp.read_status(path) is None


class TestMainExitCodes:
    """What the workflow sees: 0 when served, 75 when refused — and new or known."""

    @pytest.fixture
    def paths(self, tmp_path, monkeypatch):
        gh = tmp_path / "github_output"
        gh.write_text("", encoding="utf8")
        monkeypatch.setenv("API_FOOTBALL", "k")
        monkeypatch.setenv("GITHUB_OUTPUT", str(gh))
        return {"out": tmp_path / "v.jsonl", "status": tmp_path / "s.json", "gh": gh}

    @staticmethod
    def args(paths, *extra):
        return ["--out", str(paths["out"]), "--status", str(paths["status"]), *extra]

    @staticmethod
    def refusing(monkeypatch):
        def refuse(date, key, budget, out, pause=10.0):
            raise cvp.VendorRefusal(f"fixtures?date={date}", SUSPENDED)

        monkeypatch.setattr(cvp, "capture", refuse)

    def test_a_new_refusal_exits_75_and_is_an_error(self, paths, monkeypatch, capsys):
        self.refusing(monkeypatch)
        assert cvp.main(self.args(paths)) == cvp.EXIT_REFUSED == 75
        assert json.loads(paths["status"].read_text(encoding="utf8"))["state"] == "refused"
        assert "vendor_refused=new" in paths["gh"].read_text(encoding="utf8")
        assert "::error::" in capsys.readouterr().out

    def test_a_known_refusal_is_a_warning_not_an_error(self, paths, monkeypatch, capsys):
        self.refusing(monkeypatch)
        cvp.main(self.args(paths))
        paths["gh"].write_text("", encoding="utf8")
        capsys.readouterr()

        assert cvp.main(self.args(paths)) == cvp.EXIT_REFUSED
        out = capsys.readouterr().out
        assert "::warning::" in out and "::error::" not in out
        assert "since " in out, "the warning should say how long this has been going on"
        assert "vendor_refused=known" in paths["gh"].read_text(encoding="utf8")

    def test_a_served_run_records_ok_and_announces_the_recovery(
        self, paths, monkeypatch, capsys
    ):
        self.refusing(monkeypatch)
        cvp.main(self.args(paths))
        monkeypatch.setattr(cvp, "capture", lambda *a, **k: ([], 1, 80))
        capsys.readouterr()

        assert cvp.main(self.args(paths)) == 0
        assert json.loads(paths["status"].read_text(encoding="utf8"))["state"] == "ok"
        assert "::notice::" in capsys.readouterr().out

    def test_a_served_run_with_no_history_is_quiet(self, paths, monkeypatch, capsys):
        monkeypatch.setattr(cvp, "capture", lambda *a, **k: ([], 1, 80))
        assert cvp.main(self.args(paths)) == 0
        assert "::" not in capsys.readouterr().out
        assert json.loads(paths["status"].read_text(encoding="utf8"))["state"] == "ok"

    def test_days_walks_consecutive_dates(self, paths, monkeypatch):
        asked = []

        def fake(date, key, budget, out, pause=10.0):
            asked.append(date)
            return [], 1, 80

        monkeypatch.setattr(cvp, "capture", fake)
        assert cvp.main(self.args(paths, "--date", "2026-08-31", "--days", "2")) == 0
        assert asked == ["2026-08-31", "2026-09-01"], "month boundary included"

    def test_a_dry_run_leaves_the_record_alone(self, paths, monkeypatch):
        self.refusing(monkeypatch)
        assert cvp.main(self.args(paths, "--dry-run")) == cvp.EXIT_REFUSED
        assert not paths["status"].exists()
        assert paths["gh"].read_text(encoding="utf8") == ""
