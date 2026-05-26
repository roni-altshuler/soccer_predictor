import { cn } from '@/lib/utils'
import { clamp } from '@/lib/utils'

interface ConfidencePillProps {
  /** Model confidence on a 0..1 scale. */
  value: number
  /** Optional label override (default: "Confidence"). */
  label?: string
  /** When true, only renders the colored dot + percentage. */
  compact?: boolean
  className?: string
}

function bandFor(pct: number): { tone: 'low' | 'mid' | 'high'; label: string } {
  if (pct < 45) return { tone: 'low', label: 'Low' }
  if (pct < 65) return { tone: 'mid', label: 'Moderate' }
  return { tone: 'high', label: 'High' }
}

/**
 * Confidence chip — color-banded by model confidence (low/mid/high) using
 * the project's accent tokens.
 */
export function ConfidencePill({ value, label, compact, className }: ConfidencePillProps) {
  const pct = Math.round(clamp(value) * 100)
  const band = bandFor(pct)
  const toneClass =
    band.tone === 'high'
      ? 'bg-[var(--accent-primary)]/12 text-[var(--accent-primary)] ring-[var(--accent-primary)]/30'
      : band.tone === 'mid'
        ? 'bg-[var(--accent-ai)]/12 text-[var(--accent-ai)] ring-[var(--accent-ai)]/30'
        : 'bg-[var(--accent-warn)]/12 text-[var(--accent-warn)] ring-[var(--accent-warn)]/30'

  if (compact) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-caption font-mono ring-1 tabular-nums',
          toneClass,
          className
        )}
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
        {pct}%
      </span>
    )
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-caption font-semibold uppercase tracking-[0.16em] ring-1',
        toneClass,
        className
      )}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
      {label ?? 'Confidence'} · {band.label} · {pct}%
    </span>
  )
}
