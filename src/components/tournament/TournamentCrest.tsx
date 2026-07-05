'use client'

import { useState } from 'react'
import { Trophy } from 'lucide-react'

import { getLeagueAccent } from '@/lib/leagueAccents'

/**
 * ESPN league-logo ids for the tournaments we surface. Every id below was
 * curl-verified against a.espncdn.com (both `500/` and `500-dark/` variants
 * exist for each).
 */
const ESPN_TOURNAMENT_LOGO: Record<string, number> = {
  'uefa.champions': 2,
  'uefa.europa': 2310,
  'uefa.conference': 20296,
  'uefa.euro': 74,
  'fifa.world': 4,
  'conmebol.america': 83,
  'fifa.world.w': 60,
  'uefa.wchampions': 2408,
  'uefa.weuro': 2381,
}

interface TournamentCrestProps {
  /** Tournament id (ESPN slug style, e.g. `uefa.champions`). */
  tournamentId: string
  /** Fallback accent lookup + aria label source. */
  name: string
  /** Pixel size of the square crest box (default 40). */
  size?: number
  className?: string
}

/**
 * TournamentCrest — official competition logo with automatic light/dark
 * variant swap (ESPN ships a `500-dark` white-on-transparent version of every
 * logo). Falls back to an accent-tinted Trophy tile when the id is unknown or
 * the image fails, so we never show an empty box or an emoji.
 */
export function TournamentCrest({ tournamentId, name, size = 40, className }: TournamentCrestProps) {
  const logoId = ESPN_TOURNAMENT_LOGO[tournamentId]
  const [failed, setFailed] = useState(false)

  if (logoId != null && !failed) {
    return (
      <span
        className={`relative inline-flex shrink-0 items-center justify-center ${className ?? ''}`}
        style={{ width: size, height: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`https://a.espncdn.com/i/leaguelogos/soccer/500/${logoId}.png`}
          alt={`${name} logo`}
          width={size}
          height={size}
          className="h-full w-full object-contain dark:hidden"
          loading="lazy"
          onError={() => setFailed(true)}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`https://a.espncdn.com/i/leaguelogos/soccer/500-dark/${logoId}.png`}
          alt=""
          aria-hidden="true"
          width={size}
          height={size}
          className="hidden h-full w-full object-contain dark:block"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </span>
    )
  }

  const accent = getLeagueAccent(tournamentId ?? name)
  return (
    <span
      role="img"
      aria-label={`${name} logo`}
      className={`inline-flex shrink-0 items-center justify-center rounded-xl ${className ?? ''}`}
      style={{
        width: size,
        height: size,
        backgroundColor: `color-mix(in srgb, ${accent.accent} 16%, transparent)`,
        color: accent.accent,
      }}
    >
      <Trophy style={{ width: size * 0.5, height: size * 0.5 }} strokeWidth={2.25} />
    </span>
  )
}

export default TournamentCrest
