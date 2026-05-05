'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  WATCHLIST_STORAGE_KEY,
  normalizeTeamName,
  teamMatchesWatchlist,
  type WatchTeam,
} from '@/lib/watchlist'

interface TeamSearchResponse {
  teams?: WatchTeam[]
}

interface TodayMatch {
  id?: string
  home_team: string
  away_team: string
  home_score?: number | null
  away_score?: number | null
  time?: string
  status: string
  league: string
  minute?: number | string
  provider?: 'espn' | 'fotmob'
}

interface TodayMatchesResponse {
  live?: TodayMatch[]
  upcoming?: TodayMatch[]
  completed?: TodayMatch[]
  source?: 'espn' | 'fotmob' | 'none' | 'error'
  sourceDetail?: string
}

interface PredictionRow {
  match_id: string
  home_team: string
  away_team: string
  league: string
  match_date: string
  predicted_winner: string
  predicted_scoreline?: string
  confidence?: number
  actual_scoreline?: string | null
  winner_correct?: boolean | null
  status?: string
}

interface PredictionResponse {
  predictions?: PredictionRow[]
}

function formatLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function formatKickoff(time?: string): string {
  if (!time) return 'TBD'
  const parsed = new Date(time)
  if (Number.isNaN(parsed.getTime())) return 'TBD'
  return parsed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function formatMatchDate(time?: string): string {
  if (!time) return 'Date TBD'
  const parsed = new Date(time)
  if (Number.isNaN(parsed.getTime())) return 'Date TBD'
  return parsed.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function normalizeConfidence(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0
  return Number(value) > 1 ? Number(value) / 100 : Number(value)
}

function predictedOutcomeLabel(prediction: PredictionRow): string {
  if (prediction.predicted_winner === 'home') return `${prediction.home_team} win`
  if (prediction.predicted_winner === 'away') return `${prediction.away_team} win`
  if (prediction.predicted_winner === 'draw') return 'Draw'
  return prediction.predicted_winner || 'No outcome'
}

function statusLabel(match: TodayMatch): string {
  if (match.status === 'live') {
    return match.minute ? `${match.minute}' Live` : 'Live'
  }
  if (match.status === 'completed' || match.status === 'finished') return 'FT'
  return formatKickoff(match.time)
}

export default function FanTrackingPanel() {
  const [trackedTeams, setTrackedTeams] = useState<WatchTeam[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<WatchTeam[]>([])
  const [searchingTeams, setSearchingTeams] = useState(false)
  const [loadingSnapshot, setLoadingSnapshot] = useState(false)
  const [todayMatches, setTodayMatches] = useState<TodayMatch[]>([])
  const [predictions, setPredictions] = useState<PredictionRow[]>([])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = localStorage.getItem(WATCHLIST_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return
      const restored = parsed
        .filter((item): item is WatchTeam => {
          if (!item || typeof item !== 'object') return false
          const entry = item as Partial<WatchTeam>
          return typeof entry.name === 'string' && typeof entry.league === 'string'
        })
        .map((item) => ({ name: item.name.trim(), league: item.league.trim() }))
        .filter((item) => item.name.length > 0 && item.league.length > 0)
      setTrackedTeams(restored)
    } catch (error) {
      console.error('Failed to load team watchlist:', error)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(trackedTeams))
  }, [trackedTeams])

  const trackedNameSet = useMemo(
    () => new Set(trackedTeams.map((team) => normalizeTeamName(team.name))),
    [trackedTeams]
  )

  useEffect(() => {
    const query = searchQuery.trim()
    if (query.length < 2) {
      setSearchResults([])
      setSearchingTeams(false)
      return
    }

    let cancelled = false
    const timer = setTimeout(async () => {
      setSearchingTeams(true)
      try {
        const response = await fetch(`/api/search-teams?q=${encodeURIComponent(query)}`)
        if (!response.ok) {
          if (!cancelled) setSearchResults([])
          return
        }
        const payload = await response.json() as TeamSearchResponse
        const existing = new Set(trackedTeams.map((team) => normalizeTeamName(team.name)))
        const next = (payload.teams || []).filter((team) => !existing.has(normalizeTeamName(team.name)))
        if (!cancelled) setSearchResults(next.slice(0, 8))
      } catch (error) {
        if (!cancelled) setSearchResults([])
        console.error('Failed to search teams:', error)
      } finally {
        if (!cancelled) setSearchingTeams(false)
      }
    }, 250)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [searchQuery, trackedTeams])

  const refreshSnapshot = useCallback(async () => {
    if (trackedNameSet.size === 0) {
      setTodayMatches([])
      setPredictions([])
      return
    }

    setLoadingSnapshot(true)
    try {
      const todayKey = formatLocalDateKey(new Date())
      const [matchesRes, predictionsRes] = await Promise.all([
        fetch(`/api/todays_matches?date=${todayKey}`, { cache: 'no-store' }),
        fetch('/api/v1/tracking/predictions?status=all&time_range=season&limit=300', { cache: 'no-store' }),
      ])

      if (matchesRes.ok) {
        const payload = await matchesRes.json() as TodayMatchesResponse
        const merged = [...(payload.live || []), ...(payload.upcoming || []), ...(payload.completed || [])]
        const filteredMatches = merged
          .filter((match) => teamMatchesWatchlist(match.home_team, trackedNameSet) || teamMatchesWatchlist(match.away_team, trackedNameSet))
          .sort((a, b) => (a.time || '').localeCompare(b.time || ''))
        setTodayMatches(filteredMatches)
      } else {
        setTodayMatches([])
      }

      if (predictionsRes.ok) {
        const payload = await predictionsRes.json() as PredictionResponse
        const filteredPredictions = (payload.predictions || []).filter(
          (prediction) => teamMatchesWatchlist(prediction.home_team, trackedNameSet) || teamMatchesWatchlist(prediction.away_team, trackedNameSet)
        )
        setPredictions(filteredPredictions)
      } else {
        setPredictions([])
      }
    } catch (error) {
      console.error('Failed to refresh fan tracking snapshot:', error)
    } finally {
      setLoadingSnapshot(false)
    }
  }, [trackedNameSet])

  useEffect(() => {
    if (trackedNameSet.size === 0) return

    refreshSnapshot()
    const interval = setInterval(() => {
      refreshSnapshot()
    }, 90_000)

    return () => clearInterval(interval)
  }, [refreshSnapshot, trackedNameSet.size])

  const liveMatches = useMemo(
    () => todayMatches.filter((match) => match.status === 'live'),
    [todayMatches]
  )
  const upcomingMatches = useMemo(
    () => todayMatches.filter((match) => match.status === 'upcoming'),
    [todayMatches]
  )

  const pendingPredictions = useMemo(
    () => predictions
      .filter((prediction) => prediction.status === 'pending')
      .sort((a, b) => a.match_date.localeCompare(b.match_date)),
    [predictions]
  )

  const resolvedPredictions = useMemo(
    () => predictions
      .filter((prediction) => prediction.status === 'completed' && typeof prediction.winner_correct === 'boolean')
      .slice(0, 40),
    [predictions]
  )

  const resolvedAccuracy = useMemo(() => {
    if (resolvedPredictions.length === 0) return 0
    const correct = resolvedPredictions.filter((prediction) => prediction.winner_correct).length
    return correct / resolvedPredictions.length
  }, [resolvedPredictions])

  const addTrackedTeam = (team: WatchTeam) => {
    setTrackedTeams((current) => {
      const nextKey = normalizeTeamName(team.name)
      if (current.some((entry) => normalizeTeamName(entry.name) === nextKey)) return current
      return [...current, team]
    })
    setSearchQuery('')
    setSearchResults([])
  }

  const removeTrackedTeam = (name: string) => {
    const removeKey = normalizeTeamName(name)
    setTrackedTeams((current) => current.filter((team) => normalizeTeamName(team.name) !== removeKey))
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 md:p-5">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">Fan Tracking Workspace</p>
            <h3 className="text-lg font-bold text-[var(--text-primary)]">Team watchlist + prediction monitor</h3>
            <p className="text-xs text-[var(--text-tertiary)] mt-1">
              Track your clubs in one place: today&apos;s fixtures, live score status, and model prediction queue.
            </p>
          </div>
          <button
            onClick={refreshSnapshot}
            disabled={trackedTeams.length === 0 || loadingSnapshot}
            className="self-start lg:self-auto px-3 py-1.5 rounded-lg text-xs font-semibold border border-[var(--border-color)] bg-[var(--muted-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loadingSnapshot ? 'Refreshing...' : 'Refresh snapshot'}
          </button>
        </div>

        <div className="mt-4">
          <label htmlFor="team-search" className="block text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1.5">
            Add teams to watch
          </label>
          <input
            id="team-search"
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search team names (e.g. Arsenal, Barcelona, Milan)"
            className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--muted-bg)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/40"
          />
          {searchingTeams && <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">Searching teams...</p>}
          {searchResults.length > 0 && (
            <div className="mt-2 rounded-xl border border-[var(--border-color)] bg-[var(--muted-bg)] overflow-hidden">
              {searchResults.map((team) => (
                <button
                  key={`${team.name}-${team.league}`}
                  onClick={() => addTrackedTeam(team)}
                  className="w-full flex items-center justify-between px-3 py-2 text-left text-sm hover:bg-[var(--card-hover)] transition-colors border-b border-[var(--border-color)]/60 last:border-b-0"
                >
                  <span className="text-[var(--text-primary)] font-medium">{team.name}</span>
                  <span className="text-[11px] text-[var(--text-tertiary)]">{team.league}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {trackedTeams.length === 0 ? (
            <p className="text-xs text-[var(--text-tertiary)]">No teams tracked yet. Add at least one team to activate the watchlist.</p>
          ) : (
            trackedTeams.map((team) => (
              <button
                key={`${team.name}-${team.league}`}
                onClick={() => removeTrackedTeam(team.name)}
                className="inline-flex items-center gap-1 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-300 hover:bg-emerald-500/20 transition-colors"
              >
                <span>{team.name}</span>
                <span className="text-emerald-200/80">×</span>
              </button>
            ))
          )}
        </div>
      </section>

      {trackedTeams.length > 0 && (
        <>
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard
              label="Tracked Teams"
              value={String(trackedTeams.length)}
              tone="#38bdf8"
              sub="watchlist size"
            />
            <MetricCard
              label="Live Now"
              value={String(liveMatches.length)}
              tone={liveMatches.length > 0 ? '#ef4444' : '#94a3b8'}
              sub="matches in progress"
            />
            <MetricCard
              label="Upcoming Today"
              value={String(upcomingMatches.length)}
              tone="#22c55e"
              sub="scheduled fixtures"
            />
            <MetricCard
              label="Prediction Hit Rate"
              value={resolvedPredictions.length > 0 ? `${(resolvedAccuracy * 100).toFixed(1)}%` : 'N/A'}
              tone={resolvedAccuracy >= 0.6 ? '#22c55e' : resolvedAccuracy >= 0.5 ? '#f59e0b' : '#ef4444'}
              sub={resolvedPredictions.length > 0 ? `${resolvedPredictions.length} resolved` : 'awaiting outcomes'}
            />
          </section>

          <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 md:p-5">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-3">Today&apos;s Watchlist Matches</h4>
              {loadingSnapshot ? (
                <div className="h-36 rounded-xl bg-[var(--muted-bg)] animate-pulse" />
              ) : todayMatches.length === 0 ? (
                <p className="text-sm text-[var(--text-tertiary)]">No tracked team matches found for today.</p>
              ) : (
                <div className="space-y-2.5">
                  {todayMatches.slice(0, 10).map((match) => (
                    <div key={`${match.id || match.home_team}-${match.away_team}-${match.time || ''}`} className="rounded-lg border border-[var(--border-color)] bg-[var(--muted-bg)] px-3 py-2.5">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-[var(--text-primary)] truncate">{match.home_team} vs {match.away_team}</p>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                          match.status === 'live'
                            ? 'bg-red-500/15 text-red-300'
                            : match.status === 'completed' || match.status === 'finished'
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : 'bg-cyan-500/15 text-cyan-300'
                        }`}>
                          {statusLabel(match)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-1.5 text-[11px] text-[var(--text-tertiary)]">
                        <span>{match.league}</span>
                        {(match.status === 'live' || match.status === 'completed' || match.status === 'finished') && (
                          <span className="font-semibold text-[var(--text-secondary)]">
                            {match.home_score ?? 0}-{match.away_score ?? 0}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 md:p-5">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-3">Prediction Queue for Tracked Teams</h4>
              {loadingSnapshot ? (
                <div className="h-36 rounded-xl bg-[var(--muted-bg)] animate-pulse" />
              ) : pendingPredictions.length === 0 ? (
                <p className="text-sm text-[var(--text-tertiary)]">No pending model predictions for tracked teams right now.</p>
              ) : (
                <div className="space-y-2.5">
                  {pendingPredictions.slice(0, 10).map((prediction) => (
                    <div key={prediction.match_id} className="rounded-lg border border-[var(--border-color)] bg-[var(--muted-bg)] px-3 py-2.5">
                      <p className="text-sm font-medium text-[var(--text-primary)]">{prediction.home_team} vs {prediction.away_team}</p>
                      <div className="flex items-center justify-between mt-1.5 text-[11px] text-[var(--text-tertiary)]">
                        <span>{prediction.league}</span>
                        <span>{formatMatchDate(prediction.match_date)}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[11px]">
                        <span className="text-[var(--text-secondary)]">Model pick: {predictedOutcomeLabel(prediction)}</span>
                        <span className="text-[var(--accent-primary)] font-semibold">
                          {(normalizeConfidence(prediction.confidence) * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 md:p-5">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-3">Recent Resolved Predictions</h4>
            {resolvedPredictions.length === 0 ? (
              <p className="text-sm text-[var(--text-tertiary)]">Resolved outcomes will appear here once tracked-team predictions finish.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-[var(--muted-bg)] text-[var(--text-tertiary)] text-[10px] uppercase tracking-wider">
                      <th className="text-left py-2 px-2">Match</th>
                      <th className="text-left py-2 px-2">Model Pick</th>
                      <th className="text-left py-2 px-2">Actual</th>
                      <th className="text-left py-2 px-2">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resolvedPredictions.slice(0, 12).map((prediction) => (
                      <tr key={`${prediction.match_id}-resolved`} className="border-t border-[var(--border-color)]/60">
                        <td className="py-2 px-2 text-[var(--text-primary)]">{prediction.home_team} vs {prediction.away_team}</td>
                        <td className="py-2 px-2 text-[var(--text-secondary)]">
                          {predictedOutcomeLabel(prediction)}
                          {prediction.predicted_scoreline ? ` (${prediction.predicted_scoreline})` : ''}
                        </td>
                        <td className="py-2 px-2 text-[var(--text-secondary)]">{prediction.actual_scoreline || '—'}</td>
                        <td className="py-2 px-2">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            prediction.winner_correct
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : 'bg-red-500/15 text-red-300'
                          }`}>
                            {prediction.winner_correct ? 'Correct' : 'Miss'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function MetricCard({ label, value, tone, sub }: { label: string; value: string; tone: string; sub: string }) {
  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-3.5">
      <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">{label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color: tone }}>{value}</p>
      <p className="text-[10px] text-[var(--text-tertiary)] mt-1">{sub}</p>
    </div>
  )
}
