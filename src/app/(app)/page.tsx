'use client'

import Link from 'next/link'
import { useState, useEffect, useMemo } from 'react'
import { ArrowUpRight, Bookmark, BookmarkCheck, CalendarRange, RefreshCw, Trophy } from 'lucide-react'

import { normalizeTeamName, teamMatchesWatchlist } from '@/lib/watchlist'
import { EmptyState } from '@/components/EmptyState'
import { EvidencePanel, type Historical, type Live } from '@/components/forecast/EvidencePanel'
import { useGenderQuery } from '@/hooks/useGenderQuery'
import { useMatchday, type DayMatch } from '@/hooks/useMatchday'
import { useTeamWatchlist } from '@/hooks/useTeamWatchlist'
import { DateStrip, type DateOption } from '@/components/match/DateStrip'
import { ClubHouse, MatchdaySpotlight, fixtureHref } from '@/components/match/MatchdaySpotlight'
import { LeagueSection } from '@/components/match/LeagueSection'
import { LeagueMark } from '@/components/primitives/LeagueMark'
import { MatchCardSkeleton } from '@/components/skeletons'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

const EMPTY_MATCHES: DayMatch[] = []
const FILTER_CHIP = 'flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] px-3 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--card-hover)]'
const ACTIVE_CHIP = 'border-[var(--accent-primary)] bg-[var(--card-hover)] text-[var(--text-primary)]'

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

function groupMatchesByLeague(matches: DayMatch[]): Record<string, DayMatch[]> {
  return matches.reduce((acc, match) => {
    const key = match.league || 'Other'
    if (!acc[key]) acc[key] = []
    acc[key].push(match)
    return acc
  }, {} as Record<string, DayMatch[]>)
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

export default function Home() {
  // Resolve the reader's date after hydration; server and browser timezones may differ.
  const [dateOptions, setDateOptions] = useState<DateOption[]>([])
  const [selectedDate, setSelectedDate] = useState('')
  useEffect(() => {
    const options = getDateOptions()
    setDateOptions(options)
    setSelectedDate(options.find((d) => d.isToday)!.date)
  }, [])
  const [tab, setTab] = useState<'all' | 'live' | 'upcoming' | 'finished'>('all')
  const [competition, setCompetition] = useState('all')
  const [watchlistOnly, setWatchlistOnly] = useState(false)
  const [historical, setHistorical] = useState<Historical | null>(null)
  const [liveRecord, setLiveRecord] = useState<Live | null>(null)
  const { asQueryParam } = useGenderQuery()
  const { data, loading, error, retry } = useMatchday(selectedDate, asQueryParam)
  const { teams: trackedTeams } = useTeamWatchlist()
  const live = data?.live ?? EMPTY_MATCHES
  const upcoming = data?.upcoming ?? EMPTY_MATCHES
  const completed = data?.completed ?? EMPTY_MATCHES
  const allMatches = useMemo(() => [...live, ...upcoming, ...completed], [live, upcoming, completed])
  const trackedNames = useMemo(() => new Set(trackedTeams.map((t) => normalizeTeamName(t.name))), [trackedTeams])
  const followed = (m: DayMatch) => teamMatchesWatchlist(m.home_team, trackedNames) || teamMatchesWatchlist(m.away_team, trackedNames)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/v1/evaluation', { cache: 'no-store', signal: controller.signal })
      .then((r) => { if (!r.ok) throw new Error('Evaluation unavailable'); return r.json() })
      .then((result) => {
        if (controller.signal.aborted) return
        setHistorical(result?.available === false ? null : result?.historical ?? null)
        setLiveRecord(result?.available === false ? null : result?.live ?? null)
      })
      .catch(() => { /* EvidencePanel carries its own unavailable state. */ })
    return () => controller.abort()
  }, [])

  const competitions = useMemo(() => {
    const counts = new Map<string, { name: string; id?: string; count: number }>()
    for (const m of allMatches) {
      const entry = counts.get(m.league)
      if (entry) entry.count++
      else counts.set(m.league, { name: m.league, id: m.leagueId, count: 1 })
    }
    return [...counts.values()].sort((a, b) => leaguePriority(a.name) - leaguePriority(b.name) || a.name.localeCompare(b.name))
  }, [allMatches])
  const activeCompetition = competitions.some((c) => c.name === competition) ? competition : 'all'
  const onlyFollowing = watchlistOnly && trackedTeams.length > 0
  const scoped = allMatches.filter((m) => (activeCompetition === 'all' || m.league === activeCompetition) && (!onlyFollowing || followed(m)))
  const visible = scoped.filter((m) => tab === 'all' || (tab === 'finished' ? completed.includes(m) : tab === 'live' ? live.includes(m) : upcoming.includes(m)))
  const grouped = groupMatchesByLeague(visible)
  const leagueNames = Object.keys(grouped).sort((a, b) => leaguePriority(a) - leaguePriority(b) || a.localeCompare(b))
  const spotlight = [...scoped].filter((m) => m.id).sort((a, b) => {
    const rank = (m: DayMatch) => live.includes(m) ? 0 : upcoming.includes(m) ? 1 : 2
    return rank(a) - rank(b) || Number(followed(b)) - Number(followed(a)) || leaguePriority(a.league) - leaguePriority(b.league) || (a.time ?? '').localeCompare(b.time ?? '')
  }).slice(0, 5)
  const counts = { all: scoped.length, live: scoped.filter((m) => live.includes(m)).length, upcoming: scoped.filter((m) => upcoming.includes(m)).length, finished: scoped.filter((m) => completed.includes(m)).length }
  const dateTitle = selectedDate ? new Date(`${selectedDate}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) : 'Your matchday'

  return (
    <div className="min-h-screen">
      <DateStrip dateOptions={dateOptions} selectedDate={selectedDate} onSelectDate={(date) => { setSelectedDate(date); setCompetition('all') }} />
      <div className="mx-auto w-full max-w-6xl px-3 pb-8 pt-5 sm:px-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">{dateTitle}</p>
            <h1 className="text-2xl font-extrabold text-[var(--text-primary)] sm:text-3xl">Matchday</h1>
          </div>
          {data && <p className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
            {live.length > 0 && <><span className="h-2 w-2 rounded-full bg-[var(--accent-loss)]" aria-hidden /><span className="text-[var(--live-text)]">{live.length} live</span><span aria-hidden> / </span></>}
            {allMatches.length} matches
          </p>}
        </div>

        {error && <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-2 text-xs text-[var(--text-secondary)]">
          <span>{error}{data ? ' Showing the last available scores.' : ''}</span>
          <button type="button" onClick={retry} className="inline-flex min-h-11 items-center gap-2 text-[var(--accent-info)]"><RefreshCw className="h-3.5 w-3.5" aria-hidden />Try again</button>
        </div>}

        {spotlight.length > 0 && <div className="mb-6 grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
          <MatchdaySpotlight key={`${selectedDate}-${asQueryParam}`} matches={spotlight} />
          <ClubHouse matches={spotlight} />
        </div>}

        {competitions.length > 0 && <div aria-label="Filter by competition" className="mb-4 flex gap-2 overflow-x-auto pb-1">
          <button type="button" aria-pressed={activeCompetition === 'all'} onClick={() => setCompetition('all')} className={cn(FILTER_CHIP, activeCompetition === 'all' && ACTIVE_CHIP)}>All competitions <span className="text-[var(--text-tertiary)]">{competitions.length}</span></button>
          {competitions.map((c) => <button key={c.name} type="button" aria-pressed={activeCompetition === c.name} onClick={() => setCompetition(c.name)} className={cn(FILTER_CHIP, activeCompetition === c.name && ACTIVE_CHIP)}>
            <LeagueMark league={c.id ?? c.name} size="xs" />{c.name}<span className="text-[var(--text-tertiary)]">{c.count}</span>
          </button>)}
        </div>}

        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Filter matches">
            {(['all', 'live', 'upcoming', 'finished'] as const).map((value) => <button key={value} type="button" aria-pressed={tab === value} onClick={() => setTab(value)} className={cn('flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-xs transition-colors', tab === value ? 'bg-[var(--card-hover)] font-semibold text-[var(--text-primary)]' : 'text-[var(--text-tertiary)] hover:bg-[var(--card-bg)]')}>
              {value === 'all' ? 'All matches' : value === 'live' ? 'Live' : value === 'upcoming' ? 'To play' : 'Finished'}
              <span className="text-[10px] tabular-nums text-[var(--text-tertiary)]">{counts[value]}</span>
            </button>)}
          </div>
          <button type="button" disabled={trackedTeams.length === 0} onClick={() => setWatchlistOnly((v) => !v)} aria-pressed={onlyFollowing} className={cn(FILTER_CHIP, 'disabled:opacity-50', onlyFollowing && ACTIVE_CHIP)}>
            {onlyFollowing ? <BookmarkCheck className="h-3.5 w-3.5" aria-hidden /> : <Bookmark className="h-3.5 w-3.5" aria-hidden />}
            Following{trackedTeams.length > 0 ? ` · ${trackedTeams.length}` : ''}
          </button>
        </div>

        {loading ? <Card className="overflow-hidden p-0" aria-busy="true" aria-label="Loading matches"><MatchCardSkeleton count={7} /></Card>
          : !data && error ? null
          : leagueNames.length === 0 ? <EmptyState illustration="no-matches" title={onlyFollowing ? 'Your clubs have no matches in this view' : tab === 'live' ? 'No matches live right now' : 'No matches in this view'} description="Try another day or explore a different competition." action={<button type="button" onClick={() => { setTab('all'); setCompetition('all'); setWatchlistOnly(false) }} className="min-h-11 text-xs text-[var(--accent-info)]">Show all matches</button>} />
          : <Card className="overflow-hidden p-0">{leagueNames.map((name) => <LeagueSection key={name} leagueName={name} leagueId={LEAGUE_ID_MAP[name] ?? grouped[name][0]?.leagueId} countryLabel={LEAGUE_COUNTRY[name]?.country} matches={grouped[name]} hrefFor={(m) => fixtureHref(m as DayMatch)} defaultOpen />)}</Card>}

        <Link href="/lab" className="mt-6 flex min-h-24 items-center justify-between gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-5 transition-colors hover:bg-[var(--card-hover)]">
          <span><span className="text-[10px] uppercase tracking-[0.18em] text-[var(--accent-info)]">Step inside the Forecast Lab</span><span className="mt-1 block text-lg font-bold text-[var(--text-primary)]">Your football curiosity. Meet the model.</span><span className="mt-1 block text-xs text-[var(--text-secondary)]">Explore scorelines, test an outcome and discover the points at stake.</span></span><ArrowUpRight className="h-5 w-5 shrink-0 text-[var(--accent-info)]" aria-hidden />
        </Link>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Link href="/leagues" className="group flex min-h-24 items-center gap-4 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 transition-colors hover:bg-[var(--card-hover)]">
            <CalendarRange className="h-6 w-6 shrink-0 text-[var(--accent-info)]" aria-hidden />
            <span className="flex-1"><span className="block text-sm font-semibold text-[var(--text-primary)]">The race goes on</span><span className="mt-1 block text-xs text-[var(--text-tertiary)]">Title hopes, the table and the run-in.</span></span><ArrowUpRight className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" aria-hidden />
          </Link>
          <Link href="/tournaments" className="group flex min-h-24 items-center gap-4 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 transition-colors hover:bg-[var(--card-hover)]">
            <Trophy className="h-6 w-6 shrink-0 text-[var(--accent-info)]" aria-hidden />
            <span className="flex-1"><span className="block text-sm font-semibold text-[var(--text-primary)]">The road to the final</span><span className="mt-1 block text-xs text-[var(--text-tertiary)]">Explore the ties. Follow the contenders.</span></span><ArrowUpRight className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" aria-hidden />
          </Link>
        </div>
        <EvidencePanel historical={historical} live={liveRecord} matchday className="mt-6" />
      </div>
    </div>
  )
}
