/**
 * Anchor selection — which moment of a finished match is worth asking about.
 *
 * The ordering here is a product decision, not an implementation detail: it
 * decides the sentence a fan reads on every finished match page. These tests
 * pin it directly.
 */

import { pickAnchor, statesBeforeGoals, surpriseOf, type TimelineState } from '../anchor'

const state = (minute: number, homeScore: number, awayScore: number): TimelineState => ({
  minute,
  homeScore,
  awayScore,
})

describe('statesBeforeGoals', () => {
  it('reports the score BEFORE each goal, never the full-time score', () => {
    // 0-1 (23'), 1-1 (55'), 2-1 (78')
    const states = statesBeforeGoals([
      { minute: 23, home: 0, away: 1 },
      { minute: 55, home: 1, away: 1 },
      { minute: 78, home: 2, away: 1 },
    ])
    expect(states).toEqual([state(23, 0, 0), state(55, 0, 1), state(78, 1, 1)])
  })

  it('yields nothing for a goalless match', () => {
    expect(statesBeforeGoals([])).toEqual([])
  })
})

describe('surpriseOf', () => {
  it('scores a home win by how far behind the home side was', () => {
    expect(surpriseOf(state(60, 0, 2), 3, 2)).toBe(2)
    expect(surpriseOf(state(60, 2, 0), 3, 2)).toBe(-2)
  })

  it('mirrors for an away win', () => {
    expect(surpriseOf(state(60, 0, 2), 2, 3)).toBe(-2)
    expect(surpriseOf(state(60, 2, 0), 2, 3)).toBe(2)
  })

  it('scores a draw by how far from level it got, either way', () => {
    expect(surpriseOf(state(60, 2, 0), 2, 2)).toBe(2)
    expect(surpriseOf(state(60, 0, 2), 2, 2)).toBe(2)
    expect(surpriseOf(state(60, 1, 1), 2, 2)).toBe(0)
  })
})

describe('pickAnchor', () => {
  it('finds the deepest hole the eventual winner climbed out of', () => {
    // Home trailed 0-2, won 3-2. The story is the 0-2.
    const states = [state(20, 0, 0), state(35, 0, 1), state(63, 0, 2), state(80, 1, 2)]
    expect(pickAnchor(states, 3, 2)).toEqual({ minute: 63, homeScore: 0, awayScore: 2 })
  })

  it('breaks ties toward the later minute — two down at 80 beats two down at 20', () => {
    const states = [state(20, 0, 2), state(80, 0, 2)]
    expect(pickAnchor(states, 3, 2)?.minute).toBe(80)
  })

  it('is order-independent', () => {
    const states = [state(80, 0, 2), state(20, 0, 2)]
    expect(pickAnchor(states, 3, 2)?.minute).toBe(80)
  })

  it('picks the biggest blown lead when it finished level', () => {
    // Away led 0-2, drew 2-2.
    const states = [state(30, 0, 1), state(44, 0, 2), state(70, 1, 2)]
    expect(pickAnchor(states, 2, 2)).toEqual({ minute: 44, homeScore: 0, awayScore: 2 })
  })

  it('still anchors a match the winner led throughout', () => {
    // Home won 2-0 without ever trailing: the honest question is the level
    // state before the opener, which is a real question ("still 0-0 at 78'").
    const states = [state(78, 0, 0), state(88, 1, 0)]
    expect(pickAnchor(states, 2, 0)).toEqual({ minute: 78, homeScore: 0, awayScore: 0 })
  })

  it('returns null for a goalless match rather than quoting a tautology', () => {
    expect(pickAnchor([], 0, 0)).toBeNull()
  })
})
