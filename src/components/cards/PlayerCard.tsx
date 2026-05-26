import Link from 'next/link'

import { PlayerAvatar } from '@/components/primitives/PlayerAvatar'
import { cn } from '@/lib/utils'

interface PlayerCardProps {
  playerId?: number | string
  name: string
  /** Display position (GK, CB, RB, RM, CF, …). */
  position?: string
  shirtNumber?: number
  /** Optional rating 0..10 — renders a small chip. */
  rating?: number
  teamColor?: string
  href?: string
  className?: string
}

function ratingTone(r: number): string {
  if (r >= 7.5) return 'text-[var(--accent-primary)] bg-[var(--accent-primary)]/12 ring-[var(--accent-primary)]/30'
  if (r >= 6.5) return 'text-[var(--accent-ai)] bg-[var(--accent-ai)]/12 ring-[var(--accent-ai)]/30'
  return 'text-[var(--accent-warn)] bg-[var(--accent-warn)]/12 ring-[var(--accent-warn)]/30'
}

export function PlayerCard({
  playerId,
  name,
  position,
  shirtNumber,
  rating,
  teamColor,
  href,
  className,
}: PlayerCardProps) {
  const inner = (
    <div
      className={cn(
        'group flex items-center gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-3 transition-colors hover:border-[var(--border-color-hover)]',
        className
      )}
    >
      <PlayerAvatar playerId={playerId} name={name} size={42} teamColor={teamColor} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-h4 text-[var(--text-primary)]">{name}</p>
        <p className="flex items-center gap-1.5 text-caption text-[var(--text-tertiary)]">
          {position ? (
            <span className="rounded bg-[var(--muted-bg)] px-1.5 py-0.5 font-mono uppercase tracking-[0.1em]">
              {position}
            </span>
          ) : null}
          {typeof shirtNumber === 'number' ? <span>·</span> : null}
          {typeof shirtNumber === 'number' ? <span>#{shirtNumber}</span> : null}
        </p>
      </div>
      {typeof rating === 'number' && !Number.isNaN(rating) ? (
        <span
          className={cn(
            'rounded-md px-1.5 py-1 font-mono text-small font-bold ring-1 tabular-nums',
            ratingTone(rating)
          )}
        >
          {rating.toFixed(1)}
        </span>
      ) : null}
    </div>
  )
  return href ? <Link href={href}>{inner}</Link> : inner
}
