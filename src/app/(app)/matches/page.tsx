'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'

import { EmptyState } from '@/components/EmptyState'
import { DateStrip, type DateOption } from '@/components/match/DateStrip'
import { LeagueSection } from '@/components/match/LeagueSection'
import type { MatchRowMatch } from '@/components/match/MatchRow'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useGenderQuery } from '@/hooks/useGenderQuery'
import { getLeagueAccent, leaguesForGender } from '@/lib/leagueAccents'
import { cn } from '@/lib/utils'

/**
 * /matches — Matchday v3 browse surface. Same scores-first grammar as the
 * home Match Centre (DateStrip + league-grouped MatchRow list) with a quiet
 * league filter chip row on top: every competition in the current gender
 * universe, one tap to narrow the list. No hero, no telemetry.
 */

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
}

/* ── helpers (same date grammar as the home Match Centre) ── */

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
    else label = `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${d.getDate()}`
    out.push({ label, date: iso, isToday: i === 0 })
  }
  return out
}

const LEAGUE_PRIORITY: string[] = [
  'FIFA World Cup', 'FIFA World Cup 2026', 'World Cup',
  'UEFA Champions League', 'Champions League',
  'UEFA Europa League', 'Europa League',
  'Premier League', 'La Liga', 'LaLiga',
  'Bundesliga', 'Serie A', 'Ligue 1',
  'MLS', 'Major League Soccer',
  'Eredivisie', 'Primeira Liga',
]

function leaguePriority(leagueName: string): number {
  const idx = LEAGUE_PRIORITY.indexOf(leagueName)
  return idx === -1 ? 100 : idx
}

/** Canonical competition id for a feed match — tries leagueId, then name. */
function resolveCompetitionId(m: TodayMatch): string {
  const byId = getLeagueAccent(m.leagueId)
  if (byId.competitionId !== 'unknown') return byId.competitionId
  return getLeagueAccent(m.league).competitionId
}

function matchHref(m: MatchRowMatch & { leagueId?: string }): string | undefined {
  if (!m.id) return undefined
  const search = m.leagueId ? `?league=${encodeURIComponent(m.leagueId)}` : ''
  return `/matches/${m.id}${search}`
}

/* ── page ── */

function MatchesContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { asQueryParam } = useGenderQuery()

  const dateOptions = useMemo(() => getDateOptions(), [])
  const [selectedDate, setSelectedDate] = useState(
    () => dateOptions.find((d) => d.isToday)?.date || dateOptions[3]?.date
  )

  // League chips — every competition in the active gender universe.
  const leagues = useMemo(() => leaguesForGender(asQueryParam), [asQueryParam])

  // Selected chip is a canonical competitionId ('all' = no filter). The
  // ?league= param deep-links a chip; unknown ids fall back to All.
  const leagueParam = searchParams.get('league')
  const initialLeague = useMemo(() => {
    const resolved = getLeagueAccent(leagueParam)
    return resolved.competitionId !== 'unknown' ? resolved.competitionId : 'all'
  }, [leagueParam])
  const [selectedLeague, setSelectedLeague] = useState(initialLeague)
  useEffect(() => setSelectedLeague(initialLeague), [initialLeague])

  // Reset the filter when it doesn't exist in the current gender universe.
  useEffect(() => {
    if (selectedLeague !== 'all' && !leagues.some((l) => l.competitionId === selectedLeague)) {
      setSelectedLeague('all')
    }
  }, [leagues, selectedLeague])

  const selectLeague = (competitionId: string) => {
    setSelectedLeague(competitionId)
    router.replace(
      competitionId === 'all' ? '/matches' : `/matches?league=${encodeURIComponent(competitionId)}`,
      { scroll: false }
    )
  }

  const [payload, setPayload] = useState<TodayMatchesPayload>({ live: [], upcoming: [], completed: [] })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const fetchMatches = async () => {
      setLoading(true)
      try {
        const res = await fetch(
          `/api/todays_matches?date=${selectedDate}&gender=${asQueryParam}`,
          { cache: 'no-store' }
        )
        if (res.ok && !cancelled) setPayload(await res.json())
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

  const allMatches = useMemo(
    () => [...(payload.live || []), ...(payload.upcoming || []), ...(payload.completed || [])],
    [payload]
  )

  const visibleMatches = useMemo(
    () =>
      selectedLeague === 'all'
        ? allMatches
        : allMatches.filter((m) => resolveCompetitionId(m) === selectedLeague),
    [allMatches, selectedLeague]
  )

  const matchesByLeague = useMemo(() => {
    return visibleMatches.reduce((acc, match) => {
      const key = match.league || 'Other'
      if (!acc[key]) acc[key] = []
      acc[key].push(match)
      return acc
    }, {} as Record<string, TodayMatch[]>)
  }, [visibleMatches])

  const sortedLeagueNames = useMemo(
    () =>
      Object.keys(matchesByLeague).sort((a, b) => {
        const pa = leaguePriority(a)
        const pb = leaguePriority(b)
        if (pa !== pb) return pa - pb
        return a.localeCompare(b)
      }),
    [matchesByLeague]
  )

  const activeLeague = leagues.find((l) => l.competitionId === selectedLeague)

  return (
    <div className="min-h-screen">
      <DateStrip
        dateOptions={dateOptions}
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
      />

      <div className="mx-auto w-full max-w-5xl px-3 pb-8 pt-3 sm:px-4">
        {/* League filter chips — quiet, one horizontal line */}
        <div
          className="mb-2 flex items-center gap-1 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="group"
          aria-label="Filter by competition"
        >
          <button
            type="button"
            onClick={() => selectLeague('all')}
            aria-pressed={selectedLeague === 'all'}
            className={cn(
              'flex min-h-[36px] shrink-0 items-center rounded-full px-3 text-xs font-semibold transition-colors',
              selectedLeague === 'all'
                ? 'bg-[var(--card-hover)] text-[var(--text-primary)]'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
            )}
          >
            All leagues
          </button>
          {leagues.map((league) => {
            const active = selectedLeague === league.competitionId
            return (
              <button
                key={league.competitionId}
                type="button"
                onClick={() => selectLeague(league.competitionId)}
                aria-pressed={active}
                className={cn(
                  'flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors',
                  active
                    ? 'bg-[var(--card-hover)] text-[var(--text-primary)]'
                    : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                )}
              >
                {league.logoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={league.logoUrl} alt="" className="h-3.5 w-3.5 object-contain" aria-hidden="true" />
                )}
                {league.shortName}
              </button>
            )
          })}
        </div>

        {/* The scores list IS the page */}
        {loading && visibleMatches.length === 0 ? (
          <Card className="flex items-center justify-center gap-2 py-12 text-small text-[var(--text-tertiary)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading matches…
          </Card>
        ) : sortedLeagueNames.length === 0 ? (
          <EmptyState
            illustration="no-matches"
            title={
              activeLeague
                ? `No ${activeLeague.displayName} matches on this date`
                : 'No matches scheduled'
            }
            description={
              activeLeague
                ? 'Try another day, or open the competition page for the full schedule.'
                : 'Try a different date, or browse a competition for its full schedule.'
            }
            action={
              <Button asChild variant="default" size="sm">
                {activeLeague ? (
                  <Link href={`/leagues/${activeLeague.competitionId}`}>
                    Open {activeLeague.shortName} page
                  </Link>
                ) : (
                  <Link href="/leagues">Browse leagues</Link>
                )}
              </Button>
            }
          />
        ) : (
          <Card className="overflow-hidden p-0">
            {sortedLeagueNames.map((leagueName) => (
              <LeagueSection
                key={leagueName}
                leagueName={leagueName}
                leagueId={matchesByLeague[leagueName][0]?.leagueId}
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
            Predictions are educational only — not betting advice.
          </p>
        </div>
      </div>
    </div>
  )
}

export default function MatchesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--text-tertiary)]" />
        </div>
      }
    >
      <MatchesContent />
    </Suspense>
  )
}
