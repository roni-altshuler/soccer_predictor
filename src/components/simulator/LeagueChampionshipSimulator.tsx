'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, RotateCcw, Skull } from 'lucide-react'

import { EmptyState } from '@/components/EmptyState'
import SeasonProjections from '@/components/league/SeasonProjections'
import { Stagger, StaggerItem } from '@/components/motion'
import { LeagueChip, SectionHeader, TeamBadge } from '@/components/primitives'
import {
  ChartContainer,
  NarrativeCard,
  ProgressionChart,
  type NarrativeInsight,
  type ProgressionSeries,
} from '@/components/viz'
import type { LeagueSimulationResult } from '@/lib/api'
import { cn } from '@/lib/utils'

import PositionDistributionMatrix from './PositionDistributionMatrix'
import PredictedStandingsTable from './PredictedStandingsTable'
import SimulatorHero from './SimulatorHero'
import WhatIfLab, { type FixtureOverrideSelection } from './WhatIfLab'
import { fetchLeagueTeamMeta, ordinal, type TeamMeta } from './shared'

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
]

export interface TitleRaceRow {
  team_name: string
  current_points: number
  matches_played: number
  matches_remaining: number
  max_possible_points: number
  points_behind_leader: number
  title_probability: number
  mathematically_eliminated: boolean
  /** Min wins-of-remaining required to even theoretically catch leader's current points. */
  min_wins_to_catch: number
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
  const byCurrent = [...result.standings].sort((a, b) => b.current_points - a.current_points)
  const leader = byCurrent[0]
  if (!leader) return []

  return result.standings.map((team) => {
    const matches_remaining = Math.max(0, result.matches_per_season - team.matches_played)
    const max_possible_points = team.current_points + matches_remaining * 3
    const points_behind_leader = Math.max(0, leader.current_points - team.current_points)
    const mathematically_eliminated = max_possible_points < leader.current_points
    const min_wins_to_catch =
      matches_remaining === 0
        ? Infinity
        : Math.min(matches_remaining, Math.ceil(points_behind_leader / 3))
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
    }
  })
}

/** Skeleton mirroring the result layout — hero, zone columns, matrix, table. */
function ResultSkeleton() {
  const block =
    'rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] motion-safe:animate-pulse'
  return (
    <div aria-hidden className="space-y-5">
      <div className={cn(block, 'h-[96px]')} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className={cn(block, 'h-44')} />
        <div className={cn(block, 'hidden h-44 sm:block')} />
        <div className={cn(block, 'hidden h-44 lg:block')} />
      </div>
      <div className={cn(block, 'h-[420px]')} />
      <div className={cn(block, 'h-80')} />
    </div>
  )
}

export default function LeagueChampionshipSimulator() {
  const [selectedLeague, setSelectedLeague] = useState(SIMULATION_LEAGUES[0])
  const [nSimulations, setNSimulations] = useState(10000)
  const [result, setResult] = useState<LeagueSimulationResult | null>(null)
  const [baseline, setBaseline] = useState<LeagueSimulationResult | null>(null)
  const [override, setOverride] = useState<FixtureOverrideSelection | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [teamMeta, setTeamMeta] = useState<Record<string, TeamMeta>>({})
  const [titleRaceOpen, setTitleRaceOpen] = useState(false)
  const [runToken, setRunToken] = useState(0)

  // Crest ids + brand colours for the selected league (same ESPN feed the
  // simulation route reads, so team names line up exactly).
  useEffect(() => {
    const controller = new AbortController()
    setTeamMeta({})
    fetchLeagueTeamMeta(selectedLeague.competitionId, controller.signal).then(setTeamMeta)
    return () => controller.abort()
  }, [selectedLeague])

  // Auto-run: league select, sim-count change, what-if override, manual re-run.
  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    async function run() {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ n_simulations: String(nSimulations) })
        if (override) {
          params.set('what_if_fixture', override.fixtureKey)
          params.set('what_if_outcome', override.outcome)
        }
        const response = await fetch(
          `/api/simulation/${selectedLeague.id}?${params.toString()}`,
          { signal: controller.signal },
        )
        if (!response.ok) throw new Error('The simulation is unavailable right now')
        const data = (await response.json()) as LeagueSimulationResult
        if (cancelled) return
        if (!Array.isArray(data.standings) || data.standings.length === 0) {
          throw new Error('The simulation returned no standings')
        }
        setResult(data)
        // Runs without an override are the delta baseline for the what-if lab.
        if (!override) setBaseline(data)
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return
        setError(
          err instanceof Error ? err.message : 'The simulation is unavailable right now',
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    run()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [selectedLeague, nSimulations, override, runToken])

  const selectLeague = (league: (typeof SIMULATION_LEAGUES)[number]) => {
    if (league.id === selectedLeague.id) return
    setSelectedLeague(league)
    setResult(null)
    setBaseline(null)
    setOverride(null)
    setTitleRaceOpen(false)
  }

  const changeSimCount = (n: number) => {
    setNSimulations(n)
    // A different run depth is a different baseline — clear any override.
    setBaseline(null)
    setOverride(null)
  }

  // "Who can still win" math derived from current result.
  const titleRace = useMemo<TitleRaceRow[]>(
    () => (result ? buildTitleRace(result) : []),
    [result],
  )
  const alive = titleRace.filter((row) => !row.mathematically_eliminated)
  const eliminated = titleRace.filter((row) => row.mathematically_eliminated)

  // Projection lanes for the top title contenders: each series anchors at the
  // team's real current points (no fabricated history) and runs a dashed lane
  // to the simulation's mean final total. Distinct accent tokens per lane.
  const raceLanes = useMemo<{
    series: ProgressionSeries[]
    now: number
    total: number
  } | null>(() => {
    if (!result) return null
    const total = result.matches_per_season
    const contenders = [...result.standings]
      .sort((a, b) => b.title_probability - a.title_probability)
      .slice(0, 5)
      .filter((t) => t.matches_played > 0 && t.matches_played < total)
    if (contenders.length < 2) return null
    const now = Math.max(...contenders.map((t) => t.matches_played))
    const laneColors = [
      'var(--accent-primary)',
      'var(--accent-ai)',
      'var(--accent-warn)',
      'var(--accent-market)',
      'var(--accent-info)',
    ]
    const series = contenders.map((team, i) => {
      const played = team.matches_played
      const remaining = total - played
      const values: (number | null)[] = Array.from({ length: played }, (_, idx) =>
        idx === played - 1 ? team.current_points : null,
      )
      const projected = Array.from({ length: total - played }, (_, k) =>
        Math.round(
          (team.current_points +
            ((team.avg_final_points - team.current_points) * (k + 1)) / remaining) *
            10,
        ) / 10,
      )
      return {
        key: `t${team.team_id ?? i}`,
        label: team.team_name,
        color: laneColors[i % laneColors.length],
        values,
        projected,
      }
    })
    return { series, now, total }
  }, [result])

  // Honest, payload-derived talking points (max 5; sections that don't apply
  // are simply absent — NarrativeCard hides itself when the list is empty).
  const insights = useMemo<NarrativeInsight[]>(() => {
    if (!result) return []
    const list: NarrativeInsight[] = []
    const standings = result.standings

    const byTitle = [...standings].sort((a, b) => b.title_probability - a.title_probability)
    const [first, second] = byTitle
    if (first && second) {
      if (first.title_probability >= 0.8) {
        list.push({
          tone: 'edge',
          title: 'Title all but settled',
          detail: `${first.team_name} win the league in ${(first.title_probability * 100).toFixed(0)}% of the simulated seasons.`,
        })
      } else if (second.title_probability >= 0.1) {
        const ptsGap = Math.abs(first.current_points - second.current_points)
        list.push({
          tone: 'watch',
          title: 'Tight at the top',
          detail: `${first.team_name} (${(first.title_probability * 100).toFixed(0)}%) and ${second.team_name} (${(second.title_probability * 100).toFixed(0)}%) are ${ptsGap} point${ptsGap === 1 ? '' : 's'} apart today.`,
        })
      }
    }

    let riser: (typeof standings)[number] | null = null
    let riserGain = 1.5
    let faller: (typeof standings)[number] | null = null
    let fallerDrop = 1.5
    for (const team of standings) {
      const gain = team.current_position - team.avg_final_position
      if (gain > riserGain) {
        riser = team
        riserGain = gain
      }
      if (-gain > fallerDrop) {
        faller = team
        fallerDrop = -gain
      }
    }
    if (riser) {
      list.push({
        tone: 'edge',
        title: 'Biggest riser',
        detail: `${riser.team_name} climb from ${ordinal(riser.current_position)} today to a projected ${ordinal(Math.round(riser.avg_final_position))}.`,
      })
    }
    if (faller) {
      list.push({
        tone: 'risk',
        title: 'Biggest slide',
        detail: `${faller.team_name} drop from ${ordinal(faller.current_position)} today to a projected ${ordinal(Math.round(faller.avg_final_position))}.`,
      })
    }

    const dropBattle = standings
      .filter((t) => t.relegation_probability >= 0.15 && t.relegation_probability <= 0.85)
      .sort((a, b) => b.relegation_probability - a.relegation_probability)
    if (dropBattle.length >= 2) {
      const names = dropBattle.slice(0, 4).map((t) => t.team_name)
      list.push({
        tone: 'risk',
        title: 'Relegation battle',
        detail: `${dropBattle.length} teams are genuinely in the drop fight — ${names.join(', ')}${dropBattle.length > 4 ? ' and more' : ''}.`,
      })
    }

    const scramble = standings.filter(
      (t) => t.top_4_probability >= 0.2 && t.top_4_probability <= 0.8,
    )
    if (scramble.length >= 3) {
      list.push({
        tone: 'watch',
        title: 'Top-four scramble',
        detail: `${scramble.length} teams sit between 20% and 80% to make the top four.`,
      })
    }

    return list.slice(0, 5)
  }, [result])

  const championMeta = result ? teamMeta[result.most_likely_champion] : undefined
  const titleRaceSorted = useMemo(
    () =>
      titleRace.slice().sort((a, b) => {
        if (a.mathematically_eliminated !== b.mathematically_eliminated) {
          return a.mathematically_eliminated ? 1 : -1
        }
        return b.title_probability - a.title_probability
      }),
    [titleRace],
  )

  return (
    <div className="space-y-5">
      {/* Setup — league picker + run depth. The simulation runs itself. */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 md:p-5">
        <div className="flex flex-wrap gap-2">
          {SIMULATION_LEAGUES.map((league) => (
            <LeagueChip
              key={league.id}
              leagueId={league.competitionId}
              name={league.name}
              active={selectedLeague.id === league.id}
              onClick={() => selectLeague(league)}
            />
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label
            htmlFor="league-n-simulations"
            className="text-[12px] text-[var(--text-secondary)]"
          >
            Season runs
          </label>
          <select
            id="league-n-simulations"
            value={nSimulations}
            onChange={(e) => changeSimCount(Number(e.target.value))}
            className="min-h-[44px] rounded-lg border border-[var(--border-color)] bg-[var(--background-secondary)] px-3 text-[13px] tabular-nums text-[var(--text-primary)]"
          >
            <option value={1000}>1,000</option>
            <option value={5000}>5,000</option>
            <option value={10000}>10,000</option>
            <option value={25000}>25,000</option>
          </select>
          <button
            type="button"
            onClick={() => setRunToken((t) => t + 1)}
            disabled={loading}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[var(--border-color)] px-3 text-[13px] font-semibold text-[var(--text-secondary)] transition-colors hover:bg-[var(--card-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCcw
              className={cn('h-3.5 w-3.5', loading && 'motion-safe:animate-spin')}
              aria-hidden="true"
            />
            Re-run
          </button>
          {loading && result && (
            <span className="text-[12px] text-[var(--text-tertiary)]" aria-live="polite">
              Updating…
            </span>
          )}
        </div>
      </div>

      {/* Inline error over stale results; full empty state when nothing to show. */}
      {error && result && (
        <div
          role="alert"
          className="rounded-xl border border-[color-mix(in_srgb,var(--accent-loss)_30%,transparent)] bg-[color-mix(in_srgb,var(--accent-loss)_10%,transparent)] p-3.5 text-[13px] text-[var(--accent-loss)]"
        >
          {error} — showing the last completed run.
        </div>
      )}
      {error && !result && !loading && (
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]">
          <EmptyState
            illustration="data-error"
            title="Simulation unavailable"
            description={`${selectedLeague.name} standings could not be loaded. Nothing is shown rather than made-up numbers.`}
            action={
              <button
                type="button"
                onClick={() => setRunToken((t) => t + 1)}
                className="min-h-[44px] rounded-lg border border-[var(--border-color)] px-4 text-[13px] font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--card-hover)]"
              >
                Try again
              </button>
            }
          />
        </div>
      )}

      {loading && !result && <ResultSkeleton />}

      {result && (
        <div className={cn(loading && 'pointer-events-none opacity-60')} aria-busy={loading}>
          <Stagger key={result.league_id} inView={false} className="space-y-5">
            <StaggerItem>
              <SimulatorHero
                kicker="Most likely champion"
                teamName={result.most_likely_champion}
                probability={result.champion_probability}
                color={championMeta?.color}
                badge={
                  <TeamBadge
                    teamId={championMeta?.id}
                    name={result.most_likely_champion}
                    teamColor={championMeta?.color}
                    size={56}
                  />
                }
                chips={[
                  { label: `${result.remaining_matches} matches left` },
                  { label: `${result.n_simulations.toLocaleString()} season runs` },
                ]}
              />
            </StaggerItem>

            <StaggerItem>
              <SeasonProjections
                teams={result.standings}
                nSimulations={result.n_simulations}
              />
            </StaggerItem>

            <StaggerItem>
              <div className="space-y-2">
                <SectionHeader
                  kicker="Signature view"
                  title="Where every team finishes"
                  description="Each row is a team, each column a final position — darker means it happens more often."
                />
                <PositionDistributionMatrix
                  standings={result.standings}
                  teamMeta={teamMeta}
                />
              </div>
            </StaggerItem>

            <StaggerItem>
              <PredictedStandingsTable
                standings={result.standings}
                teamMeta={teamMeta}
                remainingMatches={result.remaining_matches}
              />
            </StaggerItem>

            {raceLanes && (
              <StaggerItem>
                <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 md:p-5">
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                    <SectionHeader
                      kicker="Projection"
                      title="Race to the finish"
                      description="Dashed lanes run from each contender's real points today to their mean simulated final total."
                    />
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {raceLanes.series.map((s) => (
                        <span
                          key={s.key}
                          className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-secondary)]"
                        >
                          <span
                            aria-hidden="true"
                            className="inline-block h-2 w-2 rounded-full"
                            style={{ backgroundColor: s.color }}
                          />
                          {s.label}
                        </span>
                      ))}
                    </div>
                  </div>
                  <ChartContainer height={300} lazy label="Title race projection chart">
                    <ProgressionChart
                      series={raceLanes.series}
                      now={raceLanes.now}
                      totalSteps={raceLanes.total}
                      height={300}
                    />
                  </ChartContainer>
                </div>
              </StaggerItem>
            )}

            {titleRace.length > 0 && (
              <StaggerItem>
                <div className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]">
                  <button
                    type="button"
                    aria-expanded={titleRaceOpen}
                    onClick={() => setTitleRaceOpen((open) => !open)}
                    className="flex min-h-[52px] w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--card-hover)]"
                  >
                    <span className="min-w-0">
                      <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                        Title race
                      </span>
                      <span className="block text-[15px] font-bold text-[var(--text-primary)]">
                        Who can still win?
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-[11px]">
                      <span className="rounded-full bg-[color-mix(in_srgb,var(--accent-primary)_15%,transparent)] px-2.5 py-1 font-semibold tabular-nums text-[var(--accent-primary)]">
                        {alive.length} alive
                      </span>
                      {eliminated.length > 0 && (
                        <span className="rounded-full bg-[color-mix(in_srgb,var(--accent-loss)_15%,transparent)] px-2.5 py-1 font-semibold tabular-nums text-[var(--accent-loss)]">
                          {eliminated.length} out
                        </span>
                      )}
                      <ChevronDown
                        className={cn(
                          'h-4 w-4 text-[var(--text-tertiary)] transition-transform',
                          titleRaceOpen && 'rotate-180',
                        )}
                        aria-hidden="true"
                      />
                    </span>
                  </button>
                  {titleRaceOpen && (
                    <>
                      <div className="overflow-x-auto border-t border-[var(--border-color)]">
                        <table className="w-full text-[13px]">
                          <thead>
                            <tr className="border-b border-[var(--border-color)] text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
                              <th className="px-4 py-2 text-left font-semibold">Team</th>
                              <th className="px-3 py-2 text-right font-semibold">Pts</th>
                              <th className="px-3 py-2 text-right font-semibold">Behind</th>
                              <th className="px-3 py-2 text-right font-semibold">Max</th>
                              <th className="hidden px-3 py-2 text-right font-semibold md:table-cell">
                                Min wins to catch
                              </th>
                              <th className="px-4 py-2 text-right font-semibold">Title</th>
                            </tr>
                          </thead>
                          <tbody>
                            {titleRaceSorted.map((row) => {
                              const isOut = row.mathematically_eliminated
                              const titlePct = row.title_probability * 100
                              return (
                                <tr
                                  key={row.team_name}
                                  className={cn(
                                    'border-b border-[var(--border-color)]/60 last:border-b-0',
                                    isOut ? 'opacity-55' : 'hover:bg-[var(--card-hover)]',
                                  )}
                                >
                                  <td className="px-4 py-2 font-medium text-[var(--text-primary)]">
                                    <span className="inline-flex items-center gap-1.5">
                                      {row.team_name}
                                      {isOut && (
                                        <Skull
                                          className="h-3 w-3 text-[var(--accent-loss)]"
                                          aria-label="Mathematically eliminated"
                                        />
                                      )}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-right tabular-nums text-[var(--text-secondary)]">
                                    {row.current_points}
                                  </td>
                                  <td className="px-3 py-2 text-right tabular-nums text-[var(--text-secondary)]">
                                    {row.points_behind_leader === 0 ? (
                                      <span className="font-semibold text-[var(--accent-primary)]">
                                        Leader
                                      </span>
                                    ) : (
                                      `−${row.points_behind_leader}`
                                    )}
                                  </td>
                                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-[var(--text-primary)]">
                                    {row.max_possible_points}
                                  </td>
                                  <td className="hidden px-3 py-2 text-right tabular-nums text-[var(--text-tertiary)] md:table-cell">
                                    {isOut || row.min_wins_to_catch === Infinity
                                      ? '—'
                                      : `${row.min_wins_to_catch} / ${row.matches_remaining}`}
                                  </td>
                                  <td className="px-4 py-2 text-right font-semibold tabular-nums text-[var(--accent-ai)]">
                                    {titlePct >= 0.05 ? `${titlePct.toFixed(1)}%` : '<0.1%'}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                      <p className="border-t border-[var(--border-color)] px-4 py-2.5 text-[11px] leading-snug text-[var(--text-tertiary)]">
                        Behind = points behind the current leader · Max = current +
                        remaining × 3 · Min wins to catch assumes the leader takes no more
                        points · Out = even winning every match leaves the team short.
                      </p>
                    </>
                  )}
                </div>
              </StaggerItem>
            )}

            {result.upcoming_fixtures && result.upcoming_fixtures.length > 0 && (
              <StaggerItem>
                <WhatIfLab
                  fixtures={result.upcoming_fixtures}
                  override={override}
                  onOverrideChange={setOverride}
                  applied={Boolean(result.what_if?.applied)}
                  loading={loading}
                  baseline={baseline}
                  current={result}
                  teamMeta={teamMeta}
                />
              </StaggerItem>
            )}

            {insights.length > 0 && (
              <StaggerItem>
                <NarrativeCard heading="What stands out" insights={insights} />
              </StaggerItem>
            )}
          </Stagger>
        </div>
      )}
    </div>
  )
}
