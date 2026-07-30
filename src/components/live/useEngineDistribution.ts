'use client'

import { useEffect, useState } from 'react'

import {
  fetchLiveEngineDistribution,
  type EngineForkState,
  type ForkDistribution,
} from '@/components/match/detail/engineClient'
import {
  rarityToBaseRate,
  type BaseRate,
  type RarityCountsResponse,
} from '@/components/match/detail/liveWinProbabilityV2'

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'unavailable'

export interface EngineDistributionResult {
  distribution: ForkDistribution | null
  gender: 'M' | 'F' | null
  status: EngineStatus
}

/**
 * Ask the roll-forward kernel to play out a fixture from `state`, deriving the
 * anchor from the committed team-strength artifact (`/api/v1/engine/live`).
 *
 * Honest by construction: any uncovered competition, unresolvable team, missing
 * route, or malformed payload resolves to `status: 'unavailable'` with a null
 * distribution — the caller falls back to the committed pre-match prediction or
 * renders no probability at all, never a fabricated number.
 */
export function useEngineDistribution(params: {
  competition?: string
  homeTeam?: string
  awayTeam?: string
  state: EngineForkState | null
  enabled?: boolean
}): EngineDistributionResult {
  const { competition, homeTeam, awayTeam, state, enabled = true } = params
  const [result, setResult] = useState<EngineDistributionResult>({
    distribution: null,
    gender: null,
    status: 'idle',
  })

  // Serialise the state so the effect only re-runs on a real change.
  const stateKey = state
    ? `${state.minute}|${state.homeGoals}|${state.awayGoals}|${state.homeReds}|${state.awayReds}`
    : ''

  useEffect(() => {
    if (!enabled || !state || !competition || !homeTeam || !awayTeam) {
      setResult({ distribution: null, gender: null, status: 'idle' })
      return
    }
    let cancelled = false
    setResult((prev) => ({ ...prev, status: 'loading' }))

    fetchLiveEngineDistribution({ competition, homeTeam, awayTeam, state })
      .then((res) => {
        if (cancelled) return
        if (!res) {
          setResult({ distribution: null, gender: null, status: 'unavailable' })
          return
        }
        setResult({ distribution: res.distribution, gender: res.gender, status: 'ready' })
      })
      .catch(() => {
        if (!cancelled) setResult({ distribution: null, gender: null, status: 'unavailable' })
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, competition, homeTeam, awayTeam, stateKey])

  return result
}

/**
 * The exact-count historical base rate for a live score-state (the same rarity
 * function the Almanac and match story use). Returns `null` until the sample is
 * both present and thick enough to claim honestly.
 */
export function useBaseRate(params: {
  gender: 'M' | 'F' | null
  diff: number | null
  minute: number | null
  enabled?: boolean
}): BaseRate | null {
  const { gender, diff, minute, enabled = true } = params
  const [baseRate, setBaseRate] = useState<BaseRate | null>(null)

  useEffect(() => {
    if (!enabled || !gender || diff == null || minute == null) {
      setBaseRate(null)
      return
    }
    let cancelled = false
    const controller = new AbortController()

    fetch(`/api/v1/rarity?gender=${gender}&diff=${diff}&minute=${minute}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          if (!cancelled) setBaseRate(null)
          return
        }
        const counts = (await res.json()) as RarityCountsResponse | null
        if (!cancelled) setBaseRate(rarityToBaseRate(counts))
      })
      .catch(() => {
        if (!cancelled) setBaseRate(null)
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [enabled, gender, diff, minute])

  return baseRate
}
