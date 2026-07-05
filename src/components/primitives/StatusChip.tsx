import { cn } from '@/lib/utils'

type Status =
  | 'live'
  | 'pending'
  | 'correct'
  | 'incorrect'
  | 'settled'
  | 'upcoming'

interface StatusChipProps {
  status: Status
  /** Override the default label text. */
  label?: string
  className?: string
}

interface StatusStyle {
  /** Accent CSS var, or a literal for tertiary. */
  color: string
  /** Default lowercase label. */
  label: string
  /** Pulse the dot (live only). */
  pulse?: boolean
}

const STATUS_STYLES: Record<Status, StatusStyle> = {
  live: { color: 'var(--accent-loss)', label: 'live', pulse: true },
  pending: { color: 'var(--accent-warn)', label: 'pending' },
  upcoming: { color: 'var(--accent-warn)', label: 'upcoming' },
  correct: { color: 'var(--accent-primary)', label: 'correct' },
  incorrect: { color: 'var(--accent-loss)', label: 'incorrect' },
  settled: { color: 'var(--text-tertiary)', label: 'settled' },
}

/**
 * StatusChip — a dot + lowercase label with a subtle accent-tinted background
 * (never full saturation). Live pulses its dot (gated on reduced motion).
 * pending/upcoming render at 70% opacity to read as provisional.
 */
export function StatusChip({ status, label, className }: StatusChipProps) {
  const style = STATUS_STYLES[status]
  const provisional = status === 'pending' || status === 'upcoming'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold lowercase tracking-wide',
        provisional && 'opacity-70',
        className
      )}
      style={{
        color: style.color,
        backgroundColor: `color-mix(in srgb, ${style.color} 12%, transparent)`,
      }}
    >
      <span
        className={cn(
          'inline-block h-1.5 w-1.5 rounded-full',
          style.pulse && 'motion-safe:animate-pulse'
        )}
        style={{ backgroundColor: style.color }}
        aria-hidden
      />
      {label ?? style.label}
    </span>
  )
}
