'use client'

import { useState, useSyncExternalStore } from 'react'

import { WATCHLIST_STORAGE_KEY, normalizeTeamName, type WatchTeam } from '@/lib/watchlist'

const CHANGE = 'pitchverse:watchlist'
const EMPTY: WatchTeam[] = []
let cachedRaw: string | null | undefined
let cachedTeams = EMPTY

function read(): WatchTeam[] {
  try {
    const raw = localStorage.getItem(WATCHLIST_STORAGE_KEY)
    if (raw === cachedRaw) return cachedTeams
    cachedRaw = raw
    const parsed: unknown = raw ? JSON.parse(raw) : []
    cachedTeams = Array.isArray(parsed) ? parsed.filter((t): t is WatchTeam =>
      !!t && typeof t === 'object' && typeof t.name === 'string' && !!t.name.trim() && typeof t.league === 'string',
    ) : EMPTY
  } catch { cachedTeams = EMPTY }
  return cachedTeams
}

function subscribe(listener: () => void) {
  window.addEventListener('storage', listener)
  window.addEventListener('focus', listener)
  window.addEventListener(CHANGE, listener)
  return () => {
    window.removeEventListener('storage', listener)
    window.removeEventListener('focus', listener)
    window.removeEventListener(CHANGE, listener)
  }
}

export function useTeamWatchlist() {
  const teams = useSyncExternalStore(subscribe, read, () => EMPTY)
  const [error, setError] = useState(false)
  const toggle = (team: WatchTeam) => {
    const current = read()
    const name = normalizeTeamName(team.name)
    const exists = current.some((t) => normalizeTeamName(t.name) === name)
    const next = exists ? current.filter((t) => normalizeTeamName(t.name) !== name) : [...current, team]
    try {
      localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(next))
      setError(false)
      window.dispatchEvent(new Event(CHANGE))
    } catch { setError(true) }
  }
  return { teams, toggle, error }
}
