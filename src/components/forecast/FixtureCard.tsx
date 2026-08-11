'use client'

import Link from 'next/link'

import { ProbabilityBar } from '@/components/forecast/ProbabilityBar'
import { cn } from '@/lib/utils'

/**
 * One fixture, understandable in a few seconds.
 *
 * Ordered by how quickly each part answers "what does the model think":
 * who is playing and when, then the three-way call, then the goal rates, then
 * the scorelines for anyone who wants them. The scoreline list is last because
 * it is the only part most readers will skip.
 *
 * The expected-goal figures and the 1X2 are two views of ONE object — the
 * backend solves the goal model's lambdas so its scoreline grid reproduces
 * these exact probabilities. They cannot disagree, which is why they can sit
 * next to each other without a caveat.
 */

export interface FixtureForecast {
  fixture_uid?: string
  competition_id: string
  season: number
  date: string
  kickoff: string | null
  round?: string | null
  home: string
  away: string
  p_home: number
  p_draw: number
  p_away: number
  xg_home: number
  xg_away: number
  scorelines: { score: string; p: number }[]
  elo_home?: number
  elo_away?: number
}

export function formatKickoff(date: string, kickoff: string | null): string {
  const d = new Date(`${date}T${kickoff ?? '12:00'}:00Z`)
  const day = d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
  return kickoff ? `${day} · ${kickoff}` : day
}

export function FixtureCard({
  fixture,
  href,
  className,
}: {
  fixture: FixtureForecast
  href?: string
  className?: string
}) {
  const f = fixture
  const kickoff = formatKickoff(f.date, f.kickoff)

  return (
    <article
      className={cn(
        'rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-4 transition-colors hover:border-[var(--text-tertiary)]',
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <time
          dateTime={`${f.date}${f.kickoff ? `T${f.kickoff}` : ''}`}
          className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]"
        >
          {kickoff}
        </time>
        {f.round ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
            {f.round}
          </span>
        ) : null}
      </div>

      <h3 className="mt-2 text-[15px] font-semibold leading-snug text-[var(--text-primary)]">
        {/* Stacked rather than "A vs B" on one line: long club names wrap
            unpredictably at 375px and a wrapped fixture is unreadable. */}
        <span className="block truncate">{f.home}</span>
        <span className="block text-[11px] font-normal uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
          vs
        </span>
        <span className="block truncate">{f.away}</span>
      </h3>

      <ProbabilityBar
        className="mt-3.5"
        probabilities={{ home: f.p_home, draw: f.p_draw, away: f.p_away }}
        homeLabel="Home"
        awayLabel="Away"
      />

      <dl className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[var(--border-color)] pt-3">
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
            Expected goals
          </dt>
          <dd className="font-mono text-[13px] tabular-nums text-[var(--text-secondary)]">
            {f.xg_home.toFixed(2)} — {f.xg_away.toFixed(2)}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
            Most likely
          </dt>
          <dd className="font-mono text-[13px] tabular-nums text-[var(--text-secondary)]">
            {f.scorelines?.[0]
              ? `${f.scorelines[0].score} · ${(f.scorelines[0].p * 100).toFixed(1)}%`
              : '—'}
          </dd>
        </div>
      </dl>

      {f.scorelines?.length > 1 ? (
        <ul className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1">
          {f.scorelines.slice(1, 5).map((s) => (
            <li
              key={s.score}
              className="font-mono text-[11px] tabular-nums text-[var(--text-tertiary)]"
            >
              {s.score}{' '}
              <span className="text-[var(--text-secondary)]">
                {(s.p * 100).toFixed(1)}%
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {href ? (
        <Link
          href={href}
          className="mt-3.5 inline-flex items-center rounded-md border border-[var(--border-color)] px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.06em] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-primary)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
        >
          View match
          <span className="sr-only">
            : {f.home} versus {f.away}, {kickoff}
          </span>
        </Link>
      ) : null}
    </article>
  )
}
