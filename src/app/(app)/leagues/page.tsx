import Link from 'next/link'

import { LeagueMark } from '@/components/primitives'
import { Card } from '@/components/ui/card'
import { coveredLeagues } from '@/lib/leagueAccents'

/**
 * Competition directory.
 *
 * This used to list all fourteen competitions in the accent registry, with a
 * search box and a domestic/international split. That was the sprawl the pivot
 * removed: nine of them had never been scored against a closing line, and
 * putting them in the same list as the five that had invites the reader to
 * trust all fourteen equally. The registry still knows every competition — a
 * Champions League fixture appearing in a search result still gets its badge —
 * but coverage is what this page is about, so it shows coverage.
 *
 * The waves are named rather than hidden. A reader who came looking for MLS
 * should learn that it is next, not conclude the product forgot about it.
 */
export const metadata = {
  title: 'Leagues · Pitchverse',
  description: 'The competitions Pitchverse covers, and what is next.',
}

const UPCOMING = [
  { wave: 'Wave B', what: 'MLS' },
  { wave: 'Wave C', what: 'Champions League · Europa League · Euros · World Cup · Copa América' },
]

export default function LeaguesPage() {
  const leagues = coveredLeagues()

  return (
    <div className="mx-auto w-full max-w-5xl px-3 py-4 sm:px-4">
      <div className="flex items-baseline justify-between gap-3 px-1 pb-1">
        <h1 className="text-lg font-bold tracking-tight text-[var(--text-primary)]">Leagues</h1>
        <span className="font-numeric text-[11px] tabular-nums text-[var(--text-tertiary)]">
          {leagues.length} covered
        </span>
      </div>
      <p className="mb-3 px-1 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
        A league is covered once the model has been scored against that league&rsquo;s closing
        odds, season by season. Each league page opens with that record.
      </p>

      <Card className="overflow-hidden p-0">
        <ul className="divide-y divide-[var(--border-color)]/40">
          {leagues.map((league) => (
            <li key={league.competitionId}>
              <Link
                href={`/leagues/${league.competitionId}`}
                prefetch={false}
                className="group flex min-h-[56px] items-center gap-3 px-3 transition-colors hover:bg-[var(--card-hover)]"
              >
                <LeagueMark league={league.competitionId} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-[var(--text-primary)]">
                    {league.displayName}
                  </span>
                  <span className="block truncate text-[11px] text-[var(--text-tertiary)]">
                    {league.country}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className="font-mono text-[11px] text-[var(--text-tertiary)] transition-colors group-hover:text-[var(--text-secondary)]"
                >
                  {league.competitionId}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      <section className="mt-4 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
          Not covered yet
        </p>
        <dl className="mt-2 space-y-1.5">
          {UPCOMING.map((row) => (
            <div key={row.wave} className="flex flex-wrap items-baseline gap-x-3">
              <dt className="font-mono text-[11px] text-[var(--text-tertiary)]">{row.wave}</dt>
              <dd className="text-[12px] text-[var(--text-secondary)]">{row.what}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2.5 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
          Each wave opens when the one before it clears its evidence gate, not on a date.
        </p>
      </section>
    </div>
  )
}
