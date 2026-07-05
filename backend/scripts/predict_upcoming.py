"""
Predict upcoming matches and store predictions for tracking.

Fetches scheduled matches from ESPN for all leagues, generates
predictions using the per-league Dixon-Coles model, and stores
them as pending predictions (no outcome yet) for the accuracy dashboard.

Usage:
    python -m backend.scripts.predict_upcoming
    python -m backend.scripts.predict_upcoming --days 7
"""

import asyncio
import json
import math
import logging
import re
import unicodedata
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import httpx
import argparse

import numpy as np

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Neural model integration ──
_NEURAL_REGISTRY = None
_MODEL_SELECTION_POLICY = None


def _get_registry():
    """Lazily load the neural model registry."""
    global _NEURAL_REGISTRY
    if _NEURAL_REGISTRY is None:
        try:
            from backend.services.prediction.neural_model import get_league_model_registry
            _NEURAL_REGISTRY = get_league_model_registry()
            logger.info("Neural model registry loaded")
        except Exception as e:
            logger.warning(f"Neural models not available: {e}")
            _NEURAL_REGISTRY = False  # sentinel: tried and failed
    return _NEURAL_REGISTRY if _NEURAL_REGISTRY is not False else None


def _get_model_selection_policy() -> Dict:
    """Load the league/global/hybrid model routing policy once per run."""
    global _MODEL_SELECTION_POLICY
    if _MODEL_SELECTION_POLICY is None:
        try:
            from backend.services.prediction.model_selection import load_model_selection_policy
            _MODEL_SELECTION_POLICY = load_model_selection_policy()
        except Exception as e:
            logger.warning(f"Model-selection policy unavailable: {e}")
            _MODEL_SELECTION_POLICY = {}
    return _MODEL_SELECTION_POLICY


def _normalize_raw_probs(raw_probs) -> Dict[str, float]:
    probs = [max(float(raw_probs[i]), 1e-12) for i in range(3)]
    total = sum(probs) or 1.0
    return {
        "home_win": probs[0] / total,
        "draw": probs[1] / total,
        "away_win": probs[2] / total,
    }


def _predict_neural_with_policy(registry, league_key: str, features: np.ndarray):
    """
    Predict with the same league/global/hybrid policy used by the live API.

    The global model is a benchmark-gated challenger, not a silent override.
    """
    if not registry or not league_key:
        return None, None, "elo_poisson", None

    try:
        from backend.services.prediction.model_selection import (
            get_global_blend_weight,
            get_model_selection_decision,
        )

        policy = _get_model_selection_policy()
        decision = get_model_selection_decision(league_key, policy)
        decision_name = str(decision.get("decision") or "league")
        league_model = registry.get_model(league_key)
        global_model = registry.get_model("global")

        if decision_name == "blend" and league_model.is_fitted and global_model.is_fitted:
            global_weight = get_global_blend_weight(league_key, policy)
            league_weight = 1.0 - global_weight
            league_probs = league_model.predict_proba(features)[0]
            global_probs = global_model.predict_proba(features)[0]
            blended_probs = [
                (league_weight * float(league_probs[i])) + (global_weight * float(global_probs[i]))
                for i in range(3)
            ]
            league_goals = league_model.predict_goals(features)
            global_goals = global_model.predict_goals(features)
            blended_goals = (
                (league_weight * float(league_goals[0, 0])) + (global_weight * float(global_goals[0, 0])),
                (league_weight * float(league_goals[0, 1])) + (global_weight * float(global_goals[0, 1])),
            )
            return (
                _normalize_raw_probs(blended_probs),
                blended_goals,
                "neural_hybrid_v5_benchmark_blend",
                {
                    "mode": "blend",
                    "reason": decision.get("reason", "hybrid_blend_benchmark_winner"),
                    "global_weight": round(float(global_weight), 4),
                },
            )

        if decision_name == "global" and global_model.is_fitted:
            raw_probs = global_model.predict_proba(features)[0]
            raw_goals = global_model.predict_goals(features)
            return (
                _normalize_raw_probs(raw_probs),
                (float(raw_goals[0, 0]), float(raw_goals[0, 1])),
                "neural_global_v5_benchmark_promoted",
                {
                    "mode": "global",
                    "reason": decision.get("reason", "benchmark_gates_passed"),
                    "global_weight": 1.0,
                },
            )

        if league_model.is_fitted:
            raw_probs = league_model.predict_proba(features)[0]
            raw_goals = league_model.predict_goals(features)
            return (
                _normalize_raw_probs(raw_probs),
                (float(raw_goals[0, 0]), float(raw_goals[0, 1])),
                "neural_ensemble_v5",
                {
                    "mode": "league",
                    "reason": decision.get("reason", "league_model_preferred"),
                    "global_weight": 0.0,
                },
            )

        if global_model.is_fitted and policy.get("fallback_to_global_when_league_missing", True):
            raw_probs = global_model.predict_proba(features)[0]
            raw_goals = global_model.predict_goals(features)
            return (
                _normalize_raw_probs(raw_probs),
                (float(raw_goals[0, 0]), float(raw_goals[0, 1])),
                "neural_global_v5_fallback",
                {
                    "mode": "global_fallback",
                    "reason": "league_model_missing_global_fallback",
                    "global_weight": 1.0,
                },
            )
    except Exception as e:
        logger.debug(f"Neural model policy prediction failed for {league_key}: {e}")

    return None, None, "elo_poisson", None

# Same leagues as the seed script. Keys are ESPN scoreboard league IDs.
LEAGUES = {
    "eng.1": "Premier League",
    "esp.1": "La Liga",
    "ger.1": "Bundesliga",
    "ita.1": "Serie A",
    "fra.1": "Ligue 1",
    "usa.1": "MLS",
    "uefa.champions": "Champions League",
    "uefa.europa": "Europa League",
    "uefa.europa.conf": "Conference League",
    "ned.1": "Eredivisie",
    "por.1": "Primeira Liga",
    "fifa.world": "FIFA World Cup",
    "uefa.euro": "UEFA European Championship",
    "conmebol.america": "Copa America",
    # Women's universe — first-class in the live pipeline. ESPN IDs from
    # WOMEN_COMPETITIONS in backend/services/data/espn_loader.py.
    "usa.nwsl": "NWSL",
    "eng.w.1": "FA Women's Super League",
    "uefa.wchampions": "UEFA Women's Champions League",
    "fifa.wwc": "FIFA Women's World Cup",
    "uefa.weuro": "UEFA Women's European Championship",
}

# ESPN scoreboard ID → gender universe ('M' default).
LEAGUE_GENDER = {
    "usa.nwsl": "F",
    "eng.w.1": "F",
    "uefa.wchampions": "F",
    "fifa.wwc": "F",
    "uefa.weuro": "F",
}

# ESPN scoreboard ID → warehouse competition_id (for the unified model).
# Men's IDs are identical; women's differ.
ESPN_TO_COMPETITION_ID = {
    "usa.nwsl": "usa.1.w",
    "eng.w.1": "eng.1.w",
    "uefa.wchampions": "uefa.champions.w",
    "fifa.wwc": "fifa.world.w",
    "uefa.weuro": "uefa.euro.w",
}

LEAGUE_DRAW_RATES = {
    "Premier League": 0.26, "La Liga": 0.24, "Bundesliga": 0.24,
    "Serie A": 0.26, "Ligue 1": 0.23, "MLS": 0.21,
    "Champions League": 0.20, "Europa League": 0.22, "Conference League": 0.22,
    "Eredivisie": 0.23, "Primeira Liga": 0.24, "FIFA World Cup": 0.18,
    "NWSL": 0.22, "FA Women's Super League": 0.20,
    "UEFA Women's Champions League": 0.18,
    "FIFA Women's World Cup": 0.17, "UEFA Women's European Championship": 0.18,
}

LEAGUE_AVG_GOALS = {
    "Premier League": 1.42, "La Liga": 1.30, "Bundesliga": 1.55,
    "Serie A": 1.32, "Ligue 1": 1.30, "MLS": 1.45,
    "Champions League": 1.50, "Europa League": 1.42, "Conference League": 1.38,
    "Eredivisie": 1.45, "Primeira Liga": 1.28, "FIFA World Cup": 1.35,
    "NWSL": 1.40, "FA Women's Super League": 1.55,
    "UEFA Women's Champions League": 1.60,
    "FIFA Women's World Cup": 1.45, "UEFA Women's European Championship": 1.50,
}

DATA_DIR = Path(__file__).parent.parent / "data" / "predictions"
ADJUSTMENTS_FILE = DATA_DIR / "model_adjustments.json"
TUNING_FILE = Path(__file__).parent.parent / "data" / "model_tuning.json"

# ── League results cache (populated once per run) ──
_league_results_cache: Dict[str, List[dict]] = {}
_team_stats_cache: Dict[str, Dict] = {}
_TUNING_CACHE: Optional[Dict] = None


# ── Load league params from single source of truth ──
def _load_league_params() -> Dict:
    """Load per-league configuration from league_params.json."""
    params_file = Path(__file__).parent.parent / "data" / "league_params.json"
    if params_file.exists():
        try:
            with open(params_file) as f:
                data = json.load(f)
            return data.get("leagues", {}), data.get("default", {})
        except Exception:
            pass
    return {}, {}


_LP_CACHE = None


def get_league_param(league_key: str, param: str, fallback=None):
    """Get a single parameter for a league from the shared config."""
    global _LP_CACHE
    if _LP_CACHE is None:
        _LP_CACHE = _load_league_params()
    leagues, default = _LP_CACHE
    lp = leagues.get(league_key, default)
    return lp.get(param, default.get(param, fallback))


# Reverse map: display name → ESPN key
DISPLAY_TO_KEY = {v: k for k, v in LEAGUES.items()}


# ── Unified multi-task model (preferred engine when artifacts exist) ──
#
# The pipeline runner may lack torch or the trained artifacts; every
# failure path returns None so the legacy neural-registry → Dixon-Coles
# chain below keeps predictions flowing regardless.

_UNIFIED_IMPORT_FAILED = False


def _predict_unified(match: dict, espn_key: str, gender: str) -> Optional[Dict]:
    """Try the unified model for one fixture. None on any failure."""
    global _UNIFIED_IMPORT_FAILED
    if _UNIFIED_IMPORT_FAILED:
        return None
    try:
        from backend.services.prediction.unified_inference import predict_for_fixture
    except Exception as exc:
        logger.info("Unified model unavailable (%s); using legacy engines.", exc)
        _UNIFIED_IMPORT_FAILED = True
        return None

    try:
        kickoff = datetime.fromisoformat(match["date"].replace("Z", "+00:00"))
    except (ValueError, KeyError):
        return None
    competition_id = ESPN_TO_COMPETITION_ID.get(espn_key, espn_key)

    try:
        pred = predict_for_fixture(
            match["home_team"], match["away_team"],
            competition_id, LEAGUES.get(espn_key, espn_key),
            kickoff, gender=gender, explain=True,
        )
    except Exception as exc:
        logger.warning(
            "Unified prediction failed for %s vs %s (%s): %s",
            match["home_team"], match["away_team"], espn_key, exc,
        )
        return None
    if pred is None:
        return None

    top_scorelines = [
        {"score": s.score, "probability": round(float(s.probability), 4)}
        for s in [pred.most_likely_score, *pred.alternative_scores]
    ]
    attribution = None
    if pred.attribution:
        attribution = [
            {
                "feature": a.feature,
                "value": round(float(a.value), 4),
                "contribution": round(float(a.contribution), 4),
            }
            for a in pred.attribution[:8]
        ]
    return {
        "probs": {
            "home_win": round(pred.outcome.home_win, 4),
            "draw": round(pred.outcome.draw, 4),
            "away_win": round(pred.outcome.away_win, 4),
        },
        "home_xg": float(pred.goals.home_expected_goals),
        "away_xg": float(pred.goals.away_expected_goals),
        "predicted_scoreline": pred.most_likely_score.score,
        "top_scorelines": top_scorelines,
        "attribution": attribution,
        "model_used": pred.model_version,
        "home_elo": float(pred.factors.home_elo),
        "away_elo": float(pred.factors.away_elo),
    }


_DERBY_GRAPH_CACHE: Optional[Dict[str, set[str]]] = None


def _normalize_team_name(team_name: str) -> str:
    """Normalize team names for robust derby matching."""
    normalized = unicodedata.normalize("NFKD", team_name or "")
    normalized = normalized.encode("ascii", "ignore").decode("ascii")
    normalized = normalized.casefold()
    normalized = re.sub(r"[^a-z0-9\s]", " ", normalized)
    normalized = re.sub(r"\b(fc|cf|sc|ac|afc|cfc)\b", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized


def _get_derby_aliases() -> Dict[str, str]:
    """Common aliases that appear in feed data but map to canonical derby names."""
    return {
        "man utd": "manchester united",
        "man united": "manchester united",
        "man city": "manchester city",
        "atleti": "atletico madrid",
        "athletico madrid": "atletico madrid",
        "inter milan": "inter",
        "psg": "paris saint germain",
        "paris sg": "paris saint germain",
        "spurs": "tottenham",
    }


def _get_derby_graph() -> Dict[str, set[str]]:
    """Build and cache a symmetric derby graph from the training feature config."""
    global _DERBY_GRAPH_CACHE
    if _DERBY_GRAPH_CACHE is not None:
        return _DERBY_GRAPH_CACHE

    graph: Dict[str, set[str]] = {}
    try:
        from backend.services.prediction.training import FeatureBuilder

        derby_pairs = FeatureBuilder.DERBY_PAIRS
        for home_team, rivals in derby_pairs.items():
            home = _normalize_team_name(home_team)
            if not home:
                continue
            graph.setdefault(home, set())
            for rival_team in rivals:
                rival = _normalize_team_name(rival_team)
                if not rival:
                    continue
                graph.setdefault(rival, set())
                graph[home].add(rival)
                graph[rival].add(home)
    except Exception as e:
        logger.warning(f"Failed to load derby pairs from training config: {e}")

    _DERBY_GRAPH_CACHE = graph
    return graph


def _resolve_derby_name(team_name: str, known_names: set[str], alias_map: Dict[str, str]) -> str:
    """
    Resolve a runtime team string to a canonical derby name.
    Falls back to containment matching for minor feed variations.
    """
    normalized = _normalize_team_name(team_name)
    if not normalized:
        return ""

    normalized = alias_map.get(normalized, normalized)
    if normalized in known_names:
        return normalized

    for candidate in known_names:
        if len(normalized) < 4 or len(candidate) < 4:
            continue
        if normalized in candidate or candidate in normalized:
            return candidate
    return normalized


def is_derby_fixture(home_team: str, away_team: str) -> float:
    """Return 1.0 for derby fixtures, else 0.0."""
    derby_graph = _get_derby_graph()
    if not derby_graph:
        return 0.0

    known_names = set(derby_graph.keys())
    alias_map = _get_derby_aliases()
    home = _resolve_derby_name(home_team, known_names, alias_map)
    away = _resolve_derby_name(away_team, known_names, alias_map)
    if not home or not away or home == away:
        return 0.0

    return 1.0 if away in derby_graph.get(home, set()) else 0.0


def load_learned_adjustments() -> Dict:
    """Load parameter adjustments from train_feedback.py output."""
    if not ADJUSTMENTS_FILE.exists():
        return {}
    try:
        with open(ADJUSTMENTS_FILE) as f:
            data = json.load(f)
        suggestions = data.get("suggested_params", {})
        applied = {}
        for league, s in suggestions.items():
            if s.get("changed"):
                applied[league] = s["suggested"]
        if applied:
            logger.info(f"Loaded learned adjustments for {len(applied)} leagues")
        return applied
    except Exception:
        return {}


def _load_model_tuning() -> Dict:
    """Load league-specific blend/threshold tuning produced by model_audit."""
    global _TUNING_CACHE
    if _TUNING_CACHE is not None:
        return _TUNING_CACHE

    if not TUNING_FILE.exists():
        _TUNING_CACHE = {}
        return _TUNING_CACHE

    try:
        with open(TUNING_FILE) as f:
            _TUNING_CACHE = json.load(f)
        leagues = _TUNING_CACHE.get("leagues", {})
        logger.info(f"Loaded model tuning for {len(leagues)} leagues")
    except Exception as e:
        logger.warning(f"Failed to load model tuning: {e}")
        _TUNING_CACHE = {}
    return _TUNING_CACHE


def _get_league_tuning(league_key: str, league_name: str) -> Dict:
    tuning = _load_model_tuning()
    leagues = tuning.get("leagues", {})

    # Prefer ESPN league key
    if league_key and league_key in leagues:
        return leagues[league_key]

    # Fallback to display-name matching if key is missing
    for key, vals in leagues.items():
        if vals.get("display_name") == league_name:
            return vals

    return tuning.get("default", {})


class EloPredictor:
    """ELO system initialized from historical seed data, with learned adjustments."""

    DEFAULT = 1500.0
    HOME_ADV = 30.0  # Reduced from 40 — modern football home advantage is ~25-35 ELO
    K = 32.0

    def __init__(self):
        self.ratings: Dict[str, float] = {}
        self.learned = load_learned_adjustments()
        self._load_ratings_from_seed()

    def _load_ratings_from_seed(self):
        """Build ELO ratings from existing seeded predictions."""
        if not DATA_DIR.exists():
            logger.warning("No seed data found — using default ELO ratings")
            return

        all_matches = []
        for f in sorted(DATA_DIR.glob("predictions_*.json")):
            try:
                with open(f) as fh:
                    data = json.load(fh)
                for p in data.get("predictions", []):
                    if p.get("actual_winner") is not None:
                        all_matches.append(p)
            except Exception:
                continue

        all_matches.sort(key=lambda m: m.get("match_date", ""))

        for m in all_matches:
            home = m["home_team"]
            away = m["away_team"]
            h_elo = self.get(home)
            a_elo = self.get(away)
            h_exp = 1.0 / (1.0 + math.pow(10, -(h_elo + self.HOME_ADV - a_elo) / 400))

            actual = m.get("actual_winner", "draw")
            if actual == "home":
                h_act, a_act = 1.0, 0.0
            elif actual == "away":
                h_act, a_act = 0.0, 1.0
            else:
                h_act, a_act = 0.5, 0.5

            hg = m.get("actual_home_goals", 0) or 0
            ag = m.get("actual_away_goals", 0) or 0
            gd = abs(hg - ag)
            mult = 1.0 if gd <= 1 else 1.5 if gd == 2 else 1.75 + (gd - 3) * 0.125

            k = self.K * mult
            self.ratings[home] = h_elo + k * (h_act - h_exp)
            self.ratings[away] = a_elo + k * ((1.0 - h_act) - (1.0 - h_exp))

        logger.info(f"Loaded ELO ratings for {len(self.ratings)} teams from {len(all_matches)} matches")

    def get(self, team: str) -> float:
        return self.ratings.get(team, self.DEFAULT)

    def predict(self, home: str, away: str, league: str) -> Dict[str, float]:
        h_elo = self.get(home) + self.HOME_ADV
        a_elo = self.get(away)
        diff = h_elo - a_elo

        # Use learned draw rate if available, else base
        learned = self.learned.get(league, {})
        base_draw_rate = learned.get("draw_rate", LEAGUE_DRAW_RATES.get(league, 0.24))
        elo_closeness = math.exp(-(diff ** 2) / (2 * 250 ** 2))
        draw = base_draw_rate * (0.7 + 0.9 * elo_closeness)
        draw = max(0.12, min(0.42, draw))

        win_pool = 1.0 - draw
        home_win_raw = 1.0 / (1.0 + math.pow(10, -diff / 400))
        hw = win_pool * home_win_raw
        aw = win_pool * (1.0 - home_win_raw)

        total = hw + draw + aw
        return {
            "home_win": round(hw / total, 4),
            "draw": round(draw / total, 4),
            "away_win": round(aw / total, 4),
        }

    def predict_goals(self, home: str, away: str, league: str):
        h_elo = self.get(home)
        a_elo = self.get(away)
        # Use learned avg_goals if available
        learned = self.learned.get(league, {})
        avg_goals = learned.get("avg_goals", LEAGUE_AVG_GOALS.get(league, 1.35))

        h_attack = max(0.5, 1.0 + (h_elo - 1500) / 600)
        a_attack = max(0.5, 1.0 + (a_elo - 1500) / 600)
        h_def_weakness = max(0.4, 1.0 - (h_elo - 1500) / 900)
        a_def_weakness = max(0.4, 1.0 - (a_elo - 1500) / 900)

        # Home advantage is already in ELO ratings + HOME_ADV;
        # do NOT add a second +0.25 bonus (was causing massive home bias)
        home_xg = h_attack * a_def_weakness * avg_goals + 0.10  # Slight venue boost
        away_xg = a_attack * h_def_weakness * avg_goals

        return max(0.3, min(4.5, home_xg)), max(0.2, min(4.0, away_xg))


def poisson_scoreline(home_xg: float, away_xg: float) -> str:
    """
    Predict the most likely scoreline from expected goals.

    Uses a hybrid approach:
    1. Round xG values to integers as the base scoreline.
    2. Apply intelligent rounding: when the fractional part is close to 0.5,
       use the Poisson probability of scoring N vs N+1 to decide.
    3. Ensure the scoreline reflects the xG advantage of the favored side.

    This avoids the "always 1-1" problem of picking the strict Poisson mode,
    which for typical soccer xG (0.8–1.8) is almost always 1 for each team.
    """
    import math as _m

    def smart_round(xg: float) -> int:
        """Round xG to nearest integer (round-half-up).

        Standard rounding is more intuitive: xG 1.6 → 2 goals.
        The Poisson mode approach always favours the floor for
        typical soccer xG (0.8–1.8), producing too many draws.
        """
        return max(0, int(xg + 0.5))

    h = smart_round(home_xg)
    a = smart_round(away_xg)

    # If the xG clearly favors one side but rounding produced a draw,
    # give the favored side +1 goal
    # Only break ties when xG difference is substantial (0.40+)
    # 0.30 was too aggressive and contributed to home bias
    xg_diff = home_xg - away_xg
    if h == a and abs(xg_diff) >= 0.40:
        if xg_diff > 0:
            h += 1
        else:
            a += 1

    return f"{h}-{a}"


# ── Real data fetching from ESPN ──


async def fetch_league_results(
    client: httpx.AsyncClient, espn_id: str, days_back: int = 120
) -> List[dict]:
    """
    Fetch completed matches from ESPN for a league (last N days).
    Results are cached per league for the duration of the run.
    """
    if espn_id in _league_results_cache:
        return _league_results_cache[espn_id]

    results = []
    today = datetime.now()
    fmt = lambda d: f"{d.year}{d.month:02d}{d.day:02d}"

    start = today - timedelta(days=days_back)
    end = today
    date_range = f"{fmt(start)}-{fmt(end)}"

    url = (
        f"https://site.api.espn.com/apis/site/v2/sports/soccer/"
        f"{espn_id}/scoreboard?dates={date_range}&limit=300"
    )
    try:
        resp = await client.get(url, timeout=20)
        if resp.status_code != 200:
            logger.warning(f"ESPN results fetch failed for {espn_id}: HTTP {resp.status_code}")
            _league_results_cache[espn_id] = []
            return []
        data = resp.json()

        for event in data.get("events", []):
            comp = event.get("competitions", [{}])[0]
            status_name = comp.get("status", {}).get("type", {}).get("name", "")

            if "FINAL" not in status_name and "FULL_TIME" not in status_name:
                continue

            home_c = next(
                (c for c in comp.get("competitors", []) if c.get("homeAway") == "home"),
                None,
            )
            away_c = next(
                (c for c in comp.get("competitors", []) if c.get("homeAway") == "away"),
                None,
            )
            if not home_c or not away_c:
                continue

            try:
                home_score = int(home_c.get("score", 0))
                away_score = int(away_c.get("score", 0))
            except (ValueError, TypeError):
                continue

            # Extract per-match stats if available in the event
            home_stats: Dict[str, float] = {}
            away_stats: Dict[str, float] = {}
            for stat_entry in home_c.get("statistics", []):
                name = stat_entry.get("name", "")
                try:
                    home_stats[name] = float(stat_entry.get("displayValue", 0))
                except (ValueError, TypeError):
                    pass
            for stat_entry in away_c.get("statistics", []):
                name = stat_entry.get("name", "")
                try:
                    away_stats[name] = float(stat_entry.get("displayValue", 0))
                except (ValueError, TypeError):
                    pass

            results.append({
                "date": event.get("date", ""),
                "home_team": home_c.get("team", {}).get("displayName", ""),
                "away_team": away_c.get("team", {}).get("displayName", ""),
                "home_score": home_score,
                "away_score": away_score,
                "home_team_id": home_c.get("team", {}).get("id", ""),
                "away_team_id": away_c.get("team", {}).get("id", ""),
                "home_stats": home_stats,
                "away_stats": away_stats,
            })
    except Exception as e:
        logger.error(f"Error fetching league results for {espn_id}: {e}")

    results.sort(key=lambda x: x.get("date", ""), reverse=True)
    _league_results_cache[espn_id] = results
    logger.info(f"  Fetched {len(results)} completed matches for {espn_id}")
    return results


async def fetch_team_season_stats(
    client: httpx.AsyncClient, espn_id: str, team_id: str
) -> Dict[str, float]:
    """Fetch season-level team statistics from ESPN (shots, fouls, cards, corners)."""
    cache_key = f"{espn_id}_{team_id}"
    if cache_key in _team_stats_cache:
        return _team_stats_cache[cache_key]

    stats: Dict[str, float] = {}
    url = (
        f"https://site.api.espn.com/apis/site/v2/sports/soccer/"
        f"{espn_id}/teams/{team_id}/statistics"
    )
    try:
        resp = await client.get(url, timeout=12)
        if resp.status_code == 200:
            data = resp.json()
            # ESPN returns stats in categories
            for cat in data.get("results", data.get("statistics", {}).get("splits", {}).get("categories", [])):
                for stat in cat.get("stats", []):
                    name = stat.get("name", "")
                    try:
                        stats[name] = float(stat.get("value", 0))
                    except (ValueError, TypeError):
                        pass
    except Exception as e:
        logger.debug(f"Team stats fetch failed for {team_id}: {e}")

    _team_stats_cache[cache_key] = stats
    return stats


def get_team_results(
    all_results: List[dict], team_name: str, n: int = 10
) -> List[dict]:
    """Filter league results to get a team's last N matches with computed stats."""
    team_lower = team_name.lower()
    team_matches = []

    for r in all_results:
        home = r["home_team"].lower()
        away = r["away_team"].lower()

        is_home = team_lower in home or home in team_lower
        is_away = team_lower in away or away in team_lower

        if not (is_home or is_away):
            continue

        if is_home:
            goals_for = r["home_score"]
            goals_against = r["away_score"]
            venue = "home"
            own_stats = r.get("home_stats", {})
            opp_stats = r.get("away_stats", {})
        else:
            goals_for = r["away_score"]
            goals_against = r["home_score"]
            venue = "away"
            own_stats = r.get("away_stats", {})
            opp_stats = r.get("home_stats", {})

        if goals_for > goals_against:
            result = "W"
        elif goals_for < goals_against:
            result = "L"
        else:
            result = "D"

        team_matches.append({
            "date": r["date"],
            "goals_for": goals_for,
            "goals_against": goals_against,
            "venue": venue,
            "result": result,
            "own_stats": own_stats,
            "opp_stats": opp_stats,
        })

    return team_matches[:n]


def compute_team_features(
    matches: List[dict], is_home_next: bool, match_date: str = ""
) -> Dict[str, float]:
    """
    Compute form + stats features from a team's recent results.
    Mirrors the FeatureBuilder in training.py but using ESPN scoreboard data.
    """
    n = len(matches)
    if n == 0:
        return {
            "form_5": 0.5, "form_10": 0.5, "weighted_form": 0.5,
            "goals_scored_avg5": 1.3, "goals_conceded_avg5": 1.3,
            "goals_scored_avg10": 1.3,
            "venue_win_pct": 0.4 if is_home_next else 0.3,
            "venue_goals_avg": 1.3,
            "ppg": 1.3, "clean_sheet_pct": 0.3, "gd_per_game": 0.0,
            "streak": 0, "unbeaten_run": 0,
            "days_rest": 7,
            "shots_ratio": 0.5, "sot_ratio": 0.5,
            "discipline": 1.5, "corner_dominance": 0.5,
        }

    # ── Form (points / max_points) ──
    def form_score(sl):
        if not sl:
            return 0.5
        pts = sum(3 if m["result"] == "W" else (1 if m["result"] == "D" else 0) for m in sl)
        return pts / (len(sl) * 3)

    form_5 = form_score(matches[:min(5, n)])
    form_10 = form_score(matches[:min(10, n)])

    # Weighted form (more recent = higher weight, like training.py)
    last5 = matches[:min(5, n)]
    weights = [0.4, 0.55, 0.7, 0.85, 1.0][-len(last5):]
    w_total = sum(weights)
    weighted_form = sum(
        (3 if m["result"] == "W" else (1 if m["result"] == "D" else 0)) * w
        for m, w in zip(last5, weights)
    ) / (w_total * 3) if w_total > 0 else 0.5

    # ── Goals averages ──
    s5 = matches[:min(5, n)]
    s10 = matches[:min(10, n)]
    goals_scored_avg5 = sum(m["goals_for"] for m in s5) / len(s5)
    goals_conceded_avg5 = sum(m["goals_against"] for m in s5) / len(s5)
    goals_scored_avg10 = sum(m["goals_for"] for m in s10) / len(s10)

    # ── Venue-specific stats ──
    venue_key = "home" if is_home_next else "away"
    venue_matches = [m for m in matches if m["venue"] == venue_key][:5]
    if venue_matches:
        venue_win_pct = sum(1 for m in venue_matches if m["result"] == "W") / len(venue_matches)
        venue_goals_avg = sum(m["goals_for"] for m in venue_matches) / len(venue_matches)
    else:
        venue_win_pct = 0.4 if is_home_next else 0.3
        venue_goals_avg = 1.3

    # ── Season stats ──
    ppg = sum(
        3 if m["result"] == "W" else (1 if m["result"] == "D" else 0)
        for m in s10
    ) / len(s10)
    clean_sheet_pct = sum(1 for m in s10 if m["goals_against"] == 0) / len(s10)
    gd_per_game = sum(m["goals_for"] - m["goals_against"] for m in s10) / len(s10)

    # ── Streak ──
    streak = 0
    first = matches[0]["result"]
    for m in matches:
        if m["result"] == first:
            streak += 1
        else:
            break
    if first == "L":
        streak = -streak

    # ── Unbeaten run ──
    unbeaten = 0
    for m in matches:
        if m["result"] != "L":
            unbeaten += 1
        else:
            break

    # ── Days rest ──
    days_rest = 7
    if match_date and matches[0].get("date"):
        try:
            current = datetime.fromisoformat(match_date.replace("Z", "+00:00"))
            last = datetime.fromisoformat(matches[0]["date"].replace("Z", "+00:00"))
            d = (current - last).days
            if 0 < d < 60:
                days_rest = d
        except Exception:
            days_rest = 7

    # ── Tactical stats from per-match statistics (if available) ──
    shots_for = 0.0
    shots_against = 0.0
    sot_for = 0.0
    sot_against = 0.0
    yellows = 0.0
    reds = 0.0
    corners_for = 0.0
    corners_against = 0.0
    tac_n = 0

    for m in matches:
        own = m.get("own_stats", {})
        opp = m.get("opp_stats", {})
        if own or opp:
            tac_n += 1
            shots_for += own.get("totalShots", own.get("shots", 0))
            shots_against += opp.get("totalShots", opp.get("shots", 0))
            sot_for += own.get("shotsOnTarget", own.get("shotsOnGoal", 0))
            sot_against += opp.get("shotsOnTarget", opp.get("shotsOnGoal", 0))
            yellows += own.get("yellowCards", own.get("foulsCommitted", 0) * 0.2)
            reds += own.get("redCards", 0)
            corners_for += own.get("wonCorners", own.get("cornerKicks", 0))
            corners_against += opp.get("wonCorners", opp.get("cornerKicks", 0))

    if tac_n > 0:
        total_shots = shots_for + shots_against
        total_sot = sot_for + sot_against
        total_corners = corners_for + corners_against
        shots_ratio = shots_for / total_shots if total_shots > 0 else 0.5
        sot_ratio = sot_for / total_sot if total_sot > 0 else 0.5
        discipline = (yellows + 3 * reds) / tac_n
        corner_dominance = corners_for / total_corners if total_corners > 0 else 0.5
    else:
        shots_ratio = 0.5
        sot_ratio = 0.5
        discipline = 1.5
        corner_dominance = 0.5

    return {
        "form_5": form_5, "form_10": form_10, "weighted_form": weighted_form,
        "goals_scored_avg5": goals_scored_avg5,
        "goals_conceded_avg5": goals_conceded_avg5,
        "goals_scored_avg10": goals_scored_avg10,
        "venue_win_pct": venue_win_pct, "venue_goals_avg": venue_goals_avg,
        "ppg": ppg, "clean_sheet_pct": clean_sheet_pct,
        "gd_per_game": gd_per_game,
        "streak": streak, "unbeaten_run": unbeaten,
        "days_rest": days_rest,
        "shots_ratio": shots_ratio, "sot_ratio": sot_ratio,
        "discipline": discipline, "corner_dominance": corner_dominance,
    }


def compute_h2h_features(
    all_results: List[dict], home_team: str, away_team: str
) -> Tuple[float, float, int]:
    """Compute H2H features from league results."""
    ht = home_team.lower()
    at = away_team.lower()
    h2h: List[dict] = []

    for r in all_results:
        h = r["home_team"].lower()
        a = r["away_team"].lower()

        is_match = (
            (ht in h or h in ht) and (at in a or a in at)
        ) or (
            (ht in a or a in ht) and (at in h or h in at)
        )

        if is_match:
            total_goals = r["home_score"] + r["away_score"]
            h_is_home = ht in h or h in ht
            if h_is_home:
                if r["home_score"] > r["away_score"]:
                    winner = "home"
                elif r["away_score"] > r["home_score"]:
                    winner = "away"
                else:
                    winner = "draw"
            else:
                if r["away_score"] > r["home_score"]:
                    winner = "home"
                elif r["home_score"] > r["away_score"]:
                    winner = "away"
                else:
                    winner = "draw"

            h2h.append({"total_goals": total_goals, "winner": winner})

    if not h2h:
        return 0.0, 2.5, 0

    h_wins = sum(1 for m in h2h if m["winner"] == "home")
    a_wins = sum(1 for m in h2h if m["winner"] == "away")
    advantage = (h_wins - a_wins) / len(h2h)
    avg_goals = sum(m["total_goals"] for m in h2h) / len(h2h)
    return advantage, avg_goals, len(h2h)


async def fetch_upcoming_matches(
    client: httpx.AsyncClient, espn_id: str, days_ahead: int = 14
) -> List[dict]:
    """Fetch scheduled/upcoming matches from ESPN."""
    matches = []
    today = datetime.now()
    fmt = lambda d: f"{d.year}{d.month:02d}{d.day:02d}"

    # Fetch from today to N days ahead
    start = today
    end = today + timedelta(days=days_ahead)
    date_range = f"{fmt(start)}-{fmt(end)}"

    url = f"https://site.api.espn.com/apis/site/v2/sports/soccer/{espn_id}/scoreboard?dates={date_range}&limit=100"
    try:
        resp = await client.get(url, timeout=15)
        if resp.status_code != 200:
            return []
        data = resp.json()

        for event in data.get("events", []):
            comp = event.get("competitions", [{}])[0]
            status = comp.get("status", {}).get("type", {}).get("name", "")

            # Only scheduled/pre-match — not finished, not in progress
            if "FINAL" in status or "FULL_TIME" in status or "IN_PROGRESS" in status:
                continue

            home_c = next(
                (c for c in comp.get("competitors", []) if c.get("homeAway") == "home"), None
            )
            away_c = next(
                (c for c in comp.get("competitors", []) if c.get("homeAway") == "away"), None
            )
            if not home_c or not away_c:
                continue

            venue = comp.get("venue", {})
            matches.append({
                "id": str(event.get("id", "")),
                "date": event.get("date", ""),
                "home_team": home_c.get("team", {}).get("displayName", "Unknown"),
                "away_team": away_c.get("team", {}).get("displayName", "Unknown"),
                "venue": venue.get("fullName", ""),
                "city": venue.get("address", {}).get("city", ""),
            })
    except Exception as e:
        logger.error(f"Error fetching upcoming {espn_id}: {e}")

    return matches


async def predict_upcoming(days_ahead: int = 14):
    """Main routine: fetch upcoming matches and generate predictions."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    elo = EloPredictor()

    # Load existing predictions to avoid duplicates. Unsettled records made
    # by a legacy engine are UPGRADE candidates: if the unified model can
    # score them now, we re-predict and replace (this also repairs records
    # stored against bracket placeholders like "Round of 32 11 Winner" —
    # the ESPN event id is stable, so once the real teams are known the
    # upgraded record carries them). fetch_upcoming_matches only returns
    # pre-match fixtures, so an in-play or finished match can never be
    # rewritten.
    existing_ids = set()
    legacy_pending_ids = set()
    for f in DATA_DIR.glob("predictions_*.json"):
        try:
            with open(f) as fh:
                data = json.load(fh)
            for p in data.get("predictions", []):
                existing_ids.add(p["match_id"])
                model = str(p.get("model_used") or "")
                if p.get("actual_winner") is None and not model.startswith("unified"):
                    legacy_pending_ids.add(p["match_id"])
        except Exception:
            continue

    all_upcoming: List[dict] = []
    league_results_map: Dict[str, List[dict]] = {}  # espn_id → completed results
    async with httpx.AsyncClient() as client:
        for espn_id, league_name in LEAGUES.items():
            logger.info(f"Fetching upcoming {league_name} ({espn_id})...")
            matches = await fetch_upcoming_matches(client, espn_id, days_ahead)
            for m in matches:
                m["league"] = league_name
                m["espn_id"] = espn_id
            # Keep genuinely new matches plus legacy-engine upgrade candidates.
            new_matches = []
            n_new = n_upgrade = 0
            for m in matches:
                if m["id"] not in existing_ids:
                    m["is_upgrade"] = False
                    new_matches.append(m)
                    n_new += 1
                elif m["id"] in legacy_pending_ids:
                    m["is_upgrade"] = True
                    new_matches.append(m)
                    n_upgrade += 1
            all_upcoming.extend(new_matches)
            logger.info(
                f"  Found {len(matches)} upcoming, {n_new} new, {n_upgrade} legacy upgrade candidates"
            )

            # Pre-fetch completed results per league (for real features)
            if new_matches:
                results = await fetch_league_results(client, espn_id, days_back=120)
                league_results_map[espn_id] = results

    if not all_upcoming:
        logger.info("No new upcoming matches to predict.")
        return

    all_upcoming.sort(key=lambda m: m["date"])
    logger.info(f"Total new upcoming matches to predict: {len(all_upcoming)}")

    # Try to load neural models
    registry = _get_registry()
    nn_leagues_used = set()
    unified_leagues_used = set()

    # Generate predictions
    predictions_by_month: Dict[str, list] = {}

    for m in all_upcoming:
        match_date_str = m["date"][:10]
        month_key = match_date_str[:7]
        league = m["league"]
        league_key = DISPLAY_TO_KEY.get(league, "")
        espn_id = m.get("espn_id", "")
        gender = LEAGUE_GENDER.get(espn_id, "M")
        league_tuning = _get_league_tuning(league_key, league)

        # Get league results for real features
        league_results = league_results_map.get(espn_id, [])

        # ── Baseline ELO prediction (always computed) ──
        elo_probs = elo.predict(m["home_team"], m["away_team"], league)
        pred_home_xg, pred_away_xg = elo.predict_goals(m["home_team"], m["away_team"], league)

        # Build feature vector once so we can persist it for post-match learning.
        features = _build_match_features(
            elo, m["home_team"], m["away_team"], league_key,
            elo_probs, pred_home_xg, pred_away_xg,
            league_results=league_results,
            match_date=m.get("date", ""),
        )

        # ── Unified multi-task model (preferred engine) ──
        unified = _predict_unified(m, espn_id, gender)
        if unified is not None:
            unified_leagues_used.add(league)

        # Upgrade candidates only ever move legacy -> unified. If the
        # unified model can't score this fixture either, keep the
        # existing record untouched.
        if m.get("is_upgrade") and unified is None:
            continue

        # ── Neural model prediction (legacy fallback, when available) ──
        nn_probs = None
        nn_goals = None
        blend_entropy = None
        blend_nn_weight = None
        blend_elo_weight = None
        model_selection_meta = None
        model_used = "elo_poisson"

        if unified is None and registry and league_key:
            nn_probs, nn_goals, model_used, model_selection_meta = _predict_neural_with_policy(
                registry,
                league_key,
                features,
            )
            if nn_probs is not None:
                nn_leagues_used.add(league)

        # ── Blend predictions ──
        if unified is not None:
            probs = unified["probs"]
            model_used = unified["model_used"]
        elif nn_probs is not None:
            # Confidence-aware blend: trust NN more when entropy is low.
            entropy = -sum(max(p, 1e-12) * math.log(max(p, 1e-12)) for p in nn_probs.values())
            entropy_norm = min(1.0, entropy / math.log(3.0))

            # Tuned weighting from walk-forward diagnostics.
            nn_base = float(league_tuning.get("blend_nn_base", 0.66))
            entropy_sensitivity = float(league_tuning.get("entropy_sensitivity", 0.18))
            nn_min = float(league_tuning.get("blend_nn_min", 0.55))
            nn_max = float(league_tuning.get("blend_nn_max", 0.82))

            blend_nn_weight = nn_base + (1.0 - entropy_norm) * entropy_sensitivity
            blend_nn_weight = max(nn_min, min(nn_max, blend_nn_weight))
            blend_elo_weight = 1.0 - blend_nn_weight
            blend_entropy = entropy_norm

            probs = {
                "home_win": round(blend_nn_weight * nn_probs["home_win"] + blend_elo_weight * elo_probs["home_win"], 4),
                "draw": round(blend_nn_weight * nn_probs["draw"] + blend_elo_weight * elo_probs["draw"], 4),
                "away_win": round(blend_nn_weight * nn_probs["away_win"] + blend_elo_weight * elo_probs["away_win"], 4),
            }
            # Normalize
            total_p = sum(probs.values())
            probs = {k: round(v / total_p, 4) for k, v in probs.items()}
        else:
            probs = elo_probs

        if unified is not None:
            final_home_xg = unified["home_xg"]
            final_away_xg = unified["away_xg"]
        elif nn_goals is not None:
            # Blend goals: 75% neural, 25% ELO
            final_home_xg = 0.75 * nn_goals[0] + 0.25 * pred_home_xg
            final_away_xg = 0.75 * nn_goals[1] + 0.25 * pred_away_xg
        else:
            final_home_xg = pred_home_xg
            final_away_xg = pred_away_xg

        if unified is not None:
            # PMF argmax, not rounded xG — the real scoreline product.
            pred_scoreline = unified["predicted_scoreline"]
        else:
            pred_scoreline = poisson_scoreline(final_home_xg, final_away_xg)

        # Tuned draw decision: predict draw when draw probability is both
        # materially high and close to the strongest win probability.
        draw_min_prob = float(league_tuning.get("draw_min_prob", 0.24))
        draw_margin = float(league_tuning.get("draw_margin", 0.02))
        max_non_draw = max(probs["home_win"], probs["away_win"])

        if probs["draw"] >= draw_min_prob and probs["draw"] + draw_margin >= max_non_draw:
            pred_winner = "draw"
        elif probs["home_win"] >= probs["away_win"]:
            pred_winner = "home"
        elif probs["away_win"] > probs["home_win"]:
            pred_winner = "away"
        else:
            pred_winner = "draw"

        record = {
            "match_id": m["id"],
            "home_team": m["home_team"],
            "away_team": m["away_team"],
            "league": league,
            "match_date": match_date_str,
            "gender": gender,
            "predicted_home_win": probs["home_win"],
            "predicted_draw": probs["draw"],
            "predicted_away_win": probs["away_win"],
            "predicted_home_goals": round(final_home_xg, 2),
            "predicted_away_goals": round(final_away_xg, 2),
            "predicted_scoreline": pred_scoreline,
            "top_scorelines": unified["top_scorelines"] if unified else None,
            "attribution": unified["attribution"] if unified else None,
            "predicted_winner": pred_winner,
            "confidence": round(max(probs.values()) * 100, 1),
            "home_elo": round(unified["home_elo"] if unified else elo.get(m["home_team"]), 1),
            "away_elo": round(unified["away_elo"] if unified else elo.get(m["away_team"]), 1),
            "model_used": model_used,
            "model_selection": model_selection_meta,
            "blend_nn_weight": round(blend_nn_weight, 4) if blend_nn_weight is not None else None,
            "blend_elo_weight": round(blend_elo_weight, 4) if blend_elo_weight is not None else None,
            "blend_entropy": round(blend_entropy, 4) if blend_entropy is not None else None,
            "draw_min_prob": round(draw_min_prob, 4),
            "draw_margin": round(draw_margin, 4),
            "weather_factor": 1.0,
            "referee_factor": 1.0,
            "venue": m.get("venue", ""),
            "feature_vector": [round(float(v), 6) for v in features.ravel().tolist()],
            # Neural model raw probs (if available)
            "nn_home_win": round(nn_probs["home_win"], 4) if nn_probs else None,
            "nn_draw": round(nn_probs["draw"], 4) if nn_probs else None,
            "nn_away_win": round(nn_probs["away_win"], 4) if nn_probs else None,
            # Outcome fields — null until match is played
            "actual_home_goals": None,
            "actual_away_goals": None,
            "actual_winner": None,
            "winner_correct": None,
            "scoreline_correct": None,
            "scoreline_in_top5": None,
            "goals_diff": None,
            "prediction_timestamp": datetime.now().isoformat(),
            "outcome_timestamp": None,
        }

        if month_key not in predictions_by_month:
            predictions_by_month[month_key] = []
        predictions_by_month[month_key].append(record)

    # Merge into existing monthly files (or create new ones)
    new_count = 0
    for month_key, new_preds in predictions_by_month.items():
        file_path = DATA_DIR / f"predictions_{month_key}.json"

        if file_path.exists():
            with open(file_path) as f:
                existing = json.load(f)
            existing_preds = existing.get("predictions", [])
            by_id = {p["match_id"]: i for i, p in enumerate(existing_preds)}
            added = 0
            for p in new_preds:
                idx = by_id.get(p["match_id"])
                if idx is None:
                    existing_preds.append(p)
                    added += 1
                elif (
                    existing_preds[idx].get("actual_winner") is None
                    and not str(existing_preds[idx].get("model_used") or "").startswith("unified")
                    and str(p.get("model_used") or "").startswith("unified")
                ):
                    # Legacy → unified upgrade of an unsettled pre-match pick.
                    existing_preds[idx] = p
                    added += 1
            existing["predictions"] = existing_preds
            existing["count"] = len(existing_preds)
            new_count += added
        else:
            existing = {"month": month_key, "count": len(new_preds), "predictions": new_preds}
            new_count += len(new_preds)

        with open(file_path, "w") as f:
            json.dump(existing, f, indent=2)
        logger.info(f"  {file_path.name}: {len(existing['predictions'])} total predictions")

    # Report
    by_league: Dict[str, int] = {}
    for preds in predictions_by_month.values():
        for p in preds:
            by_league[p["league"]] = by_league.get(p["league"], 0) + 1

    logger.info(f"\n{'='*60}")
    logger.info("UPCOMING MATCH PREDICTIONS COMPLETE")
    logger.info(f"  New predictions stored: {new_count}")
    if unified_leagues_used:
        logger.info(f"  Unified model used for: {', '.join(sorted(unified_leagues_used))}")
    if nn_leagues_used:
        logger.info(f"  Legacy neural model used for: {', '.join(sorted(nn_leagues_used))}")
    if not unified_leagues_used and not nn_leagues_used:
        logger.info("  Neural models: not available (using ELO + Poisson baseline)")
    for lg, count in sorted(by_league.items()):
        model_tag = " [unified]" if lg in unified_leagues_used else (" [NN]" if lg in nn_leagues_used else "")
        logger.info(f"    {lg}: {count} matches{model_tag}")
    logger.info(f"  Stored in: {DATA_DIR}")
    logger.info(f"{'='*60}")


def _build_match_features(
    elo_predictor, home_team: str, away_team: str, league_key: str,
    elo_probs: Dict, pred_home_xg: float, pred_away_xg: float,
    league_results: Optional[List[dict]] = None,
    match_date: str = "",
) -> np.ndarray:
    """
    Build a 66-feature vector for neural model prediction.

    v5.1: Uses REAL ESPN data for form, goals, venue splits, H2H, rest days,
    streaks, season stats, and tactical features when available.
    Falls back to ELO proxies only when no ESPN data exists.
    Adds Poisson xG, interaction terms, goal consistency, strength of schedule.
    """
    from backend.services.prediction.training import (
        N_FEATURES, LEAGUE_DRAW_RATES as LD_DRAW,
        LEAGUE_AVG_TOTAL_GOALS as LD_GOALS,
        LEAGUE_HOME_WIN_RATE as LD_HOME, LEAGUE_COMPETITIVENESS as LD_COMP,
    )
    features = np.zeros(N_FEATURES, dtype=np.float64)

    h_elo = elo_predictor.get(home_team)
    a_elo = elo_predictor.get(away_team)

    # ═══ Core ELO features (0-2) — always available ═══
    features[0] = h_elo
    features[1] = a_elo
    features[2] = h_elo - a_elo

    # ═══ Real data features (when league results are available) ═══
    if league_results:
        home_matches = get_team_results(league_results, home_team, 10)
        away_matches = get_team_results(league_results, away_team, 10)
        home_f = compute_team_features(home_matches, True, match_date)
        away_f = compute_team_features(away_matches, False, match_date)
        h2h_adv, h2h_goals, h2h_count = compute_h2h_features(
            league_results, home_team, away_team
        )

        # Form (12) [3-14] — REAL DATA
        features[3] = home_f["form_5"]
        features[4] = away_f["form_5"]
        features[5] = home_f["form_10"]
        features[6] = away_f["form_10"]
        features[7] = home_f["weighted_form"]
        features[8] = away_f["weighted_form"]
        features[9] = home_f["goals_scored_avg5"]
        features[10] = away_f["goals_scored_avg5"]
        features[11] = home_f["goals_conceded_avg5"]
        features[12] = away_f["goals_conceded_avg5"]
        features[13] = home_f["goals_scored_avg10"]
        features[14] = away_f["goals_scored_avg10"]

        # Home/away splits (4) [15-18] — REAL DATA
        features[15] = home_f["venue_win_pct"]
        features[16] = away_f["venue_win_pct"]
        features[17] = home_f["venue_goals_avg"]
        features[18] = away_f["venue_goals_avg"]

        # H2H (3) [19-21] — REAL DATA
        features[19] = h2h_adv
        features[20] = h2h_goals
        features[21] = min(h2h_count, 10)

        # Context (6) [22-27] — REAL rest days
        league_coeff = get_league_param(league_key, "league_coefficient", 1.0)
        features[22] = 0.5  # matchday_pct (mid-season default)
        features[23] = is_derby_fixture(home_team, away_team)
        features[24] = league_coeff
        features[25] = home_f["days_rest"]
        features[26] = away_f["days_rest"]
        features[27] = home_f["days_rest"] - away_f["days_rest"]

        # Season stats (6) [28-33] — REAL DATA
        features[28] = home_f["ppg"]
        features[29] = away_f["ppg"]
        features[30] = home_f["clean_sheet_pct"]
        features[31] = away_f["clean_sheet_pct"]
        features[32] = home_f["gd_per_game"]
        features[33] = away_f["gd_per_game"]

        # Momentum (4) [34-37] — REAL DATA
        features[34] = home_f["streak"]
        features[35] = away_f["streak"]
        features[36] = home_f["unbeaten_run"]
        features[37] = away_f["unbeaten_run"]

        # Tactical stats (8) [43-50] — REAL when stats available
        features[43] = home_f["shots_ratio"]
        features[44] = away_f["shots_ratio"]
        features[45] = home_f["sot_ratio"]
        features[46] = away_f["sot_ratio"]
        features[47] = home_f["discipline"]
        features[48] = away_f["discipline"]
        features[49] = home_f["corner_dominance"]
        features[50] = away_f["corner_dominance"]

    else:
        # ═══ Fallback: ELO proxies (same as v4) ═══
        home_strength = max(0.1, min(0.9, elo_probs["home_win"]))
        away_strength = max(0.1, min(0.9, elo_probs["away_win"]))
        features[3] = home_strength
        features[4] = away_strength
        features[5] = home_strength
        features[6] = away_strength
        features[7] = home_strength
        features[8] = away_strength
        features[9] = pred_home_xg
        features[10] = pred_away_xg
        features[11] = max(0.5, pred_away_xg * 0.9)
        features[12] = max(0.5, pred_home_xg * 0.9)
        features[13] = pred_home_xg
        features[14] = pred_away_xg
        features[15] = home_strength + 0.05
        features[16] = away_strength - 0.05
        features[17] = pred_home_xg
        features[18] = pred_away_xg * 0.85
        features[19] = 0.0
        features[20] = pred_home_xg + pred_away_xg
        features[21] = 0.0
        league_coeff = get_league_param(league_key, "league_coefficient", 1.0)
        features[22] = 0.5
        features[23] = is_derby_fixture(home_team, away_team)
        features[24] = league_coeff
        features[25] = 7.0
        features[26] = 7.0
        features[27] = 0.0
        home_ppg = 1.0 + (h_elo - 1500) / 500
        away_ppg = 1.0 + (a_elo - 1500) / 500
        features[28] = max(0.5, min(3.0, home_ppg))
        features[29] = max(0.5, min(3.0, away_ppg))
        features[30] = max(0.05, min(0.6, 0.2 + (h_elo - 1500) / 2000))
        features[31] = max(0.05, min(0.6, 0.2 + (a_elo - 1500) / 2000))
        features[32] = (h_elo - 1500) / 500
        features[33] = (a_elo - 1500) / 500
        features[34] = 0.0
        features[35] = 0.0
        features[36] = 3.0
        features[37] = 3.0
        features[43] = 0.5
        features[44] = 0.5
        features[45] = 0.5
        features[46] = 0.5
        features[47] = 0.0
        features[48] = 0.0
        features[49] = 0.5
        features[50] = 0.5

    # ═══ Market-implied probabilities (38-42) — use ELO probs as proxy ═══
    # (No reliable free odds API; ELO is the best available proxy)
    features[38] = elo_probs["home_win"]
    features[39] = elo_probs["draw"]
    features[40] = elo_probs["away_win"]
    features[41] = max(elo_probs["home_win"], elo_probs["draw"], elo_probs["away_win"])
    features[42] = 0.0

    # ═══ League characteristics (51-54) — always available ═══
    features[51] = LD_DRAW.get(league_key, 0.26)
    features[52] = LD_GOALS.get(league_key, 2.65)
    features[53] = LD_HOME.get(league_key, 0.45)
    features[54] = LD_COMP.get(league_key, 0.5)

    # ═══ Poisson xG (55-56) — derived from scoring rates ═══
    league_avg_half = LD_GOALS.get(league_key, 2.65) / 2.0
    if league_results:
        home_scored_rate = home_f.get("goals_scored_avg5", pred_home_xg) if league_results else pred_home_xg
        away_scored_rate = away_f.get("goals_scored_avg5", pred_away_xg) if league_results else pred_away_xg
    else:
        home_scored_rate = pred_home_xg
        away_scored_rate = pred_away_xg
    features[55] = max(0.3, min(4.0, home_scored_rate * 1.15))  # home xG with home factor
    features[56] = max(0.3, min(4.0, away_scored_rate * 0.87))  # away xG with away factor

    # ═══ Key interactions (57-61) — nonlinear feature relationships ═══
    elo_diff = features[2]  # h_elo - a_elo
    form_diff = features[7] - features[8]  # weighted form home - away
    h2h_val = features[19]  # h2h advantage
    features[57] = elo_diff * form_diff  # elo × form_diff
    features[58] = elo_diff * h2h_val  # elo × h2h
    features[59] = features[38] * features[7] if features[38] > 0 else 0.0  # implied_home × form
    features[60] = (features[25] / 7.0) * features[7]  # rest × form home
    features[61] = (features[26] / 7.0) * features[8]  # rest × form away

    # ═══ Goal consistency (62-63) — scoring variance ═══
    if league_results:
        home_goals_list = [m.get("home_score", 0) if m.get("home_team") == home_team else m.get("away_score", 0)
                           for m in get_team_results(league_results, home_team, 10)]
        away_goals_list = [m.get("away_score", 0) if m.get("away_team") == away_team else m.get("home_score", 0)
                           for m in get_team_results(league_results, away_team, 10)]
        features[62] = 1.0 / (1.0 + float(np.std(home_goals_list))) if home_goals_list else 0.5
        features[63] = 1.0 / (1.0 + float(np.std(away_goals_list))) if away_goals_list else 0.5
    else:
        features[62] = 0.5
        features[63] = 0.5

    # ═══ Strength of schedule (64-65) — avg opponent ELO ═══
    features[64] = h_elo  # Use own ELO as proxy when opponent data unavailable
    features[65] = a_elo

    return features.reshape(1, -1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Predict upcoming matches")
    parser.add_argument("--days", type=int, default=14, help="Days ahead to fetch (default: 14)")
    args = parser.parse_args()
    asyncio.run(predict_upcoming(args.days))
