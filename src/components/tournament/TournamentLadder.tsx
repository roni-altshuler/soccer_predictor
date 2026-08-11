'use client'

import { cn } from '@/lib/utils'

/**
 * Where the tie model sits between a coin flip and picking the better team.
 *
 * The framing this component exists to carry: a league match has three
 * outcomes and a quarter of them are draws, which is why every 1X2 number on
 * /accuracy tops out near the market's 54%. A knockout TIE has two — extra
 * time, penalties and away goals exist to guarantee it. So the numbers here
 * are not the same numbers made bigger; they answer a different question, and
 * the ladder is shown so a reader can see which one.
 *
 * The floor is 50%, not 1/3, and the yardstick above it is "back the
 * better-rated side" — what an informed fan already does for free.
 */

export interface LadderEntry {
  key: string
  label: string
  accuracy: number
  brier: number
}

interface Props {
  ladder: LadderEntry[]
  nTies: number
  seasons: number[]
  competitions: number
  className?: string
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`

export function TournamentLadder({ ladder, nTies, seasons, competitions, className }: Props) {
  if (!ladder.length) return null

  const floor = 0.5
  const ceiling = Math.max(...ladder.map((e) => e.accuracy))
  const span = Math.max(0.0001, ceiling - floor)

  const model = ladder.find((e) => e.key === 'model')
  const rated = ladder.find((e) => e.key === 'higher_elo')
  const edge = model && rated ? rated.brier - model.brier : null

  return (
    <section
      className={cn(
        'rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-4 md:px-5 md:py-5',
        className,
      )}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
          Who advances
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
          {nTies.toLocaleString()} ties · {competitions} competitions
          {seasons.length ? ` · ${seasons[0]}–${seasons[seasons.length - 1]}` : ''}
        </span>
      </header>

      <ol className="mt-4 space-y-2.5">
        {ladder.map((e) => {
          const isModel = e.key === 'model'
          const width = Math.max(4, ((e.accuracy - floor) / span) * 100)
          return (
            <li key={e.key} className="grid grid-cols-[1fr_auto] items-baseline gap-x-3">
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span
                    className={cn(
                      'truncate text-[13px]',
                      isModel
                        ? 'font-semibold text-[var(--text-primary)]'
                        : 'text-[var(--text-secondary)]',
                    )}
                  >
                    {e.label}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                    brier {e.brier.toFixed(4)}
                  </span>
                </div>
                <div className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-[var(--border-color)]">
                  <div
                    className={cn(
                      'h-full rounded-full',
                      isModel ? 'bg-[var(--accent-primary)]' : 'bg-[var(--text-tertiary)]',
                    )}
                    style={{ width: `${width}%` }}
                  />
                </div>
              </div>
              <span
                className={cn(
                  'font-mono text-[13px] tabular-nums',
                  isModel ? 'text-[var(--accent-primary)]' : 'text-[var(--text-secondary)]',
                )}
              >
                {pct(e.accuracy)}
              </span>
            </li>
          )
        })}
      </ol>

      {edge !== null ? (
        <p className="mt-4 text-[12px] leading-relaxed text-[var(--text-secondary)]">
          The accuracy gap over &ldquo;back the better-rated side&rdquo; is narrow. The
          probability gap is not: the model is{' '}
          <span className="text-[var(--text-primary)]">{edge.toFixed(4)} Brier</span> better,
          and a bracket is decided by probabilities compounded over four or five rounds, not
          by one pick.
        </p>
      ) : null}
    </section>
  )
}
