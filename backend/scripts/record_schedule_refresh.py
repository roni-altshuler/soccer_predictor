"""Publish the optional schedule check's outcome, including missing reports.

This record describes fixture verification only. It never certifies result
freshness or changes a forecast, its inputs, or a provider request budget.
Successful recording exits zero for either state; the workflow separately fails
degraded checks. A recording/output error must block publication.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import tempfile

ROOT = Path(__file__).resolve().parents[2]


def valid_report(report: object, outcome: str) -> bool:
    if not isinstance(report, dict):
        return False
    expected = "checked" if outcome == "success" else "degraded"
    try:
        stamp = datetime.fromisoformat(report["attempted_at"])
        rows = report["leagues"]
        ids = [r["competition_id"] for r in rows]
        scope = {"eng.1", "esp.1", "ger.1", "ita.1", "fra.1", "usa.1"}
        if (stamp.tzinfo is None or report.get("state") != expected
                or report.get("schema_version") != 1 or report.get("request_limit") != 6
                or not (expected == "degraded" and report.get("requests") is None
                        or type(report.get("requests")) is int and 0 <= report["requests"] <= 6)
                or len(ids) != len(set(ids)) or set(ids) - scope):
            return False
        for row in rows:
            if not isinstance(row["season"], str):
                return False
            if row["last_verified_at"] is not None:
                previous = datetime.fromisoformat(row["last_verified_at"])
                if previous.tzinfo is None or previous > stamp:
                    return False
        return expected != "checked" or (report["requests"] == 6 and set(ids) == scope
            and all(r["last_verified_at"] == report["attempted_at"] for r in rows))
    except (KeyError, TypeError, ValueError):
        return False


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as file:
        tmp = Path(file.name)
        try:
            json.dump(payload, file, indent=2)
            file.write("\n")
            file.flush()
            os.fsync(file.fileno())
        except BaseException:
            tmp.unlink(missing_ok=True)
            raise
    try:
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def record(report_path: Path, outcome: str, output: Path) -> dict:
    try:
        report = json.loads(report_path.read_text())
        if not valid_report(report, outcome):
            raise ValueError("inconsistent report")
    except (OSError, ValueError):
        report = {"schema_version": 1, "state": "degraded",
                  "attempted_at": datetime.now(timezone.utc).isoformat(),
                  "requests": None, "request_limit": 6, "leagues": [],
                  "reason": "check_report_unavailable"}
        try:
            previous = json.loads(output.read_text())
            if valid_report(previous, "success" if previous.get("state") == "checked" else "failure"):
                report["leagues"] = previous["leagues"]
        except (OSError, ValueError, AttributeError):
            pass
    report["workflow_run"] = os.environ.get("GITHUB_RUN_ID")
    write_json(output, report)
    return report


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--report", type=Path, required=True)
    ap.add_argument("--outcome", choices=["success", "failure"], required=True)
    ap.add_argument("--output", type=Path,
                    default=ROOT / "backend/data/predictions/season_refresh_status.json")
    args = ap.parse_args()
    report = record(args.report, args.outcome, args.output)
    summary = f"Schedule check: {report['state']}. Provider requests: {report['requests']} / 6."
    if report["state"] == "degraded":
        summary += " Last-good schedule retained; kickoff times and postponements may be outdated."
        print("::warning::" + summary)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as file:
            file.write(summary + "\n\nThis checks fixtures, not the latest verified results.\n")
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as file:
            file.write(f"state={report['state']}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
