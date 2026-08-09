'use client'

import Link from 'next/link'
import { useState, useEffect, useMemo } from 'react'
import { Bookmark, BookmarkCheck } from 'lucide-react'

import {
  WATCHLIST_STORAGE_KEY,
  normalizeTeamName,
  teamMatchesWatchlist,
  type WatchTeam,
} from '@/lib/watchlist'
import { EmptyState } from '@/components/EmptyState'
import { useGenderQuery } from '@/hooks/useGenderQuery'
import { DateStrip, type DateOption } from '@/components/match/DateStrip'
import { FeaturedStrip } from '@/components/match/FeaturedStrip'
import { LeagueSection } from '@/components/match/LeagueSection'
import type { MatchRowMatch } from '@/components/match/MatchRow'
import { MatchCardSkeleton } from '@/components/skeletons'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/* ── data shapes mirror /api/todays_matches ── */

type TodayMatch = MatchRowMatch & {
  leagueId?: string
  league: string
  provider?: 'espn' | 'fotmob'
}

type TodayMatchesPayload = {
  live: TodayMatch[]
  upcoming: TodayMatch[]
  completed: TodayMatch[]
  source?: 'espn' | 'fotmob' | 'none' | 'error'
  sourceDetail?: string
  requestedDate?: string
  generatedAt?: string
}

/* ── helpers ── */

function formatLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function getDateOptions(): DateOption[] {
  const out: DateOption[] = []
  const now = new Date()
  for (let i = -3; i <= 3; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() + i)
    const iso = formatLocalDateKey(d)
    let label: string
    if (i === -1) label = 'Yesterday'
    else if (i === 0) label = 'Today'
    else if (i === 1) label = 'Tomorrow'
    else
      label = `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${d.getDate()}`
    out.push({ label, date: iso, isToday: i === 0 })
  }
  return out
}

function groupMatchesByLeague(matches: TodayMatch[]): Record<string, TodayMatch[]> {
  return matches.reduce((acc, match) => {
    const key = match.league || 'Other'
    if (!acc[key]) acc[key] = []
    acc[key].push(match)
    return acc
  }, {} as Record<string, TodayMatch[]>)
}

// FotMob-style league prioritisation — the eye-catching leagues bubble to the top.
const LEAGUE_PRIORITY: string[] = [
  'FIFA World Cup', 'FIFA World Cup 2026', 'World Cup',
  'UEFA Champions League', 'Champions League',
  'UEFA Europa League', 'Europa League',
  'Premier League', 'La Liga', 'LaLiga',
  'Bundesliga', 'Serie A', 'Ligue 1',
  'MLS', 'Major League Soccer',
  'Eredivisie', 'Primeira Liga',
  "UEFA European Championship", 'EURO 2024',
]

const LEAGUE_COUNTRY: Record<string, { country: string; code: string }> = {
  'Premier League': { country: 'England', code: 'ENG' },
  'La Liga': { country: 'Spain', code: 'ES' },
  LaLiga: { country: 'Spain', code: 'ES' },
  'Serie A': { country: 'Italy', code: 'IT' },
  Bundesliga: { country: 'Germany', code: 'DE' },
  'Ligue 1': { country: 'France', code: 'FR' },
  Eredivisie: { country: 'Netherlands', code: 'NL' },
  'Primeira Liga': { country: 'Portugal', code: 'PT' },
  MLS: { country: 'USA', code: 'US' },
  'UEFA Champions League': { country: 'Europe', code: 'EU' },
  'Champions League': { country: 'Europe', code: 'EU' },
  'UEFA Europa League': { country: 'Europe', code: 'EU' },
  'Europa League': { country: 'Europe', code: 'EU' },
  'FIFA World Cup': { country: 'World', code: 'EARTH' },
  'FIFA World Cup 2026': { country: 'World', code: 'EARTH' },
  'World Cup': { country: 'World', code: 'EARTH' },
}

function leaguePriority(leagueName: string): number {
  const idx = LEAGUE_PRIORITY.indexOf(leagueName)
  return idx === -1 ? 100 : idx
}

const LEAGUE_ID_MAP: Record<string, string> = {
  'Premier League': 'eng.1', 'La Liga': 'esp.1', LaLiga: 'esp.1',
  'Serie A': 'ita.1', Bundesliga: 'ger.1', 'Ligue 1': 'fra.1',
  Eredivisie: 'ned.1', 'Primeira Liga': 'por.1', MLS: 'usa.1',
  'UEFA Champions League': 'uefa.champions', 'Champions League': 'uefa.champions',
  'Champions League (UCL)': 'uefa.champions',
  'UEFA Europa League': 'uefa.europa', 'Europa League': 'uefa.europa',
  'Europa League (UEL)': 'uefa.europa',
  'Conference League (UECL)': 'uefa.europa.conf',
  'FIFA World Cup': 'fifa.world',
  'FIFA World Cup 2026': 'fifa.world',
  'UEFA European Championship': 'uefa.euro',
  'Copa America': 'conmebol.america',
}

function matchHref(m: TodayMatch): string | undefined {
  if (!m.id) return undefined
  const search = m.leagueId ? `?league=${encodeURIComponent(m.leagueId)}` : ''
  return `/matches/${m.id}${search}`
}

/* ── page ── */

export default function Home() {
  const dateOptions = useMemo(() => getDateOptions(), [])
  const [selectedDate, setSelectedDate] = useState(() =>
    dateOptions.find((d) => d.isToday)?.date || dateOptions[3]?.date
  )
  const [matches, setMatches] = useState<TodayMatchesPayload>({
    live: [], upcoming: [], completed: [],
  })
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'all' | 'live' | 'finished'>('all')
  const [trackedTeams, setTrackedTeams] = useState<WatchTeam[]>([])
  const [watchlistOnly, setWatchlistOnly] = useState(false)

  // Watchlist state — load from localStorage and react to cross-tab updates.
  useEffect(() => {
    const load = () => {
      try {
        const raw = localStorage.getItem(WATCHLIST_STORAGE_KEY)
        if (!raw) return setTrackedTeams([])
        const parsed = JSON.parse(raw) as unknown
        if (!Array.isArray(parsed)) return setTrackedTeams([])
        const restored = parsed
          .filter((item): item is WatchTeam => {
            if (!item || typeof item !== 'object') return false
            const e = item as Partial<WatchTeam>
            return typeof e.name === 'string' && typeof e.league === 'string'
          })
          .map((item) => ({ name: item.name.trim(), league: item.league.trim() }))
          .filter((item) => item.name.length > 0 && item.league.length > 0)
        setTrackedTeams(restored)
      } catch {
        setTrackedTeams([])
      }
    }
    load()
    const onStorage = (e: StorageEvent) => {
      if (e.key === WATCHLIST_STORAGE_KEY) load()
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', load)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', load)
    }
  }, [])

  useEffect(() => {
    if (trackedTeams.length === 0 && watchlistOnly) {
      setWatchlistOnly(false)
    }
  }, [trackedTeams.length, watchlistOnly])

  // Today's matches — refetch every minute for live updates, and every
  // time the user toggles the men's/women's universe.
  const { asQueryParam } = useGenderQuery()

  useEffect(() => {
    let cancelled = false
    const fetchMatches = async () => {
      setLoading(true)
      try {
        const res = await fetch(
          `/api/todays_matches?date=${selectedDate}&gender=${asQueryParam}`,
          { cache: 'no-store' }
        )
        if (res.ok && !cancelled) {
          const data = await res.json()
          setMatches(data)
        }
      } catch (e) {
        console.error('Failed fetching matches:', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchMatches()
    const interval = setInterval(fetchMatches, 60_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [selectedDate, asQueryParam])

  const live = matches?.live || []
  const upcoming = matches?.upcoming || []
  const completed = matches?.completed || []

  const trackedNameSet = useMemo(
    () => new Set(trackedTeams.map((t) => normalizeTeamName(t.name))),
    [trackedTeams]
  )

  let tabMatches: TodayMatch[]
  if (tab === 'live') tabMatches = live
  else if (tab === 'finished') tabMatches = completed
  else tabMatches = [...live, ...upcoming, ...completed]

  const trackedMatchesInTab = tabMatches.filter(
    (m) =>
      teamMatchesWatchlist(m.home_team, trackedNameSet) ||
      teamMatchesWatchlist(m.away_team, trackedNameSet)
  )
  const visibleMatches = watchlistOnly ? trackedMatchesInTab : tabMatches
  const matchesByLeague = groupMatchesByLeague(visibleMatches)

  const sortedLeagueNames = Object.keys(matchesByLeague).sort((a, b) => {
    const pa = leaguePriority(a)
    const pb = leaguePriority(b)
    if (pa !== pb) return pa - pb
    return a.localeCompare(b)
  })

  return (
    <div className="min-h-screen">
      <DateStrip
        dateOptions={dateOptions}
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
      />

      <div className="mx-auto w-full max-w-5xl px-3 pb-8 pt-3 sm:px-4">
        {/* Featured strip — up to six notable fixtures from the same payload
            (live first, then league priority). Sits between the date strip and
            the filter row so the segment control stays glued to the list it
            filters. Renders nothing below two crest-complete fixtures. */}
        <FeaturedStrip
          matches={[...live, ...upcoming, ...completed]}
          priorityFor={leaguePriority}
          hrefFor={matchHref}
          className="mb-2"
        />

        {/* Filter row — segment control + watchlist toggle, one quiet line */}
        <div className="mb-2 flex items-center gap-1">
          {(['all', 'live', 'finished'] as const).map((t) => {
            const active = tab === t
            const label = t === 'all' ? 'All' : t === 'live' ? 'Live' : 'Finished'
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cn(
                  'flex min-h-[36px] items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors',
                  active
                    ? 'bg-[var(--card-hover)] text-[var(--text-primary)]'
                    : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                )}
              >
                {t === 'live' && live.length > 0 && (
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inset-0 animate-ping rounded-full bg-[var(--accent-loss)] opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--accent-loss)]" />
                  </span>
                )}
                {label}
                {t === 'live' && live.length > 0 && (
                  <span className="text-[10px] opacity-75">{live.length}</span>
                )}
              </button>
            )
          })}

          {trackedTeams.length > 0 && (
            <button
              type="button"
              onClick={() => setWatchlistOnly((v) => !v)}
              className={cn(
                'ml-auto flex min-h-[36px] items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors',
                watchlistOnly
                  ? 'bg-[var(--card-hover)] text-[var(--text-primary)]'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
              )}
              aria-pressed={watchlistOnly}
            >
              {watchlistOnly ? (
                <BookmarkCheck className="h-3.5 w-3.5" />
              ) : (
                <Bookmark className="h-3.5 w-3.5" />
              )}
              Following
            </button>
          )}
        </div>

        {/* The scores list IS the page */}
        {loading && visibleMatches.length === 0 ? (
          <Card className="overflow-hidden p-0" aria-busy="true" aria-label="Loading matches">
            <div className="flex items-center gap-2 border-b border-[var(--border-color)] px-4 py-2.5">
              <Skeleton className="h-4 w-4 rounded-full" />
              <Skeleton className="h-3.5 w-36" />
            </div>
            <MatchCardSkeleton count={7} />
          </Card>
        ) : sortedLeagueNames.length === 0 ? (
          <EmptyState
            illustration="no-matches"
            title={`No matches ${watchlistOnly ? 'for followed teams ' : ''}${tab === 'live' ? 'are live' : tab === 'finished' ? 'have finished' : 'scheduled'}`}
            description="Try a different date, or run the AI on any matchup you like."
            action={
              <Button asChild variant="default" size="sm">
                <Link href="/predict">Open AI predict</Link>
              </Button>
            }
          />
        ) : (
          <Card className="overflow-hidden p-0">
            {sortedLeagueNames.map((leagueName) => (
              <LeagueSection
                key={leagueName}
                leagueName={leagueName}
                leagueId={
                  LEAGUE_ID_MAP[leagueName] ?? matchesByLeague[leagueName][0]?.leagueId
                }
                countryLabel={LEAGUE_COUNTRY[leagueName]?.country}
                matches={matchesByLeague[leagueName]}
                hrefFor={matchHref}
                defaultOpen
              />
            ))}
          </Card>
        )}

        {/* Disclaimer — one quiet line, not a banner */}
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2 px-1">
          <p className="text-[10px] text-[var(--text-tertiary)]">
            Model probabilities, scored against the closing line on the accuracy page.
          </p>
        </div>
      </div>
    </div>
  )
}
