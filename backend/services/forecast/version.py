"""What model produced a number, stated precisely enough to reproduce it.

Why a hash and not just a string
--------------------------------
`model_version = "2026.08.1"` is a promise a human has to keep. It survives
exactly as long as someone remembers to bump it, and the failure mode is
silent: a changed feature set, a changed uncertainty treatment, or a changed
league scope ships under the old label and every stored prediction becomes
un-attributable.

So the version has two halves and they do different jobs:

    release   "2026.08.1"   human-facing, bumped deliberately, ordered
    config    "a3f19c02"    derived, unbumpable, changes when the model does

The config hash is computed from the things that actually determine a forecast
— feature prefixes, uncertainty parameters, simulation settings, league scope.
Change any of them and the hash changes whether or not anyone remembered the
release string. Two predictions with the same `model_version` are then
genuinely comparable, which is the entire point of storing it.

What is deliberately NOT in the hash: match data. The corpus grows every week
and that is not a model change — it is the same model seeing more of the world.
Data provenance is carried per-snapshot by `trained_through` instead.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any, Dict, Optional, Sequence

# Bumped deliberately, by a person, when the model changes in a way worth
# announcing. The config hash below is what actually guarantees correctness;
# this is what a human reads in a report.
RELEASE = "2026.08.1"


@dataclass(frozen=True)
class ModelVersion:
    """An immutable identity for one forecasting configuration."""

    release: str
    config_hash: str
    components: Dict[str, Any] = field(default_factory=dict)

    @property
    def id(self) -> str:
        return f"{self.release}+{self.config_hash}"

    def to_dict(self) -> Dict[str, Any]:
        return {"model_version": self.id, "release": self.release,
                "config_hash": self.config_hash, "components": self.components}


def compute(*, head: str, features: Sequence[str], leagues: Sequence[str],
            min_season: int, sims: int, strength_shock_sd: float,
            elo: Optional[Dict[str, Any]] = None,
            extra: Optional[Dict[str, Any]] = None) -> ModelVersion:
    """Derive the version from the configuration that determines a forecast.

    Every argument here is something that changes the numbers. Anything that
    does not change the numbers must stay out, or the hash churns and stops
    meaning "this is a different model".
    """
    components: Dict[str, Any] = {
        "head": head,
        # Sorted so that reordering the feature list is not a model change.
        "features": sorted(features),
        "leagues": sorted(leagues),
        "min_season": int(min_season),
        "sims": int(sims),
        "strength_shock_sd": round(float(strength_shock_sd), 6),
        "elo": elo or {},
    }
    if extra:
        components.update(extra)
    blob = json.dumps(components, sort_keys=True, separators=(",", ":"))
    return ModelVersion(
        release=RELEASE,
        config_hash=hashlib.sha256(blob.encode("utf-8")).hexdigest()[:8],
        components=components,
    )
