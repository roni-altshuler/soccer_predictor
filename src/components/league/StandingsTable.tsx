'use client'

import Link from 'next/link'

import { TeamFormPill } from '@/components/match/TeamFormPill'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/**
 * Domestic-league standings table. Redesign notes:
 *
 *   - Uses CSS variables for every colour instead of hard-coded
 *     `border-blue-500` / `border-orange-500` etc. so the table
 *     respects the app's brand palette and survives dark/light flips.
 *   - "Competition zones" are shaded full-row backgrounds (top-4 =
 *     UCL tint, 5-6 = Europa tint, bottom-3 = relegation tint) — the
 *     previous left-edge ribbon was visually weak and easy to miss.
 *   - Form column is always visible (never `hidden md:`), since the
 *     last-five run is one of the most-glanced data points in FotMob.
 *   - Each row links to the future team page when a `team_id` is
 *     present.
 *   - Wrapped in `<Card>` so it shares the same border / shadow /
 *     radius tokens as the rest of the redesigned surfaces.
 */

interface StandingsRow {
  position: number
  team_id?: number
  team_name: string
  team_logo?: string
  played: number
  won: number
  drawn: number
  lost: number
  goals_for: number
  goals_against: number
  goal_difference: number
  points: number
  form?: string[]
}

interface StandingsTableProps {
  standings: StandingsRow[]
  highlightTeams?: number[]
  leagueName?: string
  /** Show or hide the legend strip. */
  showLegend?: boolean
  /** When the league has no European places (smaller leagues), pass `false`. */
  showEuropeanZones?: boolean
}

type Zone = 'ucl' | 'europa' | 'conference' | 'relegation' | null

function zoneForPosition(position: number, total: number, showEuropeanZones: boolean): Zone {
  if (!showEuropeanZones) {
    if (position > total - 3) return 'relegation'
    return null
  }
  if (position <= 4) return 'ucl'
  if (position === 5) return 'europa'
  if (position === 6) return 'conference'
  if (position > total - 3) return 'relegation'
  return null
}

const zoneStyles: Record<NonNullable<Zone>, { bg: string; bar: string; chip: string; label: string }> = {
  ucl: {
    bg: 'bg-[color-mix(in_srgb,var(--accent-ai)_8%,transparent)]',
    bar: 'border-l-2 border-[var(--accent-ai)]',
    chip: 'bg-[color-mix(in_srgb,var(--accent-ai)_15%,transparent)] text-[var(--accent-ai)]',
    label: 'Champions League',
  },
  europa: {
    bg: 'bg-[color-mix(in_srgb,var(--accent-warn)_8%,transparent)]',
    bar: 'border-l-2 border-[var(--accent-warn)]',
    chip: 'bg-[color-mix(in_srgb,var(--accent-warn)_15%,transparent)] text-[var(--accent-warn)]',
    label: 'Europa League',
  },
  conference: {
    bg: 'bg-[color-mix(in_srgb,var(--accent-primary)_8%,transparent)]',
    bar: 'border-l-2 border-[var(--accent-primary)]',
    chip: 'bg-[color-mix(in_srgb,var(--accent-primary)_15%,transparent)] text-[var(--accent-primary)]',
    label: 'Conference League',
  },
  relegation: {
    bg: 'bg-[color-mix(in_srgb,var(--accent-loss)_8%,transparent)]',
    bar: 'border-l-2 border-[var(--accent-loss)]',
    chip: 'bg-[color-mix(in_srgb,var(--accent-loss)_15%,transparent)] text-[var(--accent-loss)]',
    label: 'Relegation',
  },
}

export default function StandingsTable({
  standings,
  highlightTeams = [],
  leagueName,
  showLegend = true,
  showEuropeanZones = true,
}: StandingsTableProps) {
  if (!standings || standings.length === 0) {
    return (
      <Card className="flex h-32 items-center justify-center text-sm text-[var(--text-tertiary)]">
        No standings available.
      </Card>
    )
  }
  return (
    <Card className="overflow-hidden">
      {leagueName && (
        <div className="border-b border-[var(--border-color)] px-4 py-3">
          <h3 className="text-sm font-bold text-[var(--text-primary)]">{leagueName}</h3>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border-color)] bg-[color-mix(in_srgb,var(--surface-muted)_30%,transparent)] text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
              <th className="px-3 py-3 text-left w-8">#</th>
              <th className="px-3 py-3 text-left">Team</th>
              <th className="px-2 py-3 text-center" title="Played">P</th>
              <th className="px-2 py-3 text-center" title="Won">W</th>
              <th className="px-2 py-3 text-center" title="Drawn">D</th>
              <th className="px-2 py-3 text-center" title="Lost">L</th>
              <th className="hidden px-2 py-3 text-center md:table-cell" title="Goals for">GF</th>
              <th className="hidden px-2 py-3 text-center md:table-cell" title="Goals against">GA</th>
              <th className="px-2 py-3 text-center" title="Goal difference">GD</th>
              <th className="px-3 py-3 text-center font-bold text-[var(--text-secondary)]">Pts</th>
              <th className="px-3 py-3 text-center">Form</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((row) => {
              const zone = zoneForPosition(row.position, standings.length, showEuropeanZones)
              const styles = zone ? zoneStyles[zone] : null
              const highlighted = highlightTeams.includes(row.team_id || 0)
              const teamHref = row.team_id ? `/teams/${row.team_id}` : undefined

              return (
                <tr
                  key={`${row.position}-${row.team_name}`}
                  className={cn(
                    'border-b border-[color-mix(in_srgb,var(--border-color)_40%,transparent)] transition-colors hover:bg-[var(--card-hover)]',
                    styles?.bg,
                    styles?.bar,
                    highlighted && 'bg-[color-mix(in_srgb,var(--accent-warn)_10%,transparent)]'
                  )}
                >
                  <td className="px-3 py-2.5 text-center text-xs font-semibold tabular-nums text-[var(--text-secondary)]">
                    {row.position}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      {row.team_logo && (
                        <img
                          src={row.team_logo}
                          alt=""
                          className="h-5 w-5 object-contain"
                          loading="lazy"
                        />
                      )}
                      {teamHref ? (
                        <Link
                          href={teamHref}
                          prefetch={false}
                          className="truncate text-sm font-semibold text-[var(--text-primary)] hover:text-[var(--accent-primary)]"
                        >
                          {row.team_name}
                        </Link>
                      ) : (
                        <span className="truncate text-sm font-semibold text-[var(--text-primary)]">
                          {row.team_name}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-2.5 text-center text-[12px] tabular-nums text-[var(--text-secondary)]">{row.played}</td>
                  <td className="px-2 py-2.5 text-center text-[12px] tabular-nums text-[var(--text-secondary)]">{row.won}</td>
                  <td className="px-2 py-2.5 text-center text-[12px] tabular-nums text-[var(--text-secondary)]">{row.drawn}</td>
                  <td className="px-2 py-2.5 text-center text-[12px] tabular-nums text-[var(--text-secondary)]">{row.lost}</td>
                  <td className="hidden px-2 py-2.5 text-center text-[12px] tabular-nums text-[var(--text-secondary)] md:table-cell">{row.goals_for}</td>
                  <td className="hidden px-2 py-2.5 text-center text-[12px] tabular-nums text-[var(--text-secondary)] md:table-cell">{row.goals_against}</td>
                  <td
                    className={cn(
                      'px-2 py-2.5 text-center text-[12px] font-semibold tabular-nums',
                      row.goal_difference > 0 ? 'text-[var(--accent-primary)]' : row.goal_difference < 0 ? 'text-[var(--accent-loss)]' : 'text-[var(--text-secondary)]'
                    )}
                  >
                    {row.goal_difference > 0 ? '+' : ''}{row.goal_difference}
                  </td>
                  <td className="px-3 py-2.5 text-center text-sm font-bold tabular-nums text-[var(--text-primary)]">
                    {row.points}
                  </td>
                  <td className="px-3 py-2.5">
                    {row.form && row.form.length > 0 ? (
                      <TeamFormPill form={row.form.join('')} size="xs" className="justify-center" />
                    ) : (
                      <span className="text-[10px] text-[var(--text-tertiary)]">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {showLegend && (
        <div className="border-t border-[var(--border-color)] bg-[color-mix(in_srgb,var(--surface-muted)_20%,transparent)] px-4 py-2.5">
          <div className="flex flex-wrap gap-3 text-[10px] text-[var(--text-tertiary)]">
            {showEuropeanZones && (
              <>
                <ZoneChip zone="ucl" />
                <ZoneChip zone="europa" />
                <ZoneChip zone="conference" />
              </>
            )}
            <ZoneChip zone="relegation" />
          </div>
        </div>
      )}
    </Card>
  )
}

function ZoneChip({ zone }: { zone: NonNullable<Zone> }) {
  const styles = zoneStyles[zone]
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold', styles.chip)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {styles.label}
    </span>
  )
}
