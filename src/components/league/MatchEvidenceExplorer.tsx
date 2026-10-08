'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Panel, StatTile } from '@/components/evidence/primitives'
import { DocsLink } from '@/components/evidence/DocsLink'
import { ProbabilityBar } from '@/components/forecast/ProbabilityBar'
import { useGenderQuery } from '@/hooks/useGenderQuery'
import { getLeagueAccent } from '@/lib/leagueAccents'
import { scoreEvidence, type EvidenceData } from '@/lib/matchEvidence'
import { keepShellFocusVisible } from '@/lib/shellFocus'

const control = 'min-h-[44px] scroll-mt-[calc(var(--shell-topbar-h)_+_12px)] scroll-mb-24 rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] px-3 text-sm text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-info)]'
const dateControl = `${control} focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--accent-info)]`
const number = (value: number | null, places = 3) => value === null ? 'Unavailable' : value.toFixed(places)
const utc = (value: string) => value.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')

export function MatchEvidenceExplorer({ leagueId, today, initialFrom, initialAsOf, initialTeam = '' }: {
  leagueId: string; today: string; initialFrom: string; initialAsOf: string; initialTeam?: string
}) {
  const { asQueryParam, withParam } = useGenderQuery()
  const [ready, setReady] = useState(false)
  const [draft, setDraft] = useState({ from: initialFrom, asOf: initialAsOf })
  const [window, setWindow] = useState(draft)
  const [attempt, setAttempt] = useState(0)
  const [selection, setSelection] = useState({ scope: `${leagueId}:${asQueryParam}`, team: initialTeam })
  const [response, setResponse] = useState<{ key: string; data: EvidenceData | null; failed: boolean } | null>(null)
  const scope = `${leagueId}:${asQueryParam}`
  const key = `${scope}:${window.from}:${window.asOf}:${attempt}`
  const result = response?.key === key ? response : null
  const data = result?.data
  const team = selection.scope === scope ? selection.team : initialTeam
  const names = [...new Set(data?.records.flatMap((r) => [r.home, r.away]) ?? [])].sort()
  const records = useMemo(() => (data?.records ?? []).filter((r) => !team || r.home === team || r.away === team), [data, team])
  const scores = useMemo(() => scoreEvidence(records), [records])
  const latestResult = records.filter((r) => r.result).map((r) => r.date).sort().at(-1)
  const api = withParam(`/api/v1/match-evidence?league=${encodeURIComponent(leagueId)}&from=${window.from}&asOf=${window.asOf}`)

  useEffect(() => { setReady(true) }, [])
  useEffect(() => {
    if (!ready || asQueryParam !== 'M') return
    const controller = new AbortController()
    let active = true
    fetch(api, { signal: controller.signal, cache: 'no-store' })
      .then(async (r) => { if (!r.ok) throw new Error('Archive unavailable'); return r.json() })
      .then((raw: EvidenceData) => {
        if (raw.leagueId !== leagueId || raw.gender !== asQueryParam || raw.from !== window.from || raw.asOf !== window.asOf || !Array.isArray(raw.records)) throw new Error('Wrong archive scope')
        if (active) setResponse({ key, data: raw, failed: false })
      })
      .catch(() => { if (active) setResponse({ key, data: null, failed: true }) })
    return () => { active = false; controller.abort() }
  }, [ready, api, key, leagueId, asQueryParam, window.from, window.asOf])

  const retry = <button className={control} onClick={() => setAttempt((n) => n + 1)}>Try again</button>
  return (
    <div onFocus={keepShellFocusVisible} className="match-evidence mx-auto max-w-5xl space-y-6 px-4 py-6 md:px-6 md:py-8">
      <Link className={`inline-flex items-center ${control}`} href={withParam(`/leagues/${leagueId}/compare`)}>Back to club comparison</Link>
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">{getLeagueAccent(leagueId).displayName} · Recorded forecasts</p>
        <h1 className="mt-2 text-3xl font-bold text-[var(--text-primary)]">Match evidence explorer</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)]">Explore what the model expected, the results on file, and the sample behind them. Select a club and a UTC cutoff to inspect its match record.</p>
      </header>
      <form className="grid items-end gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 sm:grid-cols-[1fr_1fr_auto]" onSubmit={(event) => { event.preventDefault(); setWindow(draft) }}>
        <label className="min-w-0 text-xs font-semibold text-[var(--text-secondary)]">Matches from
          <input required type="date" className={`mt-1.5 block w-full ${dateControl}`} max={draft.asOf} value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} />
        </label>
        <label className="min-w-0 text-xs font-semibold text-[var(--text-secondary)]">Results known through (UTC)
          <input required type="date" className={`mt-1.5 block w-full ${dateControl}`} min={draft.from} max={today} value={draft.asOf} onChange={(event) => setDraft({ ...draft, asOf: event.target.value })} />
        </label>
        <button className={control} type="submit">Apply dates</button>
      </form>
      {asQueryParam !== 'M' ? <Panel title="Archive unavailable"><p role="status" className="mt-3 text-sm text-[var(--text-secondary)]">This explorer covers men’s served leagues. Women’s match evidence is unavailable.</p></Panel>
        : !result ? <Panel title="Reading the archive"><p role="status" className="mt-3 text-sm text-[var(--text-secondary)]">Loading recorded match evidence…</p></Panel>
          : result.failed ? <Panel title="Couldn’t read the archive"><p role="status" className="my-3 text-sm text-[var(--text-secondary)]">The archive request failed or the date window is invalid. Use at most 366 days, then try again.</p>{retry}</Panel>
            : !data?.available ? <Panel title="Archive unavailable"><p role="status" className="my-3 text-sm text-[var(--text-secondary)]">A complete readable archive for this competition is required. No metrics are shown from a partial source.</p>{retry}</Panel>
              : <>
                <section aria-label="Filter recorded matches" className="space-y-3">
                  <label className="block max-w-md text-xs font-semibold text-[var(--text-secondary)]">Club
                    <select className={`mt-1.5 w-full ${control}`} value={team} onChange={(event) => setSelection({ scope, team: event.target.value })}>
                      <option value="">All clubs in this league</option>
                      {team && !names.includes(team) && <option value={team}>{team} · no rows in this window</option>}
                      {names.map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                  </label>
                  <p role="status" className="text-sm text-[var(--text-secondary)]">{records.length} distinct matches · {scores.n} results known by {window.asOf} · {records.length - scores.n} results unavailable at cutoff</p>
                </section>
                {records.length === 0 ? <Panel title="No eligible matches"><p className="mt-3 text-sm text-[var(--text-secondary)]">No identifiable forecasts recorded before match day in this club/date window. Change the club or dates to explore another sample.</p></Panel> : <>
                  <Panel title="This sample, in numbers" description="Descriptive audit of archived Dixon–Coles family forecasts. These scores are not a claim of improvement or a paired closing-market comparison.">
                    <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                      <StatTile label="Settled sample" value={String(scores.n)} size="lead" />
                      <StatTile label="Brier (sum, 0–2)" value={number(scores.brier)} sub="Lower is better" />
                      <StatTile label="Log loss" value={number(scores.logLoss)} sub="Natural logarithm · lower is better" />
                      <StatTile label="Goal forecast MAE" value={number(scores.goalMae, 2)} sub={`${scores.goalN} matches with both goal expectations`} />
                    </div>
                    <p className="mt-4 text-xs leading-relaxed text-[var(--text-secondary)]">{scores.n < 100 ? 'Small samples can move sharply. ' : ''}Training cutoffs and immutable publication history are absent from these files. Earlier timestamps alone cannot prove a leakage-free model. Latest included result: {latestResult ?? 'Unavailable'}.</p>
                    <details className="mt-4 border-t border-[var(--border-color)] pt-3">
                      <summary className={`flex cursor-pointer items-center ${control}`}>Calibration · {scores.n} matches</summary>
                      <p className="my-3 text-xs text-[var(--text-secondary)]">Top-outcome confidence versus how often that outcome occurred. Five fixed bands; ties choose home, then draw, then away. ECE: {number(scores.ece)}. Empty bands are omitted.</p>
                      <ul className="space-y-3">{scores.reliability.map((b) => <li key={b.low} className="rounded-lg border border-[var(--border-color)] p-3 text-sm text-[var(--text-secondary)]">
                        <p className="font-semibold">{(b.low * 100).toFixed(0)}–{(b.high * 100).toFixed(0)}% band · {b.n} matches</p>
                        <p className="mt-1">Stated {(b.stated * 100).toFixed(1)}% · Observed {(b.observed * 100).toFixed(1)}%</p>
                        <div aria-hidden className="mt-2 space-y-1"><div className="h-1 bg-[var(--text-tertiary)]" style={{ width: `${b.stated * 100}%` }} /><div className="h-1 bg-[var(--accent-primary)]" style={{ width: `${b.observed * 100}%` }} /></div>
                      </li>)}</ul>
                    </details>
                  </Panel>
                  <section aria-label="Recorded match evidence" className="space-y-4">
                    <h2 className="text-xl font-semibold text-[var(--text-primary)]">Goal expectations and outcomes</h2>
                    <p className="text-sm leading-relaxed text-[var(--text-secondary)]">The goal figures are match-model expectations, not observed shot-level xG. They do not measure a player’s finishing or commercial value. Elo is recorded context; it does not explain how much an input caused the prediction.</p>
                    {records.map((row) => <article key={row.id} aria-label={`${row.home} vs ${row.away}`} className="min-w-0 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 md:p-5">
                      <p className="text-xs text-[var(--text-tertiary)]">{row.date} · {row.result ? 'Result on file' : 'Result unavailable at cutoff'}</p>
                      <h3 className="mt-2 break-words text-lg font-semibold text-[var(--text-primary)]">{row.home} <span className="font-normal text-[var(--text-tertiary)]">vs</span> {row.away}</h3>
                      <ProbabilityBar className="mt-4" probabilities={{ home: row.p[0], draw: row.p[1], away: row.p[2] }} homeLabel={row.home} awayLabel={row.away} />
                      <dl className="mt-5 grid grid-cols-2 gap-4 text-sm text-[var(--text-secondary)]">
                        <div><dt>Model goal expectation · home / away</dt><dd className="mt-1 font-mono text-lg text-[var(--text-primary)]">{row.expectedGoals.map((v) => number(v, 2)).join(' / ')}</dd></div>
                        <div><dt>Recorded score · home / away</dt><dd className="mt-1 font-mono text-lg text-[var(--text-primary)]">{row.result ? row.result.goals.join(' / ') : 'Unavailable'}</dd></div>
                      </dl>
                      <details className="mt-4 border-t border-[var(--border-color)] pt-3">
                        <summary className={`flex cursor-pointer items-center ${control}`}>Timing and model context</summary>
                        <dl className="mt-3 space-y-2 break-words text-xs text-[var(--text-secondary)]">
                          <div><dt className="font-semibold">Forecast timestamp</dt><dd>{utc(row.recordedAt)} · {row.forecastOffsetSupplied ? 'explicit offset' : 'UTC interpretation; offset absent, 12-hour ordering guard'} · before match day; kickoff time absent</dd></div>
                          <div><dt className="font-semibold">Result recorded (UTC)</dt><dd>{row.result ? utc(row.result.knownAt) : 'Unavailable at cutoff'}</dd></div>
                          <div><dt className="font-semibold">Model family / identifier</dt><dd>{row.model}</dd></div>
                          <div><dt className="font-semibold">Recorded Elo · home / away</dt><dd>{row.elo.map((v) => number(v, 1)).join(' / ')}</dd></div>
                          <div><dt className="font-semibold">Source</dt><dd>{row.source} · recorded fixture {row.id} · first eligible forecast on file</dd></div>
                        </dl>
                      </details>
                    </article>)}
                  </section>
                </>}
                <Panel title="Coverage and limits">
                  <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">League-wide input: {data.counts.scopedRows} rows. Excluded: {data.counts.invalid} invalid, {data.counts.timingExcluded} outside the window or without provable pre-day timing, {data.counts.conflicts} conflicting. Collapsed: {data.counts.duplicates} duplicate forecast rows. Missing or unverified results: {data.counts.resultsWithheld} distinct matches. Counts precede the club filter.</p>
                  <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">A result may be missing because the feed is old or its timestamp/score is unverifiable. A cutoff filters the current files; it cannot recover corrections overwritten in the past. Missing minutes, shot locations, player xG and prices stay unavailable. Fantasy scoring and player rankings cannot be derived here.</p>
                  <div className="mt-3 flex flex-wrap gap-3"><a className={`inline-flex items-center underline ${control}`} href={api}>View source audit</a><DocsLink className={control} doc="tutorialSeason" hash="explore-match-evidence" label="How to read this evidence" /></div>
                </Panel>
              </>}
    </div>
  )
}
