/** @jest-environment node */
import { promises as fs } from 'fs'
import { GET } from '@/app/api/v1/season/refresh-status/route'
import { SCHEDULE_SCOPE } from '@/lib/scheduleRefresh'

const stamp = '2026-10-09T14:33:00Z'
const checked = { schema_version: 1, state: 'checked', attempted_at: stamp, requests: 6, request_limit: 6,
  leagues: SCHEDULE_SCOPE.map((id) => ({ competition_id: id, season: id === 'usa.1' ? '2026' : '2026-2027', last_verified_at: stamp })) }
afterEach(() => jest.restoreAllMocks())

it('keeps an unpublished status unknown', async () => {
  jest.spyOn(fs, 'readFile').mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }))
  const r = await GET()
  expect(r.status).toBe(200)
  expect(await r.json()).toMatchObject({ state: 'unknown', attempted_at: null, requests: null })
})
it.each(['{broken', '{}', JSON.stringify({ ...checked, requests: 0 }), JSON.stringify({ ...checked, leagues: [] }),
  JSON.stringify({ ...checked, attempted_at: 'yesterday' }), JSON.stringify({ ...checked, leagues: [null] })])('refuses malformed or incomplete status %s', async (content) => {
  jest.spyOn(fs, 'readFile').mockResolvedValue(content)
  const r = await GET()
  expect(r.status).toBe(503)
  expect(await r.json()).toMatchObject({ state: 'unknown' })
})
it('keeps a disk failure distinct from absence and hides filesystem details', async () => {
  jest.spyOn(fs, 'readFile').mockRejectedValue(Object.assign(new Error('/private/secret'), { code: 'EACCES' }))
  const r = await GET()
  expect(r.status).toBe(503)
  expect(JSON.stringify(await r.json())).not.toMatch(/private|secret|checked/)
})
it.each(['checked', 'degraded'])('serves the %s check without relabelling dates or counts', async (state) => {
  const payload = { ...checked, state }
  jest.spyOn(fs, 'readFile').mockResolvedValue(JSON.stringify(payload))
  const r = await GET()
  expect(r.status).toBe(200)
  expect(await r.json()).toEqual(payload)
})
