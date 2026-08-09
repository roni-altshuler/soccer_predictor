'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'

import { EmptyState } from '@/components/EmptyState'
import { AsyncSection } from '@/components/primitives'
import { LeagueSection } from '@/components/match/LeagueSection'
import type { MatchRowMatch } from '@/components/match/MatchRow'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useGenderQuery } from '@/hooks/useGenderQuery'
import { getLeagueAccent } from '@/lib/leagueAccents'
import { cn } from '@/lib/utils'

/**
 * /upcoming — Fixtures (Matchday v3).
 *
 * A FotMob-style fixtures list built from the committed prediction log
 * (`/upcoming/feed`, same source as before): upcoming fixtures grouped by
 * day with sticky day headers, each day's matches rendered through
 * LeagueSection/MatchRow so committed 1X2 probabilities and scorelines
 * appear in the standard AI zone. No telemetry cards, no calendar grid.
 */

interface Fixture {
  match_id: string
  league: string
  home_team: string
  away_team: string
  venue: string | null
  date: string
  home_win: number | null
  draw: number | null
  away_win: number | null
  predicted_scoreline: string | null
  actual_home_goals: number | null
  actual_away_goals: number | null
  winner_correct: boolean | null
  status: 'completed' | 'pending'
}

interface Feed {
  year: number
  month: number
  fixtures: Fixture[]
}

/** Marquee competitions bubble to the top of each day (FotMob ordering). */
const LEAGUE_PRIORITY: string[] = [
  'FIFA World Cup',
  'FIFA World Cup 2026',
  'UEFA Champions League',
  'UEFA Europa League',
  'Premier League',
  'La Liga',
  'Bundesliga',
  'Serie A',
  'Ligue 1',
  'MLS',
]

function leaguePriority(name: string): number {
  const idx = LEAGUE_PRIORITY.indexOf(name)
  return idx === -1 ? 100 : idx
}

/** Current month + next month — predictions run 7 days ahead, so this covers the window. */
function feedMonths(now: Date): { year: number; month: number }[] {
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 }
  return [{ year, month }, next]
}

function toMatchRow(fx: Fixture): MatchRowMatch {
  return {
    id: fx.match_id,
    home_team: fx.home_team,
    away_team: fx.away_team,
    home_score: fx.actual_home_goals,
    away_score: fx.actual_away_goals,
    status: fx.status === 'completed' ? 'finished' : 'scheduled',
    venue: fx.venue,
    ai_home_prob: fx.home_win,
    ai_draw_prob: fx.draw,
    ai_away_prob: fx.away_win,
    predicted_scoreline: fx.predicted_scoreline,
  }
}

/** Only numeric ids are real ESPN event ids with a match-detail page. */
function matchHref(m: MatchRowMatch): string | undefined {
  return m.id && /^\d+$/.test(m.id) ? `/matches/${m.id}` : undefined
}

function formatDayLabel(dateKey: string, todayKey: string): string {
  if (dateKey === todayKey) return 'Today'
  try {
    return format(parseISO(dateKey), 'EEEE, MMMM d')
  } catch {
    return dateKey
  }
}

export default function UpcomingFixturesPage() {
  const { asQueryParam } = useGenderQuery()
  const [todayKey] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [fixtures, setFixtures] = useState<Fixture[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedLeague, setSelectedLeague] = useState<string>('all')

  const fetchFeed = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true)
      setError(null)
      try {
        const feeds = await Promise.all(
          feedMonths(new Date()).map(async ({ year, month }) => {
            const res = await fetch(
              `/upcoming/feed?year=${year}&month=${month}&gender=${asQueryParam}`,
              { signal }
            )
            if (!res.ok) throw new Error(`Feed returned ${res.status}`)
            return (await res.json()) as Feed
          })
        )
        if (signal?.aborted) return
        const byId = new Map<string, Fixture>()
        feeds.forEach((feed) => feed.fixtures.forEach((fx) => byId.set(fx.match_id, fx)))
        setFixtures([...byId.values()])
      } catch {
        if (!signal?.aborted) setError('Could not load fixtures.')
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [asQueryParam]
  )

  useEffect(() => {
    const ac = new AbortController()
    fetchFeed(ac.signal)
    return () => ac.abort()
  }, [fetchFeed])

  // Gender switch resets the universe-specific league filter.
  useEffect(() => {
    setSelectedLeague('all')
  }, [asQueryParam])

  // Today onward only — this page is the forward fixture list.
  const upcoming = useMemo(
    () =>
      fixtures
        .filter((fx) => fx.date >= todayKey)
        .sort(
          (a, b) =>
            a.date.localeCompare(b.date) ||
            leaguePriority(a.league) - leaguePriority(b.league) ||
            a.league.localeCompare(b.league) ||
            a.home_team.localeCompare(b.home_team)
        ),
    [fixtures, todayKey]
  )

  const leagueCounts = useMemo(() => {
    const counts = new Map<string, number>()
    upcoming.forEach((fx) => counts.set(fx.league, (counts.get(fx.league) ?? 0) + 1))
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [upcoming])

  const filtered = useMemo(
    () =>
      selectedLeague === 'all'
        ? upcoming
        : upcoming.filter((fx) => fx.league === selectedLeague),
    [upcoming, selectedLeague]
  )

  // Day → league → fixtures, preserving the sorted order.
  const days = useMemo(() => {
    const out: { date: string; leagues: { league: string; fixtures: Fixture[] }[] }[] = []
    filtered.forEach((fx) => {
      let day = out[out.length - 1]
      if (!day || day.date !== fx.date) {
        day = { date: fx.date, leagues: [] }
        out.push(day)
      }
      let group = day.leagues[day.leagues.length - 1]
      if (!group || group.league !== fx.league) {
        group = { league: fx.league, fixtures: [] }
        day.leagues.push(group)
      }
      group.fixtures.push(fx)
    })
    return out
  }, [filtered])

  return (
    <div className="min-h-screen">
      <div className="mx-auto w-full max-w-5xl px-3 pb-8 pt-3 sm:px-4">
        {/* Compact title line — the fixtures list is the page */}
        <div className="mb-2 flex items-baseline justify-between px-1">
          <h1 className="text-[15px] font-bold text-[var(--text-primary)]">Fixtures</h1>
          {!loading && !error && filtered.length > 0 && (
            <span className="text-[11px] tabular-nums text-[var(--text-tertiary)]">
              {filtered.length} fixture{filtered.length === 1 ? '' : 's'}
            </span>
          )}
        </div>

        {/* League filter — quiet chips, one line */}
        {leagueCounts.length > 1 && (
          <div
            className="mb-2 flex flex-wrap items-center gap-1"
            role="group"
            aria-label="Filter by league"
          >
            {[['all', 0] as const, ...leagueCounts].map(([name]) => {
              const active = selectedLeague === name
              const accent = name === 'all' ? null : getLeagueAccent(name)
              const label =
                name === 'all'
                  ? 'All leagues'
                  : accent && accent.competitionId !== 'unknown'
                    ? accent.shortName
                    : name
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => setSelectedLeague(name)}
                  aria-pressed={active}
                  className={cn(
                    'flex min-h-[36px] items-center rounded-full px-3 text-xs font-semibold transition-colors',
                    active
                      ? 'bg-[var(--card-hover)] text-[var(--text-primary)]'
                      : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                  )}
                >
                  {label}
                </button>
              )
            })}
          </div>
        )}

        <AsyncSection
          loading={loading}
          error={error}
          onRetry={() => fetchFeed()}
          section="fixtures"
        >
          {days.length === 0 ? (
            <EmptyState
              illustration="no-matches"
              title={
                selectedLeague === 'all'
                  ? 'No upcoming fixtures'
                  : `No upcoming ${selectedLeague} fixtures`
              }
              description="The prediction log has nothing scheduled from today — or run the AI on any matchup you like."
              action={
                <Button asChild variant="default" size="sm">
                  <Link href="/predict">Open AI predict</Link>
                </Button>
              }
            />
          ) : (
            <div className="space-y-4">
              {days.map((day) => (
                <section key={day.date} aria-label={formatDayLabel(day.date, todayKey)}>
                  {/* Sticky day header */}
                  <h2
                    className={cn(
                      'sticky top-[var(--shell-topbar-h)] z-10 -mx-1 flex items-baseline justify-between',
                      'bg-[var(--background)]/95 px-1 py-2 backdrop-blur-sm'
                    )}
                  >
                    <span className="text-xs font-semibold text-[var(--text-secondary)]">
                      {formatDayLabel(day.date, todayKey)}
                    </span>
                    <span className="text-[10px] tabular-nums text-[var(--text-tertiary)]">
                      {day.leagues.reduce((n, g) => n + g.fixtures.length, 0)}
                    </span>
                  </h2>
                  <Card className="overflow-hidden p-0">
                    {day.leagues.map((group) => {
                      const accent = getLeagueAccent(group.league)
                      return (
                        <LeagueSection
                          key={`${day.date}-${group.league}`}
                          leagueName={group.league}
                          leagueId={
                            accent.competitionId !== 'unknown' ? accent.competitionId : undefined
                          }
                          matches={group.fixtures.map(toMatchRow)}
                          hrefFor={matchHref}
                          defaultOpen
                        />
                      )
                    })}
                  </Card>
                </section>
              ))}
            </div>
          )}
        </AsyncSection>

        {/* Disclaimer — one quiet line, not a banner */}
        <p className="mt-3 px-1 text-right text-[10px] text-[var(--text-tertiary)]">
          Model probabilities, scored against the closing line on the accuracy page.
        </p>
      </div>
    </div>
  )
}
