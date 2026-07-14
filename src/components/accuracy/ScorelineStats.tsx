'use client'

import { AnimatedNumber } from '@/components/motion'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/**
 * Scoreline intelligence band — one slim card for the exact-score side of
 * the record: exact scoreline hit rate, top-5 scoreline coverage, and (when
 * the tracker reports it) the average goals error. Each stat renders only
 * when its data genuinely exists — a zeroed placeholder field renders
 * nothing (design rule 5).
 */

interface ScorelineStatsProps {
  /** Exact scoreline hit rate 0..1. */
  exactRate: number
  exactCount: number
  /** Settled picks the exact rate is measured over. */
  completed: number
  /** Top-5 scoreline coverage 0..1 — hidden when eligible = 0. */
  top5Rate: number
  top5Count: number
  top5Eligible: number
  /** Avg absolute goals error — hidden when missing or zeroed. */
  avgGoalsError?: number | null
  className?: string
}

export function ScorelineStats({
  exactRate,
  exactCount,
  completed,
  top5Rate,
  top5Count,
  top5Eligible,
  avgGoalsError,
  className,
}: ScorelineStatsProps) {
  const showExact = completed > 0
  const showTop5 = top5Eligible > 0
  const showGoalsError = typeof avgGoalsError === 'number' && avgGoalsError > 0

  if (!showExact && !showTop5 && !showGoalsError) return null

  return (
    <Card className={cn('p-4 md:p-5', className)}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
        Scoreline picks
      </p>
      <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {showExact && (
          <div>
            <p className="text-xl font-black tabular-nums leading-tight text-[var(--text-primary)]">
              <AnimatedNumber value={exactRate * 100} decimals={1} suffix="%" />
            </p>
            <p className="mt-0.5 text-[12px] font-medium text-[var(--text-secondary)]">
              Exact scoreline
            </p>
            <p className="text-[11px] tabular-nums text-[var(--text-tertiary)]">
              {exactCount.toLocaleString()} of {completed.toLocaleString()} settled picks
            </p>
          </div>
        )}
        {showTop5 && (
          <div>
            <p className="text-xl font-black tabular-nums leading-tight text-[var(--text-primary)]">
              <AnimatedNumber value={top5Rate * 100} decimals={1} suffix="%" />
            </p>
            <p className="mt-0.5 text-[12px] font-medium text-[var(--text-secondary)]">
              Final score in top 5
            </p>
            <p className="text-[11px] tabular-nums text-[var(--text-tertiary)]">
              {top5Count.toLocaleString()} of {top5Eligible.toLocaleString()} eligible picks
            </p>
          </div>
        )}
        {showGoalsError && (
          <div>
            <p className="text-xl font-black tabular-nums leading-tight text-[var(--text-primary)]">
              <AnimatedNumber value={avgGoalsError} decimals={2} />
            </p>
            <p className="mt-0.5 text-[12px] font-medium text-[var(--text-secondary)]">
              Avg goals error
            </p>
            <p className="text-[11px] text-[var(--text-tertiary)]">
              Average distance from the real score
            </p>
          </div>
        )}
      </div>
    </Card>
  )
}
