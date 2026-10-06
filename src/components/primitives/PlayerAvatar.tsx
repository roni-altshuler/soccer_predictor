'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useHeadshotManifest } from '@/hooks/useHeadshotManifest'
import { usePlayerPortrait } from '@/hooks/usePlayerPortrait'
import { approvedPlayerPortrait, type PlayerIdentity, type PlayerPortrait } from '@/lib/playerPortrait'
import { cn } from '@/lib/utils'

interface PlayerAvatarProps {
  /** Legacy numeric ID alone cannot establish a portrait's subject. */
  playerId?: number | string
  identity?: PlayerIdentity
  portrait?: PlayerPortrait
  /** Display name; used for initials fallback. */
  name?: string
  /** Retained for callers; a bare URL provides no identity/permission evidence. */
  imageUrl?: string
  /** Pixel diameter (default 40). */
  size?: number
  /** Optional team color (used for the ring + initials background tint). */
  teamColor?: string
  className?: string
}

function initialsFor(name?: string): string {
  if (!name) return '·'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '·'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** An approved local portrait, otherwise an accessible initials fallback. */
export function PlayerAvatar({
  identity,
  portrait,
  name,
  size = 40,
  teamColor,
  className,
}: PlayerAvatarProps) {
  const { resolve, path } = useHeadshotManifest()
  const approved = portrait !== undefined ? approvedPlayerPortrait(identity, portrait) : resolve(identity)
  const resolvedUrl = usePlayerPortrait(approved, path)

  const ringStyle = teamColor
    ? { boxShadow: `0 0 0 2px ${teamColor}, 0 0 0 4px var(--background)` }
    : undefined

  const fallbackStyle = teamColor
    ? { backgroundColor: `color-mix(in srgb, ${teamColor} 22%, transparent)` }
    : undefined

  return (
    <Avatar
      key={resolvedUrl ?? 'unavailable'}
      role="img"
      aria-label={name?.trim() || 'Player'}
      className={cn('shrink-0 rounded-full', className)}
      style={{ width: size, height: size, ...ringStyle }}
    >
      {resolvedUrl ? (
        <AvatarImage src={resolvedUrl} alt="" />
      ) : null}
      <AvatarFallback
        aria-hidden="true"
        className="font-mono text-xs uppercase tracking-[0.08em] text-[var(--text-primary)]"
        style={fallbackStyle}
      >
        {initialsFor(name)}
      </AvatarFallback>
    </Avatar>
  )
}
