'use client'

import Link from 'next/link'

import { TeamBadge } from '@/components/primitives/TeamBadge'

export interface CupMatch {
  id: string
  date: string
  status: 'pre' | 'in' | 'post'
  statusDetail?: string
  home: { id?: string; name: string; score?: number | null }
  away: { id?: string; name: string; score?: number | null }
}

function kickoffLabel(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function StatusChip({ match }: { match: CupMatch }) {
  if (match.status === 'in') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em]"
        style={{ color: 'var(--accent-loss)', backgroundColor: 'color-mix(in srgb, var(--accent-loss) 14%, transparent)' }}
      >
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
        {match.statusDetail || 'Live'}
      </span>
    )
  }
  if (match.status === 'post') {
    return <span className="font-mono text-caption uppercase text-[var(--text-tertiary)]">FT</span>
  }
  return (
    <span className="font-mono text-caption tabular-nums text-[var(--text-secondary)]">
      {kickoffLabel(match.date)}
    </span>
  )
}

/** Today's World Cup fixtures, linking through to full match pages. */
export function TodayAtTheCup({ matches }: { matches: CupMatch[] }) {
  if (matches.length === 0) {
    return (
      <p className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-5 text-small text-[var(--text-secondary)]">
        No World Cup matches today — next fixtures appear here on matchday.
      </p>
    )
  }
  return (
    <ol className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]">
      {matches.map((match) => {
        const showScore = match.status !== 'pre'
        return (
          <li key={match.id} className="border-b border-[var(--border-color)] last:border-b-0">
            <Link
              href={`/matches/${match.id}?league=fifa.world`}
              className="grid grid-cols-[1fr_auto_1fr_5rem] items-center gap-2 px-4 py-3 transition-colors hover:bg-[var(--card-hover)]"
              prefetch={false}
            >
              <span className="flex min-w-0 items-center justify-end gap-2 text-right">
                <span className="truncate text-small font-semibold text-[var(--text-primary)]">
                  {match.home.name}
                </span>
                <TeamBadge teamId={match.home.id} name={match.home.name} size={22} />
              </span>
              <span className="px-1 text-center font-mono text-small font-bold tabular-nums text-[var(--text-primary)]">
                {showScore ? `${match.home.score ?? '–'} : ${match.away.score ?? '–'}` : 'vs'}
              </span>
              <span className="flex min-w-0 items-center gap-2">
                <TeamBadge teamId={match.away.id} name={match.away.name} size={22} />
                <span className="truncate text-small font-semibold text-[var(--text-primary)]">
                  {match.away.name}
                </span>
              </span>
              <span className="text-right">
                <StatusChip match={match} />
              </span>
            </Link>
          </li>
        )
      })}
    </ol>
  )
}

export default TodayAtTheCup
