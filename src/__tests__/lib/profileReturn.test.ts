import { profileReturnHref } from '@/lib/profileReturn'

it('preserves known parent paths and their return/filter context', () => {
  expect(profileReturnHref('/?date=2026-09-19&competition=Premier+League&filter=upcoming')).toBe('/?date=2026-09-19&competition=Premier+League&filter=upcoming')
  expect(profileReturnHref('/matches/123?league=usa.1&gender=F')).toBe('/matches/123?league=usa.1&gender=F')
})

it.each(['https://example.com', '//example.com', '/\\example.com', '/api/private', '/teams/fotmob:123', '/teams/123#bad', ['/?date=2026-09-19']])('rejects unknown or external return state %p', (value) => {
  expect(profileReturnHref(value)).toBe('/')
})
