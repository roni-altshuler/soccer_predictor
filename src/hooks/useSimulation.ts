'use client'

import useSWR from 'swr'

import { useGenderQuery } from '@/hooks/useGenderQuery'
import type { ScorelineBucket } from '@/components/charts/SimulationDistributionChart'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export interface SimulationResponse {
  matchId: number
  /** Number of MC samples drawn. */
  n: number
  /** Bucketed scoreline distribution. */
  buckets: ScorelineBucket[]
  /** Outcome probabilities derived from the simulation. */
  probabilities: { home: number; draw: number; away: number }
  /** Optional 2D grid for `<ScorelineHeatmap>` — grid[h][a] = P(home=h, away=a). */
  grid?: number[][]
}

async function fetcher(url: string): Promise<SimulationResponse | null> {
  const res = await fetch(url)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as SimulationResponse
}

/**
 * Monte-Carlo simulation distribution for a match. Defaults to 2,000 samples.
 */
export function useSimulation(matchId: number | null, n = 2000) {
  const { withParam } = useGenderQuery()
  const key = matchId
    ? withParam(`${API_BASE}/api/v1/predictions/simulation/${matchId}?n=${n}`)
    : null
  return useSWR<SimulationResponse | null>(key, fetcher, { revalidateOnFocus: false })
}
