'use client'

import { Fragment, useState } from 'react'
import { ChevronDown } from 'lucide-react'

import { SectionHeader, TeamBadge } from '@/components/primitives'
import type { Standing } from '@/lib/api'
import { cn } from '@/lib/utils'

import { SingleTeamDistribution } from './PositionDistributionMatrix'
import { zoneForPosition, ZONE_COLOR, ZONE_LABEL, type TeamMeta } from './shared'

/**
 * PredictedStandingsTable — FotMob table grammar (13px, tabular numerals,
 * hairline rows) for the simulated final table. Probability cells are
 * tinted by intensity: title = brand green, top four = info blue, Europa =
 * soft info, relegation = loss red. Zone left-edge stripes mark the
 * Champions League and drop zones; clicking a row expands the team's full
 * finishing-position distribution.
 */

interface ProbCellProps {
  probability: number
  token: string
  className?: string
}

function ProbCell({ probability, token, className }: ProbCellProps) {
  if (!(probability >= 0.005)) {
    return (
      <td
        className={cn(
          'px-3 py-2 text-right text-[13px] tabular-nums text-[var(--text-tertiary)]',
          className,
        )}
      >
        —
      </td>
    )
  }
  const wash = Math.min(38, Math.round(probability * 42))
  return (
    <td
      className={cn(
        'px-3 py-2 text-right text-[13px] font-semibold tabular-nums',
        className,
      )}
      style={{
        color: token,
        background: `color-mix(in srgb, ${token} ${wash}%, transparent)`,
      }}
    >
      {probability >= 0.995 ? '>99' : (probability * 100).toFixed(probability < 0.1 ? 1 : 0)}%
    </td>
  )
}

interface PredictedStandingsTableProps {
  standings: Standing[]
  teamMeta?: Record<string, TeamMeta>
  remainingMatches: number
  className?: string
}

export default function PredictedStandingsTable({
  standings,
  teamMeta = {},
  remainingMatches,
  className,
}: PredictedStandingsTableProps) {
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null)
  const ordered = [...standings].sort(
    (a, b) => a.avg_final_position - b.avg_final_position,
  )
  const numTeams = ordered.length
  if (numTeams === 0) return null
  const showEuropa = numTeams > 10

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]',
        className,
      )}
    >
      <div className="border-b border-[var(--border-color)] p-4 md:p-5">
        <SectionHeader
          kicker="Projection"
          title="Predicted final table"
          description={`${remainingMatches} matches still to play · tap a row for its full finishing spread`}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[var(--border-color)] text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
              <th className="px-3 py-2.5 text-left font-semibold">Pos</th>
              <th className="px-3 py-2.5 text-left font-semibold">Team</th>
              <th className="px-3 py-2.5 text-right font-semibold">Pts</th>
              <th className="px-3 py-2.5 text-right font-semibold">Proj pts</th>
              <th className="px-3 py-2.5 text-right font-semibold">Title</th>
              <th className="px-3 py-2.5 text-right font-semibold">Top 4</th>
              {showEuropa && (
                <th className="hidden px-3 py-2.5 text-right font-semibold sm:table-cell">
                  Europa
                </th>
              )}
              <th className="px-3 py-2.5 text-right font-semibold">Releg</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((team, idx) => {
              const pos = idx + 1
              const zone = zoneForPosition(pos, numTeams)
              const stripe = zone === 'mid' ? undefined : ZONE_COLOR[zone]
              const expanded = expandedTeam === team.team_name
              const colSpan = showEuropa ? 8 : 7
              return (
                <Fragment key={team.team_name}>
                  <tr
                    tabIndex={0}
                    aria-expanded={expanded}
                    aria-label={`${team.team_name}, projected ${pos}${pos === 1 ? 'st place' : '. place'}. Show finishing spread`}
                    onClick={() =>
                      setExpandedTeam(expanded ? null : team.team_name)
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setExpandedTeam(expanded ? null : team.team_name)
                      }
                    }}
                    className="cursor-pointer border-b border-[color-mix(in_srgb,var(--border-color)_60%,transparent)] transition-colors last:border-b-0 hover:bg-[var(--card-hover)] focus-visible:bg-[var(--card-hover)] focus-visible:outline-none"
                    style={
                      stripe
                        ? { boxShadow: `inset 2px 0 0 0 ${stripe}` }
                        : undefined
                    }
                  >
                    <td className="px-3 py-2 tabular-nums text-[var(--text-secondary)]">
                      {pos}
                    </td>
                    <td className="px-3 py-2 font-medium text-[var(--text-primary)]">
                      <span className="flex items-center gap-2">
                        <TeamBadge
                          teamId={teamMeta[team.team_name]?.id}
                          name={team.team_name}
                          teamColor={teamMeta[team.team_name]?.color}
                          size={18}
                        />
                        <span className="truncate">{team.team_name}</span>
                        <ChevronDown
                          className={cn(
                            'h-3 w-3 shrink-0 text-[var(--text-tertiary)] transition-transform',
                            expanded && 'rotate-180',
                          )}
                          aria-hidden="true"
                        />
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-[var(--text-secondary)]">
                      {team.current_points}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-[var(--text-primary)]">
                      {team.avg_final_points.toFixed(0)}
                    </td>
                    <ProbCell
                      probability={team.title_probability}
                      token="var(--accent-primary)"
                    />
                    <ProbCell
                      probability={team.top_4_probability}
                      token="var(--accent-info)"
                    />
                    {showEuropa && (
                      <td className="hidden p-0 sm:table-cell">
                        <table className="w-full">
                          <tbody>
                            <tr>
                              <ProbCell
                                probability={team.europa_probability}
                                token="var(--accent-info-soft)"
                              />
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    )}
                    <ProbCell
                      probability={team.relegation_probability}
                      token="var(--accent-loss)"
                    />
                  </tr>
                  {expanded && (
                    <tr className="border-b border-[color-mix(in_srgb,var(--border-color)_60%,transparent)] bg-[var(--background-secondary)]">
                      <td colSpan={colSpan} className="px-4 py-3">
                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                          Where {team.team_name} finish across the simulated seasons
                        </p>
                        <SingleTeamDistribution standing={team} numTeams={numTeams} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-[var(--border-color)] px-4 py-2.5 text-[11px] text-[var(--text-tertiary)]">
        {(showEuropa
          ? (['cl', 'europa', 'releg'] as const)
          : (['cl', 'releg'] as const)
        ).map((zone) => (
          <span key={zone} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-2.5 w-[3px] rounded-full"
              style={{ background: ZONE_COLOR[zone] }}
            />
            {ZONE_LABEL[zone]}
          </span>
        ))}
      </div>
    </div>
  )
}
