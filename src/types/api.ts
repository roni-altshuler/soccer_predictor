/**
 * API response types for the soccer prediction service
 */

export interface HeadToHeadPrediction {
  success: boolean;
  predictions: {
    home_win: number;
    draw: number;
    away_win: number;
    home_team: string;
    away_team: string;
  };
}

export interface CrossLeaguePrediction {
  success: boolean;
  predictions: {
    team_a_win: number;
    draw: number;
    team_b_win: number;
    team_a: string;
    team_b: string;
    league_a: string;
    league_b: string;
  };
}

export interface TeamsResponse {
  success: boolean;
  teams: string[];
}

export interface ErrorResponse {
  success: false;
  detail: string;
}

export type League = 
  | 'premier_league'
  | 'la_liga' 
  | 'bundesliga'
  | 'serie_a'
  | 'ligue_1'
  | 'mls'
  | 'ucl'
  | 'uel'
  | 'world_cup'
  | 'eredivisie'
  | 'primeira_liga'
  | 'conference_league';

// API utilities
export async function fetchHeadToHead(league: League, homeTeam: string, awayTeam: string): Promise<HeadToHeadPrediction> {
  const response = await fetch('/api/predict/head-to-head', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ league, home_team: homeTeam, away_team: awayTeam })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Failed to predict match');
  }

  return response.json();
}

export async function fetchCrossLeague(
  leagueA: League, 
  teamA: string,
  leagueB: League,
  teamB: string
): Promise<CrossLeaguePrediction> {
  const response = await fetch('/api/predict/cross-league', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      league_a: leagueA,
      team_a: teamA,
      league_b: leagueB,
      team_b: teamB
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Failed to predict match');
  }

  return response.json();
}

export async function fetchTeams(league: League): Promise<TeamsResponse> {
  const response = await fetch(`/api/teams/${league}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Failed to fetch teams');
  }

  return response.json();
}