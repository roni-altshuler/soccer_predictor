"""Build a deterministic fictional journal to exercise the serving evaluator.

This is test input, not ingested football data or evidence of forecast quality.
The warmup avoids the serving coherence guard's refusal of tiny overfit heads.
"""

import argparse
import json
from datetime import date, timedelta
from pathlib import Path

import numpy as np


def demo_journal() -> dict:
    clubs = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"]
    rotation, rounds = clubs[:], []
    for _ in range(5):
        rounds.append([(rotation[i], rotation[-1 - i]) for i in range(3)])
        rotation = [rotation[0], rotation[-1], *rotation[1:-1]]
    rounds += [[(away, home) for home, away in pairs] for pairs in rounds]
    fixtures, observations = [], []
    rng = np.random.default_rng(42)
    for season in range(2014, 2026):
        for round_index, pairs in enumerate(rounds):
            day = date(season, 8, 2) + timedelta(days=7 * round_index)
            for i, (home, away) in enumerate(pairs):
                uid = f"synthetic-{season}-{round_index}-{i}"
                fixtures.append(
                    {
                        "fixture_id": uid,
                        "competition_id": "demo.1",
                        "season": season,
                        "local_date": str(day),
                        "home_key": f"demo.1::{home}",
                        "away_key": f"demo.1::{away}",
                        "known_at": f"{season}-07-01T00:00:00Z",
                    }
                )
                hs, away_score = ((2, 0), (1, 1), (0, 2))[int(rng.integers(0, 3))]
                observations.append(
                    {
                        "fixture_id": uid,
                        "observed_at": f"{day}T23:00:00Z",
                        "home_score": hs,
                        "away_score": away_score,
                    }
                )
    return {
        "schema_version": "season-adaptation-journal/v1",
        "basis": "synthetic_fixture",
        "source_notes": "Deterministic six-club contract fixture; fictional "
        "teams/results. Not provider data or forecasting evidence.",
        "score_as_of": "2025-11-01T00:00:00Z",
        "fixtures": fixtures,
        "observations": observations,
        "evaluations": [
            {
                "competition_id": "demo.1",
                "season": season,
                "preseason_as_of": f"{season}-08-01T00:00:00Z",
                "cuts": [
                    f"{season}-08-01T00:00:00Z",
                    f"{season}-08-16T00:00:00Z",
                    f"{season}-09-06T00:00:00Z",
                ],
            }
            for season in (2024, 2025)
        ],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.write_text(json.dumps(demo_journal(), indent=2) + "\n")
