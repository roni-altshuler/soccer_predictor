'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addMonths, format, parseISO, subMonths } from 'date-fns'
import { motion, useReducedMotion } from 'framer-motion'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { EmptyState } from '@/components/EmptyState'
import {
  AsyncSection,
  FlagBadge,
  LeagueChip,
  ProbBar,
  SectionHeader,
  StatCard,
  StatusChip,
} from '@/components/primitives'
import { useGenderQuery } from '@/hooks/useGenderQuery'
import { getLeagueAccent } from '@/lib/leagueAccents'
import { staggerContainer, staggerItem } from '@/lib/motion'
import { cn } from '@/lib/utils'

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

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function hasStoredProbs(fx: Fixture): boolean {
  return fx.home_win != null && fx.draw != null && fx.away_win != null
}

function TeamLine({ name, won }: { name: string; won: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <FlagBadge country={name} teamName={name} size={20} />
      <span
        className={cn(
          'truncate text-sm font-semibold',
          won ? 'text-[var(--accent-primary)]' : 'text-[var(--text-primary)]'
        )}
      >
        {name}
      </span>
    </span>
  )
}

function FixtureRow({ fx, showLeague }: { fx: Fixture; showLeague: boolean }) {
  const { home_win: homeWin, draw, away_win: awayWin } = fx
  const { actual_home_goals: homeGoals, actual_away_goals: awayGoals } = fx
  const hasProbs = homeWin != null && draw != null && awayWin != null
  const settled = fx.status === 'completed' && homeGoals != null && awayGoals != null
  const homeWon = settled && homeGoals > awayGoals
  const awayWon = settled && awayGoals > homeGoals
  const accent = getLeagueAccent(fx.league)

  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-3 transition-colors hover:bg-[var(--card-hover)]">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <TeamLine name={fx.home_team} won={homeWon} />
          <TeamLine name={fx.away_team} won={awayWon} />
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {settled ? (
            <>
              <span className="text-lg font-black leading-none tabular-nums text-[var(--text-primary)]">
                {homeGoals}–{awayGoals}
              </span>
              {fx.winner_correct != null ? (
                <StatusChip status={fx.winner_correct ? 'correct' : 'incorrect'} />
              ) : (
                <StatusChip status="settled" />
              )}
            </>
          ) : (
            <>
              {hasProbs && fx.predicted_scoreline && (
                <span
                  className="rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums"
                  style={{
                    color: 'var(--accent-ai)',
                    backgroundColor: 'color-mix(in srgb, var(--accent-ai) 12%, transparent)',
                  }}
                >
                  AI {fx.predicted_scoreline}
                </span>
              )}
              <StatusChip status="upcoming" />
            </>
          )}
        </div>
      </div>

      {(showLeague || fx.venue) && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]">
          {showLeague && (
            <>
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: accent.accent }}
                aria-hidden
              />
              <span className="shrink-0">
                {accent.competitionId !== 'unknown' ? accent.shortName : fx.league}
              </span>
              {fx.venue && <span aria-hidden>·</span>}
            </>
          )}
          {fx.venue && <span className="truncate">{fx.venue}</span>}
        </p>
      )}

      {hasProbs && (
        <ProbBar
          size="sm"
          showLabels
          home={homeWin}
          draw={draw}
          away={awayWin}
          className="mt-2.5"
        />
      )}
    </div>
  )
}

export default function UpcomingCalendarPage() {
  const { asQueryParam } = useGenderQuery()
  const prefersReduced = useReducedMotion()

  const [todayKey] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [cursor, setCursor] = useState(() => {
    const n = new Date()
    return new Date(n.getFullYear(), n.getMonth(), 1)
  })
  const [feed, setFeed] = useState<Feed | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedLeague, setSelectedLeague] = useState<string>('all')
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const defaultsApplied = useRef(false)

  const year = cursor.getFullYear()
  const month = cursor.getMonth() + 1
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`
  const isCurrentMonth = todayKey.startsWith(monthPrefix)

  const fetchFeed = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(
          `/upcoming/feed?year=${year}&month=${month}&gender=${asQueryParam}`,
          { signal }
        )
        if (!res.ok) throw new Error(`Feed returned ${res.status}`)
        const data: Feed = await res.json()
        if (!signal?.aborted) setFeed(data)
      } catch {
        if (!signal?.aborted) setError('Could not load the fixture calendar.')
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [year, month, asQueryParam]
  )

  useEffect(() => {
    const ac = new AbortController()
    fetchFeed(ac.signal)
    return () => ac.abort()
  }, [fetchFeed])

  // Gender switch resets the universe-specific selections.
  useEffect(() => {
    defaultsApplied.current = false
    setSelectedLeague('all')
    setSelectedDate(null)
  }, [asQueryParam])

  // Once the feed lands: default the league to the one with fixtures TODAY,
  // and make sure a day is preselected (today in the current month).
  useEffect(() => {
    if (!feed || loading) return
    const feedPrefix = `${feed.year}-${String(feed.month).padStart(2, '0')}`
    const feedIsCurrentMonth = todayKey.startsWith(feedPrefix)

    if (!defaultsApplied.current) {
      defaultsApplied.current = true
      if (feedIsCurrentMonth) {
        const todays = feed.fixtures.filter((f) => f.date === todayKey)
        if (todays.length > 0) {
          const counts = new Map<string, number>()
          todays.forEach((f) => counts.set(f.league, (counts.get(f.league) ?? 0) + 1))
          const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
          setSelectedLeague(top[0])
        }
      }
    }

    setSelectedDate((prev) => {
      if (prev && prev.startsWith(feedPrefix)) return prev
      if (feedIsCurrentMonth) return todayKey
      return feed.fixtures[0]?.date ?? null
    })
  }, [feed, loading, todayKey])

  const monthFixtures = useMemo(() => feed?.fixtures ?? [], [feed])

  const leagueCounts = useMemo(() => {
    const counts = new Map<string, number>()
    monthFixtures.forEach((f) => counts.set(f.league, (counts.get(f.league) ?? 0) + 1))
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [monthFixtures])

  const chipLeagues = useMemo(() => {
    const names = leagueCounts.map(([name]) => name)
    if (selectedLeague !== 'all' && !names.includes(selectedLeague)) {
      names.push(selectedLeague)
    }
    return names
  }, [leagueCounts, selectedLeague])

  const filtered = useMemo(
    () =>
      selectedLeague === 'all'
        ? monthFixtures
        : monthFixtures.filter((f) => f.league === selectedLeague),
    [monthFixtures, selectedLeague]
  )

  const byDate = useMemo(() => {
    const map = new Map<string, Fixture[]>()
    filtered.forEach((f) => {
      const list = map.get(f.date)
      if (list) list.push(f)
      else map.set(f.date, [f])
    })
    return map
  }, [filtered])

  const summary = useMemo(() => {
    const picks = monthFixtures.filter(hasStoredProbs)
    const settled = picks.filter((f) => f.status === 'completed').length
    return {
      fixtures: monthFixtures.length,
      leagues: leagueCounts.length,
      picks: picks.length,
      settled,
      pending: picks.length - settled,
    }
  }, [monthFixtures, leagueCounts])

  const todayCount = useMemo(
    () =>
      isCurrentMonth ? monthFixtures.filter((f) => f.date === todayKey).length : null,
    [isCurrentMonth, monthFixtures, todayKey]
  )

  const cells = useMemo(() => {
    const firstDow = new Date(year, month - 1, 1).getDay()
    const daysInMonth = new Date(year, month, 0).getDate()
    const arr: (string | null)[] = []
    for (let i = 0; i < firstDow; i++) arr.push(null)
    for (let d = 1; d <= daysInMonth; d++) {
      arr.push(`${monthPrefix}-${String(d).padStart(2, '0')}`)
    }
    return arr
  }, [year, month, monthPrefix])

  const dayFixtures = selectedDate ? byDate.get(selectedDate) ?? [] : []
  const monthTitle = format(cursor, 'MMMM yyyy')

  const heroStat =
    !loading && feed && todayCount != null && todayCount > 0 ? (
      <div className="text-right">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
          Today
        </p>
        <p className="text-3xl font-black leading-tight tabular-nums text-[var(--text-primary)]">
          {todayCount}
        </p>
        <p className="text-xs text-[var(--text-tertiary)]">
          fixture{todayCount === 1 ? '' : 's'}
        </p>
      </div>
    ) : undefined

  return (
    <div className="mx-auto w-full max-w-[var(--shell-content-max)] space-y-10 px-4 py-6 md:px-8">
      {/* Hero band */}
      <div className="hero-band p-5 sm:p-6">
        <SectionHeader
          kicker="Match calendar"
          title="Fixtures & predictions"
          description="Every fixture in the prediction log, with stored model probabilities that settle into results."
          action={heroStat}
        />
        {chipLeagues.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2">
            <LeagueChip
              name="All leagues"
              size="sm"
              active={selectedLeague === 'all'}
              onClick={() => setSelectedLeague('all')}
            />
            {chipLeagues.map((name) => {
              const accent = getLeagueAccent(name)
              return (
                <LeagueChip
                  key={name}
                  leagueId={accent.competitionId !== 'unknown' ? accent.competitionId : undefined}
                  name={accent.competitionId !== 'unknown' ? accent.displayName : name}
                  size="sm"
                  active={selectedLeague === name}
                  onClick={() => setSelectedLeague(name)}
                />
              )
            })}
          </div>
        )}
      </div>

      <div className="space-y-4">
        {/* Month summary */}
        {!loading && !error && summary.fixtures > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              label="Fixtures tracked"
              value={summary.fixtures}
              sub={`${monthTitle} · prediction log`}
            />
            <StatCard
              label="Leagues active"
              value={summary.leagues}
              sub={leagueCounts
                .slice(0, 2)
                .map(([name]) => {
                  const accent = getLeagueAccent(name)
                  return accent.competitionId !== 'unknown' ? accent.shortName : name
                })
                .join(' · ')}
            />
            <StatCard
              label="AI picks generated"
              value={summary.picks}
              accent="ai"
              sub={`${summary.settled} settled · ${summary.pending} pending`}
            />
          </div>
        )}

        <AsyncSection
          loading={loading}
          error={error}
          onRetry={() => fetchFeed()}
          section="fixture calendar"
        >
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Calendar */}
            <div className="lg:col-span-2">
              <div className="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]">
                <div className="flex items-center justify-between border-b border-[var(--border-color)] px-3 py-3 sm:px-4">
                  <button
                    type="button"
                    onClick={() => setCursor((c) => subMonths(c, 1))}
                    aria-label="Previous month"
                    className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--muted-bg)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--card-hover)] hover:text-[var(--text-primary)]"
                  >
                    <ChevronLeft className="h-5 w-5" aria-hidden />
                  </button>

                  <div className="flex items-center gap-3">
                    <h2 className="text-lg font-bold text-[var(--text-primary)]">
                      {monthTitle}
                    </h2>
                    {!isCurrentMonth && (
                      <button
                        type="button"
                        onClick={() => {
                          const n = new Date()
                          setCursor(new Date(n.getFullYear(), n.getMonth(), 1))
                        }}
                        className="flex min-h-[40px] items-center rounded-lg border px-3 text-sm font-semibold text-[var(--accent-primary)] transition-colors hover:bg-[color-mix(in_srgb,var(--accent-primary)_10%,transparent)]"
                        style={{
                          borderColor:
                            'color-mix(in srgb, var(--accent-primary) 35%, transparent)',
                        }}
                      >
                        Today
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setCursor((c) => addMonths(c, 1))}
                    aria-label="Next month"
                    className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--muted-bg)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--card-hover)] hover:text-[var(--text-primary)]"
                  >
                    <ChevronRight className="h-5 w-5" aria-hidden />
                  </button>
                </div>

                <div className="p-2.5 sm:p-4">
                  <div className="mb-1.5 grid grid-cols-7 gap-1.5">
                    {WEEKDAYS.map((day) => (
                      <div
                        key={day}
                        className="py-1 text-center text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] sm:text-[11px]"
                      >
                        {day}
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-7 gap-1.5">
                    {cells.map((dateKey, i) => {
                      if (!dateKey) {
                        return <div key={`pad-${i}`} aria-hidden />
                      }
                      const day = Number(dateKey.slice(8))
                      const fx = byDate.get(dateKey) ?? []
                      const isToday = dateKey === todayKey
                      const isSelected = dateKey === selectedDate

                      if (fx.length === 0) {
                        // Quiet empty day — no heavy box.
                        return (
                          <div
                            key={dateKey}
                            className={cn(
                              'flex min-h-[52px] flex-col rounded-xl p-1.5 sm:min-h-[76px] sm:p-2',
                              isToday && 'ring-1 ring-[var(--accent-primary)]'
                            )}
                          >
                            <span
                              className={cn(
                                'text-xs tabular-nums sm:text-sm',
                                isToday
                                  ? 'font-bold text-[var(--accent-primary)]'
                                  : 'text-[var(--text-tertiary)] opacity-60'
                              )}
                            >
                              {day}
                            </span>
                          </div>
                        )
                      }

                      const dayLeagues = [...new Set(fx.map((f) => f.league))]
                      return (
                        <button
                          key={dateKey}
                          type="button"
                          onClick={() => setSelectedDate(dateKey)}
                          aria-pressed={isSelected}
                          aria-label={`${format(parseISO(dateKey), 'MMMM d')}: ${fx.length} fixture${fx.length === 1 ? '' : 's'}`}
                          className={cn(
                            'flex min-h-[52px] flex-col items-start rounded-xl border p-1.5 text-left transition-colors sm:min-h-[76px] sm:p-2',
                            isSelected
                              ? 'surface-elevated border-transparent shadow-lg ring-2 ring-[var(--accent-primary)]'
                              : 'border-[var(--border-color)] bg-[var(--card-bg)] hover:bg-[var(--card-hover)]',
                            isToday && !isSelected && 'ring-1 ring-[var(--accent-primary)]'
                          )}
                        >
                          <span
                            className={cn(
                              'text-xs font-bold tabular-nums sm:text-sm',
                              isToday
                                ? 'text-[var(--accent-primary)]'
                                : 'text-[var(--text-primary)]'
                            )}
                          >
                            {day}
                          </span>
                          <span className="mt-auto flex w-full items-center justify-between gap-1">
                            <span className="hidden items-center gap-0.5 sm:flex">
                              {dayLeagues.slice(0, 3).map((lg) => (
                                <span
                                  key={lg}
                                  className="h-1.5 w-1.5 rounded-full"
                                  style={{ backgroundColor: getLeagueAccent(lg).accent }}
                                  aria-hidden
                                />
                              ))}
                            </span>
                            <span className="ml-auto rounded-full bg-[var(--muted-bg)] px-1.5 text-[10px] font-semibold tabular-nums text-[var(--text-secondary)]">
                              {fx.length}
                            </span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--border-color)] px-4 py-2.5 text-[11px] text-[var(--text-tertiary)]">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="h-3 w-3 rounded ring-1 ring-[var(--accent-primary)]"
                      aria-hidden
                    />
                    today
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-[var(--text-tertiary)]"
                      aria-hidden
                    />
                    league accent
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span
                      className="rounded-full bg-[var(--muted-bg)] px-1.5 font-semibold tabular-nums"
                      aria-hidden
                    >
                      n
                    </span>
                    fixtures that day
                  </span>
                </div>
              </div>
            </div>

            {/* Selected-day panel */}
            <div className="lg:col-span-1">
              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 lg:sticky lg:top-24">
                {selectedDate ? (
                  <>
                    <SectionHeader
                      kicker={selectedLeague === 'all' ? 'All leagues' : selectedLeague}
                      title={format(parseISO(selectedDate), 'EEEE, MMMM d')}
                      description={
                        dayFixtures.length > 0
                          ? `${dayFixtures.length} fixture${dayFixtures.length === 1 ? '' : 's'}`
                          : undefined
                      }
                    />
                    {dayFixtures.length > 0 ? (
                      <motion.div
                        key={`${selectedDate}-${selectedLeague}`}
                        variants={staggerContainer(0.05)}
                        initial={prefersReduced ? false : 'hidden'}
                        animate="visible"
                        className="mt-4 max-h-[62vh] space-y-3 overflow-y-auto pr-1"
                      >
                        {dayFixtures.map((fx) => (
                          <motion.div
                            key={fx.match_id}
                            variants={prefersReduced ? undefined : staggerItem}
                          >
                            <FixtureRow fx={fx} showLeague={selectedLeague === 'all'} />
                          </motion.div>
                        ))}
                      </motion.div>
                    ) : (
                      <EmptyState
                        illustration="no-matches"
                        title="No fixtures on this day"
                        description={
                          selectedLeague === 'all'
                            ? 'Pick a day with a fixture badge to see its matches.'
                            : `No ${selectedLeague} fixtures on this day — try another day or All leagues.`
                        }
                        className="py-6"
                      />
                    )}
                  </>
                ) : (
                  <EmptyState
                    illustration="no-matches"
                    title={`No tracked fixtures in ${monthTitle}`}
                    description="The prediction log has nothing for this month. Jump back to today for live coverage."
                    className="py-6"
                  />
                )}
              </div>
            </div>
          </div>
        </AsyncSection>
      </div>
    </div>
  )
}
