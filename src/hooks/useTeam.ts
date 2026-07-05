'use client'

import useSWR from 'swr'

import { useGenderQuery } from '@/hooks/useGenderQuery'

export interface TeamInjury {
  playerId?: string | number
  name: string
  /** Normalized vocabulary: out | doubtful | questionable | … */
  status: string
  reason?: string
}

export interface TeamFixture {
  matchId: string
  date?: string
  opponent: string
  opponentId?: string
  home: boolean
  score?: string
}

export interface TeamProfile {
  id: number | string
  name: string
  shortName?: string
  league?: string
  league_id?: number | string
  country?: string
  founded?: number
  stadium?: string
  /** Hex brand color. */
  color?: string
  /** Optional badge override; otherwise the manifest provides it. */
  badgeUrl?: string
  /** Recent form glyph string e.g. "WWDLW". */
  form?: string
  /** Optional season-to-date stats block. */
  stats?: {
    matchesPlayed?: number
    wins?: number
    draws?: number
    losses?: number
    goalsFor?: number
    goalsAgainst?: number
    points?: number
    position?: number
  }
  squad?: Array<{
    id: number
    name: string
    position?: string
    shirtNumber?: number
    rating?: number
  }>
  fixtures?: TeamFixture[]
  recentResults?: TeamFixture[]
  injuries?: TeamInjury[]
}

/** Raw match entry from the overview endpoint (FastAPI + Next mirror). */
interface OverviewMatch {
  match_id?: string
  kickoff?: string
  is_home?: boolean
  opponent?: { id?: string; name?: string }
  self_score?: number | null
  opponent_score?: number | null
  completed?: boolean
}

interface OverviewPayload {
  team?: {
    id?: string
    name?: string
    abbreviation?: string
    logo?: string | null
    venue?: string | null
    color?: string | null
  }
  league?: { id?: string | null; name?: string }
  standing?: {
    position?: number
    played?: number
    won?: number
    drawn?: number
    lost?: number
    gf?: number
    ga?: number
    points?: number
    form_string?: string
  }
  recent_results?: OverviewMatch[]
  upcoming_fixtures?: OverviewMatch[]
  squad?: Array<{
    player_id?: string
    name?: string
    position?: string
    number?: number | null
  }>
  injuries?: Array<{
    player_id?: string | number
    name?: string
    status?: string
    reason?: string
  }>
}

function toFixture(match: OverviewMatch): TeamFixture {
  const hasScore = match.self_score != null && match.opponent_score != null
  return {
    matchId: match.match_id ?? '',
    date: match.kickoff,
    opponent: match.opponent?.name ?? '',
    opponentId: match.opponent?.id,
    home: match.is_home ?? true,
    score: hasScore ? `${match.self_score}-${match.opponent_score}` : undefined,
  }
}

function adaptOverview(payload: OverviewPayload, teamId: number | string): TeamProfile {
  const standing = payload.standing ?? {}
  return {
    id: payload.team?.id ?? teamId,
    name: payload.team?.name ?? '',
    shortName: payload.team?.abbreviation || undefined,
    league: payload.league?.name || undefined,
    league_id: payload.league?.id ?? undefined,
    stadium: payload.team?.venue ?? undefined,
    color: payload.team?.color ?? undefined,
    badgeUrl: payload.team?.logo ?? undefined,
    form: standing.form_string || undefined,
    stats: {
      matchesPlayed: standing.played,
      wins: standing.won,
      draws: standing.drawn,
      losses: standing.lost,
      goalsFor: standing.gf,
      goalsAgainst: standing.ga,
      points: standing.points,
      position: standing.position || undefined,
    },
    squad: (payload.squad ?? [])
      .filter((p) => p.name && p.player_id)
      .map((p) => ({
        id: Number(p.player_id),
        name: p.name as string,
        position: p.position || undefined,
        shirtNumber: p.number ?? undefined,
      })),
    fixtures: (payload.upcoming_fixtures ?? []).map(toFixture),
    recentResults: (payload.recent_results ?? []).map(toFixture),
    injuries: (payload.injuries ?? [])
      .filter((injury) => injury.name)
      .map((injury) => ({
        playerId: injury.player_id,
        name: injury.name as string,
        status: injury.status ?? 'questionable',
        reason: injury.reason || undefined,
      })),
  }
}

async function fetchOverview(url: string): Promise<OverviewPayload | null> {
  // Guarded fetch: a missing team (404) or a transport failure (backend
  // down, offline) both resolve to null so the page degrades to an
  // EmptyState instead of spamming the console with unhandled errors.
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return (await res.json()) as OverviewPayload
  } catch {
    return null
  }
}

/**
 * Team profile + squad + fixtures + injuries, adapted from the same-origin
 * `/api/v1/teams/{id}/overview` Next.js route (which mirrors the FastAPI
 * endpoint, so it works on Vercel and when the Python backend is down).
 * Gender-aware via `useGenderQuery`.
 */
export function useTeam(teamId: number | string | null) {
  const { withParam } = useGenderQuery()
  const key = teamId != null ? withParam(`/api/v1/teams/${teamId}/overview`) : null
  return useSWR<TeamProfile | null>(
    key,
    async (url: string) => {
      const payload = await fetchOverview(url)
      return payload && teamId != null ? adaptOverview(payload, teamId) : null
    },
    { revalidateOnFocus: false },
  )
}
