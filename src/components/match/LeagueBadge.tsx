'use client'

import { Trophy } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { getLeagueAccent } from '@/lib/leagueAccents'
import { cn } from '@/lib/utils'

/**
 * Small league identity badge — accent-coloured ring + short name, plus an
 * optional gender chip when displaying the women's universe so it's clear
 * which competition we're showing. Replaces the bare ⚽ emoji fallback that
 * previously appeared on every LeagueSection header.
 */
export interface LeagueBadgeProps {
  /** Warehouse competition_id (preferred) or display name. */
  league: string | null | undefined
  /** Size of the badge container. `sm` = inline pill, `md` = card header. */
  size?: 'sm' | 'md'
  className?: string
  /** Force a gender chip even when the accent is the default (used after a toggle). */
  showGender?: boolean
}

export function LeagueBadge({ league, size = 'sm', className, showGender = false }: LeagueBadgeProps) {
  const accent = getLeagueAccent(league)
  const isWomen = accent.gender === 'F'
  const dimensions = size === 'md' ? 'h-7 px-2.5 text-[11px]' : 'h-5 px-2 text-[10px]'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-semibold uppercase tracking-wider',
        'border ring-1 ring-inset',
        dimensions,
        className
      )}
      style={{
        background: accent.accentBg,
        color: accent.accent,
        borderColor: accent.accent + '33',
      }}
      title={`${accent.displayName}${accent.country ? ` · ${accent.country}` : ''}`}
    >
      {accent.logoUrl ? (
        <img src={accent.logoUrl} alt="" className={cn(size === 'md' ? 'h-4 w-4' : 'h-3 w-3')} aria-hidden="true" />
      ) : (
        <Trophy className={cn(size === 'md' ? 'h-3.5 w-3.5' : 'h-2.5 w-2.5')} strokeWidth={2.5} />
      )}
      <span className="truncate">{accent.shortName}</span>
      {(isWomen || showGender) && (
        <Badge
          variant="outline"
          className={cn(
            'border-current bg-transparent px-1 text-[9px] leading-none',
            size === 'md' ? 'h-4' : 'h-3.5'
          )}
        >
          {isWomen ? 'W' : 'M'}
        </Badge>
      )}
    </span>
  )
}
