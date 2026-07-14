'use client'

import { EmptyState } from '@/components/EmptyState'
import { TeamFormPill } from '@/components/match/TeamFormPill'
import { TeamBadge } from '@/components/primitives'
import { cn } from '@/lib/utils'

import type { MatchDetails, TeamStanding } from './types'

function signedGD(value: number | undefined): string {
  if (value == null) return ''
  return value > 0 ? `+${value}` : String(value)
}

/**
 * Table tab — the full league standings with crests, W/D/L, goal difference,
 * points and last-5 form pills when the feed publishes them. Qualification /
 * relegation zones get a left stripe in the feed's zone colour; both match
 * teams are highlighted.
 */
export function TableTab({ match }: { match: MatchDetails }) {
  const rows = match.fullStandings

  if (!rows || rows.length === 0) {
    return (
      <EmptyState
        illustration="searching"
        title="No table for this competition"
        description="Standings are not available for this fixture — knockout rounds and some cups don't publish a league table."
      />
    )
  }

  const hasForm = rows.some((r) => typeof r.form === 'string' && r.form.length > 0)
  const hasGoals = rows.some((r) => r.goalsFor != null && r.goalsAgainst != null)
  const hasGD = rows.some((r) => r.goalDiff != null) || hasGoals

  const gdOf = (r: TeamStanding) =>
    r.goalDiff ?? (r.goalsFor != null && r.goalsAgainst != null ? r.goalsFor - r.goalsAgainst : undefined)

  const zones = new Map<string, string>()
  for (const r of rows) {
    if (r.note?.color && r.note.description && !zones.has(r.note.description)) {
      zones.set(r.note.description, r.note.color)
    }
  }

  return (
    <div className="bg-[var(--card-bg)] border rounded-xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
      <div className="p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <h3 className="font-semibold text-[var(--text-primary)]">{match.league}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-[13px]">
          <thead>
            <tr className="text-[11px] text-[var(--text-tertiary)] border-b" style={{ borderColor: 'var(--border-color)' }}>
              <th className="py-2 pl-4 pr-2 text-left font-medium">#</th>
              <th className="py-2 px-2 text-left font-medium">Team</th>
              <th className="py-2 px-2 text-right font-medium">P</th>
              <th className="py-2 px-2 text-right font-medium">W</th>
              <th className="py-2 px-2 text-right font-medium">D</th>
              <th className="py-2 px-2 text-right font-medium">L</th>
              {hasGD && <th className="py-2 px-2 text-right font-medium">GD</th>}
              <th className="py-2 px-2 text-right font-medium">Pts</th>
              {hasForm && <th className="py-2 pl-3 pr-4 text-left font-medium">Form</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((team) => {
              const isHome = team.position === match.homeStanding?.position
              const isAway = team.position === match.awayStanding?.position
              const highlighted = isHome || isAway
              const gd = gdOf(team)
              return (
                <tr
                  key={team.position}
                  className={cn('border-b last:border-b-0', highlighted ? 'font-semibold' : 'hover:bg-[var(--muted-bg)]', 'transition-colors')}
                  style={{
                    borderColor: 'var(--border-color)',
                    background: isHome
                      ? 'color-mix(in srgb, var(--team-tint-home) 10%, transparent)'
                      : isAway
                        ? 'color-mix(in srgb, var(--team-tint-away) 10%, transparent)'
                        : undefined,
                  }}
                >
                  <td
                    className="py-2 pl-4 pr-2 tabular-nums text-[var(--text-secondary)]"
                    style={team.note?.color ? { boxShadow: `inset 3px 0 0 0 ${team.note.color}` } : undefined}
                  >
                    {team.position}
                  </td>
                  <td className="py-2 px-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <TeamBadge teamId={team.teamId} name={team.teamName || ''} size={20} className="shrink-0" />
                      <span className="truncate text-[var(--text-primary)]">{team.teamName}</span>
                      {highlighted && (
                        <span className="shrink-0 text-[10px] text-[var(--text-tertiary)]">{isHome ? '(H)' : '(A)'}</span>
                      )}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums text-[var(--text-secondary)]">{team.played}</td>
                  <td className="py-2 px-2 text-right tabular-nums text-[var(--text-secondary)]">{team.won}</td>
                  <td className="py-2 px-2 text-right tabular-nums text-[var(--text-secondary)]">{team.drawn}</td>
                  <td className="py-2 px-2 text-right tabular-nums text-[var(--text-secondary)]">{team.lost}</td>
                  {hasGD && (
                    <td className="py-2 px-2 text-right tabular-nums text-[var(--text-secondary)]">{signedGD(gd)}</td>
                  )}
                  <td className="py-2 px-2 text-right font-bold tabular-nums text-[var(--text-primary)]">{team.points}</td>
                  {hasForm && (
                    <td className="py-2 pl-3 pr-4">
                      <TeamFormPill form={team.form} size="sm" teamName={team.teamName} />
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Legend — zone stripes (feed-provided) + team highlights */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t p-3 text-xs" style={{ borderColor: 'var(--border-color)', color: 'var(--text-tertiary)' }}>
        {[...zones.entries()].map(([description, color]) => (
          <span key={description} className="flex items-center gap-1.5">
            <span className="h-3 w-1 rounded-sm" style={{ background: color }} />
            <span>{description}</span>
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm" style={{ background: 'color-mix(in srgb, var(--team-tint-home) 25%, transparent)' }} />
          <span>{match.home_team}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm" style={{ background: 'color-mix(in srgb, var(--team-tint-away) 25%, transparent)' }} />
          <span>{match.away_team}</span>
        </span>
      </div>
    </div>
  )
}
