'use client';

import React, { useMemo, useState } from 'react';
import { AlertTriangle, ArrowDown, Award, Loader2, Trophy, Skull } from 'lucide-react';
import { LeagueSimulationResult } from '@/lib/api';
import { LeagueChip, SectionHeader, StatCard } from '@/components/primitives';
import { BorderBeam } from '@/components/magicui/border-beam';

// League options for simulation. `competitionId` drives the LeagueChip crest
// + accent (matches src/lib/leagueAccents.ts ids).
const SIMULATION_LEAGUES = [
  { id: 47, name: 'Premier League', competitionId: 'eng.1' },
  { id: 87, name: 'La Liga', competitionId: 'esp.1' },
  { id: 55, name: 'Serie A', competitionId: 'ita.1' },
  { id: 54, name: 'Bundesliga', competitionId: 'ger.1' },
  { id: 53, name: 'Ligue 1', competitionId: 'fra.1' },
  { id: 57, name: 'Eredivisie', competitionId: 'ned.1' },
  { id: 61, name: 'Primeira Liga', competitionId: 'por.1' },
  { id: 130, name: 'MLS', competitionId: 'usa.1' },
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
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-5">
        <SectionHeader
          kicker="Setup"
          title="Select league"
          description="Pick a competition, choose the simulation depth, and run the race."
          className="mb-4"
        />

        <div className="mb-6 flex flex-wrap gap-2">
          {SIMULATION_LEAGUES.map((league) => (
            <LeagueChip
              key={league.id}
              leagueId={league.competitionId}
              name={league.name}
              active={selectedLeague?.id === league.id}
              onClick={() => {
                setSelectedLeague(league);
                setResult(null);
                setWhatIfFixtureKey('');
              }}
            />
          ))}
        </div>

        {/* Simulation Options */}
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[200px] flex-1">
            <label
              htmlFor="league-n-simulations"
              className="mb-2 block text-sm text-[var(--text-secondary)]"
            >
              Number of simulations
            </label>
            <select
              id="league-n-simulations"
              value={nSimulations}
              onChange={(e) => setNSimulations(Number(e.target.value))}
              className="tabular min-h-[44px] w-full rounded-xl border border-[var(--border-color)] bg-[var(--background-secondary)] px-4 text-sm text-[var(--text-primary)]"
            >
              <option value={1000}>1,000 (Fast)</option>
              <option value={5000}>5,000 (Balanced)</option>
              <option value={10000}>10,000 (Accurate)</option>
              <option value={25000}>25,000 (High Precision)</option>
            </select>
          </div>

          {/* Primary CTA with progress state */}
          <button
            onClick={runSimulation}
            disabled={loading || !selectedLeague}
            className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-[var(--accent-primary)] px-6 text-sm font-bold text-[var(--accent-on-primary)] shadow-[0_8px_24px_-8px_color-mix(in_srgb,var(--accent-primary)_60%,transparent)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-[var(--muted-bg)] disabled:text-[var(--text-tertiary)] disabled:shadow-none"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
                <span aria-live="polite" className="tabular">
                  Running {nSimulations.toLocaleString()} simulations…
                </span>
              </>
            ) : (
              <span>Run simulation</span>
            )}
          </button>
        </div>

        <p className="mt-3 text-xs text-[var(--text-tertiary)]">
          Monte Carlo simulation using Bradley-Terry model with team strength derived from current performance
        </p>
      </div>

      {selectedLeague && result?.upcoming_fixtures && result.upcoming_fixtures.length > 0 && (
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-5">
          <SectionHeader
            kicker="Fixture what-if lab"
            title="Lock one remaining result and rerun the table"
            description="Select a provider-backed upcoming fixture, force the outcome, and compare how title, top-four, and relegation probabilities move."
            action={
              result.what_if ? (
                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold ${
                    result.what_if.applied
                      ? 'bg-[color-mix(in_srgb,var(--accent-primary)_15%,transparent)] text-[var(--accent-primary)]'
                      : 'bg-[color-mix(in_srgb,var(--accent-warn)_15%,transparent)] text-[var(--accent-warn)]'
                  }`}
                >
                  {result.what_if.applied ? 'What-if applied' : 'What-if not applied'}
                </span>
              ) : undefined
            }
          />

          <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_220px_auto]">
            <select
              value={whatIfFixtureKey}
              onChange={(event) => setWhatIfFixtureKey(event.target.value)}
              aria-label="Fixture to lock"
              className="min-h-[44px] rounded-xl border border-[var(--border-color)] bg-[var(--background-secondary)] px-4 py-2 text-sm text-[var(--text-primary)]"
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
              aria-label="Forced outcome"
              className="min-h-[44px] rounded-xl border border-[var(--border-color)] bg-[var(--background-secondary)] px-4 py-2 text-sm text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="home">Home win</option>
              <option value="draw">Draw</option>
              <option value="away">Away win</option>
            </select>
            <button
              onClick={runSimulation}
              disabled={loading || !selectedLeague}
              className="min-h-[44px] rounded-xl border border-[color-mix(in_srgb,var(--accent-ai)_40%,transparent)] bg-[color-mix(in_srgb,var(--accent-ai)_10%,transparent)] px-5 text-sm font-bold text-[var(--accent-ai)] transition-colors hover:bg-[color-mix(in_srgb,var(--accent-ai)_20%,transparent)] disabled:cursor-not-allowed disabled:opacity-50"
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
        <div className="flex items-center gap-2 rounded-xl border border-[color-mix(in_srgb,var(--accent-loss)_30%,transparent)] bg-[color-mix(in_srgb,var(--accent-loss)_10%,transparent)] p-4 text-[var(--accent-loss)]">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="animate-fade-in space-y-6">
          {/* Summary — headline StatCards + contention lists */}
          <div className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]">
            <div className="hero-band rounded-none border-0 border-b border-[var(--border-color)] p-5">
              <SectionHeader
                kicker={`${result.remaining_matches} matches remaining · ${result.n_simulations.toLocaleString()} simulations`}
                title={result.league_name}
              />
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <StatCard
                  size="sm"
                  accent="ai"
                  label="Most likely champion"
                  value={result.most_likely_champion}
                  sub={`${(result.champion_probability * 100).toFixed(1)}% of simulations`}
                />
                <StatCard
                  size="sm"
                  label="Matches remaining"
                  value={result.remaining_matches}
                  sub="across the league"
                />
                <StatCard
                  size="sm"
                  label="Simulations"
                  value={result.n_simulations.toLocaleString()}
                  sub="Monte Carlo iterations"
                />
              </div>
            </div>

            {/* Key Insights */}
            <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-3">
              <div className="rounded-xl bg-[var(--background-secondary)] p-4">
                <p className="mb-2 flex items-center gap-1.5 text-sm text-[var(--text-secondary)]">
                  <Trophy className="h-3.5 w-3.5 text-[var(--accent-ai)]" aria-hidden="true" />
                  Title Contenders
                </p>
                <div className="space-y-1">
                  {result.standings
                    .filter(t => t.title_probability > 0.01)
                    .sort((a, b) => b.title_probability - a.title_probability)
                    .slice(0, 4)
                    .map((team) => (
                      <div key={team.team_name} className="flex justify-between text-sm">
                        <span className="text-[var(--text-primary)]">{team.team_name}</span>
                        <span className="tabular text-[var(--accent-ai)]">{(team.title_probability * 100).toFixed(1)}%</span>
                      </div>
                    ))}
                </div>
              </div>

              <div className="rounded-xl bg-[var(--background-secondary)] p-4">
                <p className="mb-2 flex items-center gap-1.5 text-sm text-[var(--text-secondary)]">
                  <Award className="h-3.5 w-3.5 text-[var(--accent-primary)]" aria-hidden="true" />
                  Top 4 Favorites
                </p>
                <div className="space-y-1">
                  {result.likely_top_4?.slice(0, 4).map((team, idx) => (
                    <div key={team} className="flex items-center gap-2 text-sm">
                      <span className="tabular w-5 text-center text-[var(--accent-primary)]">{idx + 1}</span>
                      <span className="text-[var(--text-primary)]">{team}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl bg-[var(--background-secondary)] p-4">
                <p className="mb-2 flex items-center gap-1.5 text-sm text-[var(--text-secondary)]">
                  <ArrowDown className="h-3.5 w-3.5 text-[var(--accent-loss)]" aria-hidden="true" />
                  Relegation Danger
                </p>
                <div className="space-y-1">
                  {result.relegation_candidates?.slice(0, 3).map((team) => (
                    <div key={team} className="flex items-center gap-2 text-sm">
                      <ArrowDown className="h-3.5 w-3.5 text-[var(--accent-loss)]" aria-hidden="true" />
                      <span className="text-[var(--text-primary)]">{team}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Title Race — "who can still win" math (independent of simulation) */}
          <div className="relative overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]">
            <BorderBeam size={1} duration={12} borderRadius={12} colorFrom="var(--accent-warn)" colorTo="var(--accent-primary)" />
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--border-color)] p-4 md:p-5">
              <SectionHeader
                kicker="Title race"
                title="Who can still win?"
                description="Mathematical contention vs the current leader · Monte Carlo title probability shown alongside."
              />
              <div className="flex gap-2 text-[11px]">
                <span className="tabular rounded-full bg-[color-mix(in_srgb,var(--accent-primary)_15%,transparent)] px-2.5 py-1 font-semibold text-[var(--accent-primary)]">
                  {alive.length} alive
                </span>
                {eliminated.length > 0 && (
                  <span className="tabular rounded-full bg-[color-mix(in_srgb,var(--accent-loss)_15%,transparent)] px-2.5 py-1 font-semibold text-[var(--accent-loss)]">
                    {eliminated.length} eliminated
                  </span>
                )}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-color)] text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
                    <th className="py-2.5 px-4 text-left">Team</th>
                    <th className="py-2.5 px-3 text-right">Pts</th>
                    <th className="py-2.5 px-3 text-right">Behind</th>
                    <th className="py-2.5 px-3 text-right">Max</th>
                    <th className="hidden py-2.5 px-3 text-right md:table-cell">Min wins to catch</th>
                    <th className="py-2.5 px-4 text-right">Title %</th>
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
                      const isOut = row.mathematically_eliminated;
                      const titlePct = row.title_probability * 100;
                      return (
                        <tr
                          key={row.team_name}
                          className={`border-b border-[var(--border-color)]/60 ${
                            isOut ? 'opacity-55' : 'hover:bg-[var(--background-secondary)]'
                          }`}
                        >
                          <td className="py-2.5 px-4 font-medium text-[var(--text-primary)]">
                            <span className="inline-flex items-center gap-1.5">
                              {row.team_name}
                              {isOut && (
                                <Skull className="h-3 w-3 text-[var(--accent-loss)]" aria-label="Mathematically eliminated" />
                              )}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-[var(--text-secondary)]">
                            {row.current_points}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-[var(--text-secondary)]">
                            {row.points_behind_leader === 0 ? (
                              <span className="font-semibold text-[var(--accent-primary)]">Leader</span>
                            ) : (
                              `−${row.points_behind_leader}`
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right font-semibold tabular-nums text-[var(--text-primary)]">
                            {row.max_possible_points}
                          </td>
                          <td className="hidden py-2.5 px-3 text-right tabular-nums text-[var(--text-tertiary)] md:table-cell">
                            {isOut || row.min_wins_to_catch === Infinity
                              ? '—'
                              : `${row.min_wins_to_catch} / ${row.matches_remaining}`}
                          </td>
                          <td className="py-2.5 px-4 text-right">
                            {/* Probability bar inline */}
                            <div className="inline-flex items-center justify-end gap-2">
                              <span
                                className="hidden h-1 w-16 overflow-hidden rounded-full bg-[var(--border-color)]/50 sm:inline-block"
                                aria-hidden="true"
                              >
                                <span
                                  className="block h-full rounded-full bg-[var(--accent-ai)]"
                                  style={{ width: `${Math.max(2, Math.min(100, titlePct))}%` }}
                                />
                              </span>
                              <span className="w-12 text-right font-semibold tabular-nums text-[var(--accent-ai)]">
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
            <div className="border-t border-[var(--border-color)] p-3 text-[11px] leading-snug text-[var(--text-tertiary)]">
              <span className="font-semibold text-[var(--text-secondary)]">Behind</span> = points behind current leader ·{' '}
              <span className="font-semibold text-[var(--text-secondary)]">Max</span> = current + remaining × 3 ·{' '}
              <span className="font-semibold text-[var(--text-secondary)]">Min wins to catch</span> = wins needed if leader drops 0 more points ·{' '}
              <span className="font-semibold text-[var(--text-secondary)]">Eliminated</span> = even running the table leaves you behind the leader&apos;s current total.
            </div>
          </div>

          {/* Full Standings Table */}
          <div className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]">
            <div className="border-b border-[var(--border-color)] p-4 md:p-5">
              <SectionHeader
                kicker="Projection"
                title="Predicted final standings"
                description={`${result.remaining_matches} games remaining · click a row for its position distribution`}
              />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--border-color)] text-xs text-[var(--text-tertiary)]">
                    <th className="py-3 px-4 text-left">Pos</th>
                    <th className="py-3 px-4 text-left">Team</th>
                    <th className="py-3 px-4 text-center">Pts</th>
                    <th className="py-3 px-4 text-center">Pred Pts</th>
                    <th className="py-3 px-4 text-center">Avg Pos</th>
                    <th className="py-3 px-4 text-center">Title %</th>
                    <th className="py-3 px-4 text-center">Top 4 %</th>
                    <th className="py-3 px-4 text-center">Releg %</th>
                  </tr>
                </thead>
                <tbody>
                  {result.standings
                    .sort((a, b) => a.avg_final_position - b.avg_final_position)
                    .map((team, idx) => (
                      <React.Fragment key={team.team_name}>
                      <tr
                        onClick={() => setExpandedTeam(expandedTeam === team.team_name ? null : team.team_name)}
                        className={`cursor-pointer border-b border-[var(--border-color)] transition-colors hover:bg-[var(--background-secondary)] ${
                          idx < 4 ? 'border-l-2 border-l-[var(--accent-primary)]' :
                          idx >= result.standings.length - 3 ? 'border-l-2 border-l-[var(--accent-loss)]' : ''
                        }`}
                      >
                        <td className="py-3 px-4 tabular-nums text-[var(--text-secondary)]">{idx + 1}</td>
                        <td className="py-3 px-4 font-medium text-[var(--text-primary)]">
                          {team.team_name}
                          <span className="ml-1 text-xs text-[var(--text-tertiary)]">▾</span>
                        </td>
                        <td className="py-3 px-4 text-center tabular-nums text-[var(--text-secondary)]">{team.current_points}</td>
                        <td className="py-3 px-4 text-center font-semibold tabular-nums text-[var(--text-primary)]">
                          {team.avg_final_points.toFixed(0)}
                        </td>
                        <td className="py-3 px-4 text-center tabular-nums text-[var(--text-secondary)]">
                          {team.avg_final_position.toFixed(1)}
                        </td>
                        <td className="py-3 px-4 text-center tabular-nums">
                          {team.title_probability > 0.01 ? (
                            <span className="text-[var(--accent-ai)]">{(team.title_probability * 100).toFixed(1)}%</span>
                          ) : (
                            <span className="text-[var(--text-tertiary)]">-</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center tabular-nums">
                          {team.top_4_probability > 0.01 ? (
                            <span className="text-[var(--accent-primary)]">{(team.top_4_probability * 100).toFixed(0)}%</span>
                          ) : (
                            <span className="text-[var(--text-tertiary)]">-</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center tabular-nums">
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
                            <div className="mb-2 text-xs font-medium text-[var(--text-secondary)]">
                              Position probability distribution
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {Object.entries(team.position_distribution)
                                .sort(([a], [b]) => Number(a) - Number(b))
                                .map(([pos, prob]) => {
                                  const pct = (prob as number) * 100;
                                  const bg = Number(pos) <= 4 ? 'bg-[var(--accent-primary)]' :
                                             Number(pos) > result.standings.length - 3 ? 'bg-[var(--accent-loss)]' :
                                             'bg-[var(--accent-ai)]';
                                  return (
                                    <div key={pos} className="min-w-[36px] text-center">
                                      <div
                                        className={`${bg} rounded-t`}
                                        style={{ height: `${Math.max(4, pct * 1.5)}px`, opacity: Math.max(0.3, pct / 50) }}
                                      />
                                      <div className="mt-0.5 text-[10px] tabular-nums text-[var(--text-tertiary)]">{pos}</div>
                                      <div className="text-[10px] tabular-nums text-[var(--text-secondary)]">{pct.toFixed(1)}%</div>
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
            <div className="flex gap-6 border-t border-[var(--border-color)] p-4 text-xs text-[var(--text-tertiary)]">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded bg-[var(--accent-primary)]" />
                <span>Champions League</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded bg-[var(--accent-loss)]" />
                <span>Relegation Zone</span>
              </div>
            </div>
          </div>

          {/* Disclaimer */}
          <div className="rounded-xl border border-[color-mix(in_srgb,var(--accent-warn)_20%,transparent)] bg-[color-mix(in_srgb,var(--accent-warn)_10%,transparent)] p-4">
            <p className="flex items-center justify-center gap-2 text-center text-sm text-[var(--accent-warn)]">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                <span className="font-semibold">Note:</span> Predictions are based on Monte Carlo simulations using current standings and team ratings.
                Actual results may vary significantly due to injuries, transfers, and unpredictable events.
              </span>
            </p>
          </div>
        </div>
      )}

      {/* Initial State - No selection */}
      {!result && !loading && !error && (
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-8 text-center">
          <Trophy className="mx-auto mb-4 h-12 w-12 text-[var(--accent-warn)]" aria-hidden="true" />
          <h3 className="mb-2 text-xl font-semibold text-[var(--text-primary)]">Championship contention simulator</h3>
          <p className="mx-auto max-w-md text-[var(--text-secondary)]">
            Pick a league and run the Monte Carlo to see who can still mathematically
            win the title, what points are needed to catch the leader, and how the
            top-four / relegation races shake out across thousands of seasons.
          </p>
        </div>
      )}
    </div>
  );
}
