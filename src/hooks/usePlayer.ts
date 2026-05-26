'use client'

import useSWR from 'swr'

import { useGenderQuery } from '@/hooks/useGenderQuery'
import type { PlayerProfile, PlayerStats } from '@/lib/api'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

async function fetcher<T>(url: string): Promise<T | null> {
  const res = await fetch(url)
  // Backend endpoint may not exist yet — return null so the UI renders a graceful empty state.
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

/**
 * Player profile (name, position, team, …). Gender param threaded via
 * `useGenderQuery.withParam`. SWR caches per (id, gender) pair.
 */
export function usePlayer(playerId: number | null) {
  const { withParam } = useGenderQuery()
  const key = playerId
    ? withParam(`${API_BASE}/api/v1/teams/players/${playerId}`)
    : null
  return useSWR<PlayerProfile | null>(key, fetcher, { revalidateOnFocus: false })
}

/**
 * Player season stats — goals, assists, xG, form sparkline values.
 */
export function usePlayerStats(playerId: number | null) {
  const { withParam } = useGenderQuery()
  const key = playerId
    ? withParam(`${API_BASE}/api/v1/teams/players/${playerId}/stats`)
    : null
  return useSWR<PlayerStats | null>(key, fetcher, { revalidateOnFocus: false })
}
