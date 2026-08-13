'use client'

import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

import { MIN_RATE_SAMPLE, count, pct0 } from './accuracyMetrics'

/**
 * By-outcome precision strip — for each pick type (home / draw / away),
 * how many times it was picked and how many of those picks landed. All
 * counts come straight from the tracker; a pick type that was never
 * chosen renders nothing (design rule 5 — no fabricated rows).
 */

export interface OutcomeCounts {
  predicted: number
  correct: number
}

interface OutcomeBreakdownProps {
  home: OutcomeCounts
  draw: OutcomeCounts
  away: OutcomeCounts
  /** Render bare, without the card chrome (used inside the deep-cuts tabs). */
  embedded?: boolean
  className?: string
}

const ROWS = [
  { key: 'home', label: 'Home win' },
  { key: 'draw', label: 'Draw' },
  { key: 'away', label: 'Away win' },
] as const

export function OutcomeBreakdown({
  home,
  draw,
  away,
  embedded = false,
  className,
}: OutcomeBreakdownProps) {
  const byKey = { home, draw, away }
  const rows = ROWS.filter((r) => byKey[r.key].predicted > 0)

  if (rows.length === 0) return null

  const body = (
    <>
      <p className="mb-3 text-[12px] leading-snug text-[var(--text-secondary)]">
        When each type of pick was made, how often it was right.
      </p>

      <div className="space-y-2.5">
        {rows.map((r) => {
          const { predicted, correct } = byKey[r.key]
          const rate = correct / predicted
          // One or two picks of a type produce a 0% / 100% bar that reads
          // like a finding. Show the counts, withhold the rate.
          const readable = predicted >= MIN_RATE_SAMPLE
          return (
            <div key={r.key} className="flex items-center gap-2.5">
              <span className="w-[68px] shrink-0 text-[12px] font-medium text-[var(--text-primary)]">
                {r.label}
              </span>
              <div
                className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--muted-bg)]"
                role="img"
                aria-label={
                  readable
                    ? `${r.label}: ${correct} of ${predicted} picks correct, ${pct0(rate)}`
                    : `${r.label}: ${correct} of ${predicted} picks correct — too few to rate`
                }
              >
                {readable && (
                  <span
                    className="block h-full rounded-full bg-[color-mix(in_srgb,var(--accent-ai)_70%,transparent)]"
                    style={{ width: `${Math.min(100, Math.max(2, rate * 100))}%` }}
                  />
                )}
              </div>
              <span className="w-[92px] shrink-0 text-right text-[11px] tabular-nums text-[var(--text-tertiary)]">
                {readable ? (
                  <>
                    <span className="font-semibold text-[var(--text-secondary)]">{pct0(rate)}</span>{' '}
                    · {count(correct)}/{count(predicted)}
                  </>
                ) : (
                  <>
                    {count(correct)}/{count(predicted)}{' '}
                    <span className="opacity-70">· too few</span>
                  </>
                )}
              </span>
            </div>
          )
        })}
      </div>
    </>
  )

  if (embedded) return <div className={className}>{body}</div>

  return <Card className={cn('p-4 md:p-5', className)}>{body}</Card>
}
