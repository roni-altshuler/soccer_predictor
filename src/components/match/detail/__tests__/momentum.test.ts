/**
 * Momentum river builder tests — segment/step construction, added-time
 * normalization, no-op events (red cards, clamped goals), the all-spans
 * n-gate, and turning-point parity with story.ts. The rarity API is mocked;
 * no network.
 */
import { buildMomentumRiver, riverChartX, RIVER_DOMAIN_MAX } from '../momentum'
import type { StoryFetch } from '../story'
import type { MatchDetails, MatchEvent } from '../types'

// ---------------------------------------------------------------------------
// Fixtures (story.test.ts style)
// ---------------------------------------------------------------------------

function makeMatch(overrides: Partial<MatchDetails> = {}): MatchDetails {
  return {
    id: 'test-match',
    home_team: 'PSG',
    away_team: 'Toulouse',
    home_score: 0,
    away_score: 0,
    status: 'FT',
    date: '2026-04-01T19:00:00Z',
    league: 'Ligue 1',
    leagueId: 'fra.1',
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

function redCard(team: 'home' | 'away', minute: number, player = 'Defender'): MatchEvent {
  return { type: 'red_card', minute, player, team }
}

interface Counts {
  n: number
  w: number
  d: number
  l: number
}

/** Mock rarity API keyed on the canonical "G:diff:bucket" state key. */
function makeFetcher(table: Record<string, Counts>) {
  const impl = jest.fn(async (url: string) => {
    const u = new URL(url, 'http://localhost')
    const key = `${u.searchParams.get('gender')}:${u.searchParams.get('diff')}:${u.searchParams.get('minute')}`
    const counts = table[key] ?? { n: 0, w: 0, d: 0, l: 0 }
    return {
      ok: true,
      json: async () => ({ ...counts, matches_covered: 35463 }),
    }
  })
  return impl as unknown as StoryFetch & jest.Mock
}

const C = (n: number, w: number, d: number): Counts => ({ n, w, d, l: n - w - d })

/** Fill every 5-minute bucket in [from, to] for one diff with the same counts. */
function fillBuckets(
  table: Record<string, Counts>,
  diff: number,
  from: number,
  to: number,
  counts: Counts,
  gender = 'M'
) {
  for (let b = from; b <= to; b += 5) table[`${gender}:${diff}:${b}`] = counts
}

/** A thick artifact for diffs −1..2 across all buckets, overridable per key. */
function thickTable(overrides: Record<string, Counts> = {}): Record<string, Counts> {
  const table: Record<string, Counts> = {}
  fillBuckets(table, -1, 0, 90, C(900, 180, 270))
  fillBuckets(table, 0, 0, 90, C(2000, 800, 600))
  fillBuckets(table, 1, 0, 90, C(1000, 700, 200))
  fillBuckets(table, 2, 0, 90, C(400, 360, 30))
  fillBuckets(table, 3, 0, 90, C(200, 196, 3))
  return { ...table, ...overrides }
}

// ---------------------------------------------------------------------------
// Chart axis normalization
// ---------------------------------------------------------------------------

describe('riverChartX', () => {
  it('passes regulation minutes through unchanged', () => {
    expect(riverChartX(1)).toBe(1)
    expect(riverChartX(44)).toBe(44)
    expect(riverChartX(67)).toBe(67)
  })

  it('pins first-half stoppage at 45', () => {
    expect(riverChartX(45, 3)).toBe(45)
    expect(riverChartX(45, 7)).toBe(45)
    expect(riverChartX(45)).toBe(45)
  })

  it('spreads second-half stoppage into the 90+ zone, clamped to the domain end', () => {
    expect(riverChartX(90, 4)).toBe(94)
    expect(riverChartX(90, 12)).toBe(RIVER_DOMAIN_MAX)
    expect(riverChartX(105)).toBe(RIVER_DOMAIN_MAX) // extra time
  })
})

// ---------------------------------------------------------------------------
// Null gates — the silences
// ---------------------------------------------------------------------------

describe('null gates', () => {
  it('returns null (and never fetches) when goal events do not reproduce the final score', async () => {
    const fetcher = makeFetcher(thickTable())
    const match = makeMatch({ home_score: 2, away_score: 0, events: [goal('home', 30)] })
    expect(await buildMomentumRiver(match, fetcher)).toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('returns null when the final score is missing', async () => {
    const match = makeMatch({ home_score: null, away_score: null, events: [goal('home', 30)] })
    expect(await buildMomentumRiver(match, makeFetcher(thickTable()))).toBeNull()
  })

  it('returns null for a match with no state-changing events', async () => {
    expect(await buildMomentumRiver(makeMatch(), makeFetcher(thickTable()))).toBeNull()
  })

  it('returns null for a red-cards-only match (mirrors the story gate)', async () => {
    const match = makeMatch({ events: [redCard('away', 30)] })
    expect(await buildMomentumRiver(match, makeFetcher(thickTable()))).toBeNull()
  })

  it('returns null when a state-changing event has no usable minute', async () => {
    const match = makeMatch({
      home_score: 1,
      away_score: 0,
      events: [{ ...goal('home', 30), minute: Number.NaN }],
    })
    expect(await buildMomentumRiver(match, makeFetcher(thickTable()))).toBeNull()
  })

  it('returns null when ANY band span is thinner than the n-gate', async () => {
    // The 0-0 opening bucket is one match short of the gate — the whole
    // river sinks; no partial rendering, no interpolated hole.
    const table = thickTable({ 'M:0:0': C(49, 20, 15) })
    const match = makeMatch({ home_score: 1, away_score: 0, events: [goal('home', 30)] })
    expect(await buildMomentumRiver(match, makeFetcher(table))).toBeNull()
  })

  it('returns null when the artifact is empty for the match (women pre-backfill)', async () => {
    const fetcher = makeFetcher({}) // every key answers n: 0
    const match = makeMatch({
      leagueId: 'eng.1.w',
      league: "FA Women's Super League",
      home_score: 1,
      away_score: 0,
      events: [goal('home', 40)],
    })
    expect(await buildMomentumRiver(match, fetcher)).toBeNull()
    for (const call of (fetcher as jest.Mock).mock.calls) {
      expect(call[0]).toContain('gender=F')
    }
    expect(fetcher).toHaveBeenCalled()
  })

  it('returns null when every rate lookup fails (offline / missing artifact)', async () => {
    const failing: StoryFetch = async () => {
      throw new Error('network down')
    }
    const match = makeMatch({ home_score: 1, away_score: 0, events: [goal('home', 40)] })
    expect(await buildMomentumRiver(match, failing)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Band values and steps
// ---------------------------------------------------------------------------

describe('band construction', () => {
  it('produces exact w/d/l fractions per span and steps at the goal and bucket boundaries', async () => {
    const match = makeMatch({ home_score: 1, away_score: 0, events: [goal('home', 32)] })
    const river = await buildMomentumRiver(match, makeFetcher(thickTable()))
    expect(river).not.toBeNull()

    const segs = river!.segments
    // 0-0 spans buckets 0..30 (7 spans, the last cut at the 32' goal), then
    // 1-0 from 32 to 35, then buckets 35..90 (12 spans) + the 90+ zone.
    expect(segs[0]).toMatchObject({ x0: 0, x1: 5, key: 'M:0:0' })
    expect(segs[0].pHome).toBeCloseTo(800 / 2000, 10)
    expect(segs[0].pDraw).toBeCloseTo(600 / 2000, 10)
    expect(segs[0].pAway).toBeCloseTo(600 / 2000, 10)

    // The span ending at the goal and the span starting there share bucket 30
    // — the step at x=32 is the score change, nothing else.
    const before = segs.find((s) => s.x1 === 32)!
    const after = segs.find((s) => s.x0 === 32)!
    expect(before.key).toBe('M:0:30')
    expect(after.key).toBe('M:1:30')
    expect(after.x1).toBe(35)
    expect(after.pHome).toBeCloseTo(0.7, 10)

    // Full, gapless coverage 0 → 95 with bands summing to 1 everywhere.
    expect(segs[0].x0).toBe(0)
    expect(segs[segs.length - 1].x1).toBe(RIVER_DOMAIN_MAX)
    for (let i = 1; i < segs.length; i++) expect(segs[i].x0).toBe(segs[i - 1].x1)
    for (const s of segs) expect(s.pHome + s.pDraw + s.pAway).toBeCloseTo(1, 10)

    // Terminal span is the artifact's 90 bucket rendered across the 90+ zone.
    expect(segs[segs.length - 1]).toMatchObject({ x0: 90, x1: 95, key: 'M:1:90' })

    expect(river!.minN).toBe(1000)
    expect(river!.matchesCovered).toBe(35463)
    expect(river!.markers).toEqual([
      {
        x: 32,
        minute: 32,
        type: 'goal',
        team: 'home',
        player: 'Scorer',
        scoreAfter: { home: 1, away: 0 },
      },
    ])
  })

  it('fetches each distinct state exactly once', async () => {
    const match = makeMatch({ home_score: 1, away_score: 0, events: [goal('home', 32)] })
    const fetcher = makeFetcher(thickTable())
    await buildMomentumRiver(match, fetcher)
    const urls = (fetcher as jest.Mock).mock.calls.map((c) => c[0] as string)
    expect(new Set(urls).size).toBe(urls.length)
  })

  it('does NOT step at a red card — the key space has no player-count axis', async () => {
    const match = makeMatch({
      home_score: 1,
      away_score: 0,
      events: [goal('home', 20), redCard('away', 57, 'Sent Off')],
    })
    const river = await buildMomentumRiver(match, makeFetcher(thickTable()))
    expect(river).not.toBeNull()
    // No span boundary at 57: the span containing it runs bucket-to-bucket.
    const containing = river!.segments.find((s) => s.x0 <= 57 && s.x1 > 57)!
    expect(containing).toMatchObject({ x0: 55, x1: 60, key: 'M:1:55' })
    // The marker is still drawn.
    expect(river!.markers).toContainEqual(
      expect.objectContaining({ x: 57, type: 'red_card', team: 'away' })
    )
  })

  it('does NOT step at a clamped goal (+3 → +4 pools onto one key)', async () => {
    const match = makeMatch({
      home_score: 4,
      away_score: 0,
      events: [goal('home', 5), goal('home', 15), goal('home', 25), goal('home', 62)],
    })
    const river = await buildMomentumRiver(match, makeFetcher(thickTable()))
    expect(river).not.toBeNull()
    // The 62' goal moved +3 → +4, clamped onto M:3:60 — spans merge across it.
    const containing = river!.segments.find((s) => s.x0 <= 62 && s.x1 > 62)!
    expect(containing).toMatchObject({ x0: 60, x1: 65, key: 'M:3:60' })
    expect(river!.markers.filter((m) => m.x === 62)).toHaveLength(1)
  })

  it('handles two goals in the same minute as one zero-width step (no phantom span)', async () => {
    const match = makeMatch({
      home_score: 1,
      away_score: 1,
      events: [goal('home', 67, { player: 'First' }), goal('away', 67, { player: 'Second' })],
    })
    const river = await buildMomentumRiver(match, makeFetcher(thickTable()))
    expect(river).not.toBeNull()
    const segs = river!.segments
    // 0-0 up to 67 (same key M:0:65 continues after — the merged span crosses 67).
    const around = segs.find((s) => s.x0 <= 67 && s.x1 > 67)!
    expect(around.key).toBe('M:0:65')
    // No span for the transient 1-0 state, but both markers stand at x=67.
    expect(segs.some((s) => s.key.startsWith('M:1:'))).toBe(false)
    expect(river!.markers.filter((m) => m.x === 67)).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// Added-time normalization
// ---------------------------------------------------------------------------

describe('added time', () => {
  it('pins a 45+3 goal at HT and keeps it before a 46′ goal', async () => {
    const match = makeMatch({
      home_score: 1,
      away_score: 1,
      events: [goal('away', 46), goal('home', 45, { addedTime: 3 })],
    })
    const river = await buildMomentumRiver(match, makeFetcher(thickTable()))
    expect(river).not.toBeNull()
    expect(river!.markers.map((m) => m.x)).toEqual([45, 46])
    expect(river!.markers[0].scoreAfter).toEqual({ home: 1, away: 0 })
    expect(river!.markers[1].scoreAfter).toEqual({ home: 1, away: 1 })
    // The brief 1-0 span renders between HT and the 46' equaliser.
    expect(river!.segments).toContainEqual(
      expect.objectContaining({ x0: 45, x1: 46, key: 'M:1:45' })
    )
  })

  it('places a 90+4 goal inside the 90+ zone against the 90 bucket', async () => {
    const match = makeMatch({
      home_score: 1,
      away_score: 0,
      events: [goal('home', 90, { addedTime: 4 })],
    })
    const river = await buildMomentumRiver(match, makeFetcher(thickTable()))
    expect(river).not.toBeNull()
    expect(river!.markers[0]).toMatchObject({ x: 94, minute: 90, addedTime: 4 })
    expect(river!.segments).toContainEqual(
      expect.objectContaining({ x0: 90, x1: 94, key: 'M:0:90' })
    )
    expect(river!.segments).toContainEqual(
      expect.objectContaining({ x0: 94, x1: 95, key: 'M:1:90' })
    )
  })
})

// ---------------------------------------------------------------------------
// Turning point — parity with story.ts
// ---------------------------------------------------------------------------

describe('turning point', () => {
  // PSG 2-1: opener 38', equaliser 60', winner 87' — same Δs as story.test.ts.
  const psg = makeMatch({
    home_score: 2,
    away_score: 1,
    events: [
      goal('home', 38, { player: 'Opener' }),
      goal('away', 60, { player: 'Leveller' }),
      goal('home', 87, { player: 'Ramos' }),
    ],
  })
  const table = thickTable({
    'M:0:35': C(1000, 400, 300), // 40%
    'M:1:35': C(800, 480, 240), //  60% → Δ1 = +20pp
    'M:1:60': C(600, 420, 120), //  70%
    'M:0:60': C(900, 360, 270), //  40% → Δ2 = −30pp
    'M:0:85': C(700, 280, 210), //  40%
    'M:1:85': C(500, 425, 50), //   85% → Δ3 = +45pp → turning point
  })

  it('labels the largest receipted |Δ| with the story’s exact rule', async () => {
    const river = await buildMomentumRiver(psg, makeFetcher(table))
    expect(river).not.toBeNull()
    expect(river!.turningPoint).toEqual({
      x: 87,
      minute: 87,
      scoreAfter: { home: 2, away: 1 },
      deltaWinRate: expect.closeTo(0.45, 10),
    })
  })

  it('never labels a turning point below the 15-point threshold', async () => {
    const match = makeMatch({ home_score: 1, away_score: 0, events: [goal('home', 40)] })
    const flat = thickTable({
      'M:0:40': C(1000, 400, 300),
      'M:1:40': C(1000, 500, 250), // Δ = +10pp
    })
    const river = await buildMomentumRiver(match, makeFetcher(flat))
    expect(river).not.toBeNull()
    expect(river!.turningPoint).toBeUndefined()
  })
})
