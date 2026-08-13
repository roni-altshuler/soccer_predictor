'use client'

import { useMemo } from 'react'

import { CompetitionSelect } from '@/components/forecast/CompetitionSelect'
import { getLeagueAccent } from '@/lib/leagueAccents'

/**
 * The league picker on `/season`.
 *
 * A thin adapter over `CompetitionSelect`, which owns the listbox, the whole
 * keyboard contract and the phone bottom sheet. What belongs here is only what
 * is specific to leagues: how they are ordered, and what the second line says.
 *
 * Order is by prominence, not alphabet. Alphabetical order opens on the
 * Bundesliga for an audience mostly there for the Premier League, and no
 * reader thinks of leagues as an alphabetised set. Anything unranked falls to
 * the end alphabetically rather than disappearing, so a newly gated league
 * shows up the day it is published.
 */

export interface LeagueOption {
  competition_id: string
  name: string
  country: string | null
  season: number
  fixtures_remaining: number
  teams: number
}

// Roughly by following: the big five, the other European top flights, then
// MLS.
//
// The second tiers and Brazil that used to sit at the tail were removed from
// the product, and `usa.1` was never added — so MLS landed last only because
// an unranked league sorts after every ranked one. It was the position we
// wanted, arrived at by accident, and the next league added anywhere but the
// end would have exposed that. Ranked explicitly now.
const RANK = [
  'eng.1', 'esp.1', 'ita.1', 'ger.1', 'fra.1', 'ned.1', 'por.1', 'tur.1',
  'usa.1',
]

export function orderLeagues<T extends { competition_id: string; name: string }>(
  leagues: T[],
): T[] {
  return [...leagues].sort((a, b) => {
    const ra = RANK.indexOf(a.competition_id)
    const rb = RANK.indexOf(b.competition_id)
    if (ra !== -1 || rb !== -1) {
      if (ra === -1) return 1
      if (rb === -1) return -1
      return ra - rb
    }
    return a.name.localeCompare(b.name)
  })
}

export const seasonLabel = (season: number) =>
  `${season}/${String(season + 1).slice(2)}`

export function LeagueSelect({
  leagues,
  value,
  onChange,
  className,
}: {
  leagues: LeagueOption[]
  value: string
  onChange: (competitionId: string) => void
  className?: string
}) {
  const options = useMemo(
    () =>
      orderLeagues(leagues).map((l) => ({
        id: l.competition_id,
        name: l.name,
        // In the list, how much is left to play is what distinguishes one
        // league from the next; on the trigger, the season is what a reader
        // wants confirmed.
        subtitle: `${l.country ?? getLeagueAccent(l.competition_id).country} · ${l.fixtures_remaining} to play`,
        triggerSubtitle: `${l.country ?? getLeagueAccent(l.competition_id).country} · ${seasonLabel(l.season)}`,
      })),
    [leagues],
  )

  return (
    <CompetitionSelect
      options={options}
      value={value}
      onChange={onChange}
      kind="League"
      className={className}
    />
  )
}
