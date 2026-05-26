'use client'

import { cn } from '@/lib/utils'

interface RatingPillProps {
  /** AI impact score, 0–10 scale. */
  value: number
  /** Compact (omits the trailing slash + 10 reference). */
  compact?: boolean
  className?: string
}

function tierTokens(value: number): { bg: string; fg: string } {
  if (value >= 7.5) return { bg: 'var(--rating-bg-high)', fg: 'var(--accent-primary)' }
  if (value >= 5) return { bg: 'var(--rating-bg-mid)', fg: 'var(--accent-warn)' }
  return { bg: 'var(--rating-bg-low)', fg: 'var(--text-secondary)' }
}

/**
 * RatingPill — 0–10 AI impact score badge for FormationDisplay v2 player
 * nodes (Phase 2.C). Reads `--rating-bg-{high,mid,low}` tokens added in
 * Phase 0.A.
 *
 * Mirrors FotMob's player rating chip in shape and size, but the underlying
 * value is our AI impact score rather than journalist-graded performance.
 */
export function RatingPill({ value, compact, className }: RatingPillProps) {
  const clamped = Math.max(0, Math.min(10, value))
  const display = clamped.toFixed(1)
  const { bg, fg } = tierTokens(clamped)
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-md px-1.5 py-0.5 font-numeric tabular-nums',
        compact ? 'text-[10px]' : 'text-meta',
        'font-semibold',
        className,
      )}
      style={{ background: bg, color: fg }}
      aria-label={`AI impact ${display} out of 10`}
    >
      {display}
      {!compact && <span className="opacity-50">/10</span>}
    </span>
  )
}
