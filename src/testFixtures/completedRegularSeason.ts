/** Synthetic but internally consistent fixture, never served as provider data. */
export const completedArtifact = () => ({
  available: true,
  generated_at: '2026-11-08T10:00:00Z',
  leagues: [{
    competition_id: 'usa.1', name: 'Major League Soccer', country: 'United States', season: 2026,
    state: 'regular_season_completed', fixtures_remaining: 0, teams: 30, table: [],
    schedule_completeness: null, relegation_places: 0,
    groups: [
      { name: 'Eastern Conference', short: 'Eastern', teams: 15, qualify: 9 },
      { name: 'Western Conference', short: 'Western', teams: 15, qualify: 9 },
    ],
    observed_table: Array.from({ length: 30 }, (_, index) => ({
      team: `${index < 15 ? 'East' : 'West'} Club ${String(index % 15 + 1).padStart(2, '0')}`,
      team_id: String(index + 100), group: index < 15 ? 'Eastern Conference' : 'Western Conference',
      position: index % 15 + 1, played: 34, wins: 10, draws: 14, losses: 10,
      points: 44, gf: 34, ga: 34, gd: 0, qualified: index % 15 < 9,
    })).reverse(),
    observation: {
      source: 'espn', scope: 'regular-season', season_type: 1,
      observed_at: '2026-11-08T09:00:00Z', results_through: '2026-11-07',
      proof_checked_at: '2026-11-08T09:30:00Z', latest_result_kickoff_at: '2026-11-08T00:00:00Z',
      matches_reconciled: 510, schedule_fixtures: 510,
      schedule_last_verified_at: '2026-10-24T08:00:00Z',
      endpoint: 'https://site.web.api.espn.com/apis/v2/sports/soccer/usa.1/standings?season=2026',
    },
    measured: { brier: 0.6, n_scored: 100 },
  }],
})
