/** @jest-environment node */
import { promises as fs } from 'fs'

import { GET as evaluation } from '@/app/api/v1/evaluation/route'
import { GET as projections } from '@/app/api/v1/season/projections/route'
import { GET as knockout } from '@/app/api/v1/tournaments/knockout/route'

afterEach(() => jest.restoreAllMocks())

describe.each([
  ['evaluation', evaluation],
  ['projections', projections],
  ['knockout', knockout],
] as const)('%s artifact reads', (_name, get) => {
  it('treats missing optional files as absence, without invented sample counts', async () => {
    jest.spyOn(fs, 'readFile').mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }))
    const response = await get()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ available: false })
  })

  it.each(['EACCES', 'EIO'])('keeps %s failures distinct from missing evidence', async (code) => {
    jest.spyOn(fs, 'readFile').mockRejectedValue(Object.assign(new Error('/private/artifact/path'), { code }))
    const response = await get()
    const body = await response.json()
    expect(response.status).toBe(503)
    expect(body.available).toBe(false)
    expect(body.live).toBeUndefined()
    expect(JSON.stringify(body)).not.toMatch(/private|has not been generated|have not been run/)
  })

  it.each(['{broken', 'null', '[]', '0'])('refuses malformed evidence %s', async (content) => {
    jest.spyOn(fs, 'readFile').mockResolvedValue(content)
    const response = await get()
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ available: false })
  })

  it('serves a readable object without changing its dates or numbers', async () => {
    const artifact = { generated_at: '2026-10-08T14:00:00Z', live: { n: 3, last_kickoff: '2026-09-20T20:45:00Z', brier: 0.61 } }
    jest.spyOn(fs, 'readFile').mockResolvedValue(JSON.stringify(artifact))
    const response = await get()
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.available).toBe(true)
    expect(_name === 'knockout' ? body.ties : body).toMatchObject(artifact)
  })
})

it('keeps a readable tie record when the optional bracket file is absent', async () => {
  jest.spyOn(fs, 'readFile').mockImplementation(async (file) => {
    if (String(file).endsWith('knockout_model.json')) return '{"n_ties_scored":4}'
    throw Object.assign(new Error('missing'), { code: 'ENOENT' })
  })
  const response = await knockout()
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ available: true, ties: { n_ties_scored: 4 }, brackets: null })
})
