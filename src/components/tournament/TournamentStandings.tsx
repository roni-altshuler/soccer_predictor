'use client'

import { useEffect, useState } from 'react'

import { StandingsBoard } from '@/components/standings/StandingsBoard'
import type { StandingsPayload } from '@/components/standings/StandingsBoard'

/**
 * The table a knockout competition played to get to its bracket.
 *
 * Standings used to live at `/standings`, a destination of its own with a
 * competition picker on it — which meant a reader looking at the Champions
 * League had to leave, pick the Champions League a second time, and come back
 * to see the league phase that produced the bracket they were reading. The
 * table belongs to the competition, so it is shown with it.
 *
 * A group stage is preserved as groups by `/api/v1/standings`, which is what
 * makes one board serve all of this: the Champions League league phase is one
 * long table, a World Cup is eight short ones, and neither is the other.
 *
 * Renders NOTHING when the season has no table. Most editions on the season
 * explorer are knockout-only from the provider's point of view, and an empty
 * frame captioned "no standings" on two thirds of the page would be noise
 * rather than information.
 */
export function TournamentStandings({
  competitionId,
  season,
}: {
  competitionId: string
  season: number
}) {
  const [data, setData] = useState<StandingsPayload | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    setLoading(true)
    setData(null)
    const qs = new URLSearchParams({ competition: competitionId, season: String(season) })
    fetch(`/api/v1/standings?${qs}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { available: false }))
      .then((payload: StandingsPayload) => {
        if (!live) return
        setData(payload)
        setLoading(false)
      })
      .catch(() => {
        if (!live) return
        setData({ available: false })
        setLoading(false)
      })
    return () => {
      live = false
    }
  }, [competitionId, season])

  if (loading || !data?.available || !data.groups?.length) return null

  return (
    <section className="mt-6">
      <h4 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
        Before the bracket
      </h4>
      <p className="mt-1.5 max-w-2xl text-[12px] leading-relaxed text-[var(--text-secondary)]">
        {data.groups.length > 1
          ? 'The group stage that decided who reached the knockout rounds above.'
          : 'The league phase that decided who reached the knockout rounds above.'}
      </p>
      <div className="mt-3">
        <StandingsBoard data={data} competitionId={competitionId} />
      </div>
    </section>
  )
}
