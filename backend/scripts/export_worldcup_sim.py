"""
Export a World Cup bracket-simulation snapshot to committed JSON.

Writes backend/data/worldcup/bracket_paths.json so the Vercel-deployed
Next.js routes (which have no FastAPI backend) can serve AI tournament
projections from the repo, the same way committed prediction JSON powers
/accuracy. Refreshed by the prediction_pipeline workflow.

Usage:
    python -m backend.scripts.export_worldcup_sim [--simulations 20000] [--seed N]
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

logger = logging.getLogger(__name__)

OUTPUT_PATH = Path(__file__).parent.parent / "data" / "worldcup" / "bracket_paths.json"


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    parser = argparse.ArgumentParser(description="Export World Cup bracket simulation snapshot")
    parser.add_argument("--simulations", type=int, default=20_000)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--output", type=str, default=str(OUTPUT_PATH))
    args = parser.parse_args()

    from backend.services.simulation.bracket_paths import simulate_bracket

    result = simulate_bracket(n_simulations=args.simulations, seed=args.seed)

    if result.get("error") or not result.get("teams"):
        # Never overwrite a good snapshot with an empty one (e.g. transient
        # ESPN outage) — fail loudly instead.
        logger.error(f"Simulation produced no teams: {result.get('error', 'unknown')}")
        return 1

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=1), encoding="utf-8")
    logger.info(
        f"Wrote {out} — {len(result['teams'])} teams, "
        f"{result['n_simulations']} sims, bracket_set={result['bracket_set']}"
    )
    favourite = result["teams"][0]
    logger.info(f"Model favourite: {favourite['name']} ({favourite['p_champion']:.1%} champion)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
