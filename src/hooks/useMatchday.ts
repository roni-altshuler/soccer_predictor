'use client'

import { useEffect, useState } from 'react'

import type { MatchRowMatch } from '@/components/match/MatchRow'

export type DayMatch = MatchRowMatch & { league: string; leagueId?: string }
export type Matchday = { live: DayMatch[]; upcoming: DayMatch[]; completed: DayMatch[] }

/** Keep refreshes quiet, but never put yesterday's results under today's date. */
export function useMatchday(date: string, gender: string) {
  const key = `/api/todays_matches?date=${date}&gender=${gender}`
  const [state, setState] = useState<{ key: string; data?: Matchday; error?: string }>({ key: '' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!date) return
    let disposed = false
    let pending = false
    let controller: AbortController | undefined
    const refresh = async () => {
      if (pending) return
      pending = true
      controller = new AbortController()
      const timeout = setTimeout(() => controller?.abort(), 25_000)
      try {
        const response = await fetch(key, { cache: 'no-store', signal: controller.signal })
        if (!response.ok) throw new Error('Scores unavailable')
        const data = await response.json()
        if (data.source === 'error' || !['live', 'upcoming', 'completed'].every((k) => Array.isArray(data[k]))) {
          throw new Error('Scores unavailable')
        }
        if (!disposed) setState({ key, data })
      } catch {
        if (!disposed) setState((previous) => ({
          key,
          data: previous.key === key ? previous.data : undefined,
          error: 'We couldn’t update the scores. Please try again.',
        }))
      } finally {
        clearTimeout(timeout)
        pending = false
      }
    }
    void refresh()
    const whenVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    const interval = setInterval(whenVisible, 60_000)
    document.addEventListener('visibilitychange', whenVisible)
    return () => {
      disposed = true
      controller?.abort()
      clearInterval(interval)
      document.removeEventListener('visibilitychange', whenVisible)
    }
  }, [key, date, attempt])

  const current = state.key === key ? state : undefined
  return {
    data: current?.data,
    error: current?.error,
    loading: !current?.data && !current?.error,
    retry: () => setAttempt((n) => n + 1),
  }
}
