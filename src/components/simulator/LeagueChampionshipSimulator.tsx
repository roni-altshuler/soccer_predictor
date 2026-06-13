'use client';

import React, { useMemo, useState } from 'react';
import { Trophy, Skull } from 'lucide-react';
import { LeagueSimulationResult } from '@/lib/api';
import { leagueFlagUrls } from '@/data/leagues';
import { BorderBeam } from '@/components/magicui/border-beam';

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

export interface TitleRaceRow {
  team_name: string;
  current_points: number;
  matches_played: number;
  matches_remaining: number;
  max_possible_points: number;
  points_behind_leader: number;
  title_probability: number;
  mathematically_eliminated: boolean;
  /** Min wins-of-remaining required to even theoretically catch leader's current points. */
  min_wins_to_catch: number;
}

/**
 * Compute "who can still win the title" math from a simulation result.
 *
 * Definitions:
 * - Leader = team currently top of the table by points.
 * - mathematically_eliminated = even winning every remaining match, the team's
 *   max possible final total is below the leader's CURRENT points (i.e. the
 *   leader could lose every remaining match and still finish ahead).
 * - min_wins_to_catch = ⌈(leader.current - team.current) / 3⌉ assuming every
 *   win earns 3 pts and the leader gets no further points. Capped at remaining.
 */
export function buildTitleRace(result: LeagueSimulationResult): TitleRaceRow[] {
  const byCurrent = [...result.standings].sort((a, b) => b.current_points - a.current_points);
  const leader = byCurrent[0];
  if (!leader) return [];

  return result.standings.map((team) => {
    const matches_remaining = Math.max(0, result.matches_per_season - team.matches_played);
    const max_possible_points = team.current_points + matches_remaining * 3;
    const points_behind_leader = Math.max(0, leader.current_points - team.current_points);
    const mathematically_eliminated = max_possible_points < leader.current_points;
    const min_wins_to_catch =
      matches_remaining === 0
        ? Infinity
        : Math.min(matches_remaining, Math.ceil(points_behind_leader / 3));
    return {
      team_name: team.team_name,
      current_points: team.current_points,
      matches_played: team.matches_played,
      matches_remaining,
      max_possible_points,
      points_behind_leader,
      title_probability: team.title_probability,
      mathematically_eliminated,
      min_wins_to_catch,
    };
  });
}

export default function LeagueChampionshipSimulator() {
  const [selectedLeague, setSelectedLeague] = useState<typeof SIMULATION_LEAGUES[0] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LeagueSimulationResult | null>(null);
  const [nSimulations, setNSimulations] = useState(10000);
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);
  const [whatIfFixtureKey, setWhatIfFixtureKey] = useState('');
  const [whatIfOutcome, setWhatIfOutcome] = useState<'home' | 'draw' | 'away'>('home');

  // "Who can still win" math derived from current result. Memoised so the
  // table re-sort doesn't recompute on every render.
  const titleRace = useMemo<TitleRaceRow[]>(
    () => (result ? buildTitleRace(result) : []),
    [result]
  );
  const alive = titleRace.filter((row) => !row.mathematically_eliminated);
  const eliminated = titleRace.filter((row) => row.mathematically_eliminated);

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
                  ? 'bg-[color-mix(in_srgb,var(--accent-info)_20%,transparent)] border-[color-mix(in_srgb,var(--accent-info)_50%,transparent)]'
                  : 'bg-[var(--background-secondary)] border-[var(--border-color)] hover:border-[color-mix(in_srgb,var(--accent-info)_30%,transparent)]'
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
            className="px-6 py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-[var(--accent-info)] to-[var(--accent-market)] hover:from-[var(--accent-info-soft)] hover:to-[var(--accent-market-soft)] disabled:from-[var(--text-tertiary)] disabled:to-[var(--text-tertiary)] disabled:cursor-not-allowed transition-all duration-300 shadow-lg shadow-[color:color-mix(in_srgb,var(--accent-info)_25%,transparent)] flex items-center gap-2"
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
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${result.what_if.applied ? 'bg-[color-mix(in_srgb,var(--accent-primary)_15%,transparent)] text-[var(--accent-primary)]' : 'bg-[color-mix(in_srgb,var(--accent-warn)_15%,transparent)] text-[var(--accent-warn)]'}`}>
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
              className="rounded-xl border border-[color-mix(in_srgb,var(--accent-info)_40%,transparent)] bg-[color-mix(in_srgb,var(--accent-info)_10%,transparent)] px-5 py-3 text-sm font-bold text-[var(--accent-info)] transition-colors hover:bg-[color-mix(in_srgb,var(--accent-info)_20%,transparent)] disabled:cursor-not-allowed disabled:opacity-50"
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
        <div className="bg-[color-mix(in_srgb,var(--accent-loss)_10%,transparent)] border border-[color-mix(in_srgb,var(--accent-loss)_30%,transparent)] rounded-xl p-4">
          <p className="text-[var(--accent-loss)]">❌ {error}</p>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-6 animate-fade-in">
          {/* Summary Card */}
          <div className="bg-[var(--card-bg)] backdrop-blur-xl rounded-3xl border border-[var(--border-color)] overflow-hidden">
            <div className="p-6 bg-gradient-to-r from-[color-mix(in_srgb,var(--accent-info)_20%,transparent)] to-[color-mix(in_srgb,var(--accent-market)_20%,transparent)] border-b border-[var(--border-color)]">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <h3 className="text-2xl font-bold text-[var(--text-primary)]">{result.league_name}</h3>
                  <p className="text-[var(--text-secondary)]">
                    {result.remaining_matches} matches remaining • {result.n_simulations.toLocaleString()} simulations
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-[var(--text-secondary)]">Most Likely Champion</p>
                  <p className="text-xl font-bold text-[var(--accent-warn)]">{result.most_likely_champion}</p>
                  <p className="text-sm text-[color-mix(in_srgb,var(--accent-warn)_80%,transparent)]">{(result.champion_probability * 100).toFixed(1)}% probability</p>
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
                        <span className="text-[var(--accent-warn)]">{(team.title_probability * 100).toFixed(1)}%</span>
                      </div>
                    ))}
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[var(--background-secondary)]">
                <p className="text-sm text-[var(--text-secondary)] mb-2">🏆 Top 4 Favorites</p>
                <div className="space-y-1">
                  {result.likely_top_4?.slice(0, 4).map((team, idx) => (
                    <div key={team} className="flex items-center gap-2 text-sm">
                      <span className="w-5 text-center text-[var(--accent-primary)]">{idx + 1}</span>
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
                      <span className="w-5 text-center text-[var(--accent-loss)]">↓</span>
                      <span className="text-[var(--text-primary)]">{team}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Title Race — "who can still win" math (independent of simulation) */}
          <div className="relative bg-[var(--card-bg)] backdrop-blur-xl rounded-3xl border border-[var(--border-color)] overflow-hidden">
            <BorderBeam size={1} duration={12} borderRadius={24} colorFrom="var(--accent-warn)" colorTo="var(--accent-primary)" />
            <div className="p-4 md:p-5 border-b border-[var(--border-color)] flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-tertiary)] font-semibold">Title Race</p>
                <h3 className="mt-1 text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-[var(--accent-warn)]" aria-hidden="true" />
                  Who can still win?
                </h3>
                <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                  Mathematical contention vs the current leader · Monte Carlo title probability shown alongside.
                </p>
              </div>
              <div className="flex gap-2 text-[11px]">
                <span className="rounded-full bg-[color-mix(in_srgb,var(--accent-primary)_15%,transparent)] text-[var(--accent-primary)] px-2.5 py-1 font-semibold">
                  {alive.length} alive
                </span>
                {eliminated.length > 0 && (
                  <span className="rounded-full bg-[color-mix(in_srgb,var(--accent-loss)_15%,transparent)] text-[var(--accent-loss)] px-2.5 py-1 font-semibold">
                    {eliminated.length} eliminated
                  </span>
                )}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] border-b border-[var(--border-color)]">
                    <th className="text-left py-2.5 px-4">Team</th>
                    <th className="text-right py-2.5 px-3">Pts</th>
                    <th className="text-right py-2.5 px-3">Behind</th>
                    <th className="text-right py-2.5 px-3">Max</th>
                    <th className="text-right py-2.5 px-3 hidden md:table-cell">Min wins to catch</th>
                    <th className="text-right py-2.5 px-4">Title %</th>
                  </tr>
                </thead>
                <tbody>
                  {titleRace
                    .slice()
                    .sort((a, b) => {
                      // Live contenders first, then by title probability desc.
                      if (a.mathematically_eliminated !== b.mathematically_eliminated) {
                        return a.mathematically_eliminated ? 1 : -1;
                      }
                      return b.title_probability - a.title_probability;
                    })
                    .map((row) => {
                      const eliminated = row.mathematically_eliminated;
                      const titlePct = row.title_probability * 100;
                      return (
                        <tr
                          key={row.team_name}
                          className={`border-b border-[var(--border-color)]/60 ${
                            eliminated ? 'opacity-55' : 'hover:bg-[var(--background-secondary)]'
                          }`}
                        >
                          <td className="py-2.5 px-4 font-medium text-[var(--text-primary)]">
                            <span className="inline-flex items-center gap-1.5">
                              {row.team_name}
                              {eliminated && (
                                <Skull className="h-3 w-3 text-[var(--accent-loss)]" aria-label="Mathematically eliminated" />
                              )}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-[var(--text-secondary)]">
                            {row.current_points}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-[var(--text-secondary)]">
                            {row.points_behind_leader === 0 ? (
                              <span className="text-[var(--accent-warn)] font-semibold">Leader</span>
                            ) : (
                              `−${row.points_behind_leader}`
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-[var(--text-primary)] font-semibold">
                            {row.max_possible_points}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-[var(--text-tertiary)] hidden md:table-cell">
                            {eliminated || row.min_wins_to_catch === Infinity
                              ? '—'
                              : `${row.min_wins_to_catch} / ${row.matches_remaining}`}
                          </td>
                          <td className="py-2.5 px-4 text-right">
                            {/* Probability bar inline */}
                            <div className="inline-flex items-center gap-2 justify-end">
                              <span
                                className="hidden sm:inline-block h-1 w-16 overflow-hidden rounded-full bg-[var(--border-color)]/50"
                                aria-hidden="true"
                              >
                                <span
                                  className="block h-full rounded-full bg-[var(--accent-warn)]"
                                  style={{ width: `${Math.max(2, Math.min(100, titlePct))}%` }}
                                />
                              </span>
                              <span className="tabular-nums font-semibold text-[var(--accent-warn)] w-12 text-right">
                                {titlePct >= 0.05 ? `${titlePct.toFixed(1)}%` : '<0.1%'}
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            <div className="p-3 border-t border-[var(--border-color)] text-[11px] text-[var(--text-tertiary)] leading-snug">
              <span className="font-semibold text-[var(--text-secondary)]">Behind</span> = points behind current leader ·{' '}
              <span className="font-semibold text-[var(--text-secondary)]">Max</span> = current + remaining × 3 ·{' '}
              <span className="font-semibold text-[var(--text-secondary)]">Min wins to catch</span> = wins needed if leader drops 0 more points ·{' '}
              <span className="font-semibold text-[var(--text-secondary)]">Eliminated</span> = even running the table leaves you behind the leader&apos;s current total.
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
                          idx < 4 ? 'border-l-2 border-l-[var(--accent-primary)]' :
                          idx >= result.standings.length - 3 ? 'border-l-2 border-l-[var(--accent-loss)]' : ''
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
                            <span className="text-[var(--accent-warn)]">{(team.title_probability * 100).toFixed(1)}%</span>
                          ) : (
                            <span className="text-[var(--text-tertiary)]">-</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {team.top_4_probability > 0.01 ? (
                            <span className="text-[var(--accent-primary)]">{(team.top_4_probability * 100).toFixed(0)}%</span>
                          ) : (
                            <span className="text-[var(--text-tertiary)]">-</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {team.relegation_probability > 0.01 ? (
                            <span className="text-[var(--accent-loss)]">{(team.relegation_probability * 100).toFixed(0)}%</span>
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
                                  const bg = Number(pos) <= 4 ? 'bg-[var(--accent-primary)]' :
                                             Number(pos) > result.standings.length - 3 ? 'bg-[var(--accent-loss)]' :
                                             'bg-[var(--accent-info)]';
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
                <div className="w-3 h-3 bg-[var(--accent-primary)] rounded" />
                <span>Champions League</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-[var(--accent-loss)] rounded" />
                <span>Relegation Zone</span>
              </div>
            </div>
          </div>

          {/* Disclaimer */}
          <div className="p-4 rounded-xl bg-[color-mix(in_srgb,var(--accent-warn)_10%,transparent)] border border-[color-mix(in_srgb,var(--accent-warn)_20%,transparent)]">
            <p className="text-sm text-[var(--accent-warn)] text-center">
              <span className="font-semibold">⚠️ Note:</span> Predictions are based on Monte Carlo simulations using current standings and team ratings. 
              Actual results may vary significantly due to injuries, transfers, and unpredictable events.
            </p>
          </div>
        </div>
      )}

      {/* Initial State - No selection */}
      {!result && !loading && !error && (
        <div className="bg-[var(--card-bg)] backdrop-blur-xl rounded-3xl border border-[var(--border-color)] p-8 text-center">
          <Trophy className="mx-auto mb-4 h-12 w-12 text-[var(--accent-warn)]" aria-hidden="true" />
          <h3 className="text-xl font-semibold text-[var(--text-primary)] mb-2">Championship contention simulator</h3>
          <p className="text-[var(--text-secondary)] max-w-md mx-auto">
            Pick a league and run the Monte Carlo to see who can still mathematically
            win the title, what points are needed to catch the leader, and how the
            top-four / relegation races shake out across thousands of seasons.
          </p>
        </div>
      )}
    </div>
  );
}
