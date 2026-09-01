"""Capture a vendor's pre-match probabilities so they can be scored against ours.

WHY THIS EXISTS
---------------
The question is whether a bought forecast beats the one we fit. That is a fair
question and it is answerable, but only one way: score both on the same
fixtures against what actually happened.

**It has to be captured FORWARD.** Asking a vendor today what it thinks of a
match played last season returns a number computed today, and nothing in the
response says whether it could have been acted on before kickoff. This project
already has that rule for its own forecasts — `final_before_kickoff()` exists
because a snapshot stamped after kickoff "would flatter the model and it is not
a forecast" — and buying a number does not exempt it. So every row here records
`captured_at`, and a capture that did not beat kickoff is written with
`before_kickoff: false` rather than quietly counted later.

WHAT THE FREE PLAN ACTUALLY ALLOWS (measured 2026-08-15)
-------------------------------------------------------
`season=` is refused — "Free plans do not have access to this season, try from
2022 to 2024" — but the data is not: `fixtures?date=<today>` returned 1,216
fixtures including 18 in our nine leagues at season 2026, and `predictions?
fixture=<id>` answered for them. One call for the day plus one per fixture is
roughly 20 of the 100 daily requests.

Leagues are matched by (country, league name), not by a hard-coded id table.
Five of the nine ids were verified live; the other four were not playing that
day, and writing down four ids nobody has checked is how a table drifts into
being wrong about one league in silence.

WHEN THE VENDOR REFUSES US
--------------------------
A suspended account, an exhausted quota or a revoked key is not a bug here and
not a quiet day either: it is a state, and it is recorded as one. The vendor's
own words go into `backend/data/diagnostics/vendor_status.json` together with
when they were first heard, and the run exits `EXIT_REFUSED` (75) so the
workflow can tell "the vendor said no" from "the script crashed". The account
was suspended on 2026-08-28 and the schedule then failed identically four
times a day; the record is what lets a refusal be reported ONCE, when it is
new, rather than on every run until someone fixes it at the dashboard.

    python3 -m backend.scripts.capture_vendor_predictions          # today
    python3 -m backend.scripts.capture_vendor_predictions --date 2026-08-16
    python3 -m backend.scripts.capture_vendor_predictions --days 2  # today + tomorrow
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

HOST = "https://v3.football.api-sports.io"
VENDOR = "api-football"

# The exit status for "the vendor answered, and the answer was no" — distinct
# from 1 so a caller can treat it as a recorded state rather than a crash.
EXIT_REFUSED = 75

# Stop asking for predictions once the DAY has this many requests left. The
# 100/day quota is spent by the whole key, not by one invocation — the
# schedule alone is eight invocations (four runs over two dates), plus
# retries, plus any hand run — and `--max-requests` bounds only its own
# invocation, so no local number can promise the day stays under the cap.
# The vendor can: every response carries `x-ratelimit-requests-remaining`,
# the day's true remaining after everything the key has done. Capture stops
# at this floor, whoever spent the rest.
DAILY_RESERVE = 15

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "backend" / "data" / "predictions" / "vendor_predictions.jsonl"
STATUS = ROOT / "backend" / "data" / "diagnostics" / "vendor_status.json"

# (country, league name as the vendor writes it) -> our competition id.
SERVED: Dict[Tuple[str, str], str] = {
    ("England", "Premier League"): "eng.1",
    ("Spain", "La Liga"): "esp.1",
    ("Germany", "Bundesliga"): "ger.1",
    ("Italy", "Serie A"): "ita.1",
    ("France", "Ligue 1"): "fra.1",
    ("Netherlands", "Eredivisie"): "ned.1",
    ("Portugal", "Primeira Liga"): "por.1",
    ("Turkey", "Süper Lig"): "tur.1",
    ("USA", "Major League Soccer"): "usa.1",
}


def read_key() -> Optional[str]:
    """The key from the environment, or from `.env.local` for a local run."""
    key = os.environ.get("API_FOOTBALL")
    if key:
        return key.strip()
    env = ROOT / ".env.local"
    if not env.exists():
        return None
    for line in env.read_text(encoding="utf8").splitlines():
        if line.startswith("API_FOOTBALL="):
            return line.split("=", 1)[1].strip()
    return None


def _read_quota(headers, meter: Optional[dict]) -> None:
    """Record the day's remaining quota from a response's own headers.

    Read on every answer, including a 429 — a throttled request still spends
    quota, and its headers still tell the truth about what is left.
    """
    if meter is None or headers is None:
        return
    remaining = headers.get("x-ratelimit-requests-remaining")
    if remaining is not None:
        try:
            meter["remaining"] = int(remaining)
        except ValueError:
            pass


class VendorRefusal(RuntimeError):
    """The vendor answered, and the answer is that it will not serve us.

    A suspended account or an exhausted daily quota is an operational state
    with a human fix (the dashboard, or midnight UTC), not a bug in this
    script — so it deserves one clear line naming the vendor's own words,
    not a traceback that reads like our code broke.

    `reason` is the vendor's error key(s) (`access`, `requests`, `token`,
    `rateLimit`...) and is what decides whether two refusals are the same
    state; `message` is its prose, kept for the record.
    """

    def __init__(self, path: str, errors: dict):
        super().__init__(f"{path}: {errors}")
        self.path = path
        self.errors = dict(errors)
        self.reason = ",".join(sorted(str(k) for k in errors))
        self.message = "; ".join(str(v) for v in errors.values())


def _http_refusal(exc: urllib.error.HTTPError) -> dict:
    """The vendor's words for a refusal it sent as an HTTP status, not JSON.

    An invalid key is answered with a bare 403 (measured 2026-09-01), so the
    body may carry the usual `errors` object, a `message`, or nothing. Prefer
    the vendor's own key when it gave one; otherwise key on the status code so
    a 403 and a 503 are recorded as different states.
    """
    try:
        body = json.loads(exc.read().decode("utf8", "replace"))
    except (ValueError, OSError, AttributeError):
        body = None
    detail = None
    if isinstance(body, dict):
        errors = body.get("errors")
        if isinstance(errors, dict) and errors:
            return errors
        detail = body.get("message")
    return {f"http_{exc.code}": str(detail or exc.reason)}


def get(
    path: str,
    key: str,
    *,
    pause: float = 0.0,
    retries: int = 3,
    meter: Optional[dict] = None,
) -> dict:
    """One call, throttled.

    The free plan caps requests per MINUTE as well as per day, and it answers
    the eleventh with a bare 429 — the first run captured nine fixtures and
    lost the other nine to it. Sleeping between calls costs nothing (a daily
    capture is twenty requests) and losing half a matchday costs a day.

    Only a rate limit is worth backing off for. The vendor files every other
    refusal under the same `errors` key, and on 2026-08-28 a suspended
    account spent a minute being retried as "rate limited" before dying on
    the third identical answer. Waiting cannot lift a suspension or refill a
    daily quota — anything that is not a rate limit raises immediately.
    """
    req = urllib.request.Request(f"{HOST}/{path}", headers={"x-apisports-key": key})
    for attempt in range(retries):
        limited = False
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = json.load(resp)
                _read_quota(resp.headers, meter)
            # The vendor reports a rate limit BOTH ways: sometimes HTTP 429,
            # sometimes HTTP 200 carrying `{"errors": {"rateLimit": ...}}` and
            # an empty response. Reading only the status code makes the second
            # form look like a day with no fixtures — which is what happened:
            # a run reported "0 forecasts, 1 request used" and nothing was
            # wrong-looking about it.
            errors = body.get("errors")
            if isinstance(errors, dict) and errors:
                if set(errors) != {"rateLimit"} or attempt == retries - 1:
                    raise VendorRefusal(path, errors)
                limited = True
            else:
                if pause:
                    time.sleep(pause)
                return body
        except urllib.error.HTTPError as exc:
            _read_quota(exc.headers, meter)
            if exc.code == 429 and attempt < retries - 1:
                limited = True
            elif exc.code in (401, 403, 429) or exc.code >= 500:
                # Also the vendor saying no, just not in JSON: an invalid or
                # revoked key is a bare 403, an outage a 5xx, and a rate limit
                # that outlasts the retries is the same state as its 200-form
                # twin above. Any other 4xx means OUR request is wrong, which
                # is a bug here and stays a crash.
                raise VendorRefusal(path, _http_refusal(exc)) from exc
            else:
                raise
        if limited:
            back = 20.0 * (attempt + 1)
            print(f"  rate limited, waiting {back:.0f}s", file=sys.stderr)
            time.sleep(back)
    raise RuntimeError("unreachable")


def parse_percent(value: object) -> Optional[float]:
    """`"45%"` -> 0.45. Anything else -> None, never a guessed number."""
    if not isinstance(value, str) or not value.endswith("%"):
        return None
    try:
        return float(value[:-1]) / 100.0
    except ValueError:
        return None


def served_fixtures(payload: dict) -> List[dict]:
    out = []
    for f in payload.get("response") or []:
        league = f.get("league") or {}
        cid = SERVED.get((league.get("country"), league.get("name")))
        if cid:
            out.append({"fixture": f, "competition_id": cid})
    return out


def already_captured(path: Path) -> set:
    seen = set()
    if not path.exists():
        return seen
    for line in path.read_text(encoding="utf8").splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        seen.add((row.get("vendor"), row.get("fixture_id")))
    return seen


def row_for(entry: dict, prediction: dict, captured_at: datetime) -> dict:
    f = entry["fixture"]
    fixture = f.get("fixture") or {}
    teams = f.get("teams") or {}
    kickoff = fixture.get("date") or ""
    pred = ((prediction.get("response") or [{}])[0].get("predictions") or {})
    percent = pred.get("percent") or {}
    p_home = parse_percent(percent.get("home"))
    p_draw = parse_percent(percent.get("draw"))
    p_away = parse_percent(percent.get("away"))
    total = None
    if None not in (p_home, p_draw, p_away):
        total = round(p_home + p_draw + p_away, 6)

    before = None
    if kickoff:
        try:
            before = captured_at < datetime.fromisoformat(kickoff.replace("Z", "+00:00"))
        except ValueError:
            before = None

    return {
        "vendor": VENDOR,
        "captured_at": captured_at.isoformat(),
        "fixture_id": fixture.get("id"),
        "competition_id": entry["competition_id"],
        "kickoff": kickoff,
        # The vendor's spelling. Joining to our forecast is a separate step and
        # must be able to see exactly what it was given.
        "home": (teams.get("home") or {}).get("name"),
        "away": (teams.get("away") or {}).get("name"),
        "p_home": p_home,
        "p_draw": p_draw,
        "p_away": p_away,
        # Kept raw as well: "0%" is a real answer the vendor gave, and it is a
        # claim no result can ever justify — rounding it away would hide that.
        "percent_raw": percent,
        "sums_to": total,
        "before_kickoff": before,
    }


def capture(
    date: str, key: str, budget: int, out: Path, pause: float = 10.0
) -> Tuple[List[dict], int, Optional[int]]:
    used = 0
    meter: dict = {"remaining": None}
    day = get(f"fixtures?date={date}", key, pause=pause, meter=meter)
    used += 1
    if meter["remaining"] is None:
        # Without the header the reserve cannot be honoured and only the
        # per-invocation budget is protecting the day. Say so rather than
        # silently flying blind — the vendor has always sent it.
        print("  !! no daily-quota header on the response; "
              "capturing on the request budget alone", file=sys.stderr)
    entries = served_fixtures(day)
    seen = already_captured(out)
    rows: List[dict] = []
    now = datetime.now(timezone.utc)

    for entry in entries:
        fid = (entry["fixture"].get("fixture") or {}).get("id")
        if fid is None or (VENDOR, fid) in seen:
            continue
        if meter["remaining"] is not None and meter["remaining"] <= DAILY_RESERVE:
            # Deliberate and printed, not a masked failure: the next run is
            # six hours away and the quota day will have moved on. A fixture
            # kicking off before then is lost to the reserve — which is still
            # cheaper than the suspension that losing the whole KEY costs.
            print(
                f"stopping at the daily-quota reserve "
                f"({meter['remaining']} of the day left, floor {DAILY_RESERVE})",
                file=sys.stderr,
            )
            break
        if used >= budget:
            print(f"stopping at the request budget ({budget})", file=sys.stderr)
            break
        try:
            pred = get(f"predictions?fixture={fid}", key, pause=pause, meter=meter)
        except urllib.error.URLError as exc:
            print(f"  !! fixture {fid}: {exc}", file=sys.stderr)
            continue
        used += 1
        rows.append(row_for(entry, pred, now))
    return rows, used, meter["remaining"]


def append(rows: Iterable[dict], out: Path) -> int:
    rows = list(rows)
    if not rows:
        return 0
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("a", encoding="utf8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    return len(rows)


def shown(path: Path) -> str:
    """A path as printed: relative to the repo when it lives inside it."""
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def read_status(path: Path) -> Optional[dict]:
    """The last recorded vendor state, or None if there is none we can read."""
    if not path.exists():
        return None
    try:
        status = json.loads(path.read_text(encoding="utf8"))
    except json.JSONDecodeError:
        return None
    return status if isinstance(status, dict) else None


def same_state(a: Optional[dict], b: Optional[dict]) -> bool:
    """Two records describe the same state when they agree on state and reason.

    The vendor's prose is not compared: a suspension notice that gains a
    trailing full stop is still the same suspension.
    """
    if not a or not b:
        return False
    return a.get("state") == b.get("state") and a.get("reason") == b.get("reason")


def record_status(
    path: Path, refusal: Optional[VendorRefusal], now: datetime
) -> Tuple[dict, Optional[dict]]:
    """Write what the vendor said to us, and when it first started saying it.

    The file holds only the state, so it changes (and gets committed) on a
    transition — suspended, restored, quota reached — and not on every check.
    `since` is carried forward while the state holds, which is what lets a
    refusal be announced once and then merely repeated. Returns the new record
    and the one it replaced.
    """
    previous = read_status(path)
    status = {
        "vendor": VENDOR,
        "state": "refused" if refusal else "ok",
        "reason": refusal.reason if refusal else None,
        "message": refusal.message if refusal else None,
        "since": now.isoformat(timespec="seconds"),
    }
    if same_state(status, previous) and previous.get("since"):
        status["since"] = previous["since"]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(status, indent=2, ensure_ascii=False) + "\n", encoding="utf8")
    return status, previous


def tell_workflow(key: str, value: str) -> None:
    """Hand a value to the calling GitHub Actions step, if there is one."""
    out = os.environ.get("GITHUB_OUTPUT")
    if not out:
        return
    with open(out, "a", encoding="utf8") as fh:
        fh.write(f"{key}={value}\n")


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--date", default=datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    ap.add_argument(
        "--days",
        type=int,
        default=1,
        help="capture this many consecutive dates starting at --date",
    )
    ap.add_argument(
        "--status",
        type=Path,
        default=STATUS,
        help="where the vendor's last answer to us (serving, or refusing and why) is recorded",
    )
    # The backstop behind the quota meter, for the response that arrives with
    # no quota header. 90 read as "under the day's 100" but it is a
    # PER-INVOCATION number and the schedule runs eight invocations a day —
    # 30 still clears the busiest measured day (18 fixtures + the listing)
    # with room, without being able to spend a whole day's quota alone.
    ap.add_argument("--max-requests", type=int, default=30)
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument(
        "--sleep",
        type=float,
        default=10.0,
        # 7s paced right at the free plan's per-minute cap and still drew
        # 429s, and the vendor's ToS calls a pattern of them "a material
        # breach" — the 2026-08-28 suspension landed mid-retry. 6/min is
        # comfortably inside the limit and costs a 20-fixture run one minute.
        help="seconds between calls; the free plan limits requests per minute",
    )
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    key = read_key()
    if not key:
        print("API_FOOTBALL is not set (env or .env.local) — nothing captured.")
        return 0

    start = datetime.strptime(args.date, "%Y-%m-%d")
    dates = [(start + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(args.days)]
    now = datetime.now(timezone.utc)

    try:
        for date in dates:
            rows, used, left = capture(date, key, args.max_requests, args.out, args.sleep)
            kept = 0 if args.dry_run else append(rows, args.out)

            quota = f", {left} of the day's quota left" if left is not None else ""
            print(f"{date}: {len(rows)} forecast(s) from {VENDOR}, {used} request(s) used{quota}")
            for r in rows:
                pct = r["percent_raw"]
                flag = "" if r["before_kickoff"] else "  [AFTER KICKOFF]"
                print(
                    f"  {r['competition_id']:7s} {r['home']} v {r['away']}: "
                    f"{pct.get('home')}/{pct.get('draw')}/{pct.get('away')}{flag}"
                )
            if not args.dry_run:
                print(f"appended {kept} row(s) to {shown(args.out)}")
    except VendorRefusal as exc:
        # A capture that cannot happen is a fixture that is never scoreable,
        # and that is not dressed up as a quiet day: the refusal goes on
        # record in the vendor's own words. But it is announced as an error
        # only when it is NEW — the same suspension is not news four times a
        # day, and the fix is at the dashboard, not in this file.
        if args.dry_run:
            print(f"::error::api-football refused the capture: {exc}")
            return EXIT_REFUSED
        status, previous = record_status(args.status, exc, now)
        if same_state(status, previous):
            print(
                f"::warning::api-football is still refusing the capture "
                f"(since {status['since']}): {exc.message}"
            )
            tell_workflow("vendor_refused", "known")
        else:
            print(f"::error::api-football refused the capture: {exc}")
            tell_workflow("vendor_refused", "new")
        return EXIT_REFUSED

    if not args.dry_run:
        status, previous = record_status(args.status, None, now)
        if previous and previous.get("state") == "refused":
            print(
                f"::notice::api-football is serving us again — it had refused since "
                f"{previous.get('since')} ({previous.get('reason')}: {previous.get('message')})"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
