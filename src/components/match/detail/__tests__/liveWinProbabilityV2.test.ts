/**
 * Live win-probability v2 pure helpers — reading the kernel's continuation
 * state off a live match, mapping its distribution onto the three-way shape,
 * and turning exact-count W/D/L into an honest historical base rate.
 */
import type { ForkDistribution } from '../engineClient'
import {
  BASE_RATE_MIN_SAMPLE,
  deriveEngineLiveState,
  distributionToProbabilities,
  rarityToBaseRate,
} from '../liveWinProbabilityV2'
import type { MatchDetails, MatchEvent } from '../types'

function baseMatch(overrides: Partial<MatchDetails> = {}): MatchDetails {
  return {
    id: 'm1',
    home_team: 'Arsenal',
    away_team: 'Chelsea',
    home_score: 1,
    away_score: 0,
    status: 'IN_PROGRESS',
    minute: 62,
    date: '2026-07-21T00:00:00Z',
    league: 'Premier League',
    leagueId: 'eng.1',
    events: [],
    lineups: { home: [], away: [] },
    stats: { possession: [50, 50], shots: [0, 0], shotsOnTarget: [0, 0], corners: [0, 0], fouls: [0, 0] },
    h2h: { homeWins: 0, draws: 0, awayWins: 0, recentMatches: [] },
    ...overrides,
  }
}

const reds = (side: 'home' | 'away', minute: number): MatchEvent => ({
  type: 'red_card',
  minute,
  player: 'x',
  team: side,
})

describe('deriveEngineLiveState', () => {
  it('reads clock, score, and per-side red cards off the live match', () => {
    const match = baseMatch({
      minute: 70,
      home_score: 2,
      away_score: 1,
      events: [reds('away', 40), reds('away', 66), { type: 'yellow_card', minute: 20, player: 'y', team: 'home' }],
    })
    expect(deriveEngineLiveState(match)).toEqual({
      minute: 70,
      homeGoals: 2,
      awayGoals: 1,
      homeReds: 0,
      awayReds: 2,
    })
  })

  it('returns null when the clock or the score is incomplete', () => {
    expect(deriveEngineLiveState(baseMatch({ minute: undefined }))).toBeNull()
    expect(deriveEngineLiveState(baseMatch({ home_score: null }))).toBeNull()
    expect(deriveEngineLiveState(baseMatch({ away_score: null }))).toBeNull()
  })

  it('floors the clock and clamps scores to non-negative integers', () => {
    const state = deriveEngineLiveState(baseMatch({ minute: 45.8, home_score: 0, away_score: 3 }))
    expect(state).toEqual({ minute: 45, homeGoals: 0, awayGoals: 3, homeReds: 0, awayReds: 0 })
  })
})

describe('distributionToProbabilities', () => {
  it('maps the kernel distribution onto the three-way outcome shape', () => {
    const dist: ForkDistribution = {
      pHome: 0.6,
      pDraw: 0.25,
      pAway: 0.15,
      expHomeGoals: 1.9,
      expAwayGoals: 0.8,
      topScorelines: [],
    }
    expect(distributionToProbabilities(dist)).toEqual({ home_win: 0.6, draw: 0.25, away_win: 0.15 })
  })
})

describe('rarityToBaseRate', () => {
  it('turns home-side W/D/L counts into a three-way rate', () => {
    const rate = rarityToBaseRate({ n: 200, w: 120, d: 50, l: 30 })
    expect(rate).not.toBeNull()
    expect(rate!.sample).toBe(200)
    expect(rate!.probabilities.home_win).toBeCloseTo(0.6, 9)
    expect(rate!.probabilities.draw).toBeCloseTo(0.25, 9)
    expect(rate!.probabilities.away_win).toBeCloseTo(0.15, 9)
  })

  it('refuses a sample below the minimum (too thin to claim)', () => {
    expect(rarityToBaseRate({ n: BASE_RATE_MIN_SAMPLE - 1, w: 10, d: 5, l: 5 })).toBeNull()
    expect(rarityToBaseRate({ n: 0, w: 0, d: 0, l: 0 })).toBeNull()
    expect(rarityToBaseRate(null)).toBeNull()
  })

  it('accepts exactly the minimum sample', () => {
    const rate = rarityToBaseRate({ n: BASE_RATE_MIN_SAMPLE, w: BASE_RATE_MIN_SAMPLE, d: 0, l: 0 })
    expect(rate).not.toBeNull()
    expect(rate!.probabilities.home_win).toBe(1)
  })
})
