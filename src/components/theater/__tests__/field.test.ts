/**
 * Theater field-builder tests — surface fidelity to the artifact, path steps
 * landing on real event minutes, and every honesty gate. No network.
 */
import {
  THEATER_DOMAIN_MAX,
  THEATER_MIN_SURFACE_CELLS,
  buildTheaterField,
  fetchTheaterField,
  theaterGender,
  type TheaterFieldCell,
  type TheaterFieldPayload,
} from '../field'
import type { MatchDetails, MatchEvent } from '../../match/detail/types'

// ---------------------------------------------------------------------------
// Fixtures (momentum.test.ts style)
// ---------------------------------------------------------------------------

function makeMatch(overrides: Partial<MatchDetails> = {}): MatchDetails {
  return {
    id: 'test-match',
    home_team: 'Aston Villa',
    away_team: 'Liverpool',
    home_score: 0,
    away_score: 0,
    status: 'FT',
    date: '2026-04-01T19:00:00Z',
    league: 'Premier League',
    leagueId: 'eng.1',
    events: [],
    lineups: { home: [], away: [] },
    stats: {
      possession: [50, 50],
      shots: [0, 0],
      shotsOnTarget: [0, 0],
      corners: [0, 0],
      fouls: [0, 0],
    },
    h2h: { homeWins: 0, draws: 0, awayWins: 0, recentMatches: [] },
    ...overrides,
  }
}

function goal(
  team: 'home' | 'away',
  minute: number,
  opts: { addedTime?: number; player?: string; type?: string } = {}
): MatchEvent {
  return {
    type: (opts.type ?? 'goal') as MatchEvent['type'],
    minute,
    ...(opts.addedTime !== undefined ? { addedTime: opts.addedTime } : {}),
    player: opts.player ?? 'Scorer',
    team,
  }
}

/**
 * A full counted field: every (diff, bucket) cell present with a distinct,
 * predictable win share so a test can assert the exact height it expects.
 */
function makeField(
  opts: { omit?: Array<[number, number]>; thin?: Array<[number, number]>; matchesCovered?: number } = {}
): TheaterFieldPayload {
  const omit = new Set((opts.omit ?? []).map(([d, m]) => `${d}:${m}`))
  const thin = new Set((opts.thin ?? []).map(([d, m]) => `${d}:${m}`))
  const cells: TheaterFieldCell[] = []
  for (let diff = -3; diff <= 3; diff++) {
    for (let minute = 0; minute <= 90; minute += 5) {
      const key = `${diff}:${minute}`
      if (omit.has(key)) continue
      // w/n encodes the cell so assertions can be exact: 100 + diff*10 + bucket/5.
      const n = thin.has(key) ? 40 : 1000
      const w = 100 + diff * 10 + minute / 5
      cells.push({ diff, minute, n, w, d: 10, l: n - w - 10 })
    }
  }
  return { gender: 'M', matchesCovered: opts.matchesCovered ?? 35463, minSample: 50, cells }
}

const expectedP = (diff: number, bucket: number) => (100 + diff * 10 + bucket / 5) / 1000

// ---------------------------------------------------------------------------
// Surface
// ---------------------------------------------------------------------------

describe('buildTheaterField — surface', () => {
  it('mirrors the artifact counts cell for cell', () => {
    const match = makeMatch({ home_score: 1, away_score: 0, events: [goal('home', 20)] })
    const data = buildTheaterField(match, makeField())!
    expect(data).not.toBeNull()
    expect(data.cells).toHaveLength(7 * 19)
    for (const cell of data.cells) {
      expect(cell.pHome).toBeCloseTo(expectedP(cell.diff, cell.minute), 12)
      expect(cell.pHome + cell.pDraw + cell.pAway).toBeCloseTo(1, 12)
    }
  })

  it('drops thin cells from the surface rather than zero-filling them', () => {
    const match = makeMatch({ home_score: 1, away_score: 0, events: [goal('home', 20)] })
    // Thin a corner the path never visits.
    const data = buildTheaterField(match, makeField({ thin: [[3, 10]] }))!
    expect(data.cells.some((c) => c.diff === 3 && c.minute === 10)).toBe(false)
    expect(data.cells).toHaveLength(7 * 19 - 1)
  })

  it('returns null when the surface is too sparse to read as a field', () => {
    const payload = makeField()
    payload.cells = payload.cells.slice(0, THEATER_MIN_SURFACE_CELLS - 1)
    const match = makeMatch({ home_score: 1, away_score: 0, events: [goal('home', 20)] })
    expect(buildTheaterField(match, payload)).toBeNull()
  })

  it('reports the artifact corpus size', () => {
    const match = makeMatch({ home_score: 1, away_score: 0, events: [goal('home', 20)] })
    const data = buildTheaterField(match, makeField({ matchesCovered: 12345 }))!
    expect(data.matchesCovered).toBe(12345)
  })
})

// ---------------------------------------------------------------------------
// Path
// ---------------------------------------------------------------------------

describe('buildTheaterField — path', () => {
  it('covers the whole domain contiguously from kickoff', () => {
    const match = makeMatch({
      home_score: 2,
      away_score: 1,
      events: [goal('home', 12), goal('away', 55), goal('home', 78)],
    })
    const data = buildTheaterField(match, makeField())!
    expect(data.spans[0].x0).toBe(0)
    expect(data.spans[data.spans.length - 1].x1).toBe(THEATER_DOMAIN_MAX)
    for (let i = 1; i < data.spans.length; i++) {
      expect(data.spans[i].x0).toBe(data.spans[i - 1].x1)
    }
  })

  it('rests every run on the exact counted height of the cell beneath it', () => {
    const match = makeMatch({ home_score: 1, away_score: 0, events: [goal('home', 12)] })
    const data = buildTheaterField(match, makeField())!
    for (const span of data.spans) {
      expect(span.pHome).toBeCloseTo(expectedP(span.diff, span.bucket), 12)
      expect(span.n).toBe(1000)
    }
    expect(data.minN).toBe(1000)
  })

  it('steps to the neighbouring ridge exactly at the goal minutes', () => {
    const match = makeMatch({
      home_score: 2,
      away_score: 1,
      events: [goal('home', 12), goal('away', 55), goal('home', 78)],
    })
    const data = buildTheaterField(match, makeField())!
    const steps: Array<{ x: number; from: number; to: number }> = []
    for (let i = 1; i < data.spans.length; i++) {
      if (data.spans[i].diff !== data.spans[i - 1].diff) {
        steps.push({ x: data.spans[i].x0, from: data.spans[i - 1].diff, to: data.spans[i].diff })
      }
    }
    expect(steps).toEqual([
      { x: 12, from: 0, to: 1 },
      { x: 55, from: 1, to: 0 },
      { x: 78, from: 0, to: 1 },
    ])
  })

  it('carries the running score on every run', () => {
    const match = makeMatch({
      home_score: 1,
      away_score: 1,
      events: [goal('away', 20), goal('home', 60)],
    })
    const data = buildTheaterField(match, makeField())!
    const at = (x: number) => data.spans.find((s) => x >= s.x0 && x < s.x1)!
    expect([at(5).home, at(5).away]).toEqual([0, 0])
    expect([at(30).home, at(30).away]).toEqual([0, 1])
    expect([at(70).home, at(70).away]).toEqual([1, 1])
  })

  it('pins first-half stoppage at half time, like the river axis', () => {
    const match = makeMatch({
      home_score: 1,
      away_score: 0,
      events: [goal('home', 45, { addedTime: 3 })],
    })
    const data = buildTheaterField(match, makeField())!
    const step = data.spans.find((s) => s.diff === 1)!
    expect(step.x0).toBe(45)
    // The bucket still comes from the effective minute (45+3 → 48 → 45).
    expect(step.bucket).toBe(45)
  })

  it('does not step for a goal that clamps onto the same ridge', () => {
    const match = makeMatch({
      home_score: 4,
      away_score: 0,
      events: [goal('home', 10), goal('home', 20), goal('home', 30), goal('home', 40)],
    })
    const data = buildTheaterField(match, makeField())!
    const diffs = [...new Set(data.spans.map((s) => s.diff))]
    expect(Math.max(...diffs)).toBe(3) // +4 clamps onto the +3 ridge
    // …but the readout still shows the score that was on the board.
    const late = data.spans.find((s) => s.x0 >= 40)!
    expect([late.home, late.away]).toEqual([4, 0])
  })

  it('records the height either side of every real step', () => {
    const match = makeMatch({ home_score: 1, away_score: 0, events: [goal('home', 12)] })
    const data = buildTheaterField(match, makeField())!
    const ev = data.events[0]
    expect(ev.minute).toBe(12)
    expect(ev.pBefore).toBeCloseTo(expectedP(0, 10), 12)
    expect(ev.pAfter).toBeCloseTo(expectedP(1, 10), 12)
  })

  it('leaves a red card without a step height — the grid has no red-card axis', () => {
    const match = makeMatch({
      home_score: 1,
      away_score: 0,
      events: [goal('home', 12), { type: 'red_card', minute: 40, player: 'Back', team: 'away' }],
    })
    const data = buildTheaterField(match, makeField())!
    const red = data.events.find((e) => e.type === 'red_card')!
    expect(red.pBefore).toBeUndefined()
    expect(red.pAfter).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

describe('buildTheaterField — honesty gates', () => {
  const withGoal = { home_score: 1, away_score: 0, events: [goal('home', 12)] }

  it('returns null without a field payload', () => {
    expect(buildTheaterField(makeMatch(withGoal), null)).toBeNull()
  })

  it('returns null when the match has no final score', () => {
    const match = makeMatch({ home_score: null, away_score: null, events: [goal('home', 12)] })
    expect(buildTheaterField(match, makeField())).toBeNull()
  })

  it('returns null when the events do not reproduce the final score', () => {
    const match = makeMatch({ home_score: 3, away_score: 0, events: [goal('home', 12)] })
    expect(buildTheaterField(match, makeField())).toBeNull()
  })

  it('returns null when an event cannot be placed on the clock', () => {
    const match = makeMatch({
      home_score: 1,
      away_score: 0,
      events: [{ type: 'goal', minute: Number.NaN, player: 'X', team: 'home' }],
    })
    expect(buildTheaterField(match, makeField())).toBeNull()
  })

  it('returns null for a goalless match — the path never leaves its ridge', () => {
    const match = makeMatch({ home_score: 0, away_score: 0, events: [] })
    expect(buildTheaterField(match, makeField())).toBeNull()
  })

  it('returns null when any run of the path rests on a thin state', () => {
    // The match is level through the 20-minute bucket, so thinning 0:20 must
    // sink the whole landscape rather than leave a hole under the line.
    const match = makeMatch({ home_score: 1, away_score: 0, events: [goal('home', 40)] })
    expect(buildTheaterField(match, makeField({ thin: [[0, 20]] }))).toBeNull()
  })

  it('returns null when any run of the path rests on a missing state', () => {
    const match = makeMatch({ home_score: 1, away_score: 0, events: [goal('home', 40)] })
    expect(buildTheaterField(match, makeField({ omit: [[1, 60]] }))).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Fetch + universe resolution
// ---------------------------------------------------------------------------

describe('fetchTheaterField', () => {
  const ok = (body: unknown) => async () => ({ ok: true, json: async () => body })

  it('requests the universe it was given and keeps only well-formed rows', async () => {
    const impl = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        matchesCovered: 7,
        minSample: 50,
        cells: [{ diff: 0, minute: 0, n: 100, w: 40, d: 30, l: 30 }, { diff: 'x' }, null],
      }),
    }))
    const payload = await fetchTheaterField('F', impl as never)
    expect(impl).toHaveBeenCalledWith('/api/v1/theater/field?gender=F')
    expect(payload).toEqual({
      gender: 'F',
      matchesCovered: 7,
      minSample: 50,
      cells: [{ diff: 0, minute: 0, n: 100, w: 40, d: 30, l: 30 }],
    })
  })

  it('resolves to null on a non-OK response, a throw, or an empty field', async () => {
    await expect(fetchTheaterField('M', (async () => ({ ok: false, json: async () => ({}) })) as never)).resolves.toBeNull()
    await expect(
      fetchTheaterField('M', (() => {
        throw new Error('offline')
      }) as never)
    ).resolves.toBeNull()
    await expect(fetchTheaterField('M', ok({ cells: [] }) as never)).resolves.toBeNull()
    await expect(fetchTheaterField('M', ok({}) as never)).resolves.toBeNull()
  })
})

describe('theaterGender', () => {
  it('resolves the universe from the league, like the story and river do', () => {
    expect(theaterGender(makeMatch({ leagueId: 'eng.1' }))).toBe('M')
    expect(theaterGender(makeMatch({ leagueId: 'eng.1.w' }))).toBe('F')
  })
})
