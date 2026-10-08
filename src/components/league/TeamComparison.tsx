'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowLeftRight } from 'lucide-react'
import { Panel, StatTile } from '@/components/evidence/primitives'
import { DocsLink } from '@/components/evidence/DocsLink'
import { SectionHeader, StatusChip } from '@/components/primitives'
import { useGenderQuery } from '@/hooks/useGenderQuery'
import { getLeagueAccent } from '@/lib/leagueAccents'
import { isCalendarYearLeague, seasonLabel } from '@/lib/seasons'
import { changeComparison, comparisonFromArtifact, pointsPerGame, type ComparisonSnapshot } from '@/lib/teamComparison'
import { keepShellFocusVisible } from '@/lib/shellFocus'

const control = 'min-h-[44px] scroll-mt-[calc(var(--shell-topbar-h)_+_12px)] scroll-mb-24 rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] px-3 text-sm text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-info)]'
const display = (value: number | null, decimals = 0) => value === null ? 'Unavailable' : value.toFixed(decimals)

/** Compare the same competition/season/source; don't merge a live provider table. */
export function TeamComparison({ leagueId }: { leagueId: string }) {
  const { asQueryParam, withParam } = useGenderQuery()
  const [ready, setReady] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [response, setResponse] = useState<{ key: string; snapshot: ComparisonSnapshot | null; failed: boolean } | null>(null)
  const [selection, setSelection] = useState<{ key: string; pair: [string, string] } | null>(null)
  const key = `${leagueId}:${asQueryParam}:${attempt}`
  const result = response?.key === key ? response : null
  const data = result?.snapshot
  const names = data?.clubs.map((club) => club.team) ?? []
  const pair: [string, string] = selection?.key === key && selection.pair.every((name) => names.includes(name))
    ? selection.pair : [names[0] ?? '', names[1] ?? '']
  const chosen = pair.map((name) => data?.clubs.find((club) => club.team === name))
  const name = getLeagueAccent(leagueId).displayName

  // Let the preference hook read its URL/storage before requesting a snapshot.
  useEffect(() => { setReady(true) }, [])
  useEffect(() => {
    if (!ready || asQueryParam !== 'M') return
    const controller = new AbortController()
    let active = true
    fetch(withParam('/api/v1/season/projections'), { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error('Snapshot unavailable')
        return r.json()
      })
      .then((raw) => {
        if (active) setResponse({ key, snapshot: comparisonFromArtifact(raw, leagueId), failed: false })
      })
      .catch(() => { if (active) setResponse({ key, snapshot: null, failed: true }) })
    return () => { active = false; controller.abort() }
  }, [key, leagueId, asQueryParam, withParam, ready])

  const select = (side: 0 | 1, team: string) => setSelection({ key, pair: changeComparison(pair, side, team) })
  const label = data ? seasonLabel(data.season, isCalendarYearLeague(leagueId)) : null
  const retry = <button className={control} onClick={() => setAttempt((n) => n + 1)}>Try again</button>

  return (
    <div onFocus={keepShellFocusVisible} className="team-comparison mx-auto max-w-5xl space-y-6 px-4 py-6 md:px-6 md:py-8">
      <Link className={`inline-flex items-center gap-2 ${control}`} href={withParam(`/leagues/${leagueId}`)}>
        <ArrowLeft size={16} aria-hidden /> Back to league
      </Link>
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">{name} · Season snapshot</p>
        <h1 className="mt-2 text-3xl font-bold text-[var(--text-primary)]">Compare clubs</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--text-secondary)]">
          Put two clubs side by side: points recorded so far, games behind those points, and the published season outlook.
        </p>
      </header>

      {asQueryParam !== 'M' ? (
        <Panel title="Snapshot unavailable"><p role="status" className="mt-3 text-sm text-[var(--text-secondary)]">This artifact covers men’s competitions. A women’s season comparison is unavailable.</p></Panel>
      ) : !result ? (
        <Panel title="Reading the snapshot"><p role="status" className="mt-3 text-sm text-[var(--text-secondary)]">Loading club comparison…</p></Panel>
      ) : result.failed ? (
        <Panel title="Couldn’t load the snapshot"><p role="status" className="my-3 text-sm text-[var(--text-secondary)]">The season snapshot could not be loaded. Try again.</p>{retry}</Panel>
      ) : !data || names.length < 2 ? (
        <Panel title="No comparison available"><p role="status" className="my-3 text-sm text-[var(--text-secondary)]">Two identifiable clubs in the same season snapshot are required. No comparison is available for this competition.</p>{retry}</Panel>
      ) : (
        <>
          <section aria-label="Choose clubs" className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 md:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-[var(--text-primary)]">Men’s {label}</p>
              <StatusChip status="settled" label="Committed snapshot" />
            </div>
            <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
              {([0, 1] as const).map((side) => (
                <label key={side} className={`min-w-0 ${side === 1 ? 'sm:col-start-3 sm:row-start-1' : ''}`}>
                  <span className="mb-1.5 block text-xs font-semibold text-[var(--text-secondary)]">{side === 0 ? 'First club' : 'Second club'}</span>
                  <select className={`${control} w-full`} value={pair[side]} onChange={(event) => select(side, event.target.value)}>
                    {names.map((team) => <option key={team} value={team}>{team}</option>)}
                  </select>
                </label>
              ))}
              <button className={`${control} inline-flex items-center justify-center gap-2 sm:col-start-2 sm:row-start-1`} onClick={() => setSelection({ key, pair: [pair[1], pair[0]] })}>
                <ArrowLeftRight size={16} aria-hidden /> Swap
              </button>
            </div>
            <p className="mt-3 text-xs text-[var(--text-tertiary)]">Selecting the same club on both sides swaps the pair.</p>
          </section>

          <section aria-label="Club comparison" className="space-y-4">
            <SectionHeader kicker="Recorded results" title="Points, with the sample in view" description="Points per game divides recorded points by games played. Different opponents and schedules can affect the comparison." />
            <div className="grid gap-4 sm:grid-cols-2" aria-live="polite" aria-atomic="true">
              {chosen.map((club, side) => club && (
                <article key={`${side}:${club.team}`} aria-label={club.team} className="min-w-0 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-5">
                  <h3 className="break-words text-xl font-semibold text-[var(--text-primary)]">{club.team}</h3>
                  <div className="mt-4"><StatTile size="lead" label="Points per game" value={display(pointsPerGame(club), 2)} sub={club.played === null ? 'Game count unavailable' : club.played === 0 ? 'No games recorded yet' : `${club.played} games recorded`} /></div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--border-color)]" aria-hidden>
                    <div className={side === 0 ? 'h-full bg-[var(--accent-primary)]' : 'h-full bg-[var(--text-tertiary)]'} style={{ width: `${Math.max(0, (pointsPerGame(club) ?? 0) / 3 * 100)}%` }} />
                  </div>
                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <StatTile label="Recorded points" value={display(club.points)} />
                    <StatTile label="Games played" value={display(club.played)} />
                  </div>
                  <div className="mt-5 border-t border-[var(--border-color)] pt-4">
                    <StatTile label="Projected final points" value={display(club.projectedPoints, 1)} sub="Model forecast · mean across season simulations" />
                  </div>
                  <Link className={`mt-4 inline-flex items-center underline ${control}`} href={withParam(`/leagues/${leagueId}/evidence?team=${encodeURIComponent(club.team)}`)}>Explore {club.team} match evidence</Link>
                </article>
              ))}
            </div>
            <p className="text-xs leading-relaxed text-[var(--text-tertiary)]">Bars use the same 0–3 points-per-game scale. Recorded points may reflect deductions. A season projection is an estimate; this view does not predict a match between these clubs.</p>
          </section>

          <Panel title="Source and coverage">
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-[var(--text-tertiary)]">Artifact built (UTC)</dt><dd className="mt-1 font-mono text-xs text-[var(--text-primary)]">{data.generatedAt ? new Date(data.generatedAt).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC') : 'Unavailable'}</dd></div>
              <div><dt className="text-[var(--text-tertiary)]">Latest result date</dt><dd className="mt-1 font-semibold text-[var(--text-primary)]">Not supplied by this artifact</dd></div>
            </dl>
            <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">A build date does not establish how recent the results are. Games counted above belong to this snapshot; live standings can differ. Goals, shot-level xG, injuries and player values are unavailable in this source.</p>
            {data.excluded > 0 && <p className="mt-2 text-xs text-[var(--text-secondary)]">{data.excluded} unidentifiable or duplicate club rows excluded.</p>}
            <div className="mt-3 flex flex-wrap gap-3">
              <a className={`inline-flex items-center underline underline-offset-4 ${control}`} href={withParam('/api/v1/season/projections')}>View source snapshot</a>
              <DocsLink className={control} doc="tutorialSeason" hash="compare-two-clubs" label="How to read this comparison" />
            </div>
          </Panel>
        </>
      )}
    </div>
  )
}
