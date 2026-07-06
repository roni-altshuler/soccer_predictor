'use client'

import { useMemo } from 'react'

import { getLeagueAccent } from '@/lib/leagueAccents'
import {
  FeaturedMatchCarousel,
  type FeaturedMatch,
} from '@/components/viz/FeaturedMatchCarousel'
import type { MatchRowMatch } from '@/components/match/MatchRow'

/** Fixture shape the home page already holds — a MatchRow match + league line. */
export type FeaturedStripMatch = MatchRowMatch & {
  league: string
  leagueId?: string
}

interface FeaturedStripProps {
  matches: FeaturedStripMatch[]
  /** League ordering — the page's existing priority fn, so both surfaces agree. */
  priorityFor: (leagueName: string) => number
  hrefFor: (match: FeaturedStripMatch) => string | undefined
  className?: string
}

function formatKickoff(timeStr?: string): string {
  if (!timeStr) return 'TBD'
  try {
    return new Date(timeStr).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: false,
    })
  } catch {
    return 'TBD'
  }
}

function toCardStatus(status: MatchRowMatch['status']): FeaturedMatch['status'] {
  const s = status?.toString().toLowerCase()
  if (s === 'live') return 'live'
  if (s === 'finished' || s === 'completed') return 'ft'
  return 'upcoming'
}

/**
 * Home-page "Featured" strip — picks up to six of the day's most notable
 * fixtures (live first, then league priority, then kickoff) from the
 * already-fetched scores payload and renders them through the ported
 * FeaturedMatchCarousel. Only fixtures with both crests qualify, and the
 * strip renders nothing below two eligible fixtures — a one-card carousel
 * or crestless duotone panels read as broken, and the list alone is fine.
 *
 * Panel colours: both sides use the league accent (there is no per-club
 * colour source in the app); the carousel mixes each hex at low strength
 * into the card surface, so a same-colour pair is a quiet uniform tint.
 */
export function FeaturedStrip({ matches, priorityFor, hrefFor, className }: FeaturedStripProps) {
  const featured = useMemo<FeaturedMatch[]>(() => {
    const eligible = matches.filter(
      (m) => m.id && m.home_crest_url && m.away_crest_url
    )
    const statusRank = (m: FeaturedStripMatch) => {
      const s = toCardStatus(m.status)
      return s === 'live' ? 0 : s === 'upcoming' ? 1 : 2
    }
    const picked = [...eligible]
      .sort((a, b) => {
        const sr = statusRank(a) - statusRank(b)
        if (sr !== 0) return sr
        const pr = priorityFor(a.league) - priorityFor(b.league)
        if (pr !== 0) return pr
        return (a.time || '').localeCompare(b.time || '')
      })
      .slice(0, 6)

    return picked.map((m) => {
      const status = toCardStatus(m.status)
      const accent = getLeagueAccent(m.leagueId ?? m.league).accent
      let statusDetail: string | undefined
      if (status === 'live' && m.minute != null && m.minute !== '') {
        statusDetail = `${m.minute}'`
      } else if (status === 'ft' && m.home_score != null && m.away_score != null) {
        statusDetail = `${m.home_score} – ${m.away_score}`
      }
      return {
        id: m.id as string,
        homeTeam: m.home_team,
        awayTeam: m.away_team,
        homeCrestUrl: m.home_crest_url ?? undefined,
        awayCrestUrl: m.away_crest_url ?? undefined,
        homeColor: accent,
        awayColor: accent,
        league: m.league,
        kickoff: formatKickoff(m.time),
        status,
        statusDetail,
        aiPick: m.predicted_scoreline ? `AI ${m.predicted_scoreline}` : undefined,
        href: hrefFor(m),
      }
    })
  }, [matches, priorityFor, hrefFor])

  if (featured.length < 2) return null

  return (
    <section aria-label="Featured fixtures" className={className}>
      {/* Kicker line — tiny on mobile; on sm+ it reserves the 44px band the
          carousel's absolutely-positioned chevron buttons float up into. */}
      <div className="flex h-5 items-end px-1 sm:h-11">
        <p className="text-caption uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
          Featured
        </p>
      </div>
      <FeaturedMatchCarousel matches={featured} />
    </section>
  )
}

export default FeaturedStrip
