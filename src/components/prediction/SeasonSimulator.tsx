'use client';

import React, { useState } from 'react';
import { LeagueSimulationResult } from '@/lib/api';
import { leagueFlagUrls } from '@/data/leagues';

// League options for simulation with flag codes
const SIMULATION_LEAGUES = [
  { id: 47, name: 'Premier League', flagCode: 'ENG' },
  { id: 87, name: 'La Liga', flagCode: 'ES' },
  { id: 55, name: 'Serie A', flagCode: 'IT' },
  { id: 54, name: 'Bundesliga', flagCode: 'DE' },
  { id: 53, name: 'Ligue 1', flagCode: 'FR' },
  { id: 57, name: 'Eredivisie', flagCode: 'NL' },
  { id: 61, name: 'Primeira Liga', flagCode: 'PT' },
  { id: 130, name: 'MLS', flagCode: 'US' },
];

export default function SeasonSimulator() {
  const [selectedLeague, setSelectedLeague] = useState<typeof SIMULATION_LEAGUES[0] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LeagueSimulationResult | null>(null);
  const [nSimulations, setNSimulations] = useState(10000);
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);
  const [whatIfFixtureKey, setWhatIfFixtureKey] = useState('');
  const [whatIfOutcome, setWhatIfOutcome] = useState<'home' | 'draw' | 'away'>('home');

  const runSimulation = async () => {
    if (!selectedLeague) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      // Use local API route instead of external backend
      const params = new URLSearchParams({ n_simulations: String(nSimulations) });
      if (whatIfFixtureKey) {
        params.set('what_if_fixture', whatIfFixtureKey);
        params.set('what_if_outcome', whatIfOutcome);
      }
      const response = await fetch(`/api/simulation/${selectedLeague.id}?${params.toString()}`);
      if (!response.ok) {
        throw new Error('Failed to run simulation');
      }
      const data = await response.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run simulation');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* League Selection */}
      <div className="bg-[var(--card-bg)] backdrop-blur-xl rounded-3xl border border-[var(--border-color)] p-6">
        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
          <span>🏆</span>
          Select League
        </h3>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          {SIMULATION_LEAGUES.map((league) => (
            <button
              key={league.id}
              onClick={() => {
                setSelectedLeague(league);
                setResult(null);
                setWhatIfFixtureKey('');
              }}
              className={`p-4 rounded-xl border transition-all text-center ${
                selectedLeague?.id === league.id
                  ? 'bg-indigo-600/20 border-indigo-500/50'
                  : 'bg-[var(--background-secondary)] border-[var(--border-color)] hover:border-indigo-500/30'
              }`}
            >
              {leagueFlagUrls[league.flagCode] ? (
                <img 
                  src={leagueFlagUrls[league.flagCode]} 
                  alt={league.name}
                  className="w-8 h-auto mx-auto mb-2"
                />
              ) : (
                <span className="text-2xl block mb-2">🏆</span>
              )}
              <span className="text-sm font-medium text-[var(--text-primary)]">{league.name}</span>
            </button>
          ))}
        </div>

        {/* Simulation Options */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm text-[var(--text-secondary)] mb-2">
              Number of Simulations
            </label>
            <select
              value={nSimulations}
              onChange={(e) => setNSimulations(Number(e.target.value))}
              className="w-full px-4 py-2 rounded-lg bg-[var(--background-secondary)] border border-[var(--border-color)] text-[var(--text-primary)]"
            >
              <option value={1000}>1,000 (Fast)</option>
              <option value={5000}>5,000 (Balanced)</option>
              <option value={10000}>10,000 (Accurate)</option>
              <option value={25000}>25,000 (High Precision)</option>
            </select>
          </div>

          <button
            onClick={runSimulation}
            disabled={loading || !selectedLeague}
            className="px-6 py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed transition-all duration-300 shadow-lg shadow-indigo-500/25 flex items-center gap-2"
          >
            {loading ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Simulating...</span>
              </>
            ) : (
              <>
                <span>🎲</span>
                <span>Run Simulation</span>
              </>
            )}
          </button>
        </div>

        <p className="text-xs text-[var(--text-tertiary)] mt-3">
          Monte Carlo simulation using Bradley-Terry model with team strength derived from current performance
        </p>
      </div>

      {selectedLeague && result?.upcoming_fixtures && result.upcoming_fixtures.length > 0 && (
        <div className="bg-[var(--card-bg)] backdrop-blur-xl rounded-3xl border border-[var(--border-color)] p-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">Fixture What-If Lab</p>
              <h3 className="mt-1 text-lg font-semibold text-[var(--text-primary)]">Lock one remaining result and rerun the table</h3>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                Select a provider-backed upcoming fixture, force the outcome, and compare how title, top-four, and relegation probabilities move.
              </p>
            </div>
            {result.what_if && (
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${result.what_if.applied ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
                {result.what_if.applied ? 'What-if applied' : 'What-if not applied'}
              </span>
            )}
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_220px_auto]">
            <select
              value={whatIfFixtureKey}
              onChange={(event) => setWhatIfFixtureKey(event.target.value)}
              className="rounded-xl border border-[var(--border-color)] bg-[var(--background-secondary)] px-4 py-3 text-sm text-[var(--text-primary)]"
            >
              <option value="">Baseline, no locked fixture</option>
              {result.upcoming_fixtures.map((fixture) => (
                <option key={fixture.key} value={fixture.key}>
                  {fixture.home_team} vs {fixture.away_team}{fixture.date ? ` · ${new Date(fixture.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
                </option>
              ))}
            </select>
            <select
              value={whatIfOutcome}
              onChange={(event) => setWhatIfOutcome(event.target.value as 'home' | 'draw' | 'away')}
              disabled={!whatIfFixtureKey}
              className="rounded-xl border border-[var(--border-color)] bg-[var(--background-secondary)] px-4 py-3 text-sm text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="home">Home win</option>
              <option value="draw">Draw</option>
              <option value="away">Away win</option>
            </select>
            <button
              onClick={runSimulation}
              disabled={loading || !selectedLeague}
              className="rounded-xl border border-indigo-500/40 bg-indigo-500/10 px-5 py-3 text-sm font-bold text-indigo-300 transition-colors hover:bg-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Rerun What-If
            </button>
          </div>
          <p className="mt-3 text-xs text-[var(--text-tertiary)]">
            Fixture source: {result.fixture_source || 'Current standings fallback'}
          </p>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
          <p className="text-red-400">❌ {error}</p>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-6 animate-fade-in">
          {/* Summary Card */}
          <div className="bg-[var(--card-bg)] backdrop-blur-xl rounded-3xl border border-[var(--border-color)] overflow-hidden">
            <div className="p-6 bg-gradient-to-r from-indigo-600/20 to-purple-600/20 border-b border-[var(--border-color)]">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <h3 className="text-2xl font-bold text-[var(--text-primary)]">{result.league_name}</h3>
                  <p className="text-[var(--text-secondary)]">
                    {result.remaining_matches} matches remaining • {result.n_simulations.toLocaleString()} simulations
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-[var(--text-secondary)]">Most Likely Champion</p>
                  <p className="text-xl font-bold text-amber-400">{result.most_likely_champion}</p>
                  <p className="text-sm text-amber-400/80">{(result.champion_probability * 100).toFixed(1)}% probability</p>
                </div>
              </div>
            </div>

            {/* Key Insights */}
            <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-xl bg-[var(--background-secondary)]">
                <p className="text-sm text-[var(--text-secondary)] mb-2">🥇 Title Contenders</p>
                <div className="space-y-1">
                  {result.standings
                    .filter(t => t.title_probability > 0.01)
                    .sort((a, b) => b.title_probability - a.title_probability)
                    .slice(0, 4)
                    .map((team, idx) => (
                      <div key={team.team_name} className="flex justify-between text-sm">
                        <span className="text-[var(--text-primary)]">{team.team_name}</span>
                        <span className="text-amber-400">{(team.title_probability * 100).toFixed(1)}%</span>
                      </div>
                    ))}
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[var(--background-secondary)]">
                <p className="text-sm text-[var(--text-secondary)] mb-2">🏆 Top 4 Favorites</p>
                <div className="space-y-1">
                  {result.likely_top_4?.slice(0, 4).map((team, idx) => (
                    <div key={team} className="flex items-center gap-2 text-sm">
                      <span className="w-5 text-center text-emerald-400">{idx + 1}</span>
                      <span className="text-[var(--text-primary)]">{team}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[var(--background-secondary)]">
                <p className="text-sm text-[var(--text-secondary)] mb-2">⚠️ Relegation Danger</p>
                <div className="space-y-1">
                  {result.relegation_candidates?.slice(0, 3).map((team, idx) => (
                    <div key={team} className="flex items-center gap-2 text-sm">
                      <span className="w-5 text-center text-red-400">↓</span>
                      <span className="text-[var(--text-primary)]">{team}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Full Standings Table */}
          <div className="bg-[var(--card-bg)] backdrop-blur-xl rounded-3xl border border-[var(--border-color)] overflow-hidden">
            <div className="p-4 border-b border-[var(--border-color)] flex items-center justify-between">
              <h3 className="font-semibold text-[var(--text-primary)]">Predicted Final Standings</h3>
              <span className="text-sm text-[var(--text-secondary)]">
                📊 {result.remaining_matches} games remaining
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-xs text-[var(--text-tertiary)] border-b border-[var(--border-color)]">
                    <th className="text-left py-3 px-4">Pos</th>
                    <th className="text-left py-3 px-4">Team</th>
                    <th className="text-center py-3 px-4">Pts</th>
                    <th className="text-center py-3 px-4">Pred Pts</th>
                    <th className="text-center py-3 px-4">Avg Pos</th>
                    <th className="text-center py-3 px-4">Title %</th>
                    <th className="text-center py-3 px-4">Top 4 %</th>
                    <th className="text-center py-3 px-4">Releg %</th>
                  </tr>
                </thead>
                <tbody>
                  {result.standings
                    .sort((a, b) => a.avg_final_position - b.avg_final_position)
                    .map((team, idx) => (
                      <React.Fragment key={team.team_name}>
                      <tr
                        onClick={() => setExpandedTeam(expandedTeam === team.team_name ? null : team.team_name)}
                        className={`border-b border-[var(--border-color)] hover:bg-[var(--background-secondary)] transition-colors cursor-pointer ${
                          idx < 4 ? 'border-l-2 border-l-emerald-500' : 
                          idx >= result.standings.length - 3 ? 'border-l-2 border-l-red-500' : ''
                        }`}
                      >
                        <td className="py-3 px-4 text-[var(--text-secondary)]">{idx + 1}</td>
                        <td className="py-3 px-4 text-[var(--text-primary)] font-medium">
                          {team.team_name}
                          <span className="text-xs text-[var(--text-tertiary)] ml-1">▾</span>
                        </td>
                        <td className="py-3 px-4 text-center text-[var(--text-secondary)]">{team.current_points}</td>
                        <td className="py-3 px-4 text-center text-[var(--text-primary)] font-semibold">
                          {team.avg_final_points.toFixed(0)}
                        </td>
                        <td className="py-3 px-4 text-center text-[var(--text-secondary)]">
                          {team.avg_final_position.toFixed(1)}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {team.title_probability > 0.01 ? (
                            <span className="text-amber-400">{(team.title_probability * 100).toFixed(1)}%</span>
                          ) : (
                            <span className="text-[var(--text-tertiary)]">-</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {team.top_4_probability > 0.01 ? (
                            <span className="text-emerald-400">{(team.top_4_probability * 100).toFixed(0)}%</span>
                          ) : (
                            <span className="text-[var(--text-tertiary)]">-</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {team.relegation_probability > 0.01 ? (
                            <span className="text-red-400">{(team.relegation_probability * 100).toFixed(0)}%</span>
                          ) : (
                            <span className="text-[var(--text-tertiary)]">-</span>
                          )}
                        </td>
                      </tr>
                      {expandedTeam === team.team_name && team.position_distribution && (
                        <tr className="bg-[var(--background-secondary)]">
                          <td colSpan={8} className="px-4 py-3">
                            <div className="text-xs text-[var(--text-secondary)] mb-2 font-medium">
                              Position probability distribution
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {Object.entries(team.position_distribution)
                                .sort(([a], [b]) => Number(a) - Number(b))
                                .map(([pos, prob]) => {
                                  const pct = (prob as number) * 100;
                                  const bg = Number(pos) <= 4 ? 'bg-emerald-500' :
                                             Number(pos) > result.standings.length - 3 ? 'bg-red-500' :
                                             'bg-indigo-500';
                                  return (
                                    <div key={pos} className="text-center min-w-[36px]">
                                      <div
                                        className={`${bg} rounded-t`}
                                        style={{ height: `${Math.max(4, pct * 1.5)}px`, opacity: Math.max(0.3, pct / 50) }}
                                      />
                                      <div className="text-[10px] text-[var(--text-tertiary)] mt-0.5">{pos}</div>
                                      <div className="text-[10px] text-[var(--text-secondary)]">{pct.toFixed(1)}%</div>
                                    </div>
                                  );
                                })}
                            </div>
                          </td>
                        </tr>
                      )}
                      </React.Fragment>
                    ))}
                </tbody>
              </table>
            </div>

            {/* Legend */}
            <div className="p-4 flex gap-6 text-xs text-[var(--text-tertiary)] border-t border-[var(--border-color)]">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-emerald-500 rounded" />
                <span>Champions League</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-red-500 rounded" />
                <span>Relegation Zone</span>
              </div>
            </div>
          </div>

          {/* Disclaimer */}
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <p className="text-sm text-amber-800 dark:text-amber-200/80 text-center">
              <span className="font-semibold">⚠️ Note:</span> Predictions are based on Monte Carlo simulations using current standings and team ratings. 
              Actual results may vary significantly due to injuries, transfers, and unpredictable events.
            </p>
          </div>
        </div>
      )}

      {/* Initial State - No selection */}
      {!result && !loading && !error && (
        <div className="bg-[var(--card-bg)] backdrop-blur-xl rounded-3xl border border-[var(--border-color)] p-8 text-center">
          <span className="text-6xl mb-4 block">🔮</span>
          <h3 className="text-xl font-semibold text-[var(--text-primary)] mb-2">Season Simulation</h3>
          <p className="text-[var(--text-secondary)] max-w-md mx-auto">
            Select a league and run the Monte Carlo simulation to predict final standings, 
            title probabilities, and relegation risks based on remaining fixtures.
          </p>
        </div>
      )}
    </div>
  );
}
