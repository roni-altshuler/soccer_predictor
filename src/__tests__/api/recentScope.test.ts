/** @jest-environment node */
import fs from 'fs'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/v1/tracking/recent/route'

jest.mock('fs', () => ({ __esModule: true, default: { existsSync: jest.fn(), readdirSync: jest.fn(), readFileSync: jest.fn() } }))
it('matches the model/league archive scope without certifying pre-match eligibility', async () => {
  jest.mocked(fs.existsSync).mockReturnValue(true)
  jest.mocked(fs.readdirSync).mockReturnValue(['predictions_2026-10.json'] as never)
  const base = { match_date: '2026-10-01', actual_winner: 'away', gender: 'M' }
  jest.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ predictions: [
    { ...base, match_id: 'kept', league: 'Premier League', model_used: 'dixon_coles_v1' },
    { ...base, match_id: 'retired', league: 'Premier League', model_used: 'retired_net' },
    { ...base, match_id: 'wrong-league', league: 'MLS', model_used: 'dixon_coles_v1' },
  ] }))
  const data = await (await GET(new NextRequest('http://localhost/api/v1/tracking/recent?gender=M&completed_only=true'))).json()
  expect(data.predictions.map((p: { match_id: string }) => p.match_id)).toEqual(['kept'])
  expect(data.scope).toEqual({ total: 3, outOfScopeLeague: 1, retiredModel: 1, inScope: 1 })
  expect(data.eligibility).toBe('unverified_pre_match_and_period')
})
