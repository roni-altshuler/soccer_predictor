'use client'

import type { MatchCard } from '@/lib/server/tieFixtures'
import { cn } from '@/lib/utils'

/**
 * What the two clubs have done — to each other, and lately.
 *
 * Both are ESPN's own records, not a summary of them: the head-to-head is the
 * list of meetings it publishes with the scores it publishes, and the form is
 * each side's last five with the opponent and the result. Nothing is derived,
 * because a "record" a reader cannot check against a scoreline is a number
 * this site has no business printing.
 */

const RESULT_TONE: Record<string, string> = {
  W: 'border-[var(--accent-primary)] text-[var(--accent-primary)]',
  D: 'border-[var(--accent-warn)] text-[var(--accent-warn)]',
  L: 'border-[var(--accent-loss)] text-[var(--accent-loss)]',
}

const fmtDate = (iso: string) =>
  iso
    ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : ''

export function HeadToHead({ h2h }: { h2h: NonNullable<MatchCard['headToHead']> }) {
  return (
    <section className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-4 md:px-5 md:py-5">
      <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
        Head to head
      </h2>
      {h2h.summary ? (
        <p className="mt-2 text-[12px] text-[var(--text-secondary)]">{h2h.summary}</p>
      ) : null}
      <ul className="mt-3 space-y-2">
        {h2h.meetings.map((m) => (
          <li
            key={m.id}
            data-meeting={m.id}
            className="grid grid-cols-[1fr_auto_1fr] items-baseline gap-2.5"
          >
            <span
              className={cn(
                'min-w-0 truncate text-right text-[12px]',
                m.home.winner ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]',
              )}
            >
              {m.home.name}
            </span>
            <span className="font-mono text-[12px] tabular-nums text-[var(--text-primary)]">
              {m.home.score ?? '–'}
              <span className="mx-1 text-[var(--text-tertiary)]">:</span>
              {m.away.score ?? '–'}
            </span>
            <span
              className={cn(
                'min-w-0 truncate text-[12px]',
                m.away.winner ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]',
              )}
            >
              {m.away.name}
            </span>
            <span className="col-span-3 font-mono text-[9.5px] uppercase tracking-[0.06em] text-[var(--text-tertiary)]">
              {[fmtDate(m.date), m.competition].filter(Boolean).join(' · ')}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function FormGuide({
  form,
  names,
}: {
  form: MatchCard['form']
  names: Record<string, string>
}) {
  const withGames = form.filter((f) => f.games.length)
  if (!withGames.length) return null
  return (
    <section className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-4 md:px-5 md:py-5">
      <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
        Going in
      </h2>
      <div className="mt-3 grid gap-5 sm:grid-cols-2">
        {withGames.map((f) => (
          <div key={f.teamId} data-form-team={f.teamId}>
            <h3 className="truncate text-[12.5px] font-semibold text-[var(--text-primary)]">
              {names[f.teamId] ?? ''}
            </h3>
            <ul className="mt-2 space-y-1.5">
              {f.games.map((g) => (
                <li key={g.id} className="flex min-w-0 items-center gap-2">
                  <span
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border font-mono text-[9px]',
                      RESULT_TONE[g.result] ??
                        'border-[var(--border-color)] text-[var(--text-tertiary)]',
                    )}
                  >
                    {g.result}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-[var(--text-secondary)]">
                    <span className="text-[var(--text-tertiary)]">{g.atVs} </span>
                    {g.opponent}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--text-secondary)]">
                    {g.score}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}
