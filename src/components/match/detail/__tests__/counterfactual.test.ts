/**
 * Counterfactual fork-state math — the tricky cases the kernel must never be
 * lied to about: added-time folding (identical to story.ts), own goals
 * credited to the scoring side, multi-goal minutes, removals, the
 * can't-remove-future-events rule, and the reds sanity cap. Pure functions;
 * no network, no component.
 */
import {
  FORK_MINUTE_MAX,
  FORK_MINUTE_MIN,
  MAX_REDS,
  buildForkTimeline,
  clampForkMinute,
  effectiveRemovals,
  forkStateLine,
  hasHappenedBy,
  isForkEligible,
  stateAtMinute,
  statesEqual,
  type ForkEvent,
} from '../counterfactual'
import type { MatchDetails, MatchEvent } from '../types'

// ---------------------------------------------------------------------------
// Fixtures (momentum.test.ts style)
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

/** Build a timeline that is guaranteed non-null, for the state-math tests. */
function timelineOf(match: MatchDetails): ForkEvent[] {
  const timeline = buildForkTimeline(match)
  if (!timeline) throw new Error('fixture must produce a valid timeline')
  return timeline
}

// ---------------------------------------------------------------------------
// buildForkTimeline — the story/river integrity gates, unchanged
// ---------------------------------------------------------------------------

describe('buildForkTimeline', () => {
  it('returns null when the final score is missing', () => {
    const match = makeMatch({ home_score: null, events: [goal('home', 10)] })
    expect(buildForkTimeline(match)).toBeNull()
    expect(isForkEligible(match)).toBe(false)
  })

  it('returns null when the goal events do not reproduce the final score', () => {
    const match = makeMatch({ home_score: 2, away_score: 0, events: [goal('home', 10)] })
    expect(buildForkTimeline(match)).toBeNull()
  })

  it('returns null for a match with no state-changing events', () => {
    expect(buildForkTimeline(makeMatch())).toBeNull()
  })

  it('returns null when an event cannot be placed on the clock', () => {
    const match = makeMatch({
      home_score: 1,
      away_score: 0,
      events: [goal('home', Number.NaN)],
    })
    expect(buildForkTimeline(match)).toBeNull()
  })

  it('assigns stable sequential ids in lexicographic (minute, addedTime) order', () => {
    const match = makeMatch({
      home_score: 1,
      away_score: 1,
      // Payload order scrambled: the 46' goal listed before the 45+3 one.
      events: [goal('away', 46), goal('home', 45, { addedTime: 3 })],
    })
    const timeline = timelineOf(match)
    expect(timeline.map((e) => ({ id: e.id, minute: e.minute, addedTime: e.addedTime }))).toEqual([
      { id: 0, minute: 45, addedTime: 3 },
      { id: 1, minute: 46, addedTime: undefined },
    ])
  })
})

// ---------------------------------------------------------------------------
// clampForkMinute / hasHappenedBy
// ---------------------------------------------------------------------------

describe('clampForkMinute', () => {
  it('clamps onto whole minutes in [1, 90]', () => {
    expect(clampForkMinute(0)).toBe(FORK_MINUTE_MIN)
    expect(clampForkMinute(-5)).toBe(FORK_MINUTE_MIN)
    expect(clampForkMinute(95)).toBe(FORK_MINUTE_MAX)
    expect(clampForkMinute(45.4)).toBe(45)
    expect(clampForkMinute(Number.NaN)).toBe(FORK_MINUTE_MIN)
  })
})

describe('hasHappenedBy — added-time folding', () => {
  it('places 45+3 inside minute 45 (story.ts lexicographic convention)', () => {
    const stoppage = { minute: 45 } // base minute of a 45+3 event
    expect(hasHappenedBy(stoppage, 45)).toBe(true)
    expect(hasHappenedBy(stoppage, 44)).toBe(false)
  })

  it('a 46th-minute event has not happened by the 45th', () => {
    expect(hasHappenedBy({ minute: 46 }, 45)).toBe(false)
    expect(hasHappenedBy({ minute: 46 }, 46)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// stateAtMinute — the heart of the fork
// ---------------------------------------------------------------------------

describe('stateAtMinute', () => {
  const base = makeMatch({
    home_score: 2,
    away_score: 1,
    events: [
      goal('home', 10, { player: 'A' }),
      redCard('away', 30),
      goal('away', 45, { addedTime: 2, player: 'B' }),
      goal('home', 70, { player: 'C' }),
    ],
  })

  it('counts everything that happened by the fork minute', () => {
    const timeline = timelineOf(base)
    expect(stateAtMinute(timeline, 90)).toEqual({
      minute: 90,
      homeGoals: 2,
      awayGoals: 1,
      homeReds: 0,
      awayReds: 1,
    })
  })

  it('excludes events after the fork automatically', () => {
    const timeline = timelineOf(base)
    expect(stateAtMinute(timeline, 29)).toEqual({
      minute: 29,
      homeGoals: 1,
      awayGoals: 0,
      homeReds: 0,
      awayReds: 0,
    })
  })

  it('folds added time: the 45+2 goal is inside a fork at 45, outside at 44', () => {
    const timeline = timelineOf(base)
    expect(stateAtMinute(timeline, 45).awayGoals).toBe(1)
    expect(stateAtMinute(timeline, 44).awayGoals).toBe(0)
  })

  it('credits own goals to the scoring side (the side whose score increments)', () => {
    const match = makeMatch({
      home_score: 1,
      away_score: 0,
      // Provider convention: the event's team is the side credited with the goal.
      events: [goal('home', 20, { type: 'own_goal', player: 'Unlucky Defender' })],
    })
    const timeline = timelineOf(match)
    expect(stateAtMinute(timeline, 25)).toMatchObject({ homeGoals: 1, awayGoals: 0 })
  })

  it('handles multi-goal minutes: both goals count, each removable on its own', () => {
    const match = makeMatch({
      home_score: 2,
      away_score: 0,
      events: [goal('home', 55, { player: 'X' }), goal('home', 55, { player: 'Y' })],
    })
    const timeline = timelineOf(match)
    expect(stateAtMinute(timeline, 55).homeGoals).toBe(2)
    expect(stateAtMinute(timeline, 55, new Set([timeline[0].id])).homeGoals).toBe(1)
    expect(stateAtMinute(timeline, 55, new Set([timeline[0].id, timeline[1].id])).homeGoals).toBe(0)
  })

  it('removals subtract goals and red cards', () => {
    const timeline = timelineOf(base)
    const redId = timeline.find((e) => e.type === 'red_card')!.id
    const firstGoalId = timeline.find((e) => e.player === 'A')!.id
    expect(stateAtMinute(timeline, 90, new Set([redId, firstGoalId]))).toEqual({
      minute: 90,
      homeGoals: 1,
      awayGoals: 1,
      homeReds: 0,
      awayReds: 0,
    })
  })

  it('a removal of a future event has no effect on the state', () => {
    const timeline = timelineOf(base)
    const lateGoalId = timeline.find((e) => e.player === 'C')!.id // 70'
    expect(stateAtMinute(timeline, 40, new Set([lateGoalId]))).toEqual(
      stateAtMinute(timeline, 40)
    )
  })

  it('adds one hypothetical goal for either side — state math only', () => {
    const timeline = timelineOf(base)
    expect(stateAtMinute(timeline, 29, new Set(), 'away')).toMatchObject({
      homeGoals: 1,
      awayGoals: 1,
    })
    expect(stateAtMinute(timeline, 29, new Set(), 'home')).toMatchObject({
      homeGoals: 2,
      awayGoals: 0,
    })
  })

  it('clamps the fork minute onto [1, 90]', () => {
    const timeline = timelineOf(base)
    expect(stateAtMinute(timeline, 120).minute).toBe(90)
    expect(stateAtMinute(timeline, -3).minute).toBe(1)
  })

  it('excludes extra-time events (base minute > 90) from every fork', () => {
    const match = makeMatch({
      home_score: 2,
      away_score: 1,
      events: [goal('home', 20), goal('away', 60), goal('home', 105, { player: 'ET Hero' })],
    })
    const timeline = timelineOf(match)
    expect(stateAtMinute(timeline, 90)).toMatchObject({ homeGoals: 1, awayGoals: 1 })
  })

  it('caps reds at the team-size sanity limit', () => {
    const events = [
      goal('home', 5),
      ...Array.from({ length: 7 }, (_, i) => redCard('away', 10 + i, `Player ${i}`)),
    ]
    const match = makeMatch({ home_score: 1, away_score: 0, events })
    const timeline = timelineOf(match)
    expect(stateAtMinute(timeline, 90).awayReds).toBe(MAX_REDS)
  })
})

// ---------------------------------------------------------------------------
// effectiveRemovals — the auto-exclusion rule as a set operation
// ---------------------------------------------------------------------------

describe('effectiveRemovals', () => {
  it('prunes removals of events after the fork, keeps the rest', () => {
    const match = makeMatch({
      home_score: 2,
      away_score: 0,
      events: [goal('home', 10), goal('home', 80)],
    })
    const timeline = timelineOf(match)
    const removed = new Set([timeline[0].id, timeline[1].id])
    expect([...effectiveRemovals(timeline, 40, removed)]).toEqual([timeline[0].id])
    expect([...effectiveRemovals(timeline, 85, removed)].sort()).toEqual(
      [timeline[0].id, timeline[1].id].sort()
    )
  })
})

// ---------------------------------------------------------------------------
// statesEqual / forkStateLine
// ---------------------------------------------------------------------------

describe('statesEqual', () => {
  it('is field-exact', () => {
    const a = { minute: 55, homeGoals: 1, awayGoals: 1, homeReds: 0, awayReds: 0 }
    expect(statesEqual(a, { ...a })).toBe(true)
    expect(statesEqual(a, { ...a, awayReds: 1 })).toBe(false)
    expect(statesEqual(a, { ...a, minute: 56 })).toBe(false)
  })
})

describe('forkStateLine', () => {
  it('states the score, and player counts only when a side is short', () => {
    expect(
      forkStateLine({ minute: 55, homeGoals: 1, awayGoals: 1, homeReds: 0, awayReds: 0 }, 'PSG', 'Toulouse')
    ).toBe('1–1')
    expect(
      forkStateLine({ minute: 55, homeGoals: 2, awayGoals: 0, homeReds: 1, awayReds: 2 }, 'PSG', 'Toulouse')
    ).toBe('2–0 · PSG down to 10 · Toulouse down to 9')
  })
})
