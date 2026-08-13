'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { CompetitionSelect } from '@/components/forecast/CompetitionSelect'
import type { CompetitionOption } from '@/components/forecast/CompetitionSelect'
import { StandingsBoard } from '@/components/standings/StandingsBoard'
import type { StandingsPayload } from '@/components/standings/StandingsBoard'
import { EmptyState } from '@/components/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import {
  SERVED_COMPETITION_IDS,
  TOURNAMENT_COMPETITION_IDS,
  getLeagueAccent,
} from '@/lib/leagueAccents'

/**
 * One table, any competition, any season that has already been played.
 *
 * The table is the thing a reader checks most and it used to be the hardest
 * thing here to reach: `/leagues` listed competitions, a league page buried
 * the table in a tab behind live ESPN calls, and a tournament had no table at
 * all. This is a single destination with two controls — which competition,
 * which season — and the same board renders a league, a group stage and a
 * two-conference league without knowing which it was handed.
 *
 * Seasons offered are past and present only. `/api/v1/standings` drops any
 * season that has not started, because ESPN advertises next season months
 * early and answers with a full table of zeroes, which reads as a real result
 * rather than as an absence.
 */

const LEAGUE_IDS = [...SERVED_COMPETITION_IDS]
const TOURNAMENT_IDS = [...TOURNAMENT_COMPETITION_IDS]

function optionsFor(ids: string[], subtitle: (id: string) => string): CompetitionOption[] {
  return ids.map((id) => {
    const accent = getLeagueAccent(id)
    return { id, name: accent.displayName, subtitle: subtitle(id) }
  })
}

export default function StandingsPage() {
  const [competition, setCompetition] = useState('eng.1')
  const [season, setSeason] = useState<number | null>(null)
  const [data, setData] = useState<StandingsPayload | null>(null)
  const [loading, setLoading] = useState(true)

  const options = useMemo<CompetitionOption[]>(
    () => [
      ...optionsFor(LEAGUE_IDS, (id) => `${getLeagueAccent(id).country} · League`),
      ...optionsFor(TOURNAMENT_IDS, () => 'Knockout competition'),
    ],
    [],
  )

  const load = useCallback(async (comp: string, year: number | null) => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ competition: comp })
      if (year != null) qs.set('season', String(year))
      const res = await fetch(`/api/v1/standings?${qs}`, { cache: 'no-store' })
      setData(await res.json())
    } catch {
      setData({ available: false, reason: 'the standings could not be loaded' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(competition, season)
  }, [competition, season, load])

  // Switching competition must clear the season: 2019 means something in the
  // Premier League and nothing in a tournament that did not run that year, and
  // carrying it across silently returns an empty table for the wrong reason.
  const onCompetition = (id: string) => {
    setSeason(null)
    setCompetition(id)
  }

  const accent = getLeagueAccent(competition)

  return (
    <div className="mx-auto w-full max-w-5xl px-3 py-4 sm:px-4">
      <h1 className="px-1 pb-1 text-lg font-bold tracking-tight text-[var(--text-primary)]">
        Standings
      </h1>
      <p className="mb-3 px-1 text-[12px] leading-relaxed text-[var(--text-secondary)]">
        The live table for any competition the site covers, and every season it
        has already played.
      </p>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <CompetitionSelect
          options={options}
          value={competition}
          onChange={onCompetition}
          kind="Competition"
          className="sm:flex-1"
        />
        <SeasonSelect
          seasons={data?.seasons ?? []}
          value={data?.season ?? null}
          onChange={setSeason}
        />
      </div>

      {loading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : data?.available ? (
        <StandingsBoard data={data} competitionId={competition} />
      ) : (
        <EmptyState
          title={`No table for ${accent.displayName}`}
          description={
            data?.reason ??
            'This competition has no standings for the selected season.'
          }
        />
      )}
    </div>
  )
}

/**
 * Season picker. A plain `<select>` on purpose — the rows carry a year and
 * nothing else, so the listbox pattern `CompetitionSelect` implements by hand
 * would be ceremony without a second line to justify it.
 */
function SeasonSelect({
  seasons,
  value,
  onChange,
}: {
  seasons: Array<{ year: number; label: string }>
  value: number | null
  onChange: (year: number | null) => void
}) {
  if (seasons.length === 0) return null
  const current = seasons[0]?.year
  return (
    <label className="flex items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-3 py-2 sm:w-[190px]">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
        Season
      </span>
      <select
        aria-label="Season"
        value={value ?? current ?? ''}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1 bg-transparent font-numeric text-[13px] font-semibold tabular-nums text-[var(--text-primary)] outline-none"
      >
        {seasons.map((s) => (
          <option key={s.year} value={s.year} className="bg-[var(--card-bg)]">
            {s.label}
            {s.year === current ? ' · current' : ''}
          </option>
        ))}
      </select>
    </label>
  )
}
