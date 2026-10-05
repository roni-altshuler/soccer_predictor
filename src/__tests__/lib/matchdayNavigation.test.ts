import { localDateKey, matchdayHref, matchdayReturnHref, readMatchdayView, withMatchdayReturn } from '@/lib/matchdayNavigation'

const today = '2026-10-05'
it('roundtrips a chosen date, status, competition, Following, and gender', () => {
  const view = { date: '2026-10-04', filter: 'finished' as const, competition: 'Premier League', following: true }
  const href = matchdayHref(view, new URLSearchParams('gender=F&other=kept'))
  expect(readMatchdayView(new URL(href, 'https://test.local').searchParams, today)).toEqual(view)
  expect(href).toContain('gender=F')
  expect(href).toContain('other=kept')
  const detail = withMatchdayReturn('/matches/1?league=eng.1', href)!
  const params = new URL(detail, 'https://test.local').searchParams
  expect(params.get('league')).toBe('eng.1')
  expect(matchdayReturnHref(params.get('returnTo'))).toBe('/?gender=F&date=2026-10-04&filter=finished&competition=Premier+League&following=1')
})
it.each(['2026-02-30', 'not-a-date', '2026-13-01', '2026-2-3'])('falls back to the local date for invalid %s', (date) => {
  expect(readMatchdayView(new URLSearchParams({ date, filter: 'invalid' }), today)).toEqual({ date: today, filter: 'all', competition: 'all', following: false })
})
it.each(['https://evil.test/', '//evil.test/?date=2026-10-04', '/leagues/eng.1', '/?date=2026-02-30', '/?x=1', null])('rejects unsafe or invalid return destinations: %p', (href) => {
  expect(matchdayReturnHref(href)).toBeNull()
})
it('formats a local calendar date, independent of its UTC offset', () => {
  expect(localDateKey(new Date(2026, 9, 4, 23, 59))).toBe('2026-10-04')
})
