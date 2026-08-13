/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'

import { GET } from '@/app/api/v1/standings/route'

/**
 * The standings route.
 *
 * Three things here are not cosmetic, and each one produces a table that looks
 * perfectly real when it breaks:
 *
 *  1. GROUPS ARE PRESERVED. The Champions League league phase, a World Cup
 *     group stage and MLS's two conferences all arrive as `children`. The
 *     older `/api/standings` flattens them, and a table that concatenates six
 *     World Cup groups into one forty-eight-row ladder is not a table of
 *     anything — but it renders, and it sorts, and nothing says it is wrong.
 *  2. SEASONS ARE NEVER IN THE FUTURE. ESPN lists next season months early
 *     with `hasStandings: true` and answers with a full table of zeroes.
 *  3. ESPN'S `rank` WINS. It already applies the competition's own
 *     tiebreakers, which differ by league — head-to-head in Serie A, goal
 *     difference in the Premier League. Re-deriving a rank by sorting on
 *     points would quietly disagree with the official table.
 */

const ORIGINAL_FETCH = global.fetch

afterEach(() => {
  global.fetch = ORIGINAL_FETCH
  jest.restoreAllMocks()
})

const req = (qs: string) =>
  new NextRequest(`http://localhost/api/v1/standings${qs}`)

function mockEspn(payload: unknown, { ok = true, status = 200 } = {}) {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    status,
    json: async () => payload,
  }) as unknown as typeof fetch
}

const entry = (
  name: string,
  over: Partial<Record<string, number>> & { rank?: number } = {},
  note?: { description: string; color: string },
) => ({
  team: { displayName: name },
  note,
  stats: [
    { name: 'rank', value: over.rank ?? 1 },
    { name: 'gamesPlayed', value: over.played ?? 10 },
    { name: 'wins', value: over.won ?? 6 },
    { name: 'ties', value: over.drawn ?? 2 },
    { name: 'losses', value: over.lost ?? 2 },
    { name: 'pointsFor', value: over.goalsFor ?? 18 },
    { name: 'pointsAgainst', value: over.goalsAgainst ?? 9 },
    { name: 'pointDifferential', value: over.goalDifference ?? 9 },
    { name: 'points', value: over.points ?? 20 },
  ],
})

const YEAR_MS = 365 * 24 * 60 * 60 * 1000

describe('GET /api/v1/standings', () => {
  it('refuses a competition the site does not cover', async () => {
    // Without this the route would proxy an arbitrary string straight into an
    // upstream URL.
    global.fetch = jest.fn() as unknown as typeof fetch
    const body = await (await GET(req('?competition=xx.9'))).json()

    expect(body.available).toBe(false)
    expect(body.reason).toMatch(/not a competition this site covers/i)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('keeps a group stage as groups instead of one long ladder', async () => {
    mockEspn({
      name: 'FIFA World Cup',
      season: { year: 2026, displayName: '2026' },
      children: [
        { name: 'Group A', standings: { entries: [entry('Mexico'), entry('Canada', { rank: 2 })] } },
        { name: 'Group B', standings: { entries: [entry('Spain')] } },
      ],
    })

    const body = await (await GET(req('?competition=fifa.world'))).json()

    expect(body.available).toBe(true)
    expect(body.groups.map((g: { name: string }) => g.name)).toEqual(['Group A', 'Group B'])
    expect(body.groups[0].teams).toHaveLength(2)
    expect(body.groups[1].teams).toHaveLength(1)
  })

  it('returns a league as a single group, so one component draws both', async () => {
    mockEspn({
      name: 'English Premier League',
      season: { year: 2025 },
      children: [{ name: 'Premier League', standings: { entries: [entry('Arsenal')] } }],
    })

    const body = await (await GET(req('?competition=eng.1'))).json()
    expect(body.groups).toHaveLength(1)
    expect(body.groups[0].teams[0].team).toBe('Arsenal')
  })

  it("orders a group by ESPN's rank, not by re-deriving one", async () => {
    // Points deliberately disagree with rank: the tiebreaker that produced
    // this order is one only the provider knows.
    mockEspn({
      name: 'Serie A',
      season: { year: 2025 },
      children: [
        {
          name: 'Serie A',
          standings: {
            entries: [
              entry('Napoli', { rank: 3, points: 70 }),
              entry('Inter', { rank: 1, points: 70 }),
              entry('Milan', { rank: 2, points: 70 }),
            ],
          },
        },
      ],
    })

    const body = await (await GET(req('?competition=ita.1'))).json()
    expect(body.groups[0].teams.map((t: { team: string }) => t.team)).toEqual([
      'Inter',
      'Milan',
      'Napoli',
    ])
  })

  it('carries the qualification note and its colour through untouched', async () => {
    // The bands are read from the competition rather than hard-coded, because
    // the Champions League cut moved from 8 to 24 when the league phase
    // landed and any constant would have been wrong for a season.
    mockEspn({
      name: 'UEFA Champions League',
      season: { year: 2025 },
      children: [
        {
          name: 'League phase',
          standings: {
            entries: [
              entry('Liverpool', { rank: 1 }, { description: 'Round of 16', color: '81D6AC' }),
            ],
          },
        },
      ],
    })

    const body = await (await GET(req('?competition=uefa.champions'))).json()
    expect(body.groups[0].teams[0].note).toBe('Round of 16')
    expect(body.groups[0].teams[0].noteColor).toBe('#81D6AC')
  })

  it('leaves the note null when the provider sends none', async () => {
    mockEspn({
      name: 'English Premier League',
      season: { year: 2025 },
      children: [{ name: 'Premier League', standings: { entries: [entry('Everton')] } }],
    })
    const body = await (await GET(req('?competition=eng.1'))).json()
    expect(body.groups[0].teams[0].note).toBeNull()
    expect(body.groups[0].teams[0].noteColor).toBeNull()
  })

  it('drops a season that has not started', async () => {
    const now = Date.now()
    mockEspn({
      name: 'English Premier League',
      season: { year: 2025 },
      seasons: [
        { year: 2027, seasonYears: '2027-28', startDate: new Date(now + YEAR_MS).toISOString() },
        { year: 2025, seasonYears: '2025-26', startDate: new Date(now - YEAR_MS).toISOString() },
      ],
      children: [{ name: 'Premier League', standings: { entries: [entry('Arsenal')] } }],
    })

    const body = await (await GET(req('?competition=eng.1'))).json()
    expect(body.seasons.map((s: { year: number }) => s.year)).toEqual([2025])
  })

  it('offers seasons newest first', async () => {
    const past = (y: number) => new Date(`${y}-08-01T00:00:00Z`).toISOString()
    mockEspn({
      name: 'English Premier League',
      season: { year: 2024 },
      seasons: [
        { year: 2022, seasonYears: '2022-23', startDate: past(2022) },
        { year: 2024, seasonYears: '2024-25', startDate: past(2024) },
        { year: 2023, seasonYears: '2023-24', startDate: past(2023) },
      ],
      children: [{ name: 'Premier League', standings: { entries: [entry('Arsenal')] } }],
    })

    const body = await (await GET(req('?competition=eng.1'))).json()
    expect(body.seasons.map((s: { year: number }) => s.year)).toEqual([2024, 2023, 2022])
  })

  it('asks the provider for the season it was given', async () => {
    mockEspn({
      name: 'English Premier League',
      season: { year: 2019 },
      children: [{ name: 'Premier League', standings: { entries: [entry('Liverpool')] } }],
    })

    await GET(req('?competition=eng.1&season=2019'))
    expect(String((global.fetch as jest.Mock).mock.calls[0][0])).toMatch(/season=2019/)
  })

  it('translates the forecast layer’s Conference League id to ESPN’s', async () => {
    // Same competition, two vocabularies. Asking upstream for
    // `uefa.conference` returns nothing at all.
    mockEspn({
      name: 'UEFA Conference League',
      season: { year: 2025 },
      children: [{ name: 'League phase', standings: { entries: [entry('Chelsea')] } }],
    })

    await GET(req('?competition=uefa.conference'))
    expect(String((global.fetch as jest.Mock).mock.calls[0][0])).toContain('uefa.europa.conf')
  })

  it('says a season has no table rather than publishing an empty one', async () => {
    mockEspn({ name: 'English Premier League', season: { year: 2026 }, children: [] })

    const body = await (await GET(req('?competition=eng.1&season=2026'))).json()
    expect(body.available).toBe(false)
    expect(body.reason).toMatch(/no table yet/i)
    expect(body.groups).toEqual([])
  })

  it('drops a group the provider returned empty', async () => {
    mockEspn({
      name: 'FIFA World Cup',
      season: { year: 2026 },
      children: [
        { name: 'Group A', standings: { entries: [entry('Mexico')] } },
        { name: 'Group B', standings: { entries: [] } },
      ],
    })

    const body = await (await GET(req('?competition=fifa.world'))).json()
    expect(body.groups.map((g: { name: string }) => g.name)).toEqual(['Group A'])
  })

  it('reports an upstream error as unavailable, with a 200 the page can read', async () => {
    mockEspn({}, { ok: false, status: 503 })
    const res = await GET(req('?competition=eng.1'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.available).toBe(false)
    expect(body.reason).toMatch(/answered 503/)
  })

  it('survives the provider being unreachable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNRESET')) as unknown as typeof fetch
    const body = await (await GET(req('?competition=eng.1'))).json()

    expect(body.available).toBe(false)
    expect(body.reason).toMatch(/could not be reached/i)
  })

  it('never asks the host that answers datacentre IPs with 403', async () => {
    // `site.api.espn.com` and `site.web.api.espn.com` serve byte-identical
    // payloads, and Akamai answers the first with 403 from Vercel and GitHub
    // Actions. Getting this wrong blanks the page in production only.
    mockEspn({
      name: 'English Premier League',
      season: { year: 2025 },
      children: [{ name: 'Premier League', standings: { entries: [entry('Arsenal')] } }],
    })

    await GET(req('?competition=eng.1'))
    const url = String((global.fetch as jest.Mock).mock.calls[0][0])
    expect(url).toContain('site.web.api.espn.com')
    expect(url).not.toMatch(/(^|\/\/)site\.api\.espn\.com/)
  })
})
