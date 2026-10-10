'use client'

import { useEffect, useState } from 'react'
import { useGenderQuery } from '@/hooks/useGenderQuery'
import { parseScheduleRefresh, SCHEDULE_SCOPE, UNKNOWN_SCHEDULE, type ScheduleRefresh } from '@/lib/scheduleRefresh'

const displayDate = (stamp: string) => new Date(stamp).toLocaleString('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
}) + ' UTC'

/** Independent of live standings and forecast reads; missing status stays unknown. */
export function ScheduleRefreshNotice({ competitionId }: { competitionId?: string }) {
  const { asQueryParam, withParam } = useGenderQuery()
  const [ready, setReady] = useState(false)
  const [status, setStatus] = useState<ScheduleRefresh>(UNKNOWN_SCHEDULE)
  const inScope = !competitionId || SCHEDULE_SCOPE.includes(competitionId)
  useEffect(() => { setReady(true) }, [])
  useEffect(() => {
    if (!ready || asQueryParam !== 'M' || !inScope) return
    const controller = new AbortController()
    fetch(withParam('/api/v1/season/refresh-status'), { signal: controller.signal, cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error('Schedule status unavailable')
        const parsed = parseScheduleRefresh(await r.json())
        if (!parsed) throw new Error('Invalid schedule status')
        if (!controller.signal.aborted) setStatus(parsed)
      })
      .catch(() => { /* Retain a read record; an initial failure remains unknown. */ })
    return () => controller.abort()
  }, [ready, asQueryParam, withParam, inScope])
  if (!ready || asQueryParam !== 'M' || !inScope) return null
  const verified = status.leagues.find((r) => r.competition_id === competitionId)?.last_verified_at
  return (
    <aside role="status" aria-label="Schedule freshness" className="my-4 rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-3 text-sm text-[var(--text-secondary)]">
      <p className="font-semibold text-[var(--text-primary)]">
        {status.state === 'checked' ? 'Schedule last checked' : status.state === 'degraded' ? 'Schedule refresh unavailable' : 'Schedule refresh status unavailable'}
      </p>
      <p className="mt-1">
        {status.state === 'checked' ? 'This verifies fixtures, not the latest results.'
          : status.state === 'degraded' ? 'Forecasts use retained schedules; kickoff times and postponements may be outdated.'
            : 'A forecast build date does not verify the fixture schedule.'}
      </p>
      {status.attempted_at && <p className="mt-1">{status.state === 'checked' ? 'Checked' : 'Attempted'} <time dateTime={status.attempted_at}>{displayDate(status.attempted_at)}</time></p>}
      {status.state === 'degraded' && verified && <p className="mt-1">Last successful schedule check <time dateTime={verified}>{displayDate(verified)}</time></p>}
    </aside>
  )
}
