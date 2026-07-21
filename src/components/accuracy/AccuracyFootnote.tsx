'use client'

import { cn } from '@/lib/utils'

import { RANDOM_WINNER_RATE, pct1 } from './accuracyMetrics'

/**
 * How to read the page, as a footnote rather than a feature block.
 *
 * This replaces a three-card grid with circled icons that sat at the bottom
 * of the page — the "AI-startup landing page" pattern the design language
 * explicitly rejects. The content was worth keeping; the packaging was not.
 */

export function AccuracyFootnote({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-3.5 md:px-5',
        className
      )}
    >
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
        How to read this
      </h2>
      <div className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-[var(--text-secondary)]">
        <p>
          Every pick is recorded before kick-off and scored against the final result. Nothing is
          edited afterwards, and picks that were never settled are excluded from the rates rather
          than counted as misses.
        </p>
        <p>
          The headline is the share of matches where the called outcome — home win, draw or away
          win — actually happened. Picking one of the three at random lands {pct1(
            RANDOM_WINNER_RATE
          )}{' '}
          of the time, so that is the line worth beating.
        </p>
        <p>
          Percentages are chances, not promises. A pick given a 70% chance is meant to be wrong
          about three times in ten — the chart above checks whether that actually holds.
        </p>
      </div>
    </div>
  )
}
