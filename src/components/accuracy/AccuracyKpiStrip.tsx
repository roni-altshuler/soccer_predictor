'use client'

import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

import {
  BRIER_SUMMED_FROM_MEAN,
  EVEN_ODDS_PROBABILITY_SCORE,
  MIN_RATE_SAMPLE,
  count,
  pct1,
  score3,
} from './accuracyMetrics'

/**
 * The supporting numbers, as one flat strip rather than five competing
 * cards. Each cell states its own denominator, because a rate without its
 * sample is the thing that made the old strip untrustworthy — the women's
 * universe rendered "Last 29 picks 48.3%" beside a headline of 48.3% from
 * 29 picks, i.e. the same number twice.
 *
 * Cells whose data does not exist are dropped, never zero-filled.
 */

interface AccuracyKpiStripProps {
  settled: number
  /** Mean squared probability error 0..1 — null hides the cell. */
  probabilityScore: number | null
  /** Expected calibration gap 0..1 — null hides the cell. */
  calibrationGap: number | null
  /** Hit rate over the trailing window 0..1. */
  recentAccuracy: number
  /** How many picks the trailing window actually covers. */
  recentWindow: number
  className?: string
}

interface Cell {
  key: string
  label: string
  value: string
  sub: string
  /** Optional signed chip rendered beside the value. */
  chip?: { text: string; tone: 'good' | 'bad' }
}

export function AccuracyKpiStrip({
  settled,
  probabilityScore,
  calibrationGap,
  recentAccuracy,
  recentWindow,
  className,
}: AccuracyKpiStripProps) {
  const cells: Cell[] = []

  cells.push({
    key: 'settled',
    label: 'Sample',
    value: count(settled),
    sub: 'Picks scored against a final result',
  })

  if (probabilityScore !== null) {
    // The tracking route emits the mean-over-classes Brier; scale it to the
    // summed convention the rest of the project uses, so this cell and the
    // market-benchmark panel below it are the same quantity on the same axis.
    const summed = probabilityScore * BRIER_SUMMED_FROM_MEAN
    // Lower is better, so an improvement is a negative delta.
    const delta = summed - EVEN_ODDS_PROBABILITY_SCORE
    cells.push({
      key: 'probability',
      label: 'Probability score',
      value: score3(summed),
      sub: `Lower is better · even odds scores ${score3(EVEN_ODDS_PROBABILITY_SCORE)}`,
      chip: {
        text: `${delta < 0 ? '−' : '+'}${Math.abs(delta).toFixed(3)}`,
        tone: delta < 0 ? 'good' : 'bad',
      },
    })
  }

  if (calibrationGap !== null) {
    cells.push({
      key: 'calibration',
      label: 'Calibration gap',
      value: `±${(calibrationGap * 100).toFixed(1)} pts`,
      sub: 'Average distance between a stated chance and what happened',
    })
  }

  if (recentWindow >= MIN_RATE_SAMPLE && recentWindow < settled) {
    cells.push({
      key: 'recent',
      label: `Last ${count(recentWindow)}`,
      value: pct1(recentAccuracy),
      sub: `Hit rate over the ${count(recentWindow)} most recent settled picks`,
    })
  }

  if (cells.length === 0) return null

  return (
    <Card className={cn('overflow-hidden p-0', className)}>
      <dl className="grid grid-cols-1 divide-y divide-[var(--border-color)] sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4">
        {cells.map((cell, i) => (
          <div
            key={cell.key}
            className={cn(
              'px-4 py-3',
              // Vertical hairlines only where a column boundary actually exists.
              i > 0 && 'sm:border-l sm:border-[var(--border-color)]',
              i === 2 && 'sm:border-l-0 lg:border-l',
              i >= 2 && 'sm:border-t sm:border-[var(--border-color)] lg:border-t-0'
            )}
          >
            <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
              {cell.label}
            </dt>
            <dd className="mt-1 flex flex-wrap items-baseline gap-2">
              <span className="text-[22px] font-bold leading-none tabular-nums text-[var(--text-primary)]">
                {cell.value}
              </span>
              {cell.chip && (
                <span
                  className={cn(
                    'rounded px-1 py-0.5 text-[10px] font-bold tabular-nums',
                    cell.chip.tone === 'good'
                      ? 'bg-[var(--accent-primary)]/12 text-[var(--accent-primary)]'
                      : 'bg-[var(--accent-warn)]/14 text-[var(--accent-warn)]'
                  )}
                >
                  {cell.chip.text}
                </span>
              )}
            </dd>
            <dd className="mt-1 text-[11px] leading-snug text-[var(--text-tertiary)]">{cell.sub}</dd>
          </div>
        ))}
      </dl>
    </Card>
  )
}
