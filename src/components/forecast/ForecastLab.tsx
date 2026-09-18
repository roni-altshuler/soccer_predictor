'use client'

import Link from 'next/link'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, ArrowUpRight, Bookmark, Check, FlaskConical, RefreshCw, Search, Share2, SlidersHorizontal } from 'lucide-react'
import { TeamCrest } from '@/components/primitives/TeamCrest'
import { LeagueMark } from '@/components/primitives/LeagueMark'
import { FollowTeamButton } from '@/components/team/FollowTeamButton'
import { useTeamWatchlist } from '@/hooks/useTeamWatchlist'
import { normalizeTeamName, teamMatchesWatchlist } from '@/lib/watchlist'
import { getLeagueAccent } from '@/lib/leagueAccents'
import { pointsScenario, type LabData, type LabFixture } from '@/lib/forecastLab'
import { cn } from '@/lib/utils'

const panel = 'rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)]'
const control = 'min-h-11 rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] px-3 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--card-hover)]'
const colors = ['var(--accent-primary)', 'var(--accent-warn)', 'var(--accent-info)']
const percent = (p: number) => `${(p * 100).toFixed(1)}%`
const dayLabel = (date: string) => new Date(`${date.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

export function ForecastLab({ initialData, initialFixture }: { initialData: LabData; initialFixture?: string }) {
  const [data, setData] = useState(initialData)
  const [selected, setSelected] = useState(initialFixture ?? initialData.fixtures[0]?.fixture_uid)
  const [competition, setCompetition] = useState('all')
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [following, setFollowing] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [outcome, setOutcome] = useState<'H' | 'D' | 'A' | null>(null)
  const [notice, setNotice] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [interactive, setInteractive] = useState(false)
  const request = useRef<AbortController | null>(null)
  const { teams } = useTeamWatchlist()
  const trackedNames = useMemo(() => new Set(teams.map((team) => normalizeTeamName(team.name))), [teams])
  const leagues = useMemo(() => Array.from(new Set(data.fixtures.map((f) => f.competition_id))), [data.fixtures])
  const visible = useMemo(() => data.fixtures.filter((f) =>
    (competition === 'all' || competition === f.competition_id) &&
    (!following || teamMatchesWatchlist(f.home, trackedNames) || teamMatchesWatchlist(f.away, trackedNames)) &&
    `${f.home} ${f.away}`.toLocaleLowerCase().includes(deferredSearch.trim().toLocaleLowerCase())),
  [data.fixtures, competition, following, trackedNames, deferredSearch])
  const fixture = visible.find((f) => f.fixture_uid === selected) ?? visible[0]
  const fixtureId = fixture?.fixture_uid
  const lastFixture = useRef(fixtureId)

  useEffect(() => {
    if (lastFixture.current !== fixtureId) setOutcome(null)
    lastFixture.current = fixtureId
    if (!fixtureId) return
    const url = new URL(window.location.href)
    url.searchParams.set('fixture', fixtureId)
    window.history.replaceState(window.history.state, '', url)
  }, [fixtureId])
  useEffect(() => {
    setInteractive(true)
    return () => { const pending = request.current; request.current = null; pending?.abort() }
  }, [])

  async function refresh() {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    const timeout = setTimeout(() => controller.abort(), 15000)
    setRefreshing(true)
    setNotice('')
    try {
      const response = await fetch(`/api/v1/forecast-lab?fixture=${encodeURIComponent(selected ?? '')}`, { signal: controller.signal, cache: 'no-store' })
      if (!response.ok) throw new Error('Unavailable')
      const next = await response.json() as LabData
      if (!next.available || !Array.isArray(next.fixtures)) throw new Error('Unavailable')
      setData(next)
      setNotice('You’re viewing the latest published forecasts.')
    } catch {
      if (request.current === controller) setNotice('Couldn’t refresh. Your last loaded forecasts are still here. Try again.')
    } finally {
      clearTimeout(timeout)
      if (request.current === controller) setRefreshing(false)
    }
  }

  async function share() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setNotice('Match link copied. Share the forecast with your friends.')
    } catch {
      setNotice('Copy this page’s address to share this match.')
    }
  }

  const stale = Boolean(data.generatedAt && new Date(`${data.from}T00:00:00Z`).getTime() - Date.parse(data.generatedAt) > 48 * 3600000)
  return (
    <div className="mx-auto max-w-[1440px] px-3 pb-10 pt-6 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--accent-info)]"><FlaskConical size={14} aria-hidden />Football intelligence, explored</p>
          <h1 className="text-3xl font-extrabold tracking-tight text-[var(--text-primary)] sm:text-5xl">Forecast Lab<span className="text-[var(--accent-primary)]">.</span></h1>
          <p className="mt-3 max-w-lg text-sm leading-relaxed text-[var(--text-secondary)]">Every match has more than one story. Explore the chances. Test an outcome. See the points at stake.</p>
        </div>
        <Link href="/predict" className={cn(control, 'inline-flex items-center gap-2')}><SlidersHorizontal size={15} aria-hidden />Build any matchup<ArrowUpRight size={14} aria-hidden /></Link>
      </header>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-2 border-y border-[var(--border-color)] py-2 text-xs text-[var(--text-secondary)]">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 py-1">
          <span><strong className="font-mono text-[var(--text-primary)]">{data.fixtures.length}</strong> recorded forecasts</span>
          <span>{leagues.length} leagues</span>
          <span>{dayLabel(data.from)} — {dayLabel(data.through)}</span>
        </div>
        <button onClick={refresh} disabled={refreshing || !interactive} className="flex min-h-11 items-center gap-2 text-xs disabled:opacity-60" aria-label="Refresh forecasts"><RefreshCw size={13} className={refreshing ? 'animate-spin motion-reduce:animate-none' : ''} aria-hidden />{refreshing ? 'Refreshing…' : data.generatedAt ? `Published ${dayLabel(data.generatedAt)}` : 'Retry forecasts'}</button>
      </div>
      <p role="status" className={cn('text-xs text-[var(--accent-info)]', notice && 'mb-4')}>{notice}</p>
      {stale && <p className="mb-4 rounded-lg border border-[var(--border-color)] p-3 text-xs text-[var(--text-secondary)]">This forecast is more than 48 hours old. Recent results or schedule changes may not be reflected.</p>}
      {initialFixture && !data.fixtures.some((f) => f.fixture_uid === initialFixture) && <p className="mb-4 text-xs text-[var(--text-secondary)]">The shared match is no longer in the upcoming forecast. Explore another match below.</p>}

      {!data.available ? <div className={cn(panel, 'px-6 py-16 text-center')}><FlaskConical className="mx-auto mb-4 text-[var(--text-tertiary)]" aria-hidden /><h2 className="text-lg font-semibold">The lab is waiting for a forecast</h2><p className="mx-auto mt-2 max-w-md text-sm text-[var(--text-secondary)]">The published forecast couldn’t be loaded. Use “Retry forecasts” above to try again.</p></div> :
        <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
          <aside className={cn(panel, 'min-w-0 overflow-hidden')} aria-label="Choose a match">
            <button disabled={!interactive} onClick={() => setPickerOpen((open) => !open)} aria-expanded={pickerOpen} aria-controls="lab-match-picker" className="flex min-h-14 w-full items-center justify-between gap-3 px-4 text-xs font-semibold text-[var(--text-primary)] xl:hidden"><span className="flex items-center gap-2"><Search size={15} aria-hidden />Choose a match</span><span className="font-mono text-[var(--text-tertiary)]">{visible.length} fixtures {pickerOpen ? '−' : '+'}</span></button>
            <div id="lab-match-picker" className={cn(pickerOpen ? 'block' : 'hidden', 'xl:block')}>
            <div className="border-b border-[var(--border-color)] p-4">
              <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-bold text-[var(--text-primary)]">Find your match</h2><span className="font-mono text-xs text-[var(--text-tertiary)]" aria-live="polite">{visible.length}</span></div>
              <label className="relative block"><span className="sr-only">Search clubs</span><Search size={15} aria-hidden className="absolute left-3 top-3.5 text-[var(--text-tertiary)]" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clubs…" className={cn(control, 'w-full pl-9')} type="search" /></label>
              <div className="mt-2 flex gap-2">
                <label className="min-w-0 flex-1"><span className="sr-only">Competition</span><select value={competition} onChange={(e) => setCompetition(e.target.value)} className={cn(control, 'w-full pr-1')}><option value="all">All leagues</option>{leagues.map((id) => <option key={id} value={id}>{getLeagueAccent(id).displayName}</option>)}</select></label>
                <button aria-label="Show followed clubs" aria-pressed={following} onClick={() => setFollowing((v) => !v)} className={cn(control, 'shrink-0', following && 'border-[var(--accent-primary)] text-[var(--accent-primary)]')}><Bookmark size={16} fill={following ? 'currentColor' : 'none'} aria-hidden /></button>
              </div>
            </div>
            <div className="max-h-[280px] overflow-y-auto overscroll-contain xl:max-h-[630px]" role="group" aria-label="Recorded matches">
              {visible.length === 0 ? <div className="p-6 text-sm text-[var(--text-secondary)]"><p>{following && teams.length === 0 ? 'Follow a club using the buttons under a match to make this view yours.' : 'No matches in this view.'}</p><button className={cn(control, 'mt-4')} onClick={() => { setSearch(''); setCompetition('all'); setFollowing(false) }}>Show all matches</button></div> : visible.map((f) => <button key={f.fixture_uid} onClick={() => { setSelected(f.fixture_uid); setOutcome(null); setPickerOpen(false) }} aria-pressed={fixture?.fixture_uid === f.fixture_uid} className={cn('block w-full border-b border-l-2 border-b-[var(--border-color)] p-4 text-left transition-colors last:border-b-0 hover:bg-[var(--card-hover)]', fixture?.fixture_uid === f.fixture_uid ? 'border-l-[var(--accent-primary)] bg-[var(--card-hover)]' : 'border-l-transparent')}>
                <span className="mb-2 flex justify-between gap-2 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]"><span>{getLeagueAccent(f.competition_id).shortName}</span><span>{dayLabel(f.date)}</span></span>
                {[f.home, f.away].map((team) => <span key={team} className="mt-1 flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]"><TeamCrest team={team} competitionId={f.competition_id} size="sm" /><span className="min-w-0 truncate">{team}</span></span>)}
              </button>)}
            </div>
            </div>
          </aside>

          {fixture ? <div className="min-w-0 space-y-4">
            <section className={cn(panel, 'overflow-hidden')} aria-label="Selected forecast">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-color)] px-4 py-2 sm:px-6">
                <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]"><LeagueMark league={fixture.competition_id} size="xs" />{getLeagueAccent(fixture.competition_id).displayName}<span aria-hidden>·</span><time dateTime={fixture.date}>{dayLabel(fixture.date)}</time></div>
                <button onClick={share} className="flex min-h-11 items-center gap-2 text-xs text-[var(--text-secondary)]"><Share2 size={14} aria-hidden />Share match</button>
              </div>
              <div className="px-4 py-6 sm:px-8 sm:py-8">
                <div className="grid grid-cols-[minmax(0,1fr)_36px_minmax(0,1fr)] items-start gap-2 sm:grid-cols-[minmax(0,1fr)_60px_minmax(0,1fr)]">
                  {[fixture.home, fixture.away].map((team, i) => <div key={`${fixture.fixture_uid}:${team}`} className={cn('flex min-w-0 flex-col items-center text-center', i === 1 && 'col-start-3 row-start-1')}><TeamCrest team={team} competitionId={fixture.competition_id} size="lg" className="!h-14 !w-14 !text-lg sm:!h-16 sm:!w-16" /><span className="mt-3 text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">{i === 0 ? 'Home' : 'Away'}</span><h2 className="mt-1 text-base font-bold leading-tight text-[var(--text-primary)] sm:text-2xl">{team}</h2><FollowTeamButton teamName={team} league={getLeagueAccent(fixture.competition_id).displayName} className="mt-3" /></div>)}
                  <div className="col-start-2 row-start-1 pt-6 text-center font-mono text-xs text-[var(--text-tertiary)]">VS</div>
                </div>
                <div className="mt-7 flex items-center justify-between gap-3"><h3 className="text-xs font-semibold text-[var(--text-primary)]">Three ways this could go</h3><span className="text-[10px] text-[var(--text-tertiary)]">90 minutes + stoppage time</span></div>
                <div className="mt-3 flex h-2.5 overflow-hidden rounded-full" aria-hidden>{[fixture.p_home, fixture.p_draw, fixture.p_away].map((p, i) => <span key={i} style={{ width: `${p * 100}%`, background: colors[i] }} />)}</div>
                <div className="mt-3 grid grid-cols-3 gap-2" role="group" aria-label="Explore an outcome">
                  {(['H', 'D', 'A'] as const).map((key, i) => <button key={key} disabled={!interactive} aria-pressed={outcome === key} onClick={() => setOutcome(outcome === key ? null : key)} className={cn('min-h-20 rounded-xl border px-1 py-3 text-center transition-colors sm:px-3', outcome === key ? 'border-[var(--text-secondary)] bg-[var(--card-hover)]' : 'border-[var(--border-color)] hover:bg-[var(--card-hover)]')}><span className="block text-[10px] text-[var(--text-secondary)]">{['Home win', 'Draw', 'Away win'][i]}</span><span className="mt-1 block font-mono text-xl font-semibold sm:text-3xl" style={{ color: colors[i] }}>{percent([fixture.p_home, fixture.p_draw, fixture.p_away][i])}</span><span className="mt-1 flex items-center justify-center gap-1 text-[9px] text-[var(--text-tertiary)]">{outcome === key ? <><Check size={10} aria-hidden />Exploring</> : <>What if?<ArrowRight size={10} aria-hidden /></>}</span></button>)}
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-tertiary)]">These are chances, not certainties. Even the favourite can lose. Select an outcome to explore its points swing below.</p>
              </div>
            </section>

            <div className="grid gap-4 lg:grid-cols-2">
              <Scorelines fixture={fixture} />
              <Points fixture={fixture} outcome={outcome} reset={() => setOutcome(null)} />
            </div>
            <details className={cn(panel, 'px-5 py-1')}>
              <summary className="flex min-h-12 cursor-pointer items-center gap-2 text-xs font-semibold text-[var(--text-secondary)]"><FlaskConical size={15} aria-hidden />Inside this forecast<span className="ml-auto text-lg" aria-hidden>+</span></summary>
              <div className="space-y-3 border-t border-[var(--border-color)] py-4 text-xs leading-relaxed text-[var(--text-secondary)]"><p>Team strength ratings and recent form feed a three-outcome model. A goal model is then fitted to reproduce those outcome probabilities, so the scorelines and win chances tell the same story.</p><p>The goal figures are model estimates before the match, not shot-based xG measured during play. This forecast does not incorporate confirmed lineups, injuries or live events.</p><dl className="grid grid-cols-2 gap-3"><div><dt className="text-[var(--text-tertiary)]">Trained through</dt><dd>{data.trainedThrough ?? 'Not recorded'}</dd></div><div><dt className="text-[var(--text-tertiary)]">Model version</dt><dd className="break-all font-mono">{data.modelVersion ?? 'Not recorded'}</dd></div></dl><Link href="/evaluation" className="inline-flex min-h-11 items-center gap-2 text-[var(--accent-info)]">Explore the evidence<ArrowUpRight size={14} aria-hidden /></Link></div>
            </details>
          </div> : <div className={cn(panel, 'px-6 py-16 text-center text-sm text-[var(--text-secondary)]')}>Choose another league or clear your filters to find a forecast.</div>}
        </div>}
      <p className="mt-6 text-center text-[10px] leading-relaxed text-[var(--text-tertiary)]">Recorded forecasts, refreshed when a new model run is published. Dates follow the source schedule; kickoff times are available on matchday.{data.excluded > 0 ? ' Some incomplete forecasts have been withheld.' : ''}</p>
    </div>
  )
}

function Scorelines({ fixture: f }: { fixture: LabFixture }) {
  const scores = [...f.scorelines].sort((a, b) => b.p - a.p).slice(0, 5)
  const other = Math.max(0, 1 - scores.reduce((sum, s) => sum + s.p, 0))
  return <section className={cn(panel, 'p-5')} aria-label="Scoreline forecast"><p className="text-[9px] uppercase tracking-[0.15em] text-[var(--text-tertiary)]">The goal picture</p><h3 className="mt-1 text-base font-bold text-[var(--text-primary)]">Likeliest scorelines</h3><p className="mt-2 text-xs text-[var(--text-secondary)]">Expected goals <span className="ml-2 font-mono text-[var(--text-primary)]">{f.xg_home.toFixed(2)} : {f.xg_away.toFixed(2)}</span></p>
    <div className="mt-5 space-y-3">{scores.map((s) => <div key={s.score} className="grid grid-cols-[32px_minmax(0,1fr)_48px] items-center gap-3 text-xs"><span className="font-mono font-semibold text-[var(--text-primary)]">{s.score.replace('-', '–')}</span><div className="h-2 overflow-hidden rounded-full bg-[var(--card-hover)]"><div className="h-full rounded-full bg-[var(--accent-primary)]" style={{ width: `${s.p * 100}%` }} /></div><span className="text-right font-mono text-[var(--text-secondary)]">{percent(s.p)}</span></div>)}</div>
    <div className="mt-4 flex justify-between gap-2 border-t border-[var(--border-color)] pt-3 text-xs text-[var(--text-secondary)]"><span>All other scorelines</span><span className="font-mono">{percent(other)}</span></div><p className="mt-3 text-[10px] leading-relaxed text-[var(--text-tertiary)]">Home goals first. No single scoreline captures the whole match.</p>
  </section>
}

function Points({ fixture: f, outcome, reset }: { fixture: LabFixture; outcome: 'H' | 'D' | 'A' | null; reset: () => void }) {
  const { expected, conditional, deltas } = pointsScenario(f, outcome)
  return <section className={cn(panel, 'p-5')} aria-label="Points scenario"><div className="flex items-center justify-between"><p className="text-[9px] uppercase tracking-[0.15em] text-[var(--text-tertiary)]">The points at stake</p>{outcome && <button onClick={reset} className="-my-3 min-h-11 text-[10px] text-[var(--accent-info)]">Reset</button>}</div><h3 className="mt-1 text-base font-bold text-[var(--text-primary)]">{outcome === 'H' ? 'If the home side wins…' : outcome === 'D' ? 'If it ends level…' : outcome === 'A' ? 'If the away side wins…' : 'What could this match mean?'}</h3>
    <div className="mt-4 space-y-4" aria-live="polite">{[f.home, f.away].map((team, i) => <div key={team}><div className="flex items-center gap-2 text-xs"><TeamCrest team={team} competitionId={f.competition_id} size="sm" /><span className="min-w-0 flex-1 truncate text-[var(--text-secondary)]">{team}</span><strong className="font-mono text-xl text-[var(--text-primary)]">{conditional[i].toFixed(outcome ? 0 : 2)}<span className="ml-1 text-[10px] font-normal">pts</span></strong></div><div className="mt-2 h-1 rounded-full bg-[var(--card-hover)]"><div className="h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${conditional[i] / 3 * 100}%`, background: colors[i === 0 ? 0 : 2] }} /></div><p className="mt-1 text-right text-[10px] text-[var(--text-tertiary)]">{outcome ? `${deltas[i] >= 0 ? '+' : ''}${deltas[i].toFixed(2)} vs ${expected[i].toFixed(2)} expected` : 'Expected points from this match'}</p></div>)}</div>
    <p className="mt-4 text-[10px] leading-relaxed text-[var(--text-tertiary)]">{outcome ? 'A hypothetical result, not a new prediction. Match points only; title and relegation chances need a full season simulation.' : 'Expected points = 3 × win chance + draw chance. Select a result above to compare it with the forecast.'}</p><Link href={`/leagues/${f.competition_id}`} className="mt-2 inline-flex min-h-11 items-center gap-2 text-xs font-semibold text-[var(--accent-info)]">Explore the season race<ArrowUpRight size={14} aria-hidden /></Link>
  </section>
}
