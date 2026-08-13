/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'

import { GET } from '@/app/api/top-scorers/[league]/route'

/**
 * The curated top-scorer fallback, and the season it is allowed to answer for.
 *
 * The Premier League list in this route is a snapshot of 2025-26, checked
 * against the Golden Boot table on 2026-05-04. It was served whenever ESPN's
 * leaders endpoint came back empty — for whatever season had been asked for.
 * From July 2026 the default season is 2026, ESPN has no leaders for a season
 * that has not kicked off, and so the page showed last season's Golden Boot
 * table stamped `season: 2026`. Asking for 2019 returned it too.
 *
 * The standing rule is that sparse coverage stays genuinely missing. An empty
 * answer for a season that has not started is the correct answer.
 */

const ORIGINAL_FETCH = global.fetch

afterEach(() => {
  global.fetch = ORIGINAL_FETCH
  jest.restoreAllMocks()
})

/** ESPN answering with nothing — a season that has not kicked off. */
function espnEmpty() {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ leaders: [] }),
  }) as unknown as typeof fetch
}

function espnLeaders(rows: Array<{ name: string; goals: number }>) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      leaders: [
        {
          name: 'goals',
          leaders: rows.map((r) => ({
            athlete: { displayName: r.name, team: { displayName: 'Someone' } },
            value: r.goals,
          })),
        },
      ],
    }),
  }) as unknown as typeof fetch
}

const call = (league: string, season?: string) =>
  GET(
    new NextRequest(
      `http://localhost/api/top-scorers/${league}${season ? `?season=${season}` : ''}`,
    ),
    { params: Promise.resolve({ league }) },
  )

describe('GET /api/top-scorers/[league]', () => {
  it('serves the curated list for the season it was verified against', async () => {
    espnEmpty()
    const body = await (await call('eng.1', '2025')).json()

    expect(body.source).toBe('verified_fallback')
    expect(body.scorers).toHaveLength(10)
    expect(body.scorers[0].name).toBe('Erling Haaland')
    expect(body.sourceDetail).toMatch(/2025-26/)
  })

  it('returns nothing for a season the curated list does not describe', async () => {
    // The 2026-27 season has not kicked off. Last season's Golden Boot table
    // is not an answer to a question about this one.
    espnEmpty()
    const body = await (await call('eng.1', '2026')).json()

    expect(body.scorers).toEqual([])
    expect(body.source).toBe('none')
  })

  it('does not reach back into an old season either', async () => {
    espnEmpty()
    const body = await (await call('eng.1', '2019')).json()
    expect(body.scorers).toEqual([])
    expect(body.source).toBe('none')
  })

  it('never serves the curated list for another league', async () => {
    // Only eng.1 has a verified list; every other league must come back empty
    // rather than borrowing one.
    espnEmpty()
    for (const league of ['esp.1', 'ger.1', 'ita.1', 'fra.1', 'usa.1']) {
      const body = await (await call(league, '2025')).json()
      expect([league, body.scorers]).toEqual([league, []])
      expect([league, body.source]).toEqual([league, 'none'])
    }
  })

  it('prefers live provider data over the curated list', async () => {
    espnLeaders([{ name: 'Someone Real', goals: 3 }])
    const body = await (await call('eng.1', '2025')).json()

    expect(body.source).toBe('espn')
    expect(body.scorers[0].name).toBe('Someone Real')
  })

  it('reports the season it actually answered for', async () => {
    espnEmpty()
    const body = await (await call('eng.1', '2026')).json()
    expect(body.season).toBe('2026')
  })
})
