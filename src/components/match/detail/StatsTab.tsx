'use client'

import { EmptyState } from '@/components/EmptyState'
import { SplitStatBar } from '@/components/match/SplitStatBar'
import { SectionHeader } from '@/components/primitives'
import { ClubColorBar } from '@/components/motion'

import type { ExtendedStat, MatchDetails } from './types'

/** Group render order — mirrors the API's stat registry. */
const GROUP_ORDER = ['Top stats', 'Shots', 'Passes', 'Defence', 'Discipline'] as const

/** Stats where the smaller number is the better one. */
const LOWER_IS_BETTER = new Set(['fouls', 'yellow_cards', 'red_cards', 'big_chances_missed'])

function formatterFor(stat: ExtendedStat): (v: number) => string {
  if (stat.percent) return (v) => `${Math.round(v)}%`
  if (stat.key === 'xg') return (v) => v.toFixed(2)
  return (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1))
}

/** Legacy fixed-tuple stats mapped into the extended shape — only real signal. */
function legacyRows(match: MatchDetails): ExtendedStat[] {
  const s = match.stats
  const totals =
    s.shots[0] + s.shots[1] + s.shotsOnTarget[0] + s.shotsOnTarget[1] + s.corners[0] + s.corners[1] + s.fouls[0] + s.fouls[1]
  if (totals <= 0) return []
  return [
    { key: 'possession', label: 'Possession', home: s.possession[0], away: s.possession[1], group: 'Top stats', percent: true },
    { key: 'shots_on_target', label: 'Shots on target', home: s.shotsOnTarget[0], away: s.shotsOnTarget[1], group: 'Top stats' },
    { key: 'shots', label: 'Total shots', home: s.shots[0], away: s.shots[1], group: 'Top stats' },
    { key: 'corners', label: 'Corners', home: s.corners[0], away: s.corners[1], group: 'Top stats' },
    { key: 'fouls', label: 'Fouls', home: s.fouls[0], away: s.fouls[1], group: 'Top stats' },
  ]
}

function TeamLegendRow({ match }: { match: MatchDetails }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs font-semibold text-[var(--text-primary)]">
      <span className="flex min-w-0 items-center gap-1.5">
        <ClubColorBar color="var(--team-tint-home, var(--accent-primary))" team={match.home_team} size="sm" />
        <span className="truncate">{match.home_team}</span>
      </span>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-right">{match.away_team}</span>
        <ClubColorBar color="var(--team-tint-away, var(--accent-info))" team={match.away_team} size="sm" />
      </span>
    </div>
  )
}

function StatRows({ stats }: { stats: ExtendedStat[] }) {
  return (
    <>
      {stats.map((stat) => (
        <SplitStatBar
          key={stat.key}
          label={stat.label}
          homeValue={stat.home}
          awayValue={stat.away}
          format={formatterFor(stat)}
          lowerIsBetter={LOWER_IS_BETTER.has(stat.key)}
        />
      ))}
    </>
  )
}

/**
 * Compact "Top stats" preview for the Overview tab — up to six SplitStatBars
 * (xG first when available) with a "See all" control into the Stats tab.
 * Renders nothing when the match carries no stats.
 */
export function TopStatsPreview({
  match,
  onSeeAll,
}: {
  match: MatchDetails
  onSeeAll: () => void
}) {
  const extended = match.statsExtended ?? []
  let rows: ExtendedStat[]
  if (extended.length > 0) {
    const preferred = ['xg', 'possession', 'shots', 'shots_on_target', 'big_chances', 'corners']
    const byKey = new Map(extended.map((s) => [s.key, s]))
    rows = preferred.map((k) => byKey.get(k)).filter((s): s is ExtendedStat => Boolean(s))
    for (const stat of extended) {
      if (rows.length >= 6) break
      if (!rows.includes(stat)) rows.push(stat)
    }
    rows = rows.slice(0, 6)
  } else {
    rows = legacyRows(match)
  }

  if (rows.length === 0) return null

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]">
      <div className="flex items-center justify-between border-b border-[var(--border-color)] px-4 py-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Top stats</h3>
        <button
          type="button"
          onClick={onSeeAll}
          className="min-h-[44px] text-sm font-medium text-[var(--accent-primary)] transition-opacity hover:opacity-80"
        >
          See all →
        </button>
      </div>
      <div className="space-y-4 p-4">
        <TeamLegendRow match={match} />
        <StatRows stats={rows} />
      </div>
    </div>
  )
}

/**
 * Stats tab — the API's grouped extended stat list rendered as SplitStatBar
 * sections. Absent stats are simply omitted; when the payload carries no
 * extended list the legacy fixed tuple is shown, and with no signal at all an
 * honest empty state renders instead. The league table lives on the Table tab.
 */
export function StatsTab({ match, isScheduled }: { match: MatchDetails; isScheduled: boolean }) {
  const extended = match.statsExtended ?? []
  const fallback = extended.length === 0 ? legacyRows(match) : []

  if (extended.length === 0 && fallback.length === 0) {
    return (
      <EmptyState
        illustration="searching"
        title={isScheduled ? 'Stats appear at kickoff' : 'No stats for this match'}
        description={
          isScheduled
            ? 'Match statistics will show up here once the game is underway.'
            : 'Detailed statistics were not published for this fixture.'
        }
      />
    )
  }

  const groups =
    extended.length > 0
      ? GROUP_ORDER.map((group) => ({
          group,
          stats: extended.filter((s) => s.group === group),
        })).filter((g) => g.stats.length > 0)
      : [{ group: 'Top stats', stats: fallback }]

  return (
    <div className="space-y-6">
      {groups.map(({ group, stats }, idx) => (
        <section key={group} className="space-y-3">
          <SectionHeader title={group} />
          <div className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]">
            <div className="space-y-4 p-4">
              {idx === 0 && <TeamLegendRow match={match} />}
              <StatRows stats={stats} />
            </div>
          </div>
        </section>
      ))}
    </div>
  )
}
