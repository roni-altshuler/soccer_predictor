'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

import type { FixtureForecast } from '@/components/forecast/FixtureCard'
import { TeamCrest } from '@/components/primitives/TeamCrest'
import { cn } from '@/lib/utils'

/**
 * A whole season of fixtures, in rows rather than cards.
 *
 * The card grid is right for "the next six" and wrong for "all 380": at that
 * length the reader is scanning, and a card forces them to re-find the same
 * three numbers in a new place on every one. Rows put them in a column, which
 * is why every fixture list in the category — FotMob's included — is a list.
 *
 * Two things keep it from becoming a wall:
 *
 *  - **Date headings.** Football is organised by matchday and readers navigate
 *    by "the weekend of the 21st", not by row 47.
 *  - **A matchday at a time.** 380 rows on open is not a feature. Six
 *    matchdays render, and more on request, so the page stays responsive on a
 *    phone and the reader chooses how much to take on.
 *
 * The three probabilities sit under one set of column headings instead of
 * being labelled per row. Repeating "home / draw / away" 380 times is noise;
 * a heading row says it once. Every row still carries a full sentence for
 * screen readers, because a positional convention is invisible to them.
 */

const DAY = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  })

const pct = (v: number) => (v * 100).toFixed(1)

const MATCHDAYS_PER_PAGE = 6

export function FixtureList({
  fixtures,
  className,
}: {
  fixtures: FixtureForecast[]
  className?: string
}) {
  const [shown, setShown] = useState(MATCHDAYS_PER_PAGE)

  const days = useMemo(() => {
    const byDate = new Map<string, FixtureForecast[]>()
    for (const f of [...fixtures].sort((a, b) =>
      a.date === b.date
        ? (a.kickoff ?? '').localeCompare(b.kickoff ?? '')
        : a.date.localeCompare(b.date),
    )) {
      const list = byDate.get(f.date)
      if (list) list.push(f)
      else byDate.set(f.date, [f])
    }
    return [...byDate.entries()]
  }, [fixtures])

  if (!fixtures.length) {
    return (
      <p className={cn('text-[13px] text-[var(--text-tertiary)]', className)}>
        No fixtures remain in this league.
      </p>
    )
  }

  const visible = days.slice(0, shown)
  const remaining = days.length - visible.length

  return (
    <div className={className}>
      <div
        aria-hidden
        className="grid grid-cols-[2.75rem_1fr_9.5rem] items-center gap-x-2 border-b border-[var(--border-color)] pb-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] sm:grid-cols-[3.25rem_1fr_11rem]"
      >
        <span>Time</span>
        <span>Match</span>
        <span className="grid grid-cols-3 gap-x-1 text-right">
          <span>Home</span>
          <span>Draw</span>
          <span>Away</span>
        </span>
      </div>

      {visible.map(([date, list]) => (
        <section key={date} aria-labelledby={`day-${date}`}>
          <h3
            id={`day-${date}`}
            className="sticky top-0 z-10 -mx-1 bg-[var(--bg-primary,var(--card-bg))]/95 px-1 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)] backdrop-blur"
          >
            {DAY(date)}
          </h3>
          <ul>
            {list.map((f) => (
              <li key={f.fixture_uid ?? `${f.date}-${f.home}-${f.away}`}>
                <FixtureRow fixture={f} />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {remaining > 0 ? (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => setShown((n) => n + MATCHDAYS_PER_PAGE)}
            className="rounded-lg border border-[var(--border-color)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--text-secondary)] transition-colors hover:border-[var(--text-tertiary)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
          >
            Show more · {remaining} more matchday{remaining === 1 ? '' : 's'}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function FixtureRow({ fixture: f }: { fixture: FixtureForecast }) {
  const probs = [
    { key: 'home', v: f.p_home },
    { key: 'draw', v: f.p_draw },
    { key: 'away', v: f.p_away },
  ]
  const top = Math.max(f.p_home, f.p_draw, f.p_away)
  // Same guard as FixtureCard: a scraped time may not be a time.
  const time = /^\d{1,2}:\d{2}$/.test(f.kickoff ?? '') ? f.kickoff : null

  const body = (
    <div className="grid grid-cols-[2.75rem_1fr_9.5rem] items-center gap-x-2 border-b border-[var(--border-color)] py-2.5 sm:grid-cols-[3.25rem_1fr_11rem]">
      <time
        dateTime={`${f.date}${time ? `T${time}` : ''}`}
        className="font-mono text-[11px] tabular-nums text-[var(--text-tertiary)]"
      >
        {time ?? '—'}
      </time>

      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <TeamCrest team={f.home} competitionId={f.competition_id} size="sm" />
          <span className="truncate text-[13px] leading-snug text-[var(--text-primary)]">
            {f.home}
          </span>
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <TeamCrest team={f.away} competitionId={f.competition_id} size="sm" />
          <span className="truncate text-[13px] leading-snug text-[var(--text-secondary)]">
            {f.away}
          </span>
        </span>
      </span>

      <span aria-hidden className="grid grid-cols-3 gap-x-1 text-right">
        {probs.map((p) => (
          <span
            key={p.key}
            className={cn(
              'font-mono text-[12px] tabular-nums',
              p.v === top
                ? 'text-[var(--text-primary)]'
                : 'text-[var(--text-tertiary)]',
            )}
          >
            {pct(p.v)}
          </span>
        ))}
      </span>

      {/* The whole row in words, because the columns above only mean anything
          to someone who can see the heading. */}
      <span className="sr-only">
        {f.home} versus {f.away}. {f.home} {pct(f.p_home)} per cent, draw{' '}
        {pct(f.p_draw)} per cent, {f.away} {pct(f.p_away)} per cent.
      </span>
    </div>
  )

  if (!f.fixture_uid) return body

  return (
    <Link
      href={`/season/fixture/${f.fixture_uid}`}
      className="block rounded-md transition-colors hover:bg-[var(--card-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
    >
      {body}
    </Link>
  )
}
