'use client'

import useSWR from 'swr'

import { useGenderQuery } from '@/hooks/useGenderQuery'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export interface TeamProfile {
  id: number
  name: string
  shortName?: string
  league?: string
  league_id?: number
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
  fixtures?: Array<{
    matchId: number
    date: string
    opponent: string
    home: boolean
    score?: string
  }>
}

async function fetcher<T>(url: string): Promise<T | null> {
  const res = await fetch(url)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

/**
 * Team profile + squad + fixtures. Gender-aware via `useGenderQuery`.
 */
export function useTeam(teamId: number | string | null) {
  const { withParam } = useGenderQuery()
  const key = teamId ? withParam(`${API_BASE}/api/v1/teams/${teamId}`) : null
  return useSWR<TeamProfile | null>(key, fetcher, { revalidateOnFocus: false })
}
