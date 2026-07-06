'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

import { TeamBadge } from '@/components/primitives/TeamBadge'

export interface GlanceTeam {
  name: string
  teamId?: string
  played: number
  points: number
  /** Probability of reaching the knockout stage (advancing from the group). */
  pAdvance?: number
}

export interface GlanceGroup {
  letter: string
  teams: GlanceTeam[]
}

/**
 * All 12 World Cup groups at a glance — standings position, points, and
 * the model's advance-to-knockout probability per team. Each card links
 * to the full group simulator page.
 */
export function GroupsGlance({ groups }: { groups: GlanceGroup[] }) {
  if (groups.length === 0) return null
  return (
    <section aria-label="World Cup groups overview">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {groups.map((group) => (
          <Link
            key={group.letter}
            href={`/world-cup/groups/${group.letter}`}
            className="group rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 transition-colors hover:border-[var(--border-hover)] hover:bg-[var(--card-hover)]"
          >
            <div className="mb-2.5 flex items-center justify-between">
              <h3 className="text-small font-bold uppercase tracking-[0.14em] text-[var(--text-primary)]">
                Group {group.letter}
              </h3>
              <span className="inline-flex items-center gap-0.5 text-caption text-[var(--text-tertiary)] transition-colors group-hover:text-[var(--accent-primary)]">
                simulate <ChevronRight className="h-3 w-3" />
              </span>
            </div>
            <ol className="space-y-1.5">
              {group.teams.map((team) => (
                <li key={team.name} className="flex items-center gap-2 text-small">
                  <TeamBadge teamId={team.teamId} name={team.name} size={18} />
                  <span className="min-w-0 flex-1 truncate text-[var(--text-primary)]">
                    {team.name}
                  </span>
                  <span className="font-mono text-caption tabular-nums text-[var(--text-secondary)]">
                    {team.points} pt{team.points === 1 ? '' : 's'}
                  </span>
                  {typeof team.pAdvance === 'number' ? (
                    <span
                      className="w-11 rounded px-1 py-0.5 text-right font-mono text-[10px] font-semibold tabular-nums"
                      style={{
                        color: 'var(--accent-ai)',
                        backgroundColor:
                          'color-mix(in srgb, var(--accent-ai) 10%, transparent)',
                      }}
                      title="Model probability of reaching the knockout stage"
                    >
                      {Math.round(team.pAdvance * 100)}%
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </Link>
        ))}
      </div>
      <p className="mt-2 text-caption text-[var(--text-tertiary)]">
        Percentages are each team&apos;s probability of reaching the knockout stage.
      </p>
    </section>
  )
}

export default GroupsGlance
