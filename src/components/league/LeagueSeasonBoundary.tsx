'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useGenderQuery } from '@/hooks/useGenderQuery'
import { isCalendarYearLeague, seasonOptions } from '@/lib/seasons'
import { readCompletedRegularSeason, type CompletedSeasonRead, type CompletedRegularSeason as CompletedSeason } from '@/lib/completedRegularSeason'

interface Props {
  leagueId: string
  leagueName: string
  country: string
  renderActive: (season: string, changeSeason: (season: string) => void, key: string, completed?: CompletedSeason) => ReactNode
}

/** Resolve the bounded observed record before mounting a season simulator. */
export function LeagueSeasonBoundary({ leagueId, leagueName, country, renderActive }: Props) {
  const { asQueryParam, withParam } = useGenderQuery()
  const seasons = seasonOptions(isCalendarYearLeague(leagueId))
  const [selection, setSelection] = useState<{ league: string; season: string } | null>(null)
  const selectedSeason = selection?.league === leagueId ? selection.season : seasons[0].value
  const changeSeason = (season: string) => setSelection({ league: leagueId, season })
  const [ready, setReady] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [response, setResponse] = useState<{ key: string; result: CompletedSeasonRead } | null>(null)
  const isMLS = leagueId === 'usa.1' || leagueId === 'mls'
  const inScope = isMLS && selectedSeason === '2026' && asQueryParam === 'M'
  const key = `${leagueId}:${selectedSeason}:${asQueryParam}`
  const requestKey = `${key}:${attempt}`
  const result = response?.key === requestKey ? response.result : null

  // Read the saved/URL gender preference before requesting the men's artifact.
  useEffect(() => { setReady(true) }, [])
  useEffect(() => {
    if (!ready || !inScope) return
    const controller = new AbortController()
    let active = true
    fetch(withParam('/api/v1/season/projections'), { signal: controller.signal })
      .then(async (reply) => {
        if (!reply.ok) throw new Error('Season record unavailable')
        return reply.json()
      })
      .then((raw: unknown) => {
        const result = readCompletedRegularSeason(raw, { competitionId: leagueId, season: Number(selectedSeason), gender: asQueryParam })
        if (active) setResponse({ key: requestKey, result })
      })
      .catch(() => { if (active) setResponse({ key: requestKey, result: { kind: 'unavailable' } }) })
    return () => { active = false; controller.abort() }
  }, [ready, inScope, requestKey, leagueId, selectedSeason, asQueryParam, withParam])

  if (!isMLS || (ready && !inScope) || result?.kind === 'active' || result?.kind === 'completed') {
    return renderActive(selectedSeason, changeSeason, key, result?.kind === 'completed' ? result.season : undefined)
  }
  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6">
      <Link href={withParam('/leagues')} className="inline-flex min-h-[44px] items-center text-sm font-semibold text-[var(--text-secondary)] underline">All leagues</Link>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-xl font-bold text-[var(--text-primary)]">{leagueName}</h1><p className="mt-1 text-sm text-[var(--text-tertiary)]">{country} · {selectedSeason}</p></div>
        <label className="text-sm text-[var(--text-secondary)]">Season
          <select value={selectedSeason} onChange={(event) => changeSeason(event.target.value)} className="ml-2 min-h-[44px] rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] px-3 text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-info)]">
            {seasons.map((season) => <option key={season.value} value={season.value}>{season.label}</option>)}
          </select>
        </label>
      </header>
      {!result || !ready ? (
        <div aria-busy="true" role="status" className="rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] p-5 text-[var(--text-secondary)]">Reading the season record…</div>
      ) : (
        <section className="rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] p-5 text-[var(--text-secondary)]">
          <h2 className="font-semibold text-[var(--text-primary)]">Season record unavailable</h2>
          <p role="status" className="mt-2 text-sm">A verified regular-season record could not be read. Season probabilities are unavailable until the record can be checked.</p>
          <button onClick={() => setAttempt((value) => value + 1)} className="mt-3 min-h-[44px] rounded-lg border border-[var(--border-color)] px-4 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-info)]">Try again</button>
        </section>
      )}
    </div>
  )
}
