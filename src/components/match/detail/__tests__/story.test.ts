/**
 * Story builder tests — timeline reconstruction, exact-count Δ math, honesty
 * gates (n < 50 suppression, turning-point threshold, reconcile failure).
 * The rarity API is mocked; no network.
 */
import {
  buildMatchStory,
  clampDiff,
  minuteBucket,
  storyStateKey,
  type StoryFetch,
} from '../story'
import type { MatchDetails, MatchEvent } from '../types'

// ---------------------------------------------------------------------------
// Fixtures
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
  // `type` is a plain string: real payloads carry 'penalty_goal', which the
  // MatchEvent union doesn't declare (story.ts compares on string, like
  // RarityStamp and EventTimeline do).
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

/** Mock rarity API keyed on the canonical "G:diff:bucket" state key. */
function makeFetcher(table: Record<string, { n: number; w: number }>) {
  const impl = jest.fn(async (url: string) => {
    const u = new URL(url, 'http://localhost')
    const key = `${u.searchParams.get('gender')}:${u.searchParams.get('diff')}:${u.searchParams.get('minute')}`
    const counts = table[key] ?? { n: 0, w: 0 }
    return {
      ok: true,
      json: async () => ({ ...counts, d: 0, l: Math.max(0, counts.n - counts.w) }),
    }
  })
  return impl as unknown as StoryFetch & jest.Mock
}

const THICK = (n: number, w: number) => ({ n, w })

// ---------------------------------------------------------------------------
// Grid helpers (must mirror src/lib/rarity.ts exactly)
// ---------------------------------------------------------------------------

describe('state grid helpers', () => {
  it('floors minutes onto the 5-minute grid and clamps 90+ / ET into the 90 bucket', () => {
    expect(minuteBucket(0)).toBe(0)
    expect(minuteBucket(4)).toBe(0)
    expect(minuteBucket(48)).toBe(45)
    expect(minuteBucket(90)).toBe(90)
    expect(minuteBucket(94)).toBe(90) // 90+4 stoppage
    expect(minuteBucket(117)).toBe(90) // extra time
  })

  it('clamps diffs to the artifact key space [-3, 3]', () => {
    expect(clampDiff(-5)).toBe(-3)
    expect(clampDiff(4)).toBe(3)
    expect(clampDiff(1)).toBe(1)
  })

  it('builds canonical keys', () => {
    expect(storyStateKey('M', -4, 87)).toBe('M:-3:85')
    expect(storyStateKey('F', 2, 91)).toBe('F:2:90')
  })
})

// ---------------------------------------------------------------------------
// Coverage 'none' — the silence gates
// ---------------------------------------------------------------------------

describe('coverage gates', () => {
  it('returns none (and never fetches) when goal events do not reproduce the final score', async () => {
    const fetcher = makeFetcher({})
    const match = makeMatch({ home_score: 2, away_score: 0, events: [goal('home', 30)] })
    const story = await buildMatchStory(match, fetcher)
    expect(story.coverage).toBe('none')
    expect(story.acts).toEqual([])
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('returns none for a match with no state-changing events (0-0, nothing to narrate)', async () => {
    const story = await buildMatchStory(makeMatch(), makeFetcher({}))
    expect(story.coverage).toBe('none')
  })

  it('returns none when the final score is missing', async () => {
    const match = makeMatch({ home_score: null, away_score: null, events: [goal('home', 30)] })
    const story = await buildMatchStory(match, makeFetcher({}))
    expect(story.coverage).toBe('none')
  })

  it('returns none when the rarity artifact is thin for every state (women pre-backfill)', async () => {
    const fetcher = makeFetcher({}) // every key answers n: 0
    const match = makeMatch({
      leagueId: 'eng.1.w',
      league: "FA Women's Super League",
      home_score: 1,
      away_score: 0,
      events: [goal('home', 40)],
    })
    const story = await buildMatchStory(match, fetcher)
    expect(story.coverage).toBe('none')
    expect(story.acts).toEqual([])
    // Gender inferred from the league: the lookups hit the women's keys.
    for (const call of (fetcher as jest.Mock).mock.calls) {
      expect(call[0]).toContain('gender=F')
    }
    expect(fetcher).toHaveBeenCalled()
  })

  it('returns none when every rate lookup fails (offline / missing artifact)', async () => {
    const failing: StoryFetch = async () => {
      throw new Error('network down')
    }
    const match = makeMatch({ home_score: 1, away_score: 0, events: [goal('home', 40)] })
    const story = await buildMatchStory(match, failing)
    expect(story.coverage).toBe('none')
  })

  it('returns none for a red-cards-only match (no goal beats, no receipts)', async () => {
    const match = makeMatch({ events: [redCard('away', 30)] })
    const story = await buildMatchStory(match, makeFetcher({}))
    expect(story.coverage).toBe('none')
  })
})

// ---------------------------------------------------------------------------
// Timeline reconstruction
// ---------------------------------------------------------------------------

describe('timeline reconstruction', () => {
  it('credits own goals to the side whose score increments', async () => {
    const match = makeMatch({
      home_score: 1,
      away_score: 0,
      events: [goal('home', 30, { type: 'own_goal', player: 'Unlucky Defender' })],
    })
    const story = await buildMatchStory(
      match,
      makeFetcher({ 'M:0:30': THICK(1000, 400), 'M:1:30': THICK(800, 480) })
    )
    expect(story.coverage).toBe('full')
    const beat = story.acts.flatMap((a) => a.beats)[0]
    expect(beat.type).toBe('own_goal')
    expect(beat.scoreAfter).toEqual({ home: 1, away: 0 })
  })

  it('counts penalty goals toward the reconciled score', async () => {
    const match = makeMatch({
      home_score: 0,
      away_score: 1,
      events: [goal('away', 20, { type: 'penalty_goal' })],
    })
    const story = await buildMatchStory(
      match,
      makeFetcher({ 'M:0:20': THICK(1200, 470), 'M:-1:20': THICK(900, 180) })
    )
    expect(story.coverage).toBe('full')
    expect(story.acts.flatMap((a) => a.beats)[0].scoreAfter).toEqual({ home: 0, away: 1 })
  })

  it('orders first-half stoppage (45+3) before an early second-half goal (46)', async () => {
    const match = makeMatch({
      home_score: 1,
      away_score: 1,
      events: [goal('away', 46), goal('home', 45, { addedTime: 3 })],
    })
    // Both effective minutes (48, 46) land in the 45 bucket, so the two beats
    // share state keys — also proves the distinct-state dedupe.
    const fetcher = makeFetcher({ 'M:0:45': THICK(1000, 390), 'M:1:45': THICK(800, 560) })
    const story = await buildMatchStory(match, fetcher)
    const beats = story.acts.flatMap((a) => a.beats)
    expect(beats.map((b) => `${b.minute}+${b.addedTime ?? 0}`)).toEqual(['45+3', '46+0'])
    expect(beats[0].scoreAfter).toEqual({ home: 1, away: 0 })
    expect(beats[1].scoreAfter).toEqual({ home: 1, away: 1 })
    expect(fetcher).toHaveBeenCalledTimes(2) // M:0:45 and M:1:45, each once
  })

  it('clamps 90+X stoppage goals into the 90 bucket', async () => {
    const match = makeMatch({
      home_score: 1,
      away_score: 0,
      events: [goal('home', 90, { addedTime: 4 })],
    })
    const fetcher = makeFetcher({ 'M:0:90': THICK(2000, 400), 'M:1:90': THICK(1500, 1440) })
    const story = await buildMatchStory(match, fetcher)
    expect(story.coverage).toBe('full')
    for (const call of (fetcher as jest.Mock).mock.calls) {
      expect(call[0]).toContain('minute=90')
    }
    const beat = story.acts.flatMap((a) => a.beats)[0]
    expect(beat.minute).toBe(90)
    expect(beat.addedTime).toBe(4)
  })

  it('returns none when a state-changing event has no usable minute', async () => {
    const match = makeMatch({
      home_score: 1,
      away_score: 0,
      events: [{ ...goal('home', 30), minute: Number.NaN }],
    })
    const story = await buildMatchStory(match, makeFetcher({}))
    expect(story.coverage).toBe('none')
  })
})

// ---------------------------------------------------------------------------
// Beat Δ math and honesty gates
// ---------------------------------------------------------------------------

describe('beat deltas', () => {
  // PSG 2-1 Toulouse: opener 38', equaliser 60', winner 87'.
  const psg = makeMatch({
    home_score: 2,
    away_score: 1,
    events: [
      goal('home', 38, { player: 'Opener' }),
      goal('away', 60, { player: 'Leveller' }),
      goal('home', 87, { player: 'Ramos' }),
    ],
  })
  const rates = {
    'M:0:35': THICK(1000, 400), // 40%
    'M:1:35': THICK(800, 480), //  60%  → Δ1 = +20pp
    'M:1:60': THICK(600, 420), //  70%
    'M:0:60': THICK(900, 360), //  40%  → Δ2 = −30pp
    'M:0:85': THICK(700, 280), //  40%
    'M:1:85': THICK(500, 425), //  85%  → Δ3 = +45pp → turning point
  }

  it('computes signed home-perspective Δs from the mocked counts, with receipts', async () => {
    const story = await buildMatchStory(psg, makeFetcher(rates))
    expect(story.coverage).toBe('full')
    const beats = story.acts.flatMap((a) => a.beats)
    expect(beats).toHaveLength(3)

    expect(beats[0].deltaWinRate).toBeCloseTo(0.2, 10)
    expect(beats[1].deltaWinRate).toBeCloseTo(-0.3, 10)
    expect(beats[2].deltaWinRate).toBeCloseTo(0.45, 10)

    expect(beats[2].rates).toEqual({
      before: 0.4,
      after: 0.85,
      n_before: 700,
      n_after: 500,
      w_before: 280,
      w_after: 425,
    })
  })

  it('labels the largest |Δ| as the turning point with a correct beat ref', async () => {
    const story = await buildMatchStory(psg, makeFetcher(rates))
    expect(story.turningPoint).toBeDefined()
    const { actIndex, beatIndex } = story.turningPoint!
    const beat = story.acts[actIndex].beats[beatIndex]
    expect(beat.player).toBe('Ramos')
    expect(beat.minute).toBe(87)
  })

  it('fetches each distinct state exactly once', async () => {
    const fetcher = makeFetcher(rates)
    await buildMatchStory(psg, fetcher)
    expect(fetcher).toHaveBeenCalledTimes(6)
    const urls = (fetcher as jest.Mock).mock.calls.map((c) => c[0] as string)
    expect(new Set(urls).size).toBe(urls.length)
  })

  it('suppresses the Δ when either state has n < 50, degrading coverage to partial', async () => {
    const thin = { ...rates, 'M:1:35': THICK(49, 30) }
    const story = await buildMatchStory(psg, makeFetcher(thin))
    expect(story.coverage).toBe('partial')
    const beats = story.acts.flatMap((a) => a.beats)
    expect(beats[0].deltaWinRate).toBeUndefined()
    expect(beats[0].rates).toBeUndefined()
    expect(beats[1].deltaWinRate).toBeCloseTo(-0.3, 10)
  })

  it('never labels a turning point below the 15-point threshold', async () => {
    const match = makeMatch({ home_score: 1, away_score: 0, events: [goal('home', 40)] })
    const story = await buildMatchStory(
      match,
      makeFetcher({ 'M:0:40': THICK(1000, 400), 'M:1:40': THICK(1000, 500) }) // Δ = +10pp
    )
    expect(story.coverage).toBe('full')
    expect(story.turningPoint).toBeUndefined()
  })

  it('gives no Δ when clamping collapses both states onto one key (4th goal of a 4-0)', async () => {
    const match = makeMatch({
      home_score: 4,
      away_score: 0,
      events: [goal('home', 10), goal('home', 20), goal('home', 30), goal('home', 80)],
    })
    const table = {
      'M:0:10': THICK(2400, 950),
      'M:1:10': THICK(400, 250),
      'M:1:20': THICK(500, 320),
      'M:2:20': THICK(100, 90),
      'M:2:30': THICK(120, 110),
      'M:3:30': THICK(60, 58),
      'M:3:80': THICK(300, 298), // before AND after clamp here
    }
    const story = await buildMatchStory(match, makeFetcher(table))
    const beats = story.acts.flatMap((a) => a.beats)
    expect(beats[3].deltaWinRate).toBeUndefined()
    expect(story.coverage).toBe('partial') // three receipted beats, one uncountable
  })

  it('keeps red cards as beats without any rate claim', async () => {
    const match = makeMatch({
      home_score: 1,
      away_score: 0,
      events: [goal('home', 70), redCard('away', 55, 'Sent Off')],
    })
    const fetcher = makeFetcher({ 'M:0:70': THICK(500, 200), 'M:1:70': THICK(400, 320) })
    const story = await buildMatchStory(match, fetcher)
    const beats = story.acts.flatMap((a) => a.beats)
    expect(beats.map((b) => b.type)).toEqual(['red_card', 'goal'])
    expect(beats[0].deltaWinRate).toBeUndefined()
    expect(beats[0].scoreAfter).toEqual({ home: 0, away: 0 })
    expect(fetcher).toHaveBeenCalledTimes(2) // red card contributes no lookups
    // Δ = +40pp → the goal (second beat of its act) is the turning point.
    expect(story.turningPoint).toBeDefined()
    const tp = story.acts[story.turningPoint!.actIndex].beats[story.turningPoint!.beatIndex]
    expect(tp.type).toBe('goal')
  })
})

// ---------------------------------------------------------------------------
// Acts — factual template headers
// ---------------------------------------------------------------------------

describe('act segmentation and headers', () => {
  it('builds quiet opening/closing acts and a spelled-out cluster header', async () => {
    const match = makeMatch({
      home_score: 2,
      away_score: 1,
      events: [
        goal('home', 30),
        goal('away', 35),
        goal('home', 41),
      ],
    })
    const table = {
      'M:0:30': THICK(1000, 400),
      'M:1:30': THICK(800, 480),
      'M:1:35': THICK(700, 430),
      'M:0:35': THICK(1000, 400),
      'M:0:40': THICK(950, 380),
      'M:1:40': THICK(760, 470),
    }
    const story = await buildMatchStory(match, makeFetcher(table))
    expect(story.acts.map((a) => a.header)).toEqual([
      'Nothing separated them for 30 minutes',
      'Three goals in eleven first-half minutes',
      'No goals in the final 49 minutes',
    ])
    expect(story.acts[0].beats).toHaveLength(0)
    expect(story.acts[1].beats).toHaveLength(3)
    expect(story.acts[2].beats).toHaveLength(0)
  })

  it('writes score-transition headers for single-goal acts', async () => {
    const match = makeMatch({
      home_score: 1,
      away_score: 1,
      events: [goal('home', 25), goal('away', 60)],
    })
    const table = {
      'M:0:25': THICK(1000, 400),
      'M:1:25': THICK(800, 480),
      'M:1:60': THICK(600, 420),
      'M:0:60': THICK(900, 360),
    }
    const story = await buildMatchStory(match, makeFetcher(table))
    expect(story.acts.map((a) => a.header)).toEqual([
      'Nothing separated them for 25 minutes',
      'PSG ahead after 25 minutes',
      'Level at 1-1 after 60 minutes',
      'No goals in the final 30 minutes',
    ])
  })

  it('states the counted player deficit for a red-card act', async () => {
    const match = makeMatch({
      home_score: 1,
      away_score: 0,
      events: [goal('home', 10), redCard('away', 50)],
    })
    const table = { 'M:0:10': THICK(2400, 950), 'M:1:10': THICK(400, 250) }
    const story = await buildMatchStory(match, makeFetcher(table))
    expect(story.acts.map((a) => a.header)).toEqual([
      'PSG ahead after 10 minutes',
      'Toulouse down to ten after 50 minutes',
      'No goals in the final 40 minutes',
    ])
  })

  it('uses a pull-one-back header when a trailing side narrows a 2+ deficit', async () => {
    const match = makeMatch({
      home_score: 2,
      away_score: 1,
      events: [goal('home', 10), goal('home', 20), goal('away', 75)],
    })
    const table = {
      'M:0:10': THICK(2400, 950),
      'M:1:10': THICK(400, 250),
      'M:1:20': THICK(500, 320),
      'M:2:20': THICK(100, 90),
      'M:2:75': THICK(240, 232),
      'M:1:75': THICK(470, 390),
    }
    const story = await buildMatchStory(match, makeFetcher(table))
    expect(story.acts.some((a) => a.header === 'Toulouse pull one back after 75 minutes')).toBe(true)
  })
})
