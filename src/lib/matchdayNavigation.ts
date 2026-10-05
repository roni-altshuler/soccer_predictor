export type MatchdayFilter = 'all' | 'live' | 'upcoming' | 'finished'
export interface MatchdayView {
  date: string
  filter: MatchdayFilter
  competition: string
  following: boolean
}

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function readMatchdayView(params: URLSearchParams, today: string): MatchdayView {
  const rawDate = params.get('date') ?? ''
  const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && localDateKey(new Date(`${rawDate}T12:00:00`)) === rawDate ? rawDate : today
  const filter = params.get('filter')
  return {
    date, filter: filter === 'live' || filter === 'upcoming' || filter === 'finished' ? filter : 'all',
    competition: params.get('competition') || 'all', following: params.get('following') === '1',
  }
}

export function matchdayHref(view: MatchdayView, params = new URLSearchParams()): string {
  const next = new URLSearchParams(params)
  next.set('date', view.date)
  for (const [key, value] of [
    ['filter', view.filter === 'all' ? '' : view.filter],
    ['competition', view.competition === 'all' ? '' : view.competition],
    ['following', view.following ? '1' : ''],
  ]) {
    if (value) next.set(key, value)
    else next.delete(key)
  }
  return `/?${next}`
}

/** Only a local Matchday destination is accepted from a detail URL. */
export function matchdayReturnHref(raw: string | null): string | null {
  if (!raw?.startsWith('/?')) return null
  try {
    const url = new URL(raw, 'https://pitchverse.local')
    if (url.origin !== 'https://pitchverse.local' || url.pathname !== '/') return null
    const date = url.searchParams.get('date')
    if (!date) return null
    const view = readMatchdayView(url.searchParams, '')
    if (!view.date) return null
    const allowed = new URLSearchParams()
    const gender = url.searchParams.get('gender')
    if (gender === 'M' || gender === 'F') allowed.set('gender', gender)
    return matchdayHref(view, allowed)
  } catch { return null }
}

export function withMatchdayReturn(href: string | undefined, returnHref: string) {
  if (!href) return undefined
  const url = new URL(href, 'https://pitchverse.local')
  url.searchParams.set('returnTo', returnHref)
  return `${url.pathname}?${url.searchParams}`
}
