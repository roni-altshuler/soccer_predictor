'use client'

import Link from 'next/link'

import { getLeagueAccent } from '@/lib/leagueAccents'
import { cn } from '@/lib/utils'

import { LeagueMark } from './LeagueMark'

interface LeagueChipProps {
  /** Competition id (used for accent + crest mapping). */
  leagueId?: string
  /** Display name (required) — also the monogram source. */
  name: string
  /** Active/selected state — adds an accent ring + tinted bg. */
  active?: boolean
  /** Click handler — renders a <button>. */
  onClick?: () => void
  /** Link target — renders a <Link> (takes precedence over onClick markup). */
  href?: string
  /** Density. */
  size?: 'sm' | 'md'
  className?: string
}

/**
 * LeagueChip — a league pill with crest (or accent-tinted monogram) + name.
 * No emoji. Renders as a <Link> when `href` is set, a <button> when `onClick`
 * is set, else a static <span>. Active state gets an accent ring + faint
 * accent-tinted background.
 */
export function LeagueChip({
  leagueId,
  name,
  active = false,
  onClick,
  href,
  size = 'md',
  className,
}: LeagueChipProps) {
  const accent = getLeagueAccent(leagueId ?? name)

  // The crest comes from `leagueAccents` — the single source of truth. This
  // component used to keep its own ESPN id table, which had drifted to cover
  // only the eight domestic leagues, so every cup and every women's
  // competition silently fell back to a monogram.
  const mark =
    accent.competitionId !== 'unknown' && accent.logoUrl ? (
      <LeagueMark league={accent.competitionId} size="xs" />
    ) : (
      <span
        aria-hidden
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] font-bold uppercase"
        style={{
          backgroundColor: `color-mix(in srgb, ${accent.accent} 22%, transparent)`,
          color: accent.accent,
        }}
      >
        {name.trim().charAt(0).toUpperCase() || '?'}
      </span>
    )

  const baseClass = cn(
    'inline-flex min-h-[40px] items-center gap-2 rounded-full border font-semibold transition-colors',
    size === 'sm' ? 'px-3 text-xs' : 'px-3.5 text-sm',
    'bg-[var(--card-bg)] text-[var(--text-primary)]',
    active
      ? 'ring-1'
      : 'border-[var(--border-color)] hover:border-[var(--border-hover)]',
    className
  )

  const activeStyle = active
    ? {
        borderColor: accent.accent,
        boxShadow: `0 0 0 1px ${accent.accent}`,
        backgroundColor: `color-mix(in srgb, ${accent.accent} 10%, var(--card-bg))`,
      }
    : undefined

  const inner = (
    <>
      {mark}
      <span className="truncate">{name}</span>
    </>
  )

  if (href) {
    return (
      <Link href={href} className={baseClass} style={activeStyle} aria-current={active ? 'true' : undefined}>
        {inner}
      </Link>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={baseClass}
      style={activeStyle}
      aria-pressed={active}
    >
      {inner}
    </button>
  )
}
