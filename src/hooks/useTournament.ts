'use client'

import useSWR from 'swr'

import { useGenderQuery } from '@/hooks/useGenderQuery'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export interface BracketMatch {
  id: string | number
  round: number
  position: number
  home?: { id?: number; name: string }
  away?: { id?: number; name: string }
  homeScore?: number | null
  awayScore?: number | null
  status?: 'scheduled' | 'live' | 'finished'
  /** Optional model win probability for the home side. */
  homeWinProb?: number
  winner?: 'home' | 'away'
}

export interface TournamentProfile {
  id: number | string
  name: string
  gender?: 'M' | 'F'
  season?: string
  stage?: string
  rounds?: Array<{ id: number; name: string; matches: BracketMatch[] }>
  groups?: Array<{
    id: string
    name: string
    teams: Array<{
      teamId: number
      name: string
      played: number
      won: number
      drawn: number
      lost: number
      points: number
      goalsFor: number
      goalsAgainst: number
    }>
  }>
}

async function fetcher<T>(url: string): Promise<T | null> {
  const res = await fetch(url)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

/**
 * Tournament profile (groups + bracket). Gender-aware.
 */
export function useTournament(tournamentId: number | string | null) {
  const { withParam } = useGenderQuery()
  const key = tournamentId
    ? withParam(`${API_BASE}/api/v1/knockout/${tournamentId}`)
    : null
  return useSWR<TournamentProfile | null>(key, fetcher, { revalidateOnFocus: false })
}
