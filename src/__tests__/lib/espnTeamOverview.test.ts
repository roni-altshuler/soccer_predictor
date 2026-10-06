import { fetchTeamOverview } from '@/lib/server/espnTeamOverview'

afterEach(() => jest.restoreAllMocks())

it.each([{ id: '999', displayName: 'Other team' }, { displayName: 'No subject ID' }])('refuses mismatched team metadata before schedule or roster requests', async (team) => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ team }) })
  expect(await fetchTeamOverview('359')).toBeNull()
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('keeps the existing ESPN overview when the subject ID matches', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ team: { id: '359', displayName: 'Synthetic team' } }) })
  expect(await fetchTeamOverview('359')).toEqual(expect.objectContaining({ team: expect.objectContaining({ id: '359', name: 'Synthetic team' }) }))
})
