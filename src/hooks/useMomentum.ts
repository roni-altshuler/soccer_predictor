'use client'

import useSWR from 'swr'

import { useGenderQuery } from '@/hooks/useGenderQuery'
import type { MomentumPoint } from '@/components/charts/MomentumChart'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface MomentumResponse {
  matchId: number
  points: MomentumPoint[]
  events?: Array<{ minute: number; label: string }>
}

async function fetcher(url: string): Promise<MomentumResponse | null> {
  const res = await fetch(url)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as MomentumResponse
}

/**
 * Live match momentum (attack/possession swings binned in 5-min windows).
 * Returns null when the backend hasn't shipped the endpoint yet — the
 * MomentumPanel renders a skeleton + empty state in that case.
 */
export function useMomentum(matchId: number | null, options?: { refreshSeconds?: number }) {
  const { withParam } = useGenderQuery()
  const key = matchId ? withParam(`${API_BASE}/api/v1/matches/${matchId}/momentum`) : null
  return useSWR<MomentumResponse | null>(key, fetcher, {
    revalidateOnFocus: false,
    refreshInterval: (options?.refreshSeconds ?? 60) * 1000,
  })
}
