'use client'

import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

interface MetaChipProps {
  /** Lucide icon to render inside the chip. Optional. */
  icon?: LucideIcon
  /** Chip label — short string ("Anfield", "41,841 attendance"). */
  children: React.ReactNode
  /** Optional clickable href; renders as an anchor when present. */
  href?: string
  /** External link target — only honoured when href is set. */
  external?: boolean
  className?: string
}

/**
 * MetaChip — small inline container for match metadata (venue, attendance,
 * referee, weather). Reads `--meta-chip-bg` token introduced in Phase 0.A.
 *
 * FotMob-style: rounded-full, 13px non-uppercase text, low-contrast surface,
 * optional inline lucide icon. Replaces the ad-hoc 10–11px uppercase tracking
 * spans that pepper the match-detail page today.
 */
export function MetaChip({ icon: Icon, children, href, external, className }: MetaChipProps) {
  const inner = (
    <>
      {Icon && <Icon className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />}
      <span className="truncate">{children}</span>
    </>
  )

  const baseClasses = cn(
    'inline-flex items-center gap-1.5 rounded-full border border-[var(--border-color)] px-3 py-1',
    'text-meta text-[var(--text-secondary)] transition-colors',
    href && 'hover:border-[var(--border-hover)] hover:text-[var(--text-primary)]',
    className,
  )

  if (href) {
    return (
      <a
        href={href}
        target={external ? '_blank' : undefined}
        rel={external ? 'noopener noreferrer' : undefined}
        className={baseClasses}
        style={{ background: 'var(--meta-chip-bg)' }}
      >
        {inner}
      </a>
    )
  }

  return (
    <span className={baseClasses} style={{ background: 'var(--meta-chip-bg)' }}>
      {inner}
    </span>
  )
}
