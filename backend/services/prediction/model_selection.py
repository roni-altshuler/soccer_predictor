"""
Model-selection policy for neural prediction artifacts.

The global cross-league model is valuable as a challenger, especially for
sparse tournaments, but it should not silently override a trained league model
until benchmark gates say it is safe for that competition.
"""

import json
import logging
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

MODEL_DIR = Path(__file__).parent.parent.parent / "data" / "models"
MODEL_SELECTION_FILE = MODEL_DIR / "model_selection.json"


DEFAULT_MODEL_SELECTION_POLICY: Dict[str, Any] = {
    "policy_version": "2026-05-09",
    "global_default": False,
    "fallback_to_global_when_league_missing": True,
    "promoted_leagues": [],
    "league_decisions": {},
    "notes": "Fail-closed: use per-league models unless benchmark gates promote the global model.",
}


def _clamp_float(value: Any, default: float, minimum: float, maximum: float) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        numeric = default
    return max(minimum, min(maximum, numeric))


def load_model_selection_policy(path: Optional[Path] = None) -> Dict[str, Any]:
    """Load model promotion policy, falling back to conservative defaults."""
    policy_path = path or MODEL_SELECTION_FILE
    if not policy_path.exists():
        return dict(DEFAULT_MODEL_SELECTION_POLICY)

    try:
        with open(policy_path) as f:
            raw = json.load(f)
    except Exception as exc:
        logger.warning("Failed to load model selection policy from %s: %s", policy_path, exc)
        return dict(DEFAULT_MODEL_SELECTION_POLICY)

    policy = dict(DEFAULT_MODEL_SELECTION_POLICY)
    if isinstance(raw, dict):
        policy.update(raw)
    return policy


def get_model_selection_decision(league_key: str, policy: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Return the configured decision block for a league with conservative defaults."""
    active_policy = policy or load_model_selection_policy()
    league_decisions = active_policy.get("league_decisions", {})
    if isinstance(league_decisions, dict):
        decision = league_decisions.get(league_key, {})
        if isinstance(decision, dict):
            result = dict(decision)
            result.setdefault("decision", "league")
            result.setdefault("reason", "policy")
            return result

    if bool(active_policy.get("global_default")):
        return {
            "decision": "global",
            "reason": "global_default_enabled",
            "global_blend_weight": 1.0,
        }

    return {
        "decision": "league",
        "reason": "league_model_preferred",
        "global_blend_weight": 0.0,
    }


def get_global_blend_weight(league_key: str, policy: Optional[Dict[str, Any]] = None) -> float:
    """Return global-model blend weight for hybrid runtime predictions."""
    decision = get_model_selection_decision(league_key, policy)
    if decision.get("decision") == "global":
        return 1.0
    if decision.get("decision") == "blend":
        return _clamp_float(decision.get("global_blend_weight"), 0.5, 0.05, 0.95)
    return 0.0


def should_use_global_model(league_key: str, policy: Optional[Dict[str, Any]] = None) -> bool:
    """Return True only when the policy explicitly promotes global for this league."""
    active_policy = policy or load_model_selection_policy()
    if bool(active_policy.get("global_default")):
        return True

    promoted = active_policy.get("promoted_leagues", [])
    if isinstance(promoted, list) and league_key in promoted:
        return True

    league_decisions = active_policy.get("league_decisions", {})
    if isinstance(league_decisions, dict):
        decision = league_decisions.get(league_key, {})
        if isinstance(decision, dict) and decision.get("decision") == "global":
            return True

    return False


def get_model_selection_reason(league_key: str, policy: Optional[Dict[str, Any]] = None) -> str:
    decision = get_model_selection_decision(league_key, policy)
    return str(decision.get("reason") or decision.get("decision") or "policy")
