/** @jest-environment node */
import { NextRequest } from 'next/server'

import { GET } from '@/app/api/todays_matches/route'

afterEach(() => jest.restoreAllMocks())

it('returns a retryable error when all score providers fail', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'))
  const response = await GET(new NextRequest('http://localhost/api/todays_matches?date=2026-09-18'))
  expect(response.status).toBe(503)
  expect((await response.json()).source).toBe('error')
})

it('keeps a genuinely empty scoreboard distinct from an outage', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ events: [], leagues: [] }) })
  const response = await GET(new NextRequest('http://localhost/api/todays_matches?date=2026-09-18'))
  expect(response.status).toBe(200)
  expect((await response.json()).source).toBe('none')
})

it('keeps unavailable scores null at the provider boundary', async () => {
  const event = { id: 'test-unscored', competitions: [{ status: { type: { name: 'STATUS_IN_PROGRESS' } }, competitors: [{ homeAway: 'home', team: { displayName: 'Home' } }, { homeAway: 'away', score: '0', team: { displayName: 'Away' } }] }] }
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ events: [event] }) })
  const response = await GET(new NextRequest('http://localhost/api/todays_matches?date=2026-09-18'))
  const data = await response.json()
  expect(data.live[0].home_score).toBeNull()
  expect(data.live[0].away_score).toBe(0)
})
