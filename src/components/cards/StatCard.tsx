import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { TrendingDown, TrendingUp } from 'lucide-react'

import { NumberTicker } from '@/components/magicui/number-ticker'
import { cn } from '@/lib/utils'

interface StatCardProps {
  /** Eyebrow label. */
  label: string
  /** Primary numeric value. */
  value: number
  /** Decimal places (default 0). */
  decimalPlaces?: number
  /** Optional suffix appended to the number (e.g. "%"). */
  suffix?: string
  /** Optional prefix prepended to the number. */
  prefix?: string
  /** Caption rendered under the value. */
  caption?: string
  /** Delta vs reference period, in same unit as value. Renders an arrow. */
  delta?: number
  /** Lucide icon. */
  Icon?: LucideIcon
  /** Visual accent — drives icon + delta tint. */
  accent?: 'primary' | 'ai' | 'warn' | 'loss' | 'neutral'
  /** Optional trailing slot (sparkline, mini chart). */
  trailing?: ReactNode
  className?: string
}

const ACCENT: Record<NonNullable<StatCardProps['accent']>, string> = {
  primary: 'text-[var(--accent-primary)]',
  ai: 'text-[var(--accent-ai)]',
  warn: 'text-[var(--accent-warn)]',
  loss: 'text-[var(--accent-loss)]',
  neutral: 'text-[var(--text-primary)]',
}

export function StatCard({
  label,
  value,
  decimalPlaces = 0,
  suffix,
  prefix,
  caption,
  delta,
  Icon,
  accent = 'neutral',
  trailing,
  className,
}: StatCardProps) {
  const tone = ACCENT[accent]
  const deltaUp = typeof delta === 'number' && delta > 0
  const deltaDown = typeof delta === 'number' && delta < 0
  return (
    <div
      className={cn(
        'rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 transition-colors',
        'hover:border-[var(--border-color-hover)]',
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-caption font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
          {label}
        </p>
        {Icon ? <Icon className={cn('h-4 w-4', tone)} aria-hidden /> : null}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <NumberTicker
          value={value}
          decimalPlaces={decimalPlaces}
          prefix={prefix}
          suffix={suffix}
          className={cn('text-h2 font-extrabold tabular-nums', tone)}
        />
        {typeof delta === 'number' ? (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 text-caption font-mono',
              deltaUp && 'text-[var(--accent-primary)]',
              deltaDown && 'text-[var(--accent-loss)]',
              !deltaUp && !deltaDown && 'text-[var(--text-tertiary)]'
            )}
          >
            {deltaUp ? <TrendingUp className="h-3 w-3" /> : null}
            {deltaDown ? <TrendingDown className="h-3 w-3" /> : null}
            {delta > 0 ? '+' : ''}
            {delta.toFixed(decimalPlaces)}
            {suffix}
          </span>
        ) : null}
      </div>
      {caption ? (
        <p className="mt-1 text-small text-[var(--text-tertiary)]">{caption}</p>
      ) : null}
      {trailing ? <div className="mt-2">{trailing}</div> : null}
    </div>
  )
}
