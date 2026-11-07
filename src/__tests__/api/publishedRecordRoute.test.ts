/** @jest-environment node */
import { promises as fs } from 'fs'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/v1/tracking/record/route'
const request = (gender = 'M') => new NextRequest(`http://localhost/api/v1/tracking/record?gender=${gender}`)
const empty = { schemaVersion: 2, outcomePeriod: 'regulation', cohort: 'immutable_snapshot_history', basis: 'verified_live_published', selection: 'last_before_authoritative_kickoff',
  generatedAt: '2026-08-17T12:00:00Z', historyThrough: null, resultThrough: null, coverageFrom: '2026-08-15', snapshotRows: 0, snapshotFixtures: 0, rows: [] }
afterEach(() => jest.restoreAllMocks())
it('serves exact dated evidence and an honest valid zero sample', async () => {
  jest.spyOn(fs, 'readFile').mockResolvedValue(JSON.stringify(empty))
  const response = await GET(request())
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.json()).toMatchObject({ available: true, record: empty })
})
it('keeps absent evidence distinct from a scored zero', async () => {
  jest.spyOn(fs, 'readFile').mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }))
  expect(await (await GET(request())).json()).toMatchObject({ available: false })
})
it.each(['EACCES', 'EIO', 'bad-json', 'bad-contract'])('refuses %s without substituting the old aggregate', async code => {
  const read = jest.spyOn(fs, 'readFile')
  if (code === 'bad-json') read.mockResolvedValue('{broken')
  else if (code === 'bad-contract') read.mockResolvedValue(JSON.stringify({ ...empty, selection: 'earliest' }))
  else read.mockRejectedValue(Object.assign(new Error('/private/location'), { code }))
  const response = await GET(request()), body = await response.json()
  expect(response.status).toBe(503)
  expect(body.available).toBe(false)
  expect(body.record).toBeUndefined()
  expect(JSON.stringify(body)).not.toContain('/private/location')
  expect(read).toHaveBeenCalledTimes(1)
})
it('does not substitute men’s evidence for an unavailable women’s ledger', async () => {
  const read = jest.spyOn(fs, 'readFile')
  expect(await (await GET(request('F'))).json()).toMatchObject({ available: false })
  expect(read).not.toHaveBeenCalled()
})
it.each([{ schemaVersion: 1 }, { cohort: 'match_pick_archive' }, { outcomePeriod: 'including_extra_time' }])('withholds an incompatible cohort or period %j', change => {
  jest.spyOn(fs, 'readFile').mockResolvedValue(JSON.stringify({ ...empty, ...change }))
  return GET(request()).then(async response => {
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ available: false })
  })
})
