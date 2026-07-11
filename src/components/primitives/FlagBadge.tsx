'use client'

import { useMemo, useState } from 'react'

import { flagUrlForCountry } from '@/lib/flags'
import { cn } from '@/lib/utils'

interface FlagBadgeProps {
  /** Country name (national teams) — resolved to a flag via flagcdn. */
  country?: string
  /** Team/country name (required) — alt text + monogram source. */
  teamName: string
  /** Direct logo/crest URL — tried first. */
  logoUrl?: string
  /** Pixel diameter (default 24). */
  size?: number
  className?: string
}


function initialFor(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?'
}

/**
 * FlagBadge — a compact circular identity mark for a team or nation. Tries,
 * in order: an explicit `logoUrl`, a country flag (flagcdn) when the country
 * resolves, then a monogram fallback. The onError chain steps forward through
 * these options so a broken image never leaves an empty box.
 */
export function FlagBadge({
  country,
  teamName,
  logoUrl,
  size = 24,
}: FlagBadgeProps) {
  const flagUrl = flagUrlForCountry(country)

  const candidates = useMemo(
    () => [logoUrl, flagUrl].filter((u): u is string => Boolean(u)),
    [logoUrl, flagUrl]
  )

  const [failedCount, setFailedCount] = useState(0)
  const src = candidates[failedCount]

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={teamName}
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
        loading="lazy"
        onError={() => setFailedCount((c) => c + 1)}
      />
    )
  }

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--muted-bg)] font-semibold text-[var(--text-secondary)]'
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      aria-label={teamName}
    >
      {initialFor(teamName)}
    </span>
  )
}
