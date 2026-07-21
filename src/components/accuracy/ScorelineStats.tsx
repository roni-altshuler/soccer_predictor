'use client'

import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

import { MIN_RATE_SAMPLE, count, pct1, samplePhrase } from './accuracyMetrics'

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
  /** Render bare, without the card chrome (used inside the deep-cuts tabs). */
  embedded?: boolean
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
  embedded = false,
  className,
}: ScorelineStatsProps) {
  const showExact = completed > 0
  const showTop5 = top5Eligible > 0
  const showGoalsError = typeof avgGoalsError === 'number' && avgGoalsError > 0

  if (!showExact && !showTop5 && !showGoalsError) return null

  // The top-5 list is only stored on part of the record, so its denominator
  // is much smaller than the settled total — often a few dozen picks. State
  // that plainly instead of letting "50%" stand beside a 1,429-pick rate.
  const top5Thin = showTop5 && top5Eligible < MIN_RATE_SAMPLE * 5

  const body = (
    <>
      <p className="mb-3 text-[12px] leading-snug text-[var(--text-secondary)]">
        Calling the winner is one thing; calling the exact score is much harder.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {showExact && (
          <Stat
            value={pct1(exactRate)}
            label="Exact final score"
            note={`${count(exactCount)} of ${samplePhrase(completed)}`}
          />
        )}
        {showTop5 && (
          <Stat
            value={pct1(top5Rate)}
            label="Score among the five most likely"
            note={`${count(top5Count)} of ${count(top5Eligible)} picks that listed five`}
            caveat={top5Thin ? 'Small sample' : undefined}
          />
        )}
        {showGoalsError && (
          <Stat
            value={avgGoalsError.toFixed(2)}
            label="Average goals out"
            note="Typical distance from the real score"
          />
        )}
      </div>
    </>
  )

  if (embedded) return <div className={className}>{body}</div>

  return <Card className={cn('p-4 md:p-5', className)}>{body}</Card>
}

function Stat({
  value,
  label,
  note,
  caveat,
}: {
  value: string
  label: string
  note: string
  caveat?: string
}) {
  return (
    <div>
      <p className="flex flex-wrap items-baseline gap-2">
        <span className="text-xl font-bold leading-tight tabular-nums text-[var(--text-primary)]">
          {value}
        </span>
        {caveat && (
          <span className="rounded bg-[var(--muted-bg)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-tertiary)]">
            {caveat}
          </span>
        )}
      </p>
      <p className="mt-0.5 text-[12px] font-medium text-[var(--text-secondary)]">{label}</p>
      <p className="text-[11px] tabular-nums text-[var(--text-tertiary)]">{note}</p>
    </div>
  )
}
