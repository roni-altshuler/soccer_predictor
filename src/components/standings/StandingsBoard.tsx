'use client'

import { useMemo } from 'react'

import { TeamCrest } from '@/components/primitives/TeamCrest'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/**
 * A table, whatever shape the competition is.
 *
 * One group renders as a league table; several render as a group stage or as
 * MLS's two conferences. Nothing here knows which kind it was handed, because
 * the difference is entirely in how many groups the provider returned.
 *
 * The qualification bands are ESPN'S OWN. Every entry carries a note —
 * "Qualifies for round of 16", "Champions League", "Relegation" — with a
 * colour, so the bands are read from the competition rather than hard-coded
 * from a remembered format. That matters more than it sounds: the Champions
 * League cut moved from eight to twenty-four teams when the league phase
 * replaced the group stage, and any constant written here would have been
 * silently wrong for a season.
 */

export interface StandingsTeam {
  rank: number
  team: string
  played: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  goalDifference: number
  points: number
  note: string | null
  noteColor: string | null
}

export interface StandingsPayload {
  available: boolean
  reason?: string
  competition?: string
  name?: string
  season?: number | null
  seasonLabel?: string
  seasons?: Array<{ year: number; label: string }>
  groups?: Array<{ name: string; teams: StandingsTeam[] }>
}

/** ESPN sends a bare hex without the `#`, and occasionally nothing at all. */
function bandColor(team: StandingsTeam): string | null {
  if (!team.note) return null
  if (team.noteColor && /^#[0-9a-f]{6}$/i.test(team.noteColor)) return team.noteColor
  return 'var(--text-tertiary)'
}

export function StandingsBoard({
  data,
  competitionId,
}: {
  data: StandingsPayload
  competitionId: string
}) {
  // Memoised so the legend below has a stable dependency. `data.groups ?? []`
  // is a fresh array on every render when the field is absent, which makes
  // the legend recompute each time for no reason.
  const groups = useMemo(() => data.groups ?? [], [data.groups])

  // One legend for the whole board: the same note means the same thing in
  // every group, and repeating it per group turns a table into a wall.
  const legend = useMemo(() => {
    const seen = new Map<string, string>()
    for (const group of groups) {
      for (const team of group.teams) {
        const color = bandColor(team)
        if (team.note && color && !seen.has(team.note)) seen.set(team.note, color)
      }
    }
    return [...seen.entries()]
  }, [groups])

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => (
        <Card key={group.name} className="overflow-hidden p-0">
          {groups.length > 1 && (
            <h2 className="border-b border-[var(--border-color)] px-3 py-2 text-[12px] font-bold uppercase tracking-[0.08em] text-[var(--text-primary)]">
              {group.name}
            </h2>
          )}
          <GroupTable
            teams={group.teams}
            competitionId={competitionId}
            caption={`${data.name ?? ''} ${group.name}`.trim()}
          />
        </Card>
      ))}

      {legend.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5 px-1">
          {legend.map(([note, color]) => (
            <li
              key={note}
              className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]"
            >
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                style={{ background: color }}
              />
              {note}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function GroupTable({
  teams,
  competitionId,
  caption,
}: {
  teams: StandingsTeam[]
  competitionId: string
  caption: string
}) {
  return (
    // The numeric columns are the ones that get squeezed first on a phone, and
    // a table that wraps `GD` onto two lines is unreadable — so the table
    // scrolls inside its own box rather than compressing.
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-left">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-[var(--border-color)] text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
            <th scope="col" className="w-9 py-2 pl-3 text-right font-semibold">
              #
            </th>
            <th scope="col" className="py-2 pl-2 font-semibold">
              Club
            </th>
            {['P', 'W', 'D', 'L', 'GF', 'GA', 'GD'].map((h) => (
              <th key={h} scope="col" className="w-9 py-2 text-right font-semibold">
                {h}
              </th>
            ))}
            <th scope="col" className="w-12 py-2 pr-3 text-right font-semibold">
              Pts
            </th>
          </tr>
        </thead>
        <tbody>
          {teams.map((team) => {
            const color = bandColor(team)
            return (
              <tr
                key={`${team.rank}-${team.team}`}
                className="border-b border-[var(--border-color)]/60 last:border-0 hover:bg-[var(--card-hover)]"
              >
                <td className="relative py-2 pl-3 text-right">
                  {color && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-0 left-0 w-[3px]"
                      style={{ background: color }}
                    />
                  )}
                  <span className="font-numeric text-[12px] tabular-nums text-[var(--text-secondary)]">
                    {team.rank}
                  </span>
                </td>
                <td className="py-2 pl-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <TeamCrest team={team.team} competitionId={competitionId} size="sm" />
                    <span className="truncate text-[13px] font-semibold text-[var(--text-primary)]">
                      {team.team}
                    </span>
                  </span>
                </td>
                {[
                  team.played,
                  team.won,
                  team.drawn,
                  team.lost,
                  team.goalsFor,
                  team.goalsAgainst,
                ].map((value, i) => (
                  <td
                    key={i}
                    className="py-2 text-right font-numeric text-[12px] tabular-nums text-[var(--text-secondary)]"
                  >
                    {value}
                  </td>
                ))}
                <td className="py-2 text-right font-numeric text-[12px] tabular-nums text-[var(--text-secondary)]">
                  {team.goalDifference > 0 ? `+${team.goalDifference}` : team.goalDifference}
                </td>
                <td
                  className={cn(
                    'py-2 pr-3 text-right font-numeric text-[13px] font-bold tabular-nums',
                    'text-[var(--text-primary)]',
                  )}
                >
                  {team.points}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
