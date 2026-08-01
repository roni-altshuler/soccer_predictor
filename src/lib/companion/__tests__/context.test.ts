/**
 * Companion context — the honesty gates.
 *
 * These tests exist to pin the two predicates every capability keys off
 * (`hasScoreState`, `hasTimeline`) and to prove `normalizeContext` degrades to
 * global rather than throwing. A context bug does not break one feature; it
 * breaks the Companion on every page it is mounted on.
 */

import {
  contextLabel,
  GLOBAL_CONTEXT,
  hasScoreState,
  hasTimeline,
  isMatch,
  normalizeContext,
  type MatchContext,
} from '../context'

function makeMatch(over: Partial<MatchContext> = {}): MatchContext {
  return {
    kind: 'match',
    matchId: '733123',
    home: 'Arsenal',
    away: 'Chelsea',
    competitionId: 'eng.1',
    gender: 'M',
    phase: 'live',
    homeScore: 0,
    awayScore: 2,
    minute: 63,
    hasEventCoverage: true,
    ...over,
  }
}

describe('hasScoreState', () => {
  it('accepts a live match with a score', () => {
    expect(hasScoreState(makeMatch())).toBe(true)
  })

  it('accepts a finished match', () => {
    expect(hasScoreState(makeMatch({ phase: 'finished', minute: null }))).toBe(true)
  })

  it('rejects a scheduled match with no score', () => {
    const scheduled = makeMatch({ phase: 'scheduled', homeScore: null, awayScore: null })
    expect(hasScoreState(scheduled)).toBe(false)
  })

  it('rejects a half-known score rather than assuming zero', () => {
    expect(hasScoreState(makeMatch({ awayScore: null }))).toBe(false)
  })

  it('rejects non-match contexts', () => {
    expect(hasScoreState(GLOBAL_CONTEXT)).toBe(false)
    expect(hasScoreState({ kind: 'league', competitionId: 'eng.1', gender: 'M' })).toBe(false)
  })
})

describe('hasTimeline', () => {
  it('requires event coverage, not merely a finished match', () => {
    expect(hasTimeline(makeMatch({ phase: 'finished', hasEventCoverage: false }))).toBe(false)
    expect(hasTimeline(makeMatch({ phase: 'finished', hasEventCoverage: true }))).toBe(true)
  })
})

describe('normalizeContext', () => {
  it('degrades unknown shapes to global instead of throwing', () => {
    expect(normalizeContext(null).kind).toBe('global')
    expect(normalizeContext('nonsense').kind).toBe('global')
    expect(normalizeContext({ kind: 'wat' }).kind).toBe('global')
    expect(normalizeContext(undefined).kind).toBe('global')
  })

  it('degrades an incomplete match to global rather than inventing fields', () => {
    expect(normalizeContext({ kind: 'match', matchId: '1' }).kind).toBe('global')
  })

  it('round-trips a full match context', () => {
    const ctx = normalizeContext(makeMatch())
    expect(isMatch(ctx)).toBe(true)
    if (!isMatch(ctx)) return
    expect(ctx.matchId).toBe('733123')
    expect(ctx.awayScore).toBe(2)
    expect(ctx.minute).toBe(63)
    expect(ctx.hasEventCoverage).toBe(true)
  })

  it('treats coverage as opt-in — a missing flag is not coverage', () => {
    const ctx = normalizeContext({ ...makeMatch(), hasEventCoverage: undefined })
    expect(hasTimeline(ctx)).toBe(false)
  })

  it('defaults an unrecognised gender to the men’s universe', () => {
    expect(normalizeContext({ kind: 'live', gender: 'X' }).gender).toBe('M')
    expect(normalizeContext({ kind: 'live', gender: 'F' }).gender).toBe('F')
  })

  it('rejects a non-finite score rather than passing NaN downstream', () => {
    const ctx = normalizeContext({ ...makeMatch(), homeScore: Number.NaN })
    expect(hasScoreState(ctx)).toBe(false)
  })
})

describe('contextLabel', () => {
  it('names the subject for each kind', () => {
    expect(contextLabel(makeMatch())).toBe('Arsenal v Chelsea')
    expect(contextLabel({ kind: 'league', competitionId: 'eng.1', gender: 'M' })).toBe('eng.1')
    expect(contextLabel({ kind: 'live', gender: 'M' })).toBe('Live now')
    expect(contextLabel(GLOBAL_CONTEXT)).toBe('Pitchverse')
  })
})
