import { cn } from '@/lib/utils'

interface LiveBadgeProps {
  /** Optional live-match minute (e.g. "67'" or 67). When provided, rendered next to the dot. */
  minute?: number | string | null
  /** Compact (no text, just the pulsing dot). */
  compact?: boolean
  className?: string
}

/**
 * Live pulse pill — used on match cards and detail headers. Uses the
 * project's `live-pulse` keyframe from globals.css.
 */
export function LiveBadge({ minute, compact = false, className }: LiveBadgeProps) {
  if (compact) {
    return (
      <span
        aria-label="Live"
        className={cn(
          'relative inline-flex h-2 w-2 items-center justify-center',
          className
        )}
      >
        <span className="absolute inset-0 animate-ping rounded-full bg-[var(--accent-loss)] opacity-60" />
        <span className="relative inline-block h-2 w-2 rounded-full bg-[var(--accent-loss)]" />
      </span>
    )
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--accent-loss)_12%,transparent)] px-2 py-0.5 text-caption font-semibold uppercase tracking-[0.18em] text-[var(--accent-loss)] ring-1 ring-[color-mix(in_srgb,var(--accent-loss)_30%,transparent)]',
        className
      )}
    >
      <span className="relative inline-flex h-1.5 w-1.5">
        <span className="absolute inset-0 animate-ping rounded-full bg-[var(--accent-loss)] opacity-70" />
        <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent-loss)]" />
      </span>
      LIVE
      {minute != null ? (
        <span className="ml-0.5 font-mono text-[10px] opacity-90">
          {typeof minute === 'number' ? `${minute}'` : minute}
        </span>
      ) : null}
    </span>
  )
}
