/**
 * API client for Soccer Predictor backend
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const API_V1 = `${API_BASE}/api/v1`;

interface FetchOptions extends RequestInit {
  timeout?: number;
}

async function fetchWithTimeout(url: string, options: FetchOptions = {}): Promise<Response> {
  const { timeout = 30000, ...fetchOptions } = options;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function apiRequest<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const url = endpoint.startsWith('http') ? endpoint : `${API_V1}${endpoint}`;
  
  const response = await fetchWithTimeout(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `API error: ${response.status}`);
  }
  
  return response.json();
}

// Authenticated request helper
async function authRequest<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
  
  return apiRequest<T>(endpoint, {
    ...options,
    headers: {
      ...options.headers,
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
  });
}

// ==================== MATCHES API ====================

export interface Match {
  id: number;
  status: {
    started?: boolean;
    finished?: boolean;
    liveTime?: { short?: string };
  };
  home: { name: string; shortName?: string; id: number };
  away: { name: string; shortName?: string; id: number };
  result?: { home: number; away: number };
  time?: string;
}

export interface MatchesResponse {
  leagues: Array<{
    id: number;
    name: string;
    ccode?: string;
    matches: Match[];
  }>;
}

export const matchesApi = {
  getToday: () => fetch('/api/todays_matches').then(r => r.json()),
  getByDate: (date: string) => apiRequest<MatchesResponse>(`/matches/date/${date}`),
  getLive: () => fetch('/api/live_scores').then(r => r.json()).then(data => ({ count: data.length || 0, matches: data || [] })),
  getUpcoming: (days = 7) => apiRequest<any>(`/matches/upcoming?days=${days}`),
  getDetails: (matchId: number) => apiRequest<any>(`/matches/${matchId}`),
  getEvents: (matchId: number) => apiRequest<any>(`/matches/${matchId}/events`),
  getLineups: (matchId: number) => apiRequest<any>(`/matches/${matchId}/lineups`),
  getStats: (matchId: number) => apiRequest<any>(`/matches/${matchId}/stats`),
  getH2H: (matchId: number) => apiRequest<any>(`/matches/${matchId}/h2h`),
};

// ==================== PREDICTIONS API ====================

export interface Prediction {
  match_id: number;
  home_team: string;
  away_team: string;
  league: string;
  kickoff_time: string;
  outcome: {
    home_win: number;
    draw: number;
    away_win: number;
    confidence: number;
  };
  goals: {
    home_expected_goals: number;
    away_expected_goals: number;
    total_expected_goals: number;
    over_1_5: number;
    over_2_5: number;
    over_3_5: number;
    btts_yes: number;
  };
  most_likely_score: {
    score: string;
    probability: number;
  };
  alternative_scores: Array<{ score: string; probability: number }>;
  factors: {
    home_elo: number;
    away_elo: number;
    elo_difference: number;
    home_form_score: number;
    away_form_score: number;
  };
  confidence: {
    data_quality: number;
    model_certainty: number;
    overall: number;
  };
  model_version: string;
}

export const predictionsApi = {
  getForMatch: (matchId: number) => apiRequest<Prediction>(`/predictions/match/${matchId}`),
  getToday: () => apiRequest<{ predictions: Prediction[] }>('/predictions/today'),
  getBatch: (matchIds: number[]) => 
    apiRequest<{ predictions: Prediction[]; errors: any[] }>('/predictions/batch', {
      method: 'POST',
      body: JSON.stringify({ match_ids: matchIds }),
    }),
  getQuick: (homeTeam: string, awayTeam: string) => 
    apiRequest<any>(`/predictions/quick/${encodeURIComponent(homeTeam)}/${encodeURIComponent(awayTeam)}`),
};

// ==================== TEAMS API ====================

export interface Team {
  id: number;
  name: string;
  shortName?: string;
}

export const teamsApi = {
  search: (query: string) => apiRequest<{ results: Team[] }>(`/teams/search?q=${encodeURIComponent(query)}`),
  get: (teamId: number) => apiRequest<any>(`/teams/${teamId}`),
  getFixtures: (teamId: number) => apiRequest<any>(`/teams/${teamId}/fixtures`),
  getSquad: (teamId: number) => apiRequest<any>(`/teams/${teamId}/squad`),
  getForm: (teamId: number, matches = 5) => 
    apiRequest<{ form: string[]; points: number }>(`/teams/${teamId}/form?matches=${matches}`),
  getInjuries: (teamId: number) => apiRequest<{ injuries: any[] }>(`/teams/${teamId}/injuries`),
  getRatings: (teamName: string) => apiRequest<any>(`/teams/ratings/${encodeURIComponent(teamName)}`),
  getRankings: (top = 50) => apiRequest<{ rankings: any[] }>(`/teams/ratings/rankings?top=${top}`),
};

// ==================== LEAGUES API ====================

export interface League {
  id: number;
  name: string;
  key: string;
}

export interface LeagueSimulationResult {
  league_id: number;
  league_name: string;
  n_simulations: number;
  remaining_matches: number;
  most_likely_champion: string;
  champion_probability: number;
  likely_top_4: string[];
  relegation_candidates: string[];
  standings: Array<{
    team_name: string;
    team_id: number | null;
    current_position: number;
    current_points: number;
    avg_final_position: number;
    avg_final_points: number;
    title_probability: number;
    top_4_probability: number;
    europa_probability: number;
    relegation_probability: number;
  }>;
}

export const leaguesApi = {
  list: () => apiRequest<{ leagues: League[] }>('/leagues/'),
  get: (leagueId: number) => apiRequest<any>(`/leagues/${leagueId}`),
  getByName: (name: string) => apiRequest<any>(`/leagues/by-name/${encodeURIComponent(name)}`),
  getStandings: (leagueId: number) => apiRequest<any>(`/leagues/${leagueId}/standings`),
  getMatches: (leagueId: number) => apiRequest<any>(`/leagues/${leagueId}/matches`),
  getTopScorers: (leagueId: number) => apiRequest<any>(`/leagues/${leagueId}/top-scorers`),
  // New endpoints
  getNews: (leagueId: number, limit = 10) => 
    apiRequest<{ news: any[]; source: string }>(`/leagues/${leagueId}/news?limit=${limit}`),
  getEspnStandings: (leagueId: number) => 
    apiRequest<any>(`/leagues/${leagueId}/espn-standings`),
  getSimulation: (leagueId: number, nSimulations = 1000) => 
    apiRequest<LeagueSimulationResult>(`/leagues/${leagueId}/simulation?n_simulations=${nSimulations}`),
  getTitleRace: (leagueId: number) => 
    apiRequest<{ title_probabilities: Record<string, number>; most_likely_champion: string }>(`/leagues/${leagueId}/title-race`),
};

// ==================== AUTH API ====================

export interface UserPrediction {
  id?: string;
  match_id: number;
  predicted_outcome: string;
  predicted_home_score?: number;
  predicted_away_score?: number;
  confidence?: number;
  home_team: string;
  away_team: string;
  league: string;
  match_date: string;
  is_correct?: boolean;
  points_earned?: number;
}

export interface UserStats {
  user_id: string;
  total_predictions: number;
  correct_predictions: number;
  accuracy: number;
  total_points: number;
  current_streak: number;
  best_streak: number;
}

export const authApi = {
  // Predictions
  savePrediction: (prediction: Omit<UserPrediction, 'id'>) =>
    authRequest<UserPrediction>('/auth/predictions', {
      method: 'POST',
      body: JSON.stringify(prediction),
    }),
  getMyPredictions: (limit = 50) =>
    authRequest<{ predictions: UserPrediction[] }>(`/auth/predictions?limit=${limit}`),
  getPredictionForMatch: (matchId: number) =>
    authRequest<UserPrediction | null>(`/auth/predictions/${matchId}`),
  
  // Stats
  getMyStats: () => authRequest<UserStats>('/auth/stats'),
  
  // Leaderboard
  getLeaderboard: (limit = 20) =>
    apiRequest<{ leaderboard: any[] }>(`/auth/leaderboard?limit=${limit}`),
};

// ==================== UTILITY FUNCTIONS ====================

export function formatKickoffTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: false 
  });
}

export function formatMatchDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
}

export function getDateString(offset: number = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().split('T')[0].replace(/-/g, '');
}

/**
 * Get ESPN date range string for fetching matches over a period
 * @param daysAhead - Number of days ahead to include (default 14)
 * @returns Object with today and future date in ESPN format (YYYYMMDD-YYYYMMDD)
 */
export function getESPNDateRange(daysAhead: number = 14): { todayStr: string; futureDateStr: string; dateRange: string } {
  const today = new Date()
  const futureDate = new Date()
  futureDate.setDate(futureDate.getDate() + daysAhead)
  
  const todayStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`
  const futureDateStr = `${futureDate.getFullYear()}${String(futureDate.getMonth() + 1).padStart(2, '0')}${String(futureDate.getDate()).padStart(2, '0')}`
  
  return { 
    todayStr, 
    futureDateStr, 
    dateRange: `${todayStr}-${futureDateStr}` 
  }
}
