export const WATCHLIST_STORAGE_KEY = 'fotpredict-team-watchlist-v1'

export interface WatchTeam {
  name: string
  league: string
}

export function normalizeTeamName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function teamMatchesWatchlist(name: string, trackedNames: Set<string>): boolean {
  const normalized = normalizeTeamName(name)
  if (!normalized) return false
  if (trackedNames.has(normalized)) return true

  for (const tracked of trackedNames) {
    if (tracked.length >= 6 && normalized.includes(tracked)) return true
    if (normalized.length >= 6 && tracked.includes(normalized)) return true
  }

  return false
}
