import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type StatAccent = 'primary' | 'ai' | 'warn' | 'loss' | 'market' | 'none'

interface StatCardProps {
  /** Kicker-style label above the value. */
  label: string
  /** Big headline value. */
  value: ReactNode
  /** Optional small caption below the value. */
  sub?: ReactNode
  /** Accent tint applied to the value + a left rail. */
  accent?: StatAccent
  /** Density: md (default) or sm for tight rows. */
  size?: 'md' | 'sm'
  className?: string
}

const ACCENT_VAR: Record<Exclude<StatAccent, 'none'>, string> = {
  primary: 'var(--accent-primary)',
  ai: 'var(--accent-ai)',
  warn: 'var(--accent-warn)',
  loss: 'var(--accent-loss)',
  market: 'var(--accent-market)',
}

/**
 * StatCard — a single card-surface metric: kicker label, big tabular value,
 * optional caption. `accent` tints the value colour and adds a 3px left rail
 * in the matching accent. Fixed min-height so cards in a grid line up.
 */
export function StatCard({
  label,
  value,
  sub,
  accent = 'none',
  size = 'md',
  className,
}: StatCardProps) {
  const accentColor = accent === 'none' ? undefined : ACCENT_VAR[accent]

  return (
    <div
      className={cn(
        'relative flex flex-col justify-center overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]',
        size === 'sm' ? 'min-h-[76px] px-3 py-2.5' : 'min-h-[104px] px-4 py-3.5',
        className
      )}
    >
      {accentColor && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[3px] rounded-l-xl"
          style={{ backgroundColor: accentColor }}
        />
      )}
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
        {label}
      </p>
      <p
        className={cn(
          'mt-1 font-black tabular-nums leading-tight',
          size === 'sm' ? 'text-xl' : 'text-3xl'
        )}
        style={{ color: accentColor ?? 'var(--text-primary)' }}
      >
        {value}
      </p>
      {sub && (
        <p className="mt-1 text-xs text-[var(--text-tertiary)]">{sub}</p>
      )}
    </div>
  )
}
