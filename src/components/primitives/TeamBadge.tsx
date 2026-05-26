'use client'

import { useMemo } from 'react'

import { useTeamBadgeManifest } from '@/hooks/useHeadshotManifest'
import { cn } from '@/lib/utils'

interface TeamBadgeProps {
  /** Team identifier — manifest key (ESPN id or similar). */
  teamId?: number | string
  /** Display name; used for initials fallback + alt text. */
  name?: string
  /** Direct badge URL — overrides manifest lookup. */
  imageUrl?: string
  /** Pixel diameter (default 32). */
  size?: number
  /** Team brand color (for fallback chip + ring tint). */
  teamColor?: string
  className?: string
}

function initialsFor(name?: string): string {
  if (!name) return 'F'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'F'
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase()
  return parts
    .slice(0, 3)
    .map((p) => p[0])
    .join('')
    .toUpperCase()
}

/**
 * Team crest with manifest lookup and initials fallback. Used wherever a
 * team needs a compact visual identifier (match rows, brackets, league
 * standings, hero pages).
 */
export function TeamBadge({
  teamId,
  name,
  imageUrl,
  size = 32,
  teamColor,
  className,
}: TeamBadgeProps) {
  const { resolve } = useTeamBadgeManifest()
  const resolvedUrl = useMemo(
    () => imageUrl ?? (teamId != null ? resolve(String(teamId)) : undefined),
    [imageUrl, teamId, resolve]
  )

  if (resolvedUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={resolvedUrl}
        alt={name ?? 'Team badge'}
        width={size}
        height={size}
        className={cn('shrink-0 rounded-md object-contain', className)}
        style={{ width: size, height: size }}
        loading="lazy"
      />
    )
  }

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]',
        className
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: teamColor
          ? `color-mix(in srgb, ${teamColor} 22%, transparent)`
          : 'var(--muted-bg)',
        border: teamColor ? `1px solid ${teamColor}` : '1px solid var(--border-color)',
      }}
      aria-label={name ?? 'Team badge'}
    >
      {initialsFor(name)}
    </span>
  )
}
