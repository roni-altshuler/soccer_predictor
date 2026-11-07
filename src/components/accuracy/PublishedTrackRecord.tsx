'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { EvidenceHeader } from '@/components/evidence/primitives'
import { AccuracyTimeline } from '@/components/accuracy/AccuracyTimeline'
import { LeagueRecordExplorer } from '@/components/accuracy/LeagueRecordExplorer'
import { EvidenceNavigation } from '@/components/evidence/EvidenceNavigation'
import { MarketBenchmarkPanel } from '@/components/accuracy/MarketBenchmarkPanel'
import { useGenderQuery } from '@/hooks/useGenderQuery'
import { getLeagueAccent } from '@/lib/leagueAccents'
import { accuracyTimeline, exactScoreSummary, filterPublishedRows, outcomeLabel, parsePublishedRecord, probabilityDetails, recordSummary, scorelineAssessment, verifiedLeadHours,
  type PublishedPick, type PublishedRecord, type RecordFilter } from '@/lib/publishedTrackRecord'

const EMPTY: RecordFilter = { competition: '', season: '', from: '', to: '' }
const control = 'min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] px-3 text-sm text-[var(--text-primary)]'
const utc = (text: string | null) => text ? new Date(text).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC' : 'Not available'
const PAGE_SIZE = 25
const periodLabel = (period: PublishedPick['forecastPeriod']) => period === 'regulation' ? '90 minutes plus stoppage time' : period === 'including_extra_time' ? 'Includes extra time' : 'Not recorded'

function HistoryRow({ row }: { row: PublishedPick }) {
  const scored = row.status === 'scored'
  const lead = verifiedLeadHours(row)
  const scoreState = scorelineAssessment(row)
  const scoreLabel = { correct: 'Exact score correct', incorrect: 'Exact score incorrect', missing: 'No stored score forecast · not assessed',
    invalid: 'Invalid stored score forecast · not assessed', ambiguous: 'Conflicting stored score forecasts · not assessed',
    period_unverified: 'Score forecast period unverified · not assessed', unscored: 'Outcome eligibility unverified · not assessed' }[scoreState]
  const label = scored ? row.pick === row.actual!.outcome ? 'Correct' : 'Incorrect' : row.status === 'retrospective' ? 'Recorded after kickoff · not scored' : row.status === 'missing' ? 'No matched forecast · not scored' : row.status === 'pending' ? 'Awaiting result' : 'Unverified · not scored'
  return <article data-record-key={row.key} className="border-t border-[var(--border-color)] py-4">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-sm font-semibold">{row.home} vs {row.away}</h3><p className="text-xs text-[var(--text-secondary)]">{row.date ?? 'Date unverified'} · {getLeagueAccent(row.competitionId).displayName} · season {row.season}</p></div>
    <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
      <div><dt className="text-xs text-[var(--text-tertiary)]">Stored outcome pick</dt><dd>{outcomeLabel(row.pick, row)}</dd></div>
      <div><dt className="text-xs text-[var(--text-tertiary)]">Actual outcome · 90 minutes</dt><dd>{row.actual ? outcomeLabel(row.actual.outcome, row) : 'No verified regulation-time result'}</dd></div>
      <div><dt className="text-xs text-[var(--text-tertiary)]">Record</dt><dd className="font-semibold">{label}</dd></div>
    </dl>
    <details className="mt-2"><summary className="min-h-11 cursor-pointer py-3 text-xs font-semibold text-[var(--accent-info)]">Forecast and verification details</summary>
      <dl className="grid gap-2 text-xs sm:grid-cols-2">
        <div><dt className="text-[var(--text-tertiary)]">Forecast saved</dt><dd>{utc(row.generatedAt)}</dd></div>
        <div><dt className="text-[var(--text-tertiary)]">Forecast outcome period</dt><dd>{periodLabel(row.forecastPeriod)}</dd></div>
        <div><dt className="text-[var(--text-tertiary)]">Verified forecast lead time</dt><dd>{lead === null ? 'Not verified' : `${lead.toFixed(1)} hours before kickoff`}</dd></div>
        <div><dt className="text-[var(--text-tertiary)]">Event time{scored ? ' (verified)' : ' (not used for scoring)'}</dt><dd>{utc(row.kickoffAt)}</dd></div>
        <div><dt className="text-[var(--text-tertiary)]">Result observed</dt><dd>{utc(row.settledAt)}</dd></div>
        <div><dt className="text-[var(--text-tertiary)]">Model version / training through</dt><dd className="break-all">{row.modelVersion ?? 'Not recorded'} / {row.trainedThrough ?? 'Unverified'}</dd></div>
        <div><dt className="text-[var(--text-tertiary)]">Home / draw / away chances</dt><dd>{row.probabilities ? row.probabilities.map(p => `${(100 * p).toFixed(1)}%`).join(' / ') : 'Not recorded'}</dd></div>
        <div><dt className="text-[var(--text-tertiary)]">Event and stage</dt><dd className="break-all">{row.key} · {row.phase ?? 'Stage not recorded'}</dd></div>
      </dl>
      {row.reason ? <p className="mt-3 text-xs text-[var(--text-secondary)]">{row.reason}. Excluded from the percentage and timeline.</p> : null}
    </details>
    <details className="mt-2"><summary className="min-h-11 cursor-pointer py-3 text-xs font-semibold text-[var(--accent-info)]">Advanced: stored exact-score forecast</summary>
      <dl className="grid gap-2 text-xs sm:grid-cols-2">
        <div><dt className="text-[var(--text-tertiary)]">Stored score forecast</dt><dd>{row.scoreForecast ? `${row.scoreForecast.home}–${row.scoreForecast.away}` : row.scoreForecastStatus === 'missing' ? 'Not recorded' : 'Not usable'}</dd></div>
        <div><dt className="text-[var(--text-tertiary)]">Score forecast period</dt><dd>{periodLabel(row.scorelinePeriod)}</dd></div>
        <div><dt className="text-[var(--text-tertiary)]">Actual score · 90 minutes</dt><dd>{row.actual ? `${row.actual.home}–${row.actual.away}` : 'Not verified'}</dd></div>
        <div><dt className="text-[var(--text-tertiary)]">Exact-score assessment</dt><dd>{scoreLabel}</dd></div>
      </dl>
      <p className="mt-3 text-xs text-[var(--text-secondary)]">Outcome correctness and exact-score correctness are separate. Expected goals are never rounded into a missing forecast.</p>
    </details>
  </article>
}

export function PublishedTrackRecord() {
  const { asQueryParam } = useGenderQuery()
  const [response, setResponse] = useState<{ scope: string; record: PublishedRecord } | null>(null)
  const data = response?.scope === asQueryParam ? response.record : null
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [filter, setFilter] = useState<RecordFilter>(EMPTY)
  const [unit, setUnit] = useState<'day' | 'week'>('week')
  const [historyChoice, setHistory] = useState<'scored' | 'excluded' | null>(null)
  const [page, setPage] = useState(0)
  const [marketOpen, setMarketOpen] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setResponse(null); setError('')
    fetch(`/api/v1/tracking/record?gender=${asQueryParam}`, { cache: 'no-store', signal: controller.signal })
      .then(async r => { const body = await r.json(); if (!r.ok || !body.available) throw new Error(body.reason || 'The verified record could not be read.'); return parsePublishedRecord(body.record) })
      .then(record => { if (!controller.signal.aborted) setResponse({ scope: asQueryParam, record }) })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'The verified record could not be read.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [asQueryParam, retry])
  const rows = useMemo(() => filterPublishedRows(data?.rows ?? [], filter), [data, filter])
  const leagueRows = useMemo(() => filterPublishedRows(data?.rows ?? [], { competition: '', season: filter.season, from: filter.from, to: filter.to }), [data, filter.season, filter.from, filter.to])
  const summary = useMemo(() => recordSummary(rows), [rows])
  const history = historyChoice ?? (summary.settled ? 'scored' : 'excluded')
  const points = useMemo(() => data ? accuracyTimeline(rows, unit, data.generatedAt, filter, data.coverageFrom) : [], [data, rows, unit, filter])
  const technical = useMemo(() => probabilityDetails(rows), [rows])
  const exact = useMemo(() => exactScoreSummary(rows), [rows])
  const competitions = useMemo(() => [...new Set(data?.rows.map(r => r.competitionId))].sort(), [data])
  const seasons = useMemo(() => [...new Set(data?.rows.map(r => r.season))].sort((a, b) => b - a), [data])
  const historyRows = useMemo(() => rows.filter(r => history === 'scored' ? r.status === 'scored' : r.status !== 'scored')
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.key.localeCompare(b.key)), [rows, history])
  const pages = Math.ceil(historyRows.length / PAGE_SIZE), currentPage = Math.min(page, Math.max(0, pages - 1))
  const update = (key: keyof RecordFilter, value: string) => { setFilter(f => ({ ...f, [key]: value })); setPage(0) }
  const invalidWindow = Boolean(filter.from && filter.to && filter.from > filter.to)
  return <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6 md:py-8">
    <EvidenceNavigation current="accuracy" />
    <EvidenceHeader title="Accuracy" lede="Stored home/draw/away picks, checked only when a verified pre-event forecast and result refer to the same 90-minute period." />
    {loading || (response && !data) ? <p role="status" className="mt-6 py-8">Loading the verified prediction record…</p> : error ? <section role="alert" className="mt-6 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-5"><h2 className="font-semibold">Record unavailable</h2><p className="mt-2 text-sm">{error} No percentage has been estimated from missing data.</p><button type="button" onClick={() => setRetry(n => n + 1)} className="mt-3 min-h-11 rounded-lg border border-[var(--border-color)] px-4 text-sm">Try again</button></section> : data ? <div className="mt-6 space-y-6">
      <section aria-label="Prediction track record" className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-5" aria-live="polite">
        <h2 className="text-sm font-semibold">{filter.competition ? `${getLeagueAccent(filter.competition).displayName} outcome accuracy` : 'Overall model outcome accuracy'}</h2>
        <p className="mt-3 text-3xl font-extrabold tabular-nums sm:text-4xl" data-track-record-headline>{summary.percent === null ? 'Not yet scored' : `${summary.percent.toFixed(1)}% correct`}</p>
        <p className="mt-2 text-lg font-semibold tabular-nums">{summary.correct.toLocaleString()} of {summary.settled.toLocaleString()} games correct</p>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">{filter.competition ? getLeagueAccent(filter.competition).displayName : 'All recorded competitions'} · {filter.season ? `season ${filter.season}` : 'all recorded seasons'}{summary.first ? ` · scored game dates ${summary.first} to ${summary.last}` : ''}.</p>
        <p className="mt-3 text-sm text-[var(--text-secondary)]">A pick is correct when its highest-probability outcome matches the home win, draw or away win after 90 minutes plus stoppage time. Extra time, penalty shootouts and knockout advancement are not graded here. One final verified pre-event forecast per game; no historical backtests are added.</p>
        <p className="mt-2 text-xs text-[var(--text-tertiary)]">This is an observed sample, not a promise for the next game. Every eligible settled game in this scope is counted.</p>
        <p className="mt-2 text-xs text-[var(--text-secondary)]">This view uses the timestamped forecast history. The match-page pick archive and older aggregate reports are separate records; their samples and saved picks can differ.</p>
        {summary.settled === 0 ? <p className="mt-3 text-sm text-[var(--text-secondary)]">Saved forecasts may exist, but no result in this scope has complete pre-match and regulation-time evidence. Older aggregate percentages are not substituted.</p> : null}
        <a href="#saved-predictions" onClick={() => { setHistory(summary.settled ? 'scored' : 'excluded'); setPage(0) }} className="mt-3 inline-flex min-h-11 items-center text-sm text-[var(--accent-info)] underline">Compare saved predictions and results</a>
      </section>
      <LeagueRecordExplorer rows={leagueRows} leagues={competitions} selected={filter.competition} onSelect={id => update('competition', id)} />
      <form onSubmit={e => e.preventDefault()} aria-label="Filter the prediction record" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs">Competition<select value={filter.competition} onChange={e => update('competition', e.target.value)} className={control}><option value="">All recorded competitions</option>{competitions.map(id => <option key={id} value={id}>{getLeagueAccent(id).displayName}</option>)}</select></label>
        <label className="text-xs">Season<select value={filter.season} onChange={e => update('season', e.target.value)} className={control}><option value="">All recorded seasons</option>{seasons.map(year => <option key={year} value={year}>Season {year}</option>)}</select></label>
        <label className="text-xs">Games from (UTC)<input type="date" value={filter.from} onChange={e => update('from', e.target.value)} className={control} /></label>
        <label className="text-xs">Games through (UTC)<input type="date" value={filter.to} onChange={e => update('to', e.target.value)} className={control} /></label>
        <button type="button" onClick={() => { setFilter(EMPTY); setPage(0) }} className="min-h-11 justify-self-start text-sm text-[var(--accent-info)] underline">Show the whole record</button>
      </form>
      {invalidWindow ? <p role="alert">Choose an end date on or after the start date.</p> : null}

      <section aria-label="Record coverage" className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4">
        <h2 className="text-sm font-semibold">What could be checked</h2>
        <dl className="mt-3 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div><dt>Awaiting verified result</dt><dd className="text-lg font-semibold tabular-nums">{summary.pending}</dd></div>
          <div><dt>Unverified saved records</dt><dd className="text-lg font-semibold tabular-nums">{summary.unverified}</dd></div>
          <div><dt>Recorded after kickoff</dt><dd className="text-lg font-semibold tabular-nums">{summary.retrospective}</dd></div>
          <div><dt>Known games without matched forecast</dt><dd className="text-lg font-semibold tabular-nums">{summary.missing}</dd></div>
        </dl>
        <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">These counts describe retained records and known games, including future games, not all football played. Unverified records may lack a declared forecast period, an original regulation-result receipt, real event times, a unique match, or a valid training cutoff. None enters the percentage. Date filters exclude undated records; the whole-record view includes them.</p>
        <p className="mt-2 text-xs text-[var(--text-secondary)]">History through {utc(data.historyThrough)}. Latest scored result observed {utc(data.resultThrough)}. Audit rebuilt {utc(data.generatedAt)}.</p>
        <p className="mt-2 text-xs text-[var(--text-secondary)]">Results arriving after that audit are not included. A newly rebuilt audit can still contain older source observations; check all three dates.</p>
        <a href={`/api/v1/tracking/record?gender=${asQueryParam}`} className="mt-2 inline-flex min-h-11 items-center text-xs text-[var(--accent-info)] underline">Open verified record data</a>
      </section>
      <details aria-label="Advanced exact-score record" className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-[var(--accent-info)]">Advanced: exact-score assessment</summary>
        <p className="mt-3 text-lg font-semibold">{exact.percent === null ? 'Not yet assessed' : `${exact.percent.toFixed(1)}% exact scores correct`}</p>
        <p className="mt-2 text-sm">{exact.correct} of {exact.assessed} eligible score forecasts correct</p>
        <p className="mt-3 text-sm text-[var(--text-secondary)]">This uses only stored score forecasts for the same verified 90-minute period, on eligible settled outcome records. A correct home/draw/away pick does not imply a correct scoreline. Past results do not guarantee future exact scores.</p>
        <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
          <div><dt>Eligible outcomes without a stored score forecast</dt><dd>{exact.missing}</dd></div>
          <div><dt>Eligible outcomes with invalid or conflicting score forecasts</dt><dd>{exact.invalid + exact.ambiguous}</dd></div>
          <div><dt>Eligible outcomes with an unverified score period</dt><dd>{exact.periodUnverified}</dd></div>
          <div><dt>Other records unassessed</dt><dd>{exact.unscored}</dd></div>
        </dl>
      </details>
      <details aria-label="Separate closing-line benchmark" onToggle={event => setMarketOpen(event.currentTarget.open)} className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-[var(--accent-info)]">Advanced: paired closing-line benchmark</summary>
        <p className="my-3 text-xs text-[var(--text-secondary)]">A separate historical benchmark artifact, with its own paired fixtures and model scope. It is not this selected pre-match accuracy cohort, and does not establish coverage of every saved pick.</p>
        {marketOpen ? <MarketBenchmarkPanel /> : null}
      </details>
      <section aria-label="Accuracy over time" className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Accuracy over time</h2><label className="text-xs">Calendar grouping<select value={unit} onChange={e => setUnit(e.target.value as 'day' | 'week')} className={control}><option value="week">Week (Monday–Sunday)</option><option value="day">Day</option></select></label></div>
        <AccuracyTimeline points={points} />
        <p className="mt-3 text-xs text-[var(--text-tertiary)]">Correct/settled counts determine every point; weekly percentages are never averaged. The chart uses the same eligible games as the card and scored history. Version names are recorded metadata, not claims that an update caused improvement.</p>
      </section>
      <section id="saved-predictions" aria-label="Game by game record" className="scroll-mt-20 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Every game, inspectable</h2><label className="text-xs">History view<select value={history} onChange={e => { setHistory(e.target.value as 'scored' | 'excluded'); setPage(0) }} className={control}><option value="scored">Scored games ({summary.settled})</option><option value="excluded">Not counted ({rows.length - summary.settled})</option></select></label></div>
        <p className="mt-2 text-xs text-[var(--text-secondary)]">The history view changes only the list. Competition, season and date filters apply to the card, timeline and history together.</p>
        {historyRows.length ? historyRows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map(row => <HistoryRow key={row.key} row={row} />) : <div className="py-6 text-sm"><p>No {history === 'scored' ? 'eligible settled games' : 'excluded records'} in this scope.</p>{history === 'scored' && summary.settled === 0 ? <button type="button" onClick={() => { setHistory('excluded'); setPage(0) }} className="mt-2 min-h-11 text-[var(--accent-info)] underline">Inspect unscored records</button> : null}</div>}
        {pages > 1 ? <nav aria-label="Game history pages" className="mt-3 flex items-center justify-between gap-3"><button type="button" disabled={currentPage === 0} onClick={() => setPage(p => Math.max(0, p - 1))} className="min-h-11 rounded-lg border border-[var(--border-color)] px-3 text-sm disabled:opacity-50">Previous games</button><span className="text-xs">Page {currentPage + 1} of {pages}</span><button type="button" disabled={currentPage + 1 >= pages} onClick={() => setPage(p => p + 1)} className="min-h-11 rounded-lg border border-[var(--border-color)] px-3 text-sm disabled:opacity-50">Next games</button></nav> : null}
      </section>
      <details className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4"><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-[var(--accent-info)]">How this record is scored · optional probability metrics</summary>
        <p className="mt-3 text-sm leading-relaxed">Selection: the last saved forecast strictly before the authoritative event kickoff, across recorded model versions. Its outcome period must be declared. Original result evidence must verify a completed regulation-time result and a valid aware kickoff; a normalized warehouse timestamp is insufficient. Training must end before the forecast day. Unknown periods, extra-time results without supported regulation evidence, ambiguous identities and conflicting final snapshots stay unscored.</p>
        <p className="mt-3 text-sm">Probability ties use the existing home, draw, away order. Equal-time games are ordered by stable event ID for the fixed recent-form window. Season is the source competition’s season identifier. Soccer’s three outcomes and forecast horizon differ from other sports; these percentages are not directly comparable.</p>
        <dl className="mt-4 grid grid-cols-3 gap-3 text-sm"><div><dt>Brier (0–2)</dt><dd>{technical.brier?.toFixed(4) ?? 'Not yet scored'}</dd></div><div><dt>Log loss</dt><dd>{technical.logLoss?.toFixed(4) ?? 'Not yet scored'}</dd></div><div><dt>Calibration gap</dt><dd>{technical.ece === null ? 'Not yet scored' : `${(100 * technical.ece).toFixed(1)} points`}</dd></div></dl>
        <p className="mt-3 text-xs text-[var(--text-secondary)]">All three use these same {technical.n} eligible settled games. They assess probabilities, not a composite confidence score.</p>
        <Link href="/evaluation" className="mt-3 inline-flex min-h-11 items-center text-sm text-[var(--accent-info)] underline">Separate historical backtests and model analysis</Link><p className="text-xs text-[var(--text-tertiary)]">Historical walk-forward results were reconstructed later. They are not included here; legacy aggregates use different timing checks and must not stand in for this verified record.</p>
      </details>
    </div> : null}
  </div>
}
