'use client'

import { cn, clamp } from '@/lib/utils'

/**
 * bet365-grammar 1X2 probability boxes: three fixed-width cells labeled
 * 1 / X / 2 showing outcome percentages, with the model's pick tinted cyan.
 *
 * Render ONLY when a committed prediction exists — the caller must not
 * fabricate probabilities (design-language rule 5).
 */
export interface Prob1X2Props {
  home: number
  draw: number
  away: number
  /** Compact renders a single argmax box (mobile list rows). */
  compact?: boolean
  className?: string
}

const LABELS = ['1', 'X', '2'] as const

export function Prob1X2({ home, draw, away, compact = false, className }: Prob1X2Props) {
  const probs = [clamp(home), clamp(draw), clamp(away)]
  const maxIdx = probs.indexOf(Math.max(...probs))

  const cells = compact ? [maxIdx] : [0, 1, 2]

  return (
    <div className={cn('flex items-center gap-1', className)} aria-label="Model outcome probabilities">
      {cells.map((i) => {
        const isPick = i === maxIdx
        return (
          <span
            key={LABELS[i]}
            className={cn(
              'flex h-8 w-[42px] flex-col items-center justify-center rounded-md border leading-none',
              isPick
                ? 'border-[color-mix(in_srgb,var(--accent-ai)_45%,transparent)] bg-[color-mix(in_srgb,var(--accent-ai)_12%,transparent)]'
                : 'border-[var(--border-color)] bg-[color-mix(in_srgb,var(--muted-bg)_60%,transparent)]'
            )}
          >
            <span
              className={cn(
                'text-[9px] font-semibold',
                isPick ? 'text-[var(--accent-ai)]' : 'text-[var(--text-tertiary)]'
              )}
            >
              {LABELS[i]}
            </span>
            <span
              className={cn(
                'mt-0.5 text-[11px] font-bold tabular-nums',
                isPick ? 'text-[var(--accent-ai)]' : 'text-[var(--text-secondary)]'
              )}
            >
              {Math.round(probs[i] * 100)}
            </span>
          </span>
        )
      })}
    </div>
  )
}
