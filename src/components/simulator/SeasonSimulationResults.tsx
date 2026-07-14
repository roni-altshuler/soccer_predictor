'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, Skull } from 'lucide-react'

import SeasonProjections from '@/components/league/SeasonProjections'
import { Stagger, StaggerItem } from '@/components/motion'
import { SectionHeader, TeamBadge } from '@/components/primitives'
import {
  ChartContainer,
  NarrativeCard,
  ProgressionChart,
  type NarrativeInsight,
  type ProgressionSeries,
} from '@/components/viz'
import type { LeagueSimulationResult, UniverseOutcome } from '@/lib/api'
import { cn } from '@/lib/utils'

import UniverseBrowser from './UniverseBrowser'
import WhatIfLab, { type FixtureOverrideSelection } from './WhatIfLab'
import PositionDistributionMatrix from './PositionDistributionMatrix'
import PredictedStandingsTable from './PredictedStandingsTable'
import SimulatorHero from './SimulatorHero'
import { ordinal, type TeamMeta } from './shared'

/**
 * SeasonSimulationResults — the single rendering of a league season
 * simulation payload: champion hero, season outlook zones, the
 * finishing-position matrix, projected table, title-race lanes and table,
 * what-if lab, and derived insights.
 *
 * Both simulation surfaces compose this: the standalone /simulator page
 * (league picker + run controls live there) and the league pages' Simulator
 * tab (league is fixed, controls live in the tab header). Keep all result
 * presentation here so the two never drift apart again.
 *
 * Callers own fetching/error/loading states; mount this only when a result
 * exists. Key it by league id so per-league view state (e.g. the collapsed
 * title-race table) resets when the league changes.
 */

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
export function SeasonSimulationSkeleton() {
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

interface SeasonSimulationResultsProps {
  result: LeagueSimulationResult
  /** Last no-override run — the delta baseline for the what-if lab. */
  baseline: LeagueSimulationResult | null
  override: FixtureOverrideSelection | null
  onOverrideChange: (override: FixtureOverrideSelection | null) => void
  /** True while a rerun is in flight — dims the stale results in place. */
  loading: boolean
  /** Crest ids + brand colours keyed by team name (empty map is fine). */
  teamMeta: Record<string, TeamMeta>
  /**
   * Universe Browser search: rerun the sim with find_team/find_outcome.
   * The browser section renders only when the payload carries sampled
   * universes AND a caller wired this callback.
   */
  onFindUniverse?: (team: string, outcome: UniverseOutcome) => void
}

export default function SeasonSimulationResults({
  result,
  baseline,
  override,
  onOverrideChange,
  loading,
  teamMeta,
  onFindUniverse,
}: SeasonSimulationResultsProps) {
  const [titleRaceOpen, setTitleRaceOpen] = useState(false)

  // "Who can still win" math derived from current result.
  const titleRace = useMemo<TitleRaceRow[]>(() => buildTitleRace(result), [result])
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

  const championMeta = teamMeta[result.most_likely_champion]
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
              onOverrideChange={onOverrideChange}
              applied={Boolean(result.what_if?.applied)}
              loading={loading}
              baseline={baseline}
              current={result}
              teamMeta={teamMeta}
            />
          </StaggerItem>
        )}

        {onFindUniverse &&
          ((result.sampled_universes && result.sampled_universes.length > 0) ||
            result.condition_matches !== undefined) && (
            <StaggerItem>
              <UniverseBrowser
                result={result}
                teamMeta={teamMeta}
                loading={loading}
                onFindUniverse={onFindUniverse}
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
  )
}
