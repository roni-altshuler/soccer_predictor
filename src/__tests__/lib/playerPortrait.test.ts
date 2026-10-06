import contract from '../../../backend/tests/fixtures/portraits/contract.json'
import { approvedPlayerPortrait, playerIdentityKey } from '@/lib/playerPortrait'
import { playerApiPath } from '@/lib/api'

it.each(contract.cases)('$name', (test) => {
  expect(Boolean(approvedPlayerPortrait(test.identity, test.entry))).toBe(test.valid)
})

it('keeps colliding IDs in their own namespaces', () => {
  expect(playerIdentityKey({ provider: 'espn', id: '123' })).toBe('espn:123')
  expect(playerIdentityKey({ provider: 'fotmob', id: '123' })).toBe('fotmob:123')
})

it('retains league/gender on canonical ESPN API links', () => {
  expect(playerApiPath(123, { league: 'usa.1', gender: 'F' }, true))
    .toBe('/teams/players/123/stats?provider=espn&league=usa.1&gender=F')
  expect(() => playerApiPath(-1)).toThrow()
  expect(() => playerApiPath(123, { provider: 'fotmob' } as never)).toThrow()
})
