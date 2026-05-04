'use client'

import Link from 'next/link'
import { useState, useEffect, useMemo } from 'react'
import { leagues, leagueFlagUrls } from '@/data/leagues'
import {
  WATCHLIST_STORAGE_KEY,
  normalizeTeamName,
  teamMatchesWatchlist,
  type WatchTeam,
} from '@/lib/watchlist'
import WorldCupCountdown from '@/components/worldcup/WorldCupCountdown'

type TodayMatch = {
  id?: string
  home_team: string
  away_team: string
  home_score?: number
  away_score?: number
  time?: string
  status: string
  league: string
  leagueId?: string
  minute?: number | string
  venue?: string
}

type DateOption = { label: string; date: string; isToday: boolean }

function formatLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function getDateOptions(): DateOption[] {
  const options: DateOption[] = []
  const now = new Date()
  for (let i = -3; i <= 3; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() + i)
    const iso = formatLocalDateKey(d)
    let label: string
    if (i === -1) label = 'Yesterday'
    else if (i === 0) label = 'Today'
    else if (i === 1) label = 'Tomorrow'
    else label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    options.push({ label, date: iso, isToday: i === 0 })
  }
  return options
}

function formatMatchTime(timeStr?: string): string {
  if (!timeStr) return 'TBD'
  try {
    const date = new Date(timeStr)
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  } catch {
    return 'TBD'
  }
}

function groupMatchesByLeague(matches: TodayMatch[]): Record<string, TodayMatch[]> {
  return matches.reduce((acc, match) => {
    const league = match.league || 'Other'
    if (!acc[league]) acc[league] = []
    acc[league].push(match)
    return acc
  }, {} as Record<string, TodayMatch[]>)
}

const leagueFlagCodes: Record<string, string> = {
  'Premier League': 'ENG', 'La Liga': 'ES', 'LaLiga': 'ES', 'Serie A': 'IT',
  'Bundesliga': 'DE', 'Ligue 1': 'FR', 'Champions League': 'EU',
  'UEFA Champions League': 'EU', 'Europa League': 'EU', 'UEFA Europa League': 'EU',
  'FA Cup': 'ENG', 'Copa del Rey': 'ES', 'MLS': 'US',
  'Eredivisie': 'NL', 'Primeira Liga': 'PT',
}

function getLeagueFlagUrl(league: string): string | null {
  const code = leagueFlagCodes[league]
  return code ? (leagueFlagUrls[code] || null) : null
}

/* ── Match Row (FotMob style) ── */
function MatchRow({ match }: { match: TodayMatch }) {
  const isLive = match.status === 'live'
  const isFinished = match.status === 'finished' || match.status === 'completed'
  const venue = match.venue?.trim()
  const href = match.id
    ? `/matches/${match.id}${match.leagueId ? `?league=${match.leagueId}` : ''}`
    : '/matches'

  return (
    <Link
      href={href}
      className={`match-card group ${isLive ? 'bg-[var(--live-bg)]' : ''}`}
    >
      <div className="w-full">
        <div className="flex items-center w-full">
          {/* Home team */}
          <div className="flex-1 text-right pr-3">
            <span className={`text-sm font-medium ${isFinished ? 'text-[var(--text-secondary)]' : 'text-[var(--text-primary)]'}`}>
              {match.home_team}
            </span>
          </div>

          {/* Score / Time */}
          <div className="w-24 flex-shrink-0 text-center">
            {isLive ? (
              <div>
                <div className="flex items-center justify-center gap-1.5">
                  <span className="text-lg font-bold text-[var(--text-primary)]">{match.home_score}</span>
                  <span className="text-[var(--text-tertiary)] text-xs">-</span>
                  <span className="text-lg font-bold text-[var(--text-primary)]">{match.away_score}</span>
                </div>
                <div className="flex items-center justify-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-[10px] font-bold text-red-500">{match.minute ? `${match.minute}'` : 'LIVE'}</span>
                </div>
              </div>
            ) : isFinished ? (
              <div>
                <div className="flex items-center justify-center gap-1.5">
                  <span className="text-lg font-bold text-[var(--text-secondary)]">{match.home_score}</span>
                  <span className="text-[var(--text-tertiary)] text-xs">-</span>
                  <span className="text-lg font-bold text-[var(--text-secondary)]">{match.away_score}</span>
                </div>
                <span className="text-[10px] text-[var(--text-tertiary)] font-medium">FT</span>
              </div>
            ) : (
              <span className="text-sm font-semibold text-[var(--accent-primary)]">{formatMatchTime(match.time)}</span>
            )}
          </div>

          {/* Away team */}
          <div className="flex-1 text-left pl-3">
            <span className={`text-sm font-medium ${isFinished ? 'text-[var(--text-secondary)]' : 'text-[var(--text-primary)]'}`}>
              {match.away_team}
            </span>
          </div>
        </div>
        {venue && (
          <p className="mt-1 text-center text-[10px] text-[var(--text-tertiary)]">{venue}</p>
        )}
      </div>
    </Link>
  )
}

/* ── League Section ── */
function LeagueSection({ league, matches }: { league: string; matches: TodayMatch[] }) {
  const flagUrl = getLeagueFlagUrl(league)
  return (
    <div className="mb-1">
      <div className="league-header">
        <div className="flex items-center gap-2">
          {flagUrl ? (
            <img src={flagUrl} alt="" className="w-4 h-auto rounded-sm" />
          ) : (
            <span className="text-xs">⚽</span>
          )}
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">{league}</span>
        </div>
        <span className="text-[10px] text-[var(--text-tertiary)]">{matches.length}</span>
      </div>
      <div>
        {matches.map((m, i) => (
          <MatchRow key={`${league}-${i}`} match={m} />
        ))}
      </div>
    </div>
  )
}

/* ── AI Prediction Banner ── */
function AIPredictionBanner() {
  return (
    <Link href="/predict" className="block mx-4 my-4">
      <div className="relative overflow-hidden rounded-2xl border border-[var(--accent-ai)]/30 bg-gradient-to-r from-[var(--accent-ai)]/22 via-[var(--surface-highlight)] to-[var(--accent-primary)]/24 p-4">
        <div className="absolute top-0 right-0 w-32 h-32 bg-white/8 rounded-full -translate-y-1/2 translate-x-1/2" />
        <div className="relative flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl border border-[var(--accent-ai)]/35 bg-[var(--accent-ai)]/18 flex items-center justify-center flex-shrink-0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-ai)" strokeWidth="2">
              <path d="M12 2v4" /><path d="m15.5 7.5 2.8-2.8" /><path d="M20 12h-4" />
              <path d="m15.5 16.5 2.8 2.8" /><path d="M12 18v4" /><path d="m4.2 19.8 2.8-2.8" />
              <path d="M4 12h4" /><path d="m4.2 4.2 2.8 2.8" /><circle cx="12" cy="12" r="4" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-[var(--text-primary)] font-bold text-sm">AI Match Predictions</p>
            <p className="text-[var(--text-secondary)] text-xs">66-feature neural ensemble, calibrated for real match context</p>
          </div>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" className="flex-shrink-0">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </div>
      </div>
    </Link>
  )
}

/* ── Quick Leagues Row ── */
function QuickLeagues() {
  const leagueIdMap: Record<string, string> = {
    'Premier League': 'eng.1', 'La Liga': 'esp.1', 'Serie A': 'ita.1',
    'Bundesliga': 'ger.1', 'Ligue 1': 'fra.1', 'Eredivisie': 'ned.1',
    'Primeira Liga': 'por.1', 'MLS': 'usa.1',
    'UEFA Champions League': 'uefa.champions', 'UEFA Europa League': 'uefa.europa',
  }

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Leagues</span>
        <Link href="/matches" className="text-[10px] text-[var(--accent-primary)] font-medium">See all</Link>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
        {leagues.slice(0, 8).map((league) => {
          const id = leagueIdMap[league.name] || ''
          return (
            <Link
              key={league.name}
              href={id ? `/matches?league=${id}` : '/matches'}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--card-bg)] border border-[var(--border-color)] hover:border-[var(--accent-primary)] transition-colors text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--accent-primary)]"
            >
              {leagueFlagUrls[league.country] && (
                <img src={leagueFlagUrls[league.country]} alt="" className="w-3.5 h-auto rounded-sm" />
              )}
              <span className="whitespace-nowrap">{league.name.replace('UEFA ', '')}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

/* ── Live Indicator Bar ── */
function LiveBar({ liveCount }: { liveCount: number }) {
  if (liveCount === 0) return null
  return (
    <div className="flex items-center justify-center gap-2 py-2 bg-[var(--live-bg)] border-b border-[var(--live-border)]">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
      </span>
      <span className="text-xs font-bold text-red-500 uppercase tracking-wider">{liveCount} Live</span>
    </div>
  )
}

function AtAGlance({
  liveCount,
  upcomingCount,
  finishedCount,
  selectedDateLabel,
}: {
  liveCount: number
  upcomingCount: number
  finishedCount: number
  selectedDateLabel: string
}) {
  return (
    <div className="max-w-3xl mx-auto px-4 pt-4 pb-2 animate-slideUp">
      <div className="fm-surface p-4 md:p-5">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-tertiary)] font-semibold mb-1">Match Center</p>
            <h1 className="text-xl md:text-2xl font-black text-[var(--text-primary)]">{selectedDateLabel} Fixtures & Results</h1>
            <p className="text-xs text-[var(--text-tertiary)] mt-1">Follow live games, check completed scorelines, and jump into AI picks with one tap.</p>
          </div>
          <div className="grid grid-cols-3 gap-2 w-full md:w-auto">
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-center min-w-[82px]">
              <p className="text-lg font-bold text-red-400">{liveCount}</p>
              <p className="text-[10px] uppercase tracking-wider text-red-300/90">Live</p>
            </div>
            <div className="rounded-lg bg-cyan-500/10 border border-cyan-500/20 px-3 py-2 text-center min-w-[82px]">
              <p className="text-lg font-bold text-cyan-400">{upcomingCount}</p>
              <p className="text-[10px] uppercase tracking-wider text-cyan-300/90">Upcoming</p>
            </div>
            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-center min-w-[82px]">
              <p className="text-lg font-bold text-emerald-400">{finishedCount}</p>
              <p className="text-[10px] uppercase tracking-wider text-emerald-300/90">Finished</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════
 *  HOME PAGE
 * ════════════════════════════════════════ */
export default function Home() {
  const dateOptions = useMemo(() => getDateOptions(), [])
  const [selectedDate, setSelectedDate] = useState(() => dateOptions.find(d => d.isToday)?.date || dateOptions[3]?.date)
  const [matches, setMatches] = useState<{ live: TodayMatch[]; upcoming: TodayMatch[]; completed: TodayMatch[] }>({
    live: [], upcoming: [], completed: [],
  })
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'all' | 'live' | 'finished'>('all')
  const [trackedTeams, setTrackedTeams] = useState<WatchTeam[]>([])
  const [watchlistOnly, setWatchlistOnly] = useState(false)

  useEffect(() => {
    const loadWatchlist = () => {
      try {
        const raw = localStorage.getItem(WATCHLIST_STORAGE_KEY)
        if (!raw) {
          setTrackedTeams([])
          return
        }
        const parsed = JSON.parse(raw) as unknown
        if (!Array.isArray(parsed)) {
          setTrackedTeams([])
          return
        }
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
        console.error('Failed to load home watchlist:', error)
        setTrackedTeams([])
      }
    }

    loadWatchlist()
    const onStorage = (event: StorageEvent) => {
      if (event.key === WATCHLIST_STORAGE_KEY) loadWatchlist()
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', loadWatchlist)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', loadWatchlist)
    }
  }, [])

  useEffect(() => {
    if (trackedTeams.length === 0 && watchlistOnly) {
      setWatchlistOnly(false)
    }
  }, [trackedTeams.length, watchlistOnly])

  useEffect(() => {
    let cancelled = false
    const fetchMatches = async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/todays_matches?date=${selectedDate}`, { cache: 'no-store' })
        if (res.ok && !cancelled) {
          const data = await res.json()
          setMatches(data)
        }
      } catch (e) {
        console.error('Error fetching matches:', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchMatches()
    const interval = setInterval(fetchMatches, 60000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [selectedDate])

  const live = matches?.live || []
  const upcoming = matches?.upcoming || []
  const completed = matches?.completed || []
  const trackedNameSet = useMemo(
    () => new Set(trackedTeams.map((team) => normalizeTeamName(team.name))),
    [trackedTeams]
  )

  let tabMatches: TodayMatch[]
  if (tab === 'live') tabMatches = live
  else if (tab === 'finished') tabMatches = completed
  else tabMatches = [...live, ...upcoming, ...completed]

  const trackedMatchesByTab = tabMatches.filter(
    (match) => teamMatchesWatchlist(match.home_team, trackedNameSet) || teamMatchesWatchlist(match.away_team, trackedNameSet)
  )
  const filteredMatches = watchlistOnly ? trackedMatchesByTab : tabMatches

  const matchesByLeague = groupMatchesByLeague(filteredMatches)
  const leagueNames = Object.keys(matchesByLeague)
  const totalCount = live.length + upcoming.length + completed.length
  const trackedCount = trackedMatchesByTab.length
  const selectedDateLabel = dateOptions.find((d) => d.date === selectedDate)?.label || selectedDate

  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* Live indicator */}
      <LiveBar liveCount={live.length} />

      {/* At-a-glance summary */}
      <AtAGlance
        liveCount={live.length}
        upcomingCount={upcoming.length}
        finishedCount={completed.length}
        selectedDateLabel={selectedDateLabel}
      />

      <WorldCupCountdown />

      {/* Date Selector — FotMob horizontal scroll */}
      <div className="sticky top-12 md:top-14 z-40 bg-[var(--nav-bg)] border-b border-[var(--border-color)] backdrop-blur-md">
        <div className="flex items-center overflow-x-auto px-2 py-1.5 gap-1 max-w-3xl mx-auto" style={{ scrollbarWidth: 'none' }}>
          {dateOptions.map((opt) => (
            <button
              key={opt.date}
              onClick={() => setSelectedDate(opt.date)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                selectedDate === opt.date
                  ? 'bg-[var(--accent-primary)] text-[#04120a] border-[var(--accent-primary)]'
                  : 'text-[var(--text-secondary)] border-transparent hover:text-[var(--text-primary)] hover:bg-[var(--card-hover)]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Filter: All / Live / Finished */}
      <div className="max-w-3xl mx-auto">
        <div className="flex flex-wrap items-center gap-1 px-4 pt-3 pb-1">
          {(['all', 'live', 'finished'] as const).map((t) => {
            const count = t === 'all' ? totalCount : t === 'live' ? live.length : completed.length
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider rounded-lg border transition-colors ${
                  tab === t
                    ? 'border-[var(--accent-primary)] text-[var(--accent-primary)] bg-[var(--tab-active-bg)]'
                    : 'border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--card-hover)]'
                }`}
              >
                {t === 'all' ? 'All' : t === 'live' ? 'Live' : 'Finished'}
                {count > 0 && <span className="ml-1 text-[10px]">({count})</span>}
              </button>
            )
          })}
          {trackedTeams.length > 0 && (
            <button
              onClick={() => setWatchlistOnly((value) => !value)}
              className={`ml-auto px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider rounded-lg border transition-colors ${
                watchlistOnly
                  ? 'border-violet-400/60 text-violet-300 bg-violet-500/15'
                  : 'border-[var(--border-color)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--card-hover)]'
              }`}
            >
              Tracked Teams {watchlistOnly ? 'On' : 'Off'}
              <span className="ml-1 text-[10px]">({trackedCount})</span>
            </button>
          )}
        </div>
        {trackedTeams.length === 0 && (
          <div className="px-4 pb-1">
            <Link href="/tracking?view=fan" className="text-[11px] text-[var(--text-tertiary)] hover:text-[var(--accent-primary)]">
              Add a team watchlist in Tracking → Fan Team Tracker
            </Link>
          </div>
        )}
        {trackedTeams.length > 0 && (
          <div className="px-4 pb-1 text-[10px] text-[var(--text-tertiary)]">
            Tracking: {trackedTeams.map((team) => team.name).slice(0, 4).join(', ')}
            {trackedTeams.length > 4 ? ` +${trackedTeams.length - 4} more` : ''}
          </div>
        )}
      </div>

      {/* Matches List — grouped by league */}
      <div className="max-w-3xl mx-auto pb-6">
        {loading ? (
          <div className="py-16 flex flex-col items-center gap-3">
            <div className="w-6 h-6 border-2 border-[var(--accent-primary)] border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-[var(--text-tertiary)]">Loading matches...</span>
          </div>
        ) : leagueNames.length > 0 ? (
          <>
            {leagueNames.map((league) => (
              <LeagueSection key={league} league={league} matches={matchesByLeague[league]} />
            ))}
          </>
        ) : (
          <div className="py-16 text-center">
            <span className="text-3xl block mb-2">⚽</span>
            <p className="text-sm text-[var(--text-secondary)]">
              No matches {watchlistOnly ? 'for tracked teams ' : ''}{tab === 'live' ? 'live right now' : tab === 'finished' ? 'finished yet' : 'scheduled'}
            </p>
            <p className="text-xs text-[var(--text-tertiary)] mt-1">Try selecting a different date</p>
          </div>
        )}

        {/* AI Prediction Banner — between matches and leagues */}
        <AIPredictionBanner />

        {/* Quick Leagues */}
        <QuickLeagues />

        {/* Model info stripe */}
        <div className="mx-4 mt-2 p-3 rounded-xl bg-[var(--card-bg)] border border-[var(--border-color)] shadow-[var(--shadow-sm)]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[var(--accent-ai)]/20 flex items-center justify-center flex-shrink-0">
              <span className="text-base">🧠</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-[var(--text-primary)]">Neural Ensemble v5.1</p>
              <p className="text-[10px] text-[var(--text-tertiary)]">66 features · neural-first serving · calibrated league parameters · audit-ready tracking</p>
            </div>
            <Link href="/about" className="text-[10px] text-[var(--accent-primary)] font-medium flex-shrink-0">Learn more</Link>
          </div>
        </div>

        {/* Disclaimer */}
        <p className="text-center text-[10px] text-[var(--text-tertiary)] px-4 mt-4">
          Predictions are for educational/entertainment purposes only. Not intended for betting.
        </p>
      </div>
    </div>
  )
}
