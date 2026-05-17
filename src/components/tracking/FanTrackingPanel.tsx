'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_WATCHLIST_ALERT_SETTINGS,
  WATCHLIST_ALERTS_STORAGE_KEY,
  WATCHLIST_STORAGE_KEY,
  normalizeTeamName,
  teamMatchesWatchlist,
  type WatchlistAlertSettings,
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

interface WatchlistAlertItem {
  id: string
  type: 'kickoff' | 'confidence'
  title: string
  detail: string
  tone: string
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

function minutesUntil(time?: string): number | null {
  if (!time) return null
  const parsed = new Date(time)
  if (Number.isNaN(parsed.getTime())) return null
  return Math.round((parsed.getTime() - Date.now()) / 60_000)
}

function timeUntilLabel(minutes: number): string {
  if (minutes <= 0) return 'starting now'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}

export default function FanTrackingPanel() {
  const [trackedTeams, setTrackedTeams] = useState<WatchTeam[]>([])
  const [alertSettings, setAlertSettings] = useState<WatchlistAlertSettings>(DEFAULT_WATCHLIST_ALERT_SETTINGS)
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>('unsupported')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<WatchTeam[]>([])
  const [searchingTeams, setSearchingTeams] = useState(false)
  const [loadingSnapshot, setLoadingSnapshot] = useState(false)
  const [todayMatches, setTodayMatches] = useState<TodayMatch[]>([])
  const [predictions, setPredictions] = useState<PredictionRow[]>([])
  const [cloudAlertSyncCode, setCloudAlertSyncCode] = useState('')
  const [cloudAlertStatus, setCloudAlertStatus] = useState('')
  const [syncingCloudAlerts, setSyncingCloudAlerts] = useState(false)
  const [cloudAlerts, setCloudAlerts] = useState<WatchlistAlertItem[]>([])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = localStorage.getItem(WATCHLIST_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as unknown
        if (Array.isArray(parsed)) {
          const restored = parsed
            .filter((item): item is WatchTeam => {
              if (!item || typeof item !== 'object') return false
              const entry = item as Partial<WatchTeam>
              return typeof entry.name === 'string' && typeof entry.league === 'string'
            })
            .map((item) => ({ name: item.name.trim(), league: item.league.trim() }))
            .filter((item) => item.name.length > 0 && item.league.length > 0)
          setTrackedTeams(restored)
        }
      }

      const rawSettings = localStorage.getItem(WATCHLIST_ALERTS_STORAGE_KEY)
      if (rawSettings) {
        const parsedSettings = JSON.parse(rawSettings) as Partial<WatchlistAlertSettings>
        setAlertSettings({
          ...DEFAULT_WATCHLIST_ALERT_SETTINGS,
          ...parsedSettings,
          reminderMinutes: Math.max(5, Math.min(240, Number(parsedSettings.reminderMinutes) || DEFAULT_WATCHLIST_ALERT_SETTINGS.reminderMinutes)),
          confidenceThreshold: Math.max(0.35, Math.min(0.9, Number(parsedSettings.confidenceThreshold) || DEFAULT_WATCHLIST_ALERT_SETTINGS.confidenceThreshold)),
        })
      }

      if ('Notification' in window) {
        setNotificationPermission(Notification.permission)
      }
    } catch (error) {
      console.error('Failed to load team watchlist:', error)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(trackedTeams))
  }, [trackedTeams])

  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem(WATCHLIST_ALERTS_STORAGE_KEY, JSON.stringify(alertSettings))
  }, [alertSettings])

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

  const watchlistAlerts = useMemo<WatchlistAlertItem[]>(() => {
    const alerts: WatchlistAlertItem[] = []
    if (alertSettings.kickoffReminders) {
      for (const match of upcomingMatches) {
        const minutes = minutesUntil(match.time)
        if (minutes == null || minutes < -5 || minutes > alertSettings.reminderMinutes) continue
        alerts.push({
          id: `kickoff-${match.id || match.home_team}-${match.away_team}`,
          type: 'kickoff',
          title: `${match.home_team} vs ${match.away_team}`,
          detail: `Kickoff ${timeUntilLabel(minutes)} · ${match.league}`,
          tone: '#38bdf8',
        })
      }
    }

    if (alertSettings.confidenceAlerts) {
      for (const prediction of pendingPredictions) {
        const confidence = normalizeConfidence(prediction.confidence)
        if (confidence < alertSettings.confidenceThreshold) continue
        alerts.push({
          id: `confidence-${prediction.match_id}`,
          type: 'confidence',
          title: `${prediction.home_team} vs ${prediction.away_team}`,
          detail: `${predictedOutcomeLabel(prediction)} at ${(confidence * 100).toFixed(1)}% · ${prediction.league}`,
          tone: '#22c55e',
        })
      }
    }
    return alerts.slice(0, 8)
  }, [alertSettings, pendingPredictions, upcomingMatches])

  const syncAlertQueue = async () => {
    setSyncingCloudAlerts(true)
    try {
      const response = await fetch('/api/watchlist-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          syncCode: cloudAlertSyncCode,
          trackedTeams,
          settings: alertSettings,
          alerts: watchlistAlerts,
          sourceDevice: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 80) : 'Browser session',
        }),
      })
      const payload = await response.json()
      if (!response.ok) {
        setCloudAlertStatus(payload.error || 'Cloud alert sync failed.')
        return
      }
      setCloudAlertSyncCode(payload.syncCode)
      setCloudAlerts(payload.alerts || [])
      setCloudAlertStatus(`Synced ${payload.alerts?.length || 0} active alerts to code ${payload.syncCode}.`)
    } catch {
      setCloudAlertStatus('Cloud alert sync failed. Check your connection and try again.')
    } finally {
      setSyncingCloudAlerts(false)
    }
  }

  const pullAlertQueue = async () => {
    const syncCode = cloudAlertSyncCode.trim().toUpperCase()
    if (!syncCode) {
      setCloudAlertStatus('Enter a sync code before pulling cloud alerts.')
      return
    }

    setSyncingCloudAlerts(true)
    try {
      const response = await fetch(`/api/watchlist-alerts?syncCode=${encodeURIComponent(syncCode)}`, { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) {
        setCloudAlertStatus(payload.error || 'Cloud alert sync code was not found.')
        return
      }
      if (Array.isArray(payload.trackedTeams)) setTrackedTeams(payload.trackedTeams)
      if (payload.settings) {
        setAlertSettings({
          ...DEFAULT_WATCHLIST_ALERT_SETTINGS,
          ...payload.settings,
        })
      }
      setCloudAlerts(payload.alerts || [])
      setCloudAlertStatus(`Pulled ${payload.alerts?.length || 0} cloud alerts from ${payload.syncCode}.`)
    } catch {
      setCloudAlertStatus('Could not pull cloud alerts. Check the sync code and try again.')
    } finally {
      setSyncingCloudAlerts(false)
    }
  }

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

  const updateAlertSettings = (next: Partial<WatchlistAlertSettings>) => {
    setAlertSettings((current) => ({
      ...current,
      ...next,
      reminderMinutes: Math.max(5, Math.min(240, Number(next.reminderMinutes ?? current.reminderMinutes))),
      confidenceThreshold: Math.max(0.35, Math.min(0.9, Number(next.confidenceThreshold ?? current.confidenceThreshold))),
    }))
  }

  const requestBrowserNotifications = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setNotificationPermission('unsupported')
      return
    }
    const permission = await Notification.requestPermission()
    setNotificationPermission(permission)
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

          <section className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 md:p-5">
            <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">Watchlist Alerts</p>
                <h4 className="mt-1 text-base font-bold text-[var(--text-primary)]">Kickoff reminders + confidence alerts</h4>
                <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                  Local alert rules for tracked-team matches and high-confidence pending model picks.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => updateAlertSettings({ kickoffReminders: !alertSettings.kickoffReminders })}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${alertSettings.kickoffReminders ? 'border-cyan-500/45 bg-cyan-500/10 text-cyan-300' : 'border-[var(--border-color)] bg-[var(--muted-bg)] text-[var(--text-tertiary)]'}`}
                >
                  Kickoffs {alertSettings.kickoffReminders ? 'On' : 'Off'}
                </button>
                <button
                  onClick={() => updateAlertSettings({ confidenceAlerts: !alertSettings.confidenceAlerts })}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${alertSettings.confidenceAlerts ? 'border-emerald-500/45 bg-emerald-500/10 text-emerald-300' : 'border-[var(--border-color)] bg-[var(--muted-bg)] text-[var(--text-tertiary)]'}`}
                >
                  Confidence {alertSettings.confidenceAlerts ? 'On' : 'Off'}
                </button>
                <button
                  onClick={requestBrowserNotifications}
                  className="rounded-lg border border-[var(--border-color)] bg-[var(--muted-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  Browser {notificationPermission === 'granted' ? 'Allowed' : notificationPermission === 'denied' ? 'Blocked' : 'Enable'}
                </button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 lg:grid-cols-[0.8fr_1.2fr] gap-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="rounded-xl border border-[var(--border-color)] bg-[var(--muted-bg)] p-3">
                  <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">Kickoff window</span>
                  <input
                    type="number"
                    min={5}
                    max={240}
                    step={5}
                    value={alertSettings.reminderMinutes}
                    onChange={(event) => updateAlertSettings({ reminderMinutes: Number(event.target.value) })}
                    className="mt-2 w-full rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] px-2 py-1.5 text-sm font-semibold text-[var(--text-primary)]"
                  />
                  <span className="mt-1 block text-[10px] text-[var(--text-tertiary)]">minutes before kickoff</span>
                </label>
                <label className="rounded-xl border border-[var(--border-color)] bg-[var(--muted-bg)] p-3">
                  <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">Confidence floor</span>
                  <input
                    type="number"
                    min={35}
                    max={90}
                    step={1}
                    value={Math.round(alertSettings.confidenceThreshold * 100)}
                    onChange={(event) => updateAlertSettings({ confidenceThreshold: Number(event.target.value) / 100 })}
                    className="mt-2 w-full rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] px-2 py-1.5 text-sm font-semibold text-[var(--text-primary)]"
                  />
                  <span className="mt-1 block text-[10px] text-[var(--text-tertiary)]">percent model confidence</span>
                </label>
              </div>

              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--muted-bg)] p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">Active alert queue</p>
                  <span className="text-[10px] text-[var(--text-tertiary)]">{watchlistAlerts.length} active</span>
                </div>
                {watchlistAlerts.length === 0 ? (
                  <p className="mt-3 text-xs text-[var(--text-tertiary)]">No kickoff or confidence alerts match the current rules.</p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {watchlistAlerts.map((alert) => (
                      <div key={alert.id} className="flex items-start gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] px-3 py-2">
                        <span className="mt-1.5 h-2 w-2 rounded-full" style={{ backgroundColor: alert.tone }} />
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-[var(--text-primary)]">{alert.title}</p>
                          <p className="text-[11px] text-[var(--text-tertiary)]">{alert.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-[var(--border-color)] bg-[var(--muted-bg)] p-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">Server Alert Sync</p>
                  <h5 className="mt-1 text-sm font-bold text-[var(--text-primary)]">Cross-device notification queue</h5>
                  <p className="mt-1 text-xs leading-5 text-[var(--text-tertiary)]">
                    Push your current alert rules and active queue to a sync code, then pull the same watchlist from another device.
                  </p>
                </div>
                <div className="grid min-w-full gap-2 sm:min-w-[360px] sm:grid-cols-[1fr_auto_auto]">
                  <input
                    value={cloudAlertSyncCode}
                    onChange={(event) => setCloudAlertSyncCode(event.target.value.toUpperCase())}
                    placeholder="Sync code"
                    className="rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] px-3 py-2 text-xs uppercase tracking-[0.12em] text-[var(--text-primary)]"
                  />
                  <button
                    onClick={syncAlertQueue}
                    disabled={syncingCloudAlerts}
                    className="rounded-lg border border-emerald-500/45 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {syncingCloudAlerts ? 'Syncing' : 'Sync'}
                  </button>
                  <button
                    onClick={pullAlertQueue}
                    disabled={syncingCloudAlerts}
                    className="rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] px-3 py-2 text-xs font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Pull
                  </button>
                </div>
              </div>
              {(cloudAlertStatus || cloudAlerts.length > 0) && (
                <div className="mt-3 rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] px-3 py-2">
                  {cloudAlertStatus && <p className="text-xs text-[var(--text-secondary)]">{cloudAlertStatus}</p>}
                  {cloudAlerts.length > 0 && (
                    <p className="mt-1 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
                      Cloud queue: {cloudAlerts.length} active alert{cloudAlerts.length === 1 ? '' : 's'}
                    </p>
                  )}
                </div>
              )}
            </div>
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
