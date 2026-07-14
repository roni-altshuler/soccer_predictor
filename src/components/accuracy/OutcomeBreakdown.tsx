'use client'

import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

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
  className?: string
}

const ROWS = [
  { key: 'home', label: 'Home win' },
  { key: 'draw', label: 'Draw' },
  { key: 'away', label: 'Away win' },
] as const

export function OutcomeBreakdown({ home, draw, away, className }: OutcomeBreakdownProps) {
  const byKey = { home, draw, away }
  const rows = ROWS.filter((r) => byKey[r.key].predicted > 0)

  if (rows.length === 0) return null

  return (
    <Card className={cn('p-4 md:p-5', className)}>
      <div className="mb-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
          By outcome
        </p>
        <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
          How often each type of pick was right when it was made.
        </p>
      </div>

      <div className="space-y-2.5">
        {rows.map((r) => {
          const { predicted, correct } = byKey[r.key]
          const precision = correct / predicted
          const pct = Math.round(precision * 100)
          return (
            <div key={r.key} className="flex items-center gap-2.5">
              <span className="w-[68px] shrink-0 text-[12px] font-medium text-[var(--text-primary)]">
                {r.label}
              </span>
              <div
                className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--muted-bg)]"
                role="img"
                aria-label={`${r.label}: ${correct} of ${predicted} picks correct (${pct}%)`}
              >
                <span
                  className="block h-full rounded-full bg-[var(--accent-ai)]/70"
                  style={{ width: `${Math.min(100, Math.max(2, pct))}%` }}
                />
              </div>
              <span className="w-[86px] shrink-0 text-right text-[11px] tabular-nums text-[var(--text-tertiary)]">
                <span className="font-semibold text-[var(--text-secondary)]">{pct}%</span>{' '}
                · {correct}/{predicted}
              </span>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
