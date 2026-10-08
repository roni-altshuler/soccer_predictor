/** @jest-environment node */
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/v1/match-evidence/route'
import { readPredictionArchive } from '@/lib/server/recordedForecast'
jest.mock('@/lib/server/recordedForecast', () => ({ readPredictionArchive: jest.fn() }))
const call = (query: string) => GET(new NextRequest(`http://localhost/api/v1/match-evidence?league=eng.1&gender=M&${query}`))
beforeEach(() => jest.mocked(readPredictionArchive).mockResolvedValue({ entries: [], failedFiles: [] }))
afterEach(() => jest.clearAllMocks())
it.each(['asOf=bad', 'asOf=2026-02-30', 'asOf=2099-01-01', 'asOf=2026-09-20&from=2026-09-21', 'asOf=2026-09-20&from=2024-01-01', 'asOf=2026-09-20&from=bad'])('rejects invalid/future/oversized windows without reading the archive: %s', async (q) => {
  expect((await call(q)).status).toBe(400); expect(readPredictionArchive).not.toHaveBeenCalled()
})
it('returns an explicit empty source and no-store response for a valid window', async () => {
  const r = await call('asOf=2026-09-20&from=2026-08-01')
  expect(r.status).toBe(200); expect(r.headers.get('Cache-Control')).toBe('no-store')
  expect(await r.json()).toMatchObject({ available: true, leagueId: 'eng.1', gender: 'M', records: [] })
})
it('withholds a corrupt archive rather than masquerading as a complete empty sample', async () => {
  jest.mocked(readPredictionArchive).mockResolvedValue({ entries: [], failedFiles: ['broken.json'] })
  expect(await (await call('asOf=2026-09-20&from=2026-08-01')).json()).toMatchObject({ available: false, failedFiles: ['broken.json'] })
})
