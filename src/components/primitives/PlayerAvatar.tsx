'use client'

import { useMemo } from 'react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useHeadshotManifest } from '@/hooks/useHeadshotManifest'
import { cn } from '@/lib/utils'

interface PlayerAvatarProps {
  /** Stable player identifier — manifest key. */
  playerId?: number | string
  /** Display name; used for initials fallback. */
  name?: string
  /** Direct image URL — overrides manifest lookup. */
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

// ESPN's public headshot CDN — 404s for less-prominent players, which the
// Radix Avatar handles by never rendering the image (initials show instead).
function espnHeadshotUrl(playerId: number | string): string {
  return `https://a.espncdn.com/i/headshots/soccer/players/full/${playerId}.png`
}

/**
 * Player headshot with graceful initials fallback. Resolution order:
 * explicit imageUrl → headshot-manifest override → ESPN headshot CDN →
 * team-tinted initials avatar.
 */
export function PlayerAvatar({
  playerId,
  name,
  imageUrl,
  size = 40,
  teamColor,
  className,
}: PlayerAvatarProps) {
  const { resolve } = useHeadshotManifest()
  const resolvedUrl = useMemo(() => {
    if (imageUrl) return imageUrl
    if (playerId == null) return undefined
    return resolve(String(playerId)) ?? espnHeadshotUrl(playerId)
  }, [imageUrl, playerId, resolve])

  const ringStyle = teamColor
    ? { boxShadow: `0 0 0 2px ${teamColor}, 0 0 0 4px var(--background)` }
    : undefined

  const fallbackStyle = teamColor
    ? { backgroundColor: `color-mix(in srgb, ${teamColor} 22%, transparent)` }
    : undefined

  return (
    <Avatar
      className={cn('shrink-0 rounded-full', className)}
      style={{ width: size, height: size, ...ringStyle }}
    >
      {resolvedUrl ? (
        <AvatarImage src={resolvedUrl} alt={name ?? 'Player'} />
      ) : null}
      <AvatarFallback
        className="font-mono text-xs uppercase tracking-[0.08em] text-[var(--text-primary)]"
        style={fallbackStyle}
      >
        {initialsFor(name)}
      </AvatarFallback>
    </Avatar>
  )
}
