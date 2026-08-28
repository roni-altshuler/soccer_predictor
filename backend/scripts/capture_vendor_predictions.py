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

    python3 -m backend.scripts.capture_vendor_predictions          # today
    python3 -m backend.scripts.capture_vendor_predictions --date 2026-08-16
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

HOST = "https://v3.football.api-sports.io"
VENDOR = "api-football"

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
    """


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
                    raise VendorRefusal(f"{path}: {errors}")
                limited = True
            else:
                if pause:
                    time.sleep(pause)
                return body
        except urllib.error.HTTPError as exc:
            _read_quota(exc.headers, meter)
            if exc.code != 429 or attempt == retries - 1:
                raise
            limited = True
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


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--date", default=datetime.now(timezone.utc).strftime("%Y-%m-%d"))
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
    args = ap.parse_args()

    key = read_key()
    if not key:
        print("API_FOOTBALL is not set (env or .env.local) — nothing captured.")
        return 0

    try:
        rows, used, left = capture(args.date, key, args.max_requests, args.out, args.sleep)
    except VendorRefusal as exc:
        # Still exit 1 — a capture that cannot happen is a fixture that is
        # never scoreable, and the workflow's honesty rule forbids dressing
        # that up as a quiet day. But surface it as one actionable line
        # (::error:: becomes the run annotation in Actions) instead of a
        # traceback: the fix is at the dashboard, not in this file.
        print(f"::error::api-football refused the capture: {exc}")
        return 1
    kept = 0 if args.dry_run else append(rows, args.out)

    quota = f", {left} of the day's quota left" if left is not None else ""
    print(f"{args.date}: {len(rows)} forecast(s) from {VENDOR}, {used} request(s) used{quota}")
    for r in rows:
        pct = r["percent_raw"]
        flag = "" if r["before_kickoff"] else "  [AFTER KICKOFF]"
        print(
            f"  {r['competition_id']:7s} {r['home']} v {r['away']}: "
            f"{pct.get('home')}/{pct.get('draw')}/{pct.get('away')}{flag}"
        )
    if not args.dry_run:
        print(f"appended {kept} row(s) to {args.out.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
