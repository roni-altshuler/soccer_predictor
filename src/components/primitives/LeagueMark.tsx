'use client'

import { Trophy } from 'lucide-react'

import { getLeagueAccent } from '@/lib/leagueAccents'
import { cn } from '@/lib/utils'

/**
 * A competition's real badge, seated on a light plate.
 *
 * Competition marks are authored for light backgrounds: the Premier League's
 * purple (#37003c), Ligue 1's navy and the MLS crest all disappear against the
 * dark surface. Every product in our reference class (FotMob, ESPN) solves this
 * the same way — a light tile under the mark — so `--logo-plate` stays light in
 * both themes and the hairline ring is what separates it from the card.
 *
 * Falls back to a neutral trophy only when a competition genuinely has no
 * artwork. That path should now be rare: every competition in `leagueAccents`
 * carries a verified `logoUrl`.
 */

const SIZES = {
  sm: { box: 'h-7 w-7 rounded-md', img: 'h-4 w-4', icon: 'h-3.5 w-3.5' },
  md: { box: 'h-9 w-9 rounded-lg', img: 'h-6 w-6', icon: 'h-4 w-4' },
  lg: { box: 'h-11 w-11 rounded-xl', img: 'h-7 w-7', icon: 'h-5 w-5' },
} as const

export interface LeagueMarkProps {
  /** Warehouse competition_id (preferred) or display name. */
  league: string | null | undefined
  size?: keyof typeof SIZES
  className?: string
}

export function LeagueMark({ league, size = 'md', className }: LeagueMarkProps) {
  const accent = getLeagueAccent(league)
  const s = SIZES[size]

  return (
    <span
      className={cn('flex shrink-0 items-center justify-center', s.box, className)}
      style={{ background: 'var(--logo-plate)', boxShadow: 'inset 0 0 0 1px var(--logo-plate-ring)' }}
      title={`${accent.displayName}${accent.country ? ` · ${accent.country}` : ''}`}
    >
      {accent.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={accent.logoUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className={cn('object-contain', s.img)}
          aria-hidden="true"
        />
      ) : (
        <Trophy className={cn(s.icon, 'text-[#6d6d78]')} strokeWidth={2} aria-hidden="true" />
      )}
    </span>
  )
}
