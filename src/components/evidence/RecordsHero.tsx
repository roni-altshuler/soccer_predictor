'use client'

import { StatTile } from '@/components/evidence/primitives'
import { cn } from '@/lib/utils'

/**
 * The two records, side by side and visibly apart.
 *
 * This page has exactly one rule — the historical walk-forward and the live
 * published forecasts are never mixed and never summed — and the old layout
 * expressed it in a sentence while rendering both as identical grey boxes in a
 * vertical stack. The rule is now the layout: two columns, each labelled with
 * what it is and what it is not, with the divider between them doing the work
 * the sentence was doing alone.
 *
 * The live side is usually the smaller number and often zero. It is given
 * equal weight anyway, because the whole point is that the large retrospective
 * number is not evidence about what this site has published.
 */

interface Side {
  eyebrow: string
  n?: number
  brier?: number
  what: string
  /** Shown instead of the numbers when there is no sample at all. */
  empty: string
}

export function RecordsHero({
  historical,
  live,
  className,
}: {
  historical?: { n?: number; brier?: number; protocol?: string }
  live?: { n?: number; brier?: number }
  className?: string
}) {
  const sides: Side[] = [
    {
      eyebrow: 'Historical backtest',
      n: historical?.n,
      brier: historical?.brier,
      what: 'Retrospective. Nobody saw these numbers before those kickoffs.',
      empty: 'No backtest has been generated here.',
    },
    {
      eyebrow: 'Live published',
      n: live?.n,
      brier: live?.brier,
      what: 'The last forecast published before each kickoff, scored after it.',
      empty: 'Nothing scored yet — the correct state before a season starts.',
    },
  ]

  return (
    <section
      className={cn(
        'rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]',
        className,
      )}
      aria-label="The two records"
    >
      <div className="grid divide-y divide-[var(--border-color)] md:grid-cols-2 md:divide-x md:divide-y-0">
        {sides.map((side) => (
          <div key={side.eyebrow} className="px-4 py-4 md:px-5 md:py-5">
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
              {side.eyebrow}
            </div>

            {side.n ? (
              <>
                <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-3">
                  <StatTile
                    label="Brier"
                    value={side.brier != null ? side.brier.toFixed(5) : '—'}
                    size="lead"
                  />
                  <StatTile label="Matches" value={side.n.toLocaleString()} />
                </div>
                <p className="mt-3 max-w-sm text-[12px] leading-relaxed text-[var(--text-secondary)]">
                  {side.what}
                </p>
              </>
            ) : (
              <>
                <div className="mt-3">
                  <StatTile label="Matches" value="0" size="lead" tone="muted" />
                </div>
                <p className="mt-3 max-w-sm text-[12px] leading-relaxed text-[var(--text-tertiary)]">
                  {side.empty}
                </p>
              </>
            )}
          </div>
        ))}
      </div>

      <p className="border-t border-[var(--border-color)] px-4 py-2.5 text-[11px] leading-relaxed text-[var(--text-tertiary)] md:px-5">
        These are two different samples measuring two different things. They are
        never added together, and the left-hand number is not a claim about what
        this site has published.
      </p>
    </section>
  )
}
