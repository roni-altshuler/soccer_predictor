"""Reviewed provider identities for legacy injury caches; no model imports."""
import json
from pathlib import Path
import re

from backend.services.data.injury_diagnostics import InjuryReportFailure
from backend.services.data.provider_status import ProviderUnavailable, observation_time
from backend.services.espn.client import ESPN_LEAGUE_IDS

DEFAULT_ROUTES_PATH = Path(__file__).resolve().parents[2] / 'data' / 'injury_team_routes.json'


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate routing key')
        result[key] = value
    return result


def _team_id(value):
    return isinstance(value, str) and re.fullmatch(r'[1-9][0-9]{0,19}', value) is not None


def resolve_injury_league(provider, team_id, explicit_league=None, routes_path=DEFAULT_ROUTES_PATH):
    """Explicit context wins; otherwise require one reviewed qualified binding."""
    if provider not in ('espn', 'fotmob'):
        raise InjuryReportFailure('invalid_context', 'unknown_provider')
    if not _team_id(team_id):
        raise InjuryReportFailure('invalid_context', 'invalid_team_identity')
    if explicit_league is not None:
        if not isinstance(explicit_league, str) or explicit_league not in ESPN_LEAGUE_IDS:
            raise InjuryReportFailure('invalid_context', 'unknown_league')
        return explicit_league
    try:
        data = json.loads(Path(routes_path).read_text(), object_pairs_hook=_unique_object)
        if not isinstance(data, dict) or type(data.get('schema_version')) is not int or data['schema_version'] != 1:
            raise ValueError('Invalid routing schema')
        provenance = data.get('provenance')
        if not isinstance(provenance, dict) or (
            provenance.get('repository') != 'roni-altshuler/soccer_predictor'
            or provenance.get('path') != 'backend/data/sim_priors.json'
            or provenance.get('builder') != 'backend/scripts/build_sim_priors.py'
            or not isinstance(provenance.get('commit'), str)
            or not re.fullmatch(r'[0-9a-f]{40}', provenance['commit'])
            or not isinstance(provenance.get('sha256'), str)
            or not re.fullmatch(r'[0-9a-f]{64}', provenance['sha256'])
        ):
            raise ValueError('Invalid routing provenance')
        observation_time(provenance.get('generated_at'))
        routes = data.get('routes')
        if not isinstance(routes, list) or any(
            not isinstance(row, dict) or row.get('provider') not in ('espn', 'fotmob')
            or not _team_id(row.get('team_id')) for row in routes
        ):
            raise ValueError('Invalid routing identities')
    except (OSError, ValueError, ProviderUnavailable):
        raise InjuryReportFailure('invalid_context', 'invalid_routing_evidence') from None
    matches = [row for row in routes if row['provider'] == provider and row['team_id'] == team_id]
    if not matches:
        raise InjuryReportFailure('invalid_context', 'missing_league_mapping')
    if len(matches) != 1:
        raise InjuryReportFailure('invalid_context', 'conflicting_league_mapping')
    route = matches[0]
    league = route.get('league_key')
    if not isinstance(league, str) or league not in ESPN_LEAGUE_IDS or route.get('league_slug') != ESPN_LEAGUE_IDS[league]:
        raise InjuryReportFailure('invalid_context', 'unsupported_league_mapping')
    if not isinstance(route.get('team_name'), str) or not route['team_name'].strip():
        raise InjuryReportFailure('invalid_context', 'invalid_routing_evidence')
    return league
