import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface SectionHeaderProps {
  /** Small uppercase eyebrow above the title. */
  kicker?: string
  /** Section title (required). */
  title: string
  /** Optional one-line description under the title. */
  description?: string
  /** Optional right-aligned action slot (link/button). */
  action?: ReactNode
  className?: string
}

/**
 * SectionHeader — the standard section lead-in used on every page: an
 * optional uppercase kicker, a bold title, an optional description, and an
 * optional right-aligned action slot. Presentation-only (no client state).
 */
export function SectionHeader({
  kicker,
  title,
  description,
  action,
  className,
}: SectionHeaderProps) {
  return (
    <div className={cn('flex items-end justify-between gap-4', className)}>
      <div className="min-w-0">
        {kicker && (
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
            {kicker}
          </p>
        )}
        <h2 className="text-xl font-bold text-[var(--text-primary)]">{title}</h2>
        {description && (
          <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">
            {description}
          </p>
        )}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  )
}
