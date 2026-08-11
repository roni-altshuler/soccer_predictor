"""Score the forecasts we actually published, as results arrive.

This is the only evaluation in the repository that grades forecasts a user
could have acted on. Everything else — the .59303 walk-forward, the layered
ablation, the bracket backtest — is retrospective: honest, much larger, and
about a model refit as history advanced rather than about numbers published
before a kickoff.

Both are written to `backend/data/evaluation/live.json`, in separate blocks,
labelled `basis`. They are never summed. A live sample of forty matches is not
evidence of anything and the correct response is to print `n=40`, not to pad it
with 43,433 rows of backtest.

    python3 -m backend.scripts.evaluate_live
    python3 -m backend.scripts.evaluate_live --competition eng.1

Writes backend/data/evaluation/live.json.
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services.forecast.evaluate import baselines, join_results, score  # noqa: E402
from backend.services.forecast.snapshots import SnapshotStore  # noqa: E402

logger = logging.getLogger("evaluate_live")
OUT = ROOT / "backend" / "data" / "evaluation" / "live.json"
WALKFORWARD = ROOT / "reports" / "baselines" / "layered_wave_a_logistic.json"


def historical_block() -> dict:
    """The walk-forward record, carried through verbatim and labelled.

    Read from the artifact the experiment wrote rather than retyped, so the
    number on the site cannot drift from the number that was measured.
    """
    try:
        d = json.loads(WALKFORWARD.read_text())
    except Exception:  # noqa: BLE001
        return {"basis": "historical_walkforward", "available": False}
    best = min(d["layers"], key=lambda r: r["brier"])
    return {
        "basis": "historical_walkforward",
        "available": True,
        "n": best["n"],
        "brier": best["brier"],
        "log_loss": best["log_loss"],
        "accuracy": best["accuracy"],
        "ece": best["ece"],
        "layer": best["layer"],
        "protocol": d["protocol"],
        "competitions": d["competitions"],
        "seasons": [d["min_season"], d["max_season"]],
        "note": "retrospective. The model was refit as the corpus advanced and "
                "predicted each match before its own result, but no user saw "
                "these numbers before these kickoffs.",
    }


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--competition")
    ap.add_argument("--model-version")
    ap.add_argument("--output", default=str(OUT))
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    with SnapshotStore() as store:
        stats = store.stats()
        finals = store.final_before_kickoff(competition_id=args.competition,
                                            model_version=args.model_version)
    logger.info("snapshots: %s rows over %s fixtures, %s model version(s)",
                f"{stats['rows']:,}", f"{stats['fixtures']:,}",
                stats["versions"])
    logger.info("final pre-kickoff forecasts: %d", len(finals))

    join_report: dict = {}
    scored = join_results(finals, report=join_report)
    logger.info("of those, %d now have a result", len(scored))
    if join_report.get("unresolved_count"):
        # Distinct from "not played yet". A club whose name stopped resolving
        # shrinks the sample because something is broken upstream, and that
        # must never look like an ordinary small sample.
        logger.warning("%d snapshot(s) could not be matched to a club: %s",
                       join_report["unresolved_count"],
                       ", ".join(join_report["unresolved_clubs"]))

    live = score(scored, basis="live_published")
    if scored:
        live["baselines"] = baselines(scored)
        logger.info("\nLIVE  n=%d  brier %.5f  logloss %.5f  acc %.1f%%  ece %.4f",
                    live["n"], live["brier"], live["log_loss"],
                    100 * live["accuracy"], live["ece"])
        logger.info("      uniform on the same fixtures: %.5f",
                    live["baselines"]["uniform"])
    else:
        logger.info("\nLIVE  nothing scored yet — no fixture has both a "
                    "published forecast and a result. That is the correct "
                    "state before the season starts, not a failure.")

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "snapshot_store": stats,
        "join": join_report,
        "live": live,
        "historical": historical_block(),
        "warning": "live and historical are different samples measuring "
                   "different things. Never add them together or present one "
                   "as the other.",
    }
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2, default=str))
    logger.info("\nwrote %s", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
