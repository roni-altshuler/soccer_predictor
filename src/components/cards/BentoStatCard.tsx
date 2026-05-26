import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

import { BentoCard } from '@/components/magicui/bento-grid'
import { BorderBeam } from '@/components/magicui/border-beam'
import { NumberTicker } from '@/components/magicui/number-ticker'
import { cn } from '@/lib/utils'

interface BentoStatCardProps {
  label: string
  value: number
  decimalPlaces?: number
  suffix?: string
  prefix?: string
  caption?: ReactNode
  Icon?: LucideIcon
  accent?: 'primary' | 'ai' | 'warn' | 'loss' | 'neutral'
  /** When true, wraps in a BorderBeam for marquee positioning. */
  beam?: boolean
  /** Bento span class (e.g. "col-span-2 row-span-2"). */
  span?: string
  className?: string
}

const ACCENT: Record<NonNullable<BentoStatCardProps['accent']>, string> = {
  primary: 'text-[var(--accent-primary)]',
  ai: 'text-[var(--accent-ai)]',
  warn: 'text-[var(--accent-warn)]',
  loss: 'text-[var(--accent-loss)]',
  neutral: 'text-[var(--text-primary)]',
}

/**
 * Bento-grid-friendly metric card with optional BorderBeam for marquee cells.
 * Use inside `<BentoGrid>`.
 */
export function BentoStatCard({
  label,
  value,
  decimalPlaces = 0,
  suffix,
  prefix,
  caption,
  Icon,
  accent = 'neutral',
  beam = false,
  span,
  className,
}: BentoStatCardProps) {
  const tone = ACCENT[accent]
  return (
    <BentoCard className={cn(span, className)}>
      <div className="relative z-10 flex h-full flex-col justify-between p-5">
        <div className="flex items-center gap-2 text-caption uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
          {Icon ? <Icon className={cn('h-3.5 w-3.5', tone)} aria-hidden /> : null}
          {label}
        </div>
        <NumberTicker
          value={value}
          decimalPlaces={decimalPlaces}
          prefix={prefix}
          suffix={suffix}
          className={cn('text-display font-extrabold tabular-nums', tone)}
        />
        {caption ? (
          <p className="text-small text-[var(--text-tertiary)]">{caption}</p>
        ) : null}
      </div>
      {beam ? <BorderBeam size={1} duration={9} borderRadius={8} /> : null}
    </BentoCard>
  )
}
