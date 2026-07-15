"""Resolve Dixon-Coles param team names against the frontend simulators' names.

The committed ``backend/data/dixon_coles_params.json`` keys teams by the
warehouse's *source-canonical* names (fdcouk spellings for the European men's
leagues, ESPN spellings for the women's competitions). The frontend league
simulator (``src/app/api/simulation/[leagueId]/route.ts``) builds its team list
from the live ESPN standings ``team.displayName`` — which does NOT always match
("Ath Madrid" vs "Atlético Madrid", "Ipswich" vs "Ipswich Town", ...).

This CLI closes that gap. For every competition in the params artifact it

1. fetches the current ESPN standings (the exact payload the simulator uses),
2. resolves each params team onto an ESPN ``displayName`` using
   *conservative* matching only — exact, normalized (case / diacritics /
   punctuation / FC-style suffixes, mirroring the frontend's
   ``normalizeTeamName``), or an explicit entry in :data:`MANUAL_OVERRIDES`.
   Anything ambiguous or unresolved is listed as unmatched — never guessed —
   so those teams honestly fall back to the simulator's existing behaviour,
3. converts each matched team's attack/defence strengths into an
   expected-points-per-game prior (``prior_ppg``) by playing a full home-and-away
   round robin against the other matched teams with the fitted Dixon-Coles
   model (Poisson goal expectations + the low-score rho correction),

and writes a committed JSON artifact the Next.js side can read on Vercel
(same pattern as ``backend/data/rarity/`` → ``src/lib/rarity.ts``).

Run
---
    python -m backend.scripts.build_sim_priors

Artifact (committed): ``backend/data/sim_priors.json``
Consumed by: ``src/lib/simulation/teamPriors.ts``

Rerun this after every ``train_dixon_coles`` refresh; unmatched names are
printed loudly so new stubborn spellings can be added to MANUAL_OVERRIDES.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Dict, List, Optional, Sequence

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services.prediction.dixon_coles import DixonColesModel  # noqa: E402

PARAMS_PATH = ROOT / "backend" / "data" / "dixon_coles_params.json"
DEFAULT_OUTPUT = ROOT / "backend" / "data" / "sim_priors.json"

SCHEMA_VERSION = 1

STANDINGS_URL = "https://site.api.espn.com/apis/v2/sports/soccer/{slug}/standings"
HTTP_HEADERS = {
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
}

# Warehouse competition id -> ESPN API slug. Identity for the men's leagues;
# the women's competitions use different ESPN slugs (see src/app/api/standings).
ESPN_SLUGS: Dict[str, str] = {
    "eng.1.w": "eng.w.1",
    "usa.1.w": "usa.nwsl",
    "uefa.champions.w": "uefa.wchampions",
    "uefa.euro.w": "uefa.weuro",
    "fifa.world.w": "fifa.wwc",
}

# Explicit params-name -> ESPN displayName bindings for spellings the
# conservative normalizer cannot (and must not) bridge on its own.
# Keyed by competition id, then by the params (warehouse-canonical) name.
MANUAL_OVERRIDES: Dict[str, Dict[str, str]] = {
    "eng.1": {
        "Ipswich": "Ipswich Town",
    },
    "esp.1": {
        "Ath Madrid": "Atlético Madrid",
        "Athletic Bilbao": "Athletic Club",
        "Vallecano": "Rayo Vallecano",
    },
    "usa.1.w": {
        "NJ/NY Gotham FC": "Gotham FC",
    },
}

_SUFFIX_WORDS = re.compile(r"\b(football club|fc|afc|cf|sc|club|the)\b")
_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def normalize_team_name(name: str) -> str:
    """Mirror the frontend's ``normalizeTeamName`` exactly.

    NFD-decompose and strip diacritics, lowercase, expand ``&``, drop
    FC/AFC/CF/SC/club/the tokens, collapse everything else to single spaces.
    """
    decomposed = unicodedata.normalize("NFD", name)
    stripped = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    lowered = stripped.lower().replace("&", " and ")
    without_suffixes = _SUFFIX_WORDS.sub(" ", lowered)
    return _NON_ALNUM.sub(" ", without_suffixes).strip()


def fetch_frontend_teams(competition_id: str) -> List[Dict[str, str]]:
    """Current ESPN standings roster for a competition.

    Returns ``[{"name": displayName, "id": teamId}, ...]`` — the same names the
    frontend simulator receives. Raises on HTTP/shape errors (the caller skips
    the competition rather than emitting a half-guessed mapping).
    """
    import urllib.request

    slug = ESPN_SLUGS.get(competition_id, competition_id)
    req = urllib.request.Request(
        STANDINGS_URL.format(slug=slug), headers=HTTP_HEADERS
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.load(resp)
    children = data.get("children") or []
    entries = (
        children[0].get("standings", {}).get("entries", []) if children else []
    )
    teams: List[Dict[str, str]] = []
    for entry in entries:
        team = entry.get("team") or {}
        name = team.get("displayName")
        if not name:
            continue
        teams.append({"name": str(name), "id": str(team.get("id", ""))})
    if not teams:
        raise ValueError(f"ESPN standings for {slug} contained no teams")
    return teams


def resolve_aliases(
    params_team_names: Sequence[str],
    frontend_teams: Sequence[Dict[str, str]],
    overrides: Optional[Dict[str, str]] = None,
) -> Dict[str, object]:
    """Conservatively map params team names onto frontend team names.

    Match order per params team: manual override -> exact -> unique normalized.
    A normalized match counts only when it is unambiguous on BOTH sides (no two
    frontend teams and no two params teams share the normalized key). Anything
    else lands in the unmatched lists — an unmatched team simply gets no prior.
    """
    overrides = overrides or {}
    frontend_by_exact = {t["name"]: t for t in frontend_teams}

    frontend_by_norm: Dict[str, List[Dict[str, str]]] = {}
    for t in frontend_teams:
        frontend_by_norm.setdefault(normalize_team_name(t["name"]), []).append(t)

    params_norm_counts: Dict[str, int] = {}
    for name in params_team_names:
        key = normalize_team_name(name)
        params_norm_counts[key] = params_norm_counts.get(key, 0) + 1

    matched: Dict[str, Dict[str, str]] = {}
    unmatched_params: List[str] = []
    claimed_frontend: Dict[str, str] = {}  # frontend name -> params name

    def claim(params_name: str, team: Dict[str, str], method: str) -> bool:
        if team["name"] in claimed_frontend:
            return False  # two params teams onto one frontend team — refuse
        claimed_frontend[team["name"]] = params_name
        matched[params_name] = {
            "frontend_name": team["name"],
            "espn_team_id": team["id"],
            "match": method,
        }
        return True

    for params_name in sorted(params_team_names):
        target = overrides.get(params_name)
        if target is not None:
            team = frontend_by_exact.get(target)
            # An override pointing at a name ESPN no longer lists is stale:
            # treat as unmatched rather than inventing a binding.
            if team is None or not claim(params_name, team, "override"):
                unmatched_params.append(params_name)
            continue

        team = frontend_by_exact.get(params_name)
        if team is not None and claim(params_name, team, "exact"):
            continue

        key = normalize_team_name(params_name)
        candidates = frontend_by_norm.get(key, [])
        if (
            len(candidates) == 1
            and params_norm_counts.get(key, 0) == 1
            and claim(params_name, candidates[0], "normalized")
        ):
            continue

        unmatched_params.append(params_name)

    unmatched_frontend = sorted(
        t["name"] for t in frontend_teams if t["name"] not in claimed_frontend
    )
    return {
        "matched": matched,
        "unmatched_params": unmatched_params,
        "unmatched_frontend": unmatched_frontend,
    }


def compute_prior_ppg(
    model: DixonColesModel, team_names: Sequence[str]
) -> Dict[str, float]:
    """Expected points per game from a full home-and-away round robin.

    Every ordered pair plays once with the fitted model's outcome
    probabilities; each team's expected points divide by its 2*(M-1) matches.
    With fewer than two teams there is no opposition — returns {}.
    """
    names = sorted(team_names)
    if len(names) < 2:
        return {}
    points = {name: 0.0 for name in names}
    for home in names:
        for away in names:
            if home == away:
                continue
            pred = model.predict(home, away)
            points[home] += 3.0 * float(pred["p_home"]) + float(pred["p_draw"])
            points[away] += 3.0 * float(pred["p_away"]) + float(pred["p_draw"])
    matches_each = 2 * (len(names) - 1)
    return {name: points[name] / matches_each for name in names}


def build_competition_entry(
    competition_id: str,
    comp_params: Dict[str, object],
    frontend_teams: Sequence[Dict[str, str]],
) -> Dict[str, object]:
    """Alias resolution + priors for one competition's params entry."""
    model = DixonColesModel.from_dict(comp_params)
    resolution = resolve_aliases(
        sorted(model.teams.keys()),
        frontend_teams,
        MANUAL_OVERRIDES.get(competition_id),
    )
    matched: Dict[str, Dict[str, str]] = resolution["matched"]  # type: ignore[assignment]
    prior_ppg = compute_prior_ppg(model, list(matched.keys()))

    teams_out: Dict[str, object] = {}
    for params_name, binding in matched.items():
        rating = model.teams[params_name]
        teams_out[binding["frontend_name"]] = {
            "params_name": params_name,
            "espn_team_id": binding["espn_team_id"],
            "match": binding["match"],
            "attack": round(float(rating["attack"]), 6),
            "defence": round(float(rating["defence"]), 6),
            "prior_ppg": round(prior_ppg.get(params_name, 0.0), 4),
        }

    return {
        "espn_league_slug": ESPN_SLUGS.get(competition_id, competition_id),
        "home_adv": comp_params.get("home_adv"),
        "rho": comp_params.get("rho"),
        "fitted_matches": comp_params.get("fitted_matches"),
        "last_match_date": comp_params.get("last_match_date"),
        "teams": teams_out,
        "unmatched_params_teams": resolution["unmatched_params"],
        "unmatched_frontend_teams": resolution["unmatched_frontend"],
    }


def build_artifact(
    params: Dict[str, object],
    competition_ids: Sequence[str],
    fetcher: Callable[[str], List[Dict[str, str]]] = fetch_frontend_teams,
    now: Optional[str] = None,
) -> Dict[str, object]:
    competitions_params: Dict[str, Dict[str, object]] = params.get(  # type: ignore[assignment]
        "competitions", {}
    )
    competitions: Dict[str, object] = {}
    for comp in sorted(competition_ids):
        comp_params = competitions_params.get(comp)
        if comp_params is None:
            print(f"  !! {comp}: not present in params artifact — skipped")
            continue
        try:
            frontend_teams = fetcher(comp)
        except Exception as exc:  # noqa: BLE001 — skip, never guess
            print(f"  !! {comp}: could not fetch frontend team list ({exc}) — skipped")
            continue
        entry = build_competition_entry(comp, comp_params, frontend_teams)
        competitions[comp] = entry
        teams = entry["teams"]
        methods = [t["match"] for t in teams.values()]  # type: ignore[union-attr]
        print(
            f"  {comp}: {len(teams)} matched "
            f"(exact={methods.count('exact')}, "
            f"normalized={methods.count('normalized')}, "
            f"override={methods.count('override')}), "
            f"{len(entry['unmatched_params_teams'])} params-only, "  # type: ignore[arg-type]
            f"{len(entry['unmatched_frontend_teams'])} frontend-only"  # type: ignore[arg-type]
        )
        for name in entry["unmatched_params_teams"]:  # type: ignore[union-attr]
            print(f"      params-only (no prior emitted): {name}")
        for name in entry["unmatched_frontend_teams"]:  # type: ignore[union-attr]
            print(f"      frontend-only (simulates without prior): {name}")
    return {
        "schema": SCHEMA_VERSION,
        "generated_at": now
        or datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "params_generated_at": params.get("generated_at"),
        "competitions": competitions,
    }


def write_artifact(artifact: Dict[str, object], output: Path) -> None:
    """Deterministic serialisation: sorted keys, fixed indent, trailing newline."""
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(artifact, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Map Dixon-Coles param team names onto the frontend simulator's "
            "team names and emit expected-points priors."
        )
    )
    parser.add_argument(
        "--params",
        type=Path,
        default=PARAMS_PATH,
        help=f"Dixon-Coles params artifact (default {PARAMS_PATH})",
    )
    parser.add_argument(
        "--competitions",
        nargs="*",
        default=None,
        help="Competition ids to resolve (default: every one in the params file)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Artifact path (default {DEFAULT_OUTPUT})",
    )
    args = parser.parse_args(argv)

    params = json.loads(args.params.read_text(encoding="utf-8"))
    competition_ids = args.competitions or sorted(params.get("competitions", {}))
    print(f"Resolving simulator priors: {', '.join(competition_ids)}")

    artifact = build_artifact(params, competition_ids)
    if not artifact["competitions"]:
        print("No competitions could be resolved — artifact not written.")
        return 1
    write_artifact(artifact, args.output)
    print(f"Wrote {args.output} ({len(artifact['competitions'])} competitions)")  # type: ignore[arg-type]
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
