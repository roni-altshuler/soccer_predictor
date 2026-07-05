'use client'

import Link from 'next/link'
import { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Bookmark, BookmarkCheck, Brain, Filter, Loader2, RefreshCw } from 'lucide-react'

import { leagues } from '@/data/leagues'
import {
  WATCHLIST_STORAGE_KEY,
  normalizeTeamName,
  teamMatchesWatchlist,
  type WatchTeam,
} from '@/lib/watchlist'
import WorldCupCountdown from '@/components/worldcup/WorldCupCountdown'
import DataSourceBadge, { type DataProvider } from '@/components/DataSourceBadge'
import { EmptyState } from '@/components/EmptyState'
import { HeroSpotlight, type HeroAccuracy } from '@/components/home/HeroSpotlight'
import { LiveTickerBar } from '@/components/home/LiveTickerBar'
import { NewsStrip } from '@/components/home/NewsStrip'
import { LeagueChip, SectionHeader } from '@/components/primitives'
import { useGenderQuery } from '@/hooks/useGenderQuery'
import {
  MatchCenterHeader,
  type DateOption,
} from '@/components/match/MatchCenterHeader'
import { LeagueSection } from '@/components/match/LeagueSection'
import type { MatchRowMatch } from '@/components/match/MatchRow'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
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
    else label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
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
  'UEFA Champions League', 'Champions League',
  'UEFA Europa League', 'Europa League',
  'Premier League', 'La Liga', 'LaLiga',
  'Bundesliga', 'Serie A', 'Ligue 1',
  'MLS', 'Major League Soccer',
  'Eredivisie', 'Primeira Liga',
  'FIFA World Cup', 'World Cup',
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

/**
 * Documented holdout accuracy for the unified models (11,661-match men's
 * test set / women's test set — see CLAUDE.md). Used as the honest fallback
 * when neither the 30-day nor the all-time tracked window has ≥10 settled
 * picks, per design-language rule 3.
 */
const HOLDOUT_ACCURACY: Record<'M' | 'F', HeroAccuracy> = {
  M: { pct: 60.56, windowLabel: 'holdout accuracy', detail: '11,661-match holdout test set' },
  F: { pct: 51.45, windowLabel: 'holdout accuracy', detail: "women's holdout test set" },
}

/** Minimum settled picks before a tracked window is displayed. */
const MIN_SETTLED_FOR_WINDOW = 10

function resolveDataProvider(source?: TodayMatchesPayload['source'] | TodayMatch['provider']): DataProvider {
  if (source === 'espn' || source === 'fotmob' || source === 'error') return source
  return 'none'
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
  const [lastFetched, setLastFetched] = useState<Date | null>(null)
  const [accuracy, setAccuracy] = useState<HeroAccuracy | null>(null)

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

  // Honest accuracy chip (design-language rule 3): show the 30-day window
  // only when it holds ≥10 settled picks; otherwise widen to all-time; and
  // if even that is too thin, fall back to the documented holdout figure.
  useEffect(() => {
    let cancelled = false

    const readWindow = async (days?: number) => {
      const url = `/api/v1/tracking/accuracy?gender=${asQueryParam}${days ? `&days=${days}` : ''}`
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) return null
      const data = await res.json()
      const settled = Number(data?.completed_predictions ?? 0)
      const raw = Number(data?.winner_accuracy ?? data?.accuracy ?? 0)
      if (!Number.isFinite(settled) || !Number.isFinite(raw)) return null
      return { settled, pct: raw <= 1 ? raw * 100 : raw }
    }

    const resolveAccuracy = async (): Promise<HeroAccuracy> => {
      try {
        const win30 = await readWindow(30)
        if (win30 && win30.settled >= MIN_SETTLED_FOR_WINDOW) {
          return { pct: win30.pct, windowLabel: '30-day accuracy', detail: `${win30.settled} settled picks` }
        }
        const allTime = await readWindow()
        if (allTime && allTime.settled >= MIN_SETTLED_FOR_WINDOW) {
          return { pct: allTime.pct, windowLabel: 'all-time accuracy', detail: `${allTime.settled} settled picks` }
        }
      } catch {
        /* fall through to holdout */
      }
      return HOLDOUT_ACCURACY[asQueryParam]
    }

    resolveAccuracy().then((resolved) => {
      if (!cancelled) setAccuracy(resolved)
    })
    return () => { cancelled = true }
  }, [asQueryParam])
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
          setLastFetched(new Date())
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

  const selectedDateLabel =
    dateOptions.find((d) => d.date === selectedDate)?.label || selectedDate

  // Single source of truth for the day's counts + committed-pick coverage:
  // everything below derives from the one /api/todays_matches payload.
  const aiPicksCount = [...live, ...upcoming, ...completed].filter(
    (m) => typeof m.ai_home_prob === 'number'
  ).length

  return (
    <div className="min-h-screen">
      <HeroSpotlight
        liveCount={live.length}
        upcomingCount={upcoming.length}
        finishedCount={completed.length}
        selectedDateLabel={selectedDateLabel}
        accuracy={accuracy}
      />

      <LiveTickerBar
        matches={live.map((m) => ({
          id: m.id,
          home_team: m.home_team,
          away_team: m.away_team,
          home_score: m.home_score ?? 0,
          away_score: m.away_score ?? 0,
          minute: m.minute ?? null,
          league: m.league,
          leagueId: m.leagueId,
        }))}
      />

      <MatchCenterHeader
        dateOptions={dateOptions}
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
        selectedDateLabel={selectedDateLabel}
        predictGender={asQueryParam}
        aiPicksCount={aiPicksCount}
      />

      <div className="mx-auto w-full max-w-5xl px-4 pt-4">
        {/* Filter row */}
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 p-3">
            {(['all', 'live', 'finished'] as const).map((t) => {
              const count = t === 'all' ? tabMatches.length : t === 'live' ? live.length : completed.length
              return (
                <Button
                  key={t}
                  variant={tab === t ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setTab(t)}
                  className="min-h-[40px] gap-1.5"
                >
                  {t === 'live' && live.length > 0 && (
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inset-0 animate-ping rounded-full bg-[var(--accent-loss)] opacity-75" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--accent-loss)]" />
                    </span>
                  )}
                  <span className="uppercase tracking-wide">{t}</span>
                  <span className="text-[10px] opacity-75">({count})</span>
                </Button>
              )
            })}

            {trackedTeams.length > 0 && (
              <Button
                variant={watchlistOnly ? 'default' : 'outline'}
                size="sm"
                onClick={() => setWatchlistOnly((v) => !v)}
                className={cn('ml-auto min-h-[40px] gap-1.5', watchlistOnly && 'bg-[var(--accent-market)]/90 hover:bg-[var(--accent-market)]')}
              >
                {watchlistOnly ? (
                  <BookmarkCheck className="h-3.5 w-3.5" />
                ) : (
                  <Bookmark className="h-3.5 w-3.5" />
                )}
                Tracked teams
                <span className="text-[10px] opacity-75">({trackedMatchesInTab.length})</span>
              </Button>
            )}

            {trackedTeams.length === 0 && (
              <Link
                href="/tracking?view=fan"
                className="ml-auto inline-flex min-h-[40px] items-center rounded-lg px-2 text-[11px] text-[var(--text-tertiary)] transition-colors hover:text-[var(--accent-primary)]"
              >
                <Filter className="mr-1 inline h-3 w-3" />
                Add a team watchlist
              </Link>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-color)] px-3 py-2">
            <DataSourceBadge
              provider={resolveDataProvider(matches.source)}
              detail={matches.sourceDetail || 'Daily match feed'}
              refreshedAt={matches.generatedAt}
              compact
            />
            {lastFetched && (
              <span className="flex items-center gap-1 text-[10px] text-[var(--text-tertiary)]">
                <RefreshCw className="h-3 w-3" />
                Refreshed {lastFetched.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </Card>
      </div>

      {/* Matches list */}
      <div className="mx-auto w-full max-w-5xl px-4 pt-4 pb-8">
        {loading && visibleMatches.length === 0 ? (
          <Card className="flex items-center justify-center gap-2 py-12 text-small text-[var(--text-tertiary)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading matches…
          </Card>
        ) : sortedLeagueNames.length === 0 ? (
          <EmptyState
            illustration="no-matches"
            title={`No matches ${watchlistOnly ? 'for tracked teams ' : ''}${tab === 'live' ? 'are live' : tab === 'finished' ? 'have finished' : 'scheduled'}`}
            description="Try a different date or filter — the AI prediction tool still works for any matchup you can dream up."
            action={
              <Button asChild variant="default" size="sm">
                <Link href="/predict">Run a custom prediction</Link>
              </Button>
            }
          />
        ) : (
          <motion.div
            initial="hidden"
            animate="visible"
            variants={{
              visible: { transition: { staggerChildren: 0.04 } },
              hidden: {},
            }}
          >
            <Card className="overflow-hidden">
              {sortedLeagueNames.map((leagueName) => (
                <motion.div
                  key={leagueName}
                  variants={{
                    hidden: { opacity: 0, y: 8 },
                    visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.22, 1, 0.36, 1] } },
                  }}
                >
                  <LeagueSection
                    leagueName={leagueName}
                    leagueId={
                      LEAGUE_ID_MAP[leagueName] ?? matchesByLeague[leagueName][0]?.leagueId
                    }
                    countryLabel={LEAGUE_COUNTRY[leagueName]?.country}
                    matches={matchesByLeague[leagueName]}
                    hrefFor={matchHref}
                    defaultOpen
                  />
                </motion.div>
              ))}
            </Card>
          </motion.div>
        )}

        {/* AI promo card */}
        <Card className="mt-4 overflow-hidden border-[var(--accent-ai)]/30 bg-gradient-to-r from-[var(--accent-ai)]/12 via-[var(--surface-highlight)] to-[var(--accent-primary)]/15 p-4">
          <Link href="/predict" className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--accent-ai)]/35 bg-[var(--accent-ai)]/15">
              <Brain className="h-5 w-5 text-[var(--accent-ai)]" strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-small font-bold text-[var(--text-primary)]">
                Run the unified AI model on any fixture
              </p>
              <p className="text-[11px] text-[var(--text-tertiary)]">
                Multi-task neural network · scoreline distribution · 80 contextual features
              </p>
            </div>
            <Badge variant="outline" className="border-[var(--accent-ai)]/40 text-[var(--accent-ai)]">
              Try it
            </Badge>
          </Link>
        </Card>

        {/* World Cup hub + editorial below the data */}
        <div className="mt-4">
          <WorldCupCountdown compact />
        </div>
        <NewsStrip className="px-0 pt-2" />

        {/* Quick league chips */}
        <div className="mt-6">
          <SectionHeader
            kicker="Browse"
            title="Explore leagues"
            className="mb-3"
            action={
              <Link
                href="/matches"
                className="inline-flex min-h-[40px] items-center text-xs font-medium text-[var(--accent-primary)] hover:underline"
              >
                See all
              </Link>
            }
          />
          <div className="flex gap-2 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none]">
            {leagues.slice(0, 10).map((league) => {
              const id = LEAGUE_ID_MAP[league.name] || ''
              return (
                <LeagueChip
                  key={league.name}
                  leagueId={id || undefined}
                  name={league.name.replace('UEFA ', '').replace(/\s*\(.*\)$/, '')}
                  href={id ? `/leagues/${id}` : '/matches'}
                  size="sm"
                  className="shrink-0"
                />
              )
            })}
          </div>
        </div>

        {/* Disclaimer */}
        <p className="mt-6 text-center text-[10px] text-[var(--text-tertiary)]">
          Predictions are for educational/entertainment purposes only. Not intended for betting.
        </p>
      </div>
    </div>
  )
}
