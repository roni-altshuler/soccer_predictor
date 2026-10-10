export const SCHEDULE_SCOPE = ['eng.1', 'esp.1', 'ger.1', 'ita.1', 'fra.1', 'usa.1']

export type ScheduleRefresh = {
  schema_version: 1
  state: 'checked' | 'degraded' | 'unknown'
  attempted_at: string | null
  requests: number | null
  request_limit: 6
  leagues: Array<{ competition_id: string; season: string; last_verified_at: string | null }>
}

export const UNKNOWN_SCHEDULE: ScheduleRefresh = {
  schema_version: 1, state: 'unknown', attempted_at: null,
  requests: null, request_limit: 6, leagues: [],
}
const timestamp = (v: unknown): v is string => typeof v === 'string'
  && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v))

/** Refuse a malformed or incomplete check instead of giving it a fresh label. */
export function parseScheduleRefresh(value: unknown): ScheduleRefresh | null {
  if (!value || typeof value !== 'object') return null
  const v = value as ScheduleRefresh
  if (v.state === 'unknown') return UNKNOWN_SCHEDULE
  if (v.schema_version !== 1 || !['checked', 'degraded'].includes(v.state)
    || !timestamp(v.attempted_at) || v.request_limit !== 6 || !Array.isArray(v.leagues)
    || (v.requests !== null && (!Number.isInteger(v.requests) || v.requests < 0 || v.requests > 6))) return null
  if (v.leagues.some((r) => !r || !SCHEDULE_SCOPE.includes(r.competition_id)
    || typeof r.season !== 'string' || (r.last_verified_at !== null && (!timestamp(r.last_verified_at)
      || Date.parse(r.last_verified_at) > Date.parse(v.attempted_at as string))))
    || new Set(v.leagues.map((r) => r.competition_id)).size !== v.leagues.length) return null
  if (v.state === 'checked' && (v.requests !== 6 || v.leagues.length !== 6
    || v.leagues.some((r) => r.last_verified_at !== v.attempted_at))) return null
  return { schema_version: 1, state: v.state, attempted_at: v.attempted_at,
    requests: v.requests, request_limit: 6, leagues: v.leagues }
}
