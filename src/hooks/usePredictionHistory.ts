'use client'

import useSWR from 'swr'

import { useGenderQuery } from '@/hooks/useGenderQuery'

export interface PredictionHistoryRow {
  match_id: number | string
  match_date: string
  home_team: string
  away_team: string
  league?: string
  predicted_outcome: 'H' | 'D' | 'A'
  predicted_scoreline?: string
  predicted_confidence?: number
  actual_outcome?: 'H' | 'D' | 'A'
  actual_scoreline?: string
  is_correct?: boolean | null
}

interface PredictionHistoryResponse {
  predictions: PredictionHistoryRow[]
  total: number
  /** Server-computed running accuracy (0..1) over the returned window. */
  accuracy?: number
}

async function fetcher(url: string): Promise<PredictionHistoryResponse> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as PredictionHistoryResponse
}

/**
 * Prediction history feed — consumed by `/history` page. Server route lives
 * at `/api/v1/tracking/recent` (Node + FastAPI both implement it).
 */
export function usePredictionHistory(limit = 100) {
  const { withParam } = useGenderQuery()
  return useSWR<PredictionHistoryResponse>(
    withParam(`/api/v1/tracking/recent?limit=${limit}`),
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 5 * 60_000 }
  )
}
