/**
 * Engine fork client — the FROZEN CONTRACT with the simulation kernel:
 * POST /api/v1/engine/fork, `available: false` / failure / malformed payload
 * all collapse to null (the caller renders nothing). Fetch is injected; no
 * network.
 */
import {
  ENGINE_FORK_ENDPOINT,
  KICKOFF_STATE,
  fetchForkDistribution,
  type EngineFetch,
  type EngineForkState,
} from '../engineClient'

const STATE: EngineForkState = { minute: 55, homeGoals: 2, awayGoals: 1, homeReds: 0, awayReds: 1 }

const DISTRIBUTION = {
  pHome: 0.71,
  pDraw: 0.17,
  pAway: 0.12,
  expHomeGoals: 2.6,
  expAwayGoals: 1.3,
  topScorelines: [
    { home: 2, away: 1, p: 0.21 },
    { home: 3, away: 1, p: 0.14 },
    { home: 2, away: 2, p: 0.09 },
  ],
}

function fetcherReturning(body: unknown, ok = true): jest.MockedFunction<EngineFetch> {
  return jest.fn(async () => ({ ok, json: async () => body }))
}

describe('fetchForkDistribution', () => {
  it('POSTs the exact contract body to the fork endpoint', async () => {
    const fetchImpl = fetcherReturning({ available: true, distribution: DISTRIBUTION })
    await fetchForkDistribution('740957', STATE, fetchImpl)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(ENGINE_FORK_ENDPOINT)
    expect(init?.method).toBe('POST')
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init?.body ?? '')).toEqual({ matchId: '740957', state: STATE })
  })

  it('returns the distribution when the kernel says available', async () => {
    const fetchImpl = fetcherReturning({ available: true, distribution: DISTRIBUTION })
    await expect(fetchForkDistribution('m', STATE, fetchImpl)).resolves.toEqual(DISTRIBUTION)
  })

  it('returns null when the kernel says available: false', async () => {
    const fetchImpl = fetcherReturning({ available: false })
    await expect(fetchForkDistribution('m', STATE, fetchImpl)).resolves.toBeNull()
  })

  it('returns null on a non-OK response (route not deployed yet)', async () => {
    const fetchImpl = fetcherReturning({ available: true, distribution: DISTRIBUTION }, false)
    await expect(fetchForkDistribution('m', STATE, fetchImpl)).resolves.toBeNull()
  })

  it('returns null when the fetch itself fails', async () => {
    const fetchImpl: EngineFetch = jest.fn(async () => {
      throw new Error('offline')
    })
    await expect(fetchForkDistribution('m', STATE, fetchImpl)).resolves.toBeNull()
  })

  it('returns null when available is true but the distribution is missing or malformed', async () => {
    await expect(
      fetchForkDistribution('m', STATE, fetcherReturning({ available: true }))
    ).resolves.toBeNull()
    await expect(
      fetchForkDistribution(
        'm',
        STATE,
        fetcherReturning({ available: true, distribution: { ...DISTRIBUTION, pHome: 'high' } })
      )
    ).resolves.toBeNull()
    await expect(
      fetchForkDistribution(
        'm',
        STATE,
        fetcherReturning({ available: true, distribution: { ...DISTRIBUTION, topScorelines: null } })
      )
    ).resolves.toBeNull()
  })

  it('drops malformed scoreline entries but keeps valid ones', async () => {
    const fetchImpl = fetcherReturning({
      available: true,
      distribution: {
        ...DISTRIBUTION,
        topScorelines: [{ home: 2, away: 1, p: 0.21 }, { home: 'x', away: 1, p: 0.1 }, null],
      },
    })
    const result = await fetchForkDistribution('m', STATE, fetchImpl)
    expect(result?.topScorelines).toEqual([{ home: 2, away: 1, p: 0.21 }])
  })

  it('exposes the kickoff probe state per the contract', () => {
    expect(KICKOFF_STATE).toEqual({ minute: 1, homeGoals: 0, awayGoals: 0, homeReds: 0, awayReds: 0 })
  })
})
