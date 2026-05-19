"""
World Cup group-stage simulation endpoints.

Exposes the Monte Carlo permutation simulator (and what-if variant) at
`/api/v1/world-cup/groups/{group_id}/simulate` so the Next.js front end
can fetch live advancement probabilities for each team in each group.
"""

from typing import Dict, List, Optional, Tuple

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.services.simulation.group_permutations import (
    simulate_group,
    simulate_group_what_if,
)

router = APIRouter(prefix="/world-cup/groups", tags=["world-cup"])


class WhatIfRequest(BaseModel):
    """Body for the what-if scenario explorer."""

    forced_results: Dict[str, Tuple[int, int]] = Field(default_factory=dict)
    n_simulations: int = 20_000
    seed: Optional[int] = None


@router.get("/{group_id}/simulate")
def simulate_world_cup_group(
    group_id: str,
    n_simulations: int = Query(50_000, ge=500, le=200_000),
    seed: Optional[int] = Query(None),
) -> Dict:
    """Run the live group-permutation simulator."""
    try:
        return simulate_group(group_id, n_simulations=n_simulations, seed=seed)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=500, detail=f"Simulation failed: {exc}")


@router.post("/{group_id}/what-if")
def world_cup_group_what_if(group_id: str, payload: WhatIfRequest) -> Dict:
    """Run a what-if simulation with forced scorelines for chosen matches."""
    try:
        return simulate_group_what_if(
            group_id,
            forced_results=payload.forced_results,
            n_simulations=payload.n_simulations,
            seed=payload.seed,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=500, detail=f"What-if simulation failed: {exc}")
