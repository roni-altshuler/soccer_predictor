/**
 * Companion capability registry — availability gates and link integrity.
 *
 * The registry's whole value is that everything it offers is real. These tests
 * guard the two ways that can rot: offering a capability whose data does not
 * exist (a scheduled match has no timeline to fork), and linking to a surface
 * that will not honour the deep link.
 */

import { WHATIF_TAB } from '@/components/match/detail/counterfactual'

import {
  CAPABILITIES,
  capabilitiesFor,
  groupedCapabilitiesFor,
  VERBS,
} from '../capabilities'
import { GLOBAL_CONTEXT, type CompanionContext, type MatchContext } from '../context'

function makeMatch(over: Partial<MatchContext> = {}): MatchContext {
  return {
    kind: 'match',
    matchId: '733123',
    home: 'Arsenal',
    away: 'Chelsea',
    competitionId: 'eng.1',
    gender: 'M',
    phase: 'finished',
    homeScore: 2,
    awayScore: 2,
    minute: null,
    hasEventCoverage: true,
    ...over,
  }
}

const LEAGUE: CompanionContext = { kind: 'league', competitionId: 'eng.1', gender: 'M' }

const ids = (ctx: CompanionContext) => capabilitiesFor(ctx).map((c) => c.id)

describe('registry hygiene', () => {
  it('has unique ids', () => {
    const seen = new Set(CAPABILITIES.map((c) => c.id))
    expect(seen.size).toBe(CAPABILITIES.length)
  })

  it('only uses the four verbs', () => {
    for (const c of CAPABILITIES) expect(VERBS).toContain(c.verb)
  })

  it('never produces an empty href, in any context', () => {
    const contexts: CompanionContext[] = [
      GLOBAL_CONTEXT,
      LEAGUE,
      { kind: 'live', gender: 'M' },
      { kind: 'team', teamId: '359', name: 'Arsenal', gender: 'M', competitionId: 'eng.1' },
      makeMatch(),
      makeMatch({ phase: 'scheduled', homeScore: null, awayScore: null }),
    ]
    for (const ctx of contexts) {
      for (const c of CAPABILITIES) {
        expect(c.href(ctx)).toMatch(/^\//)
      }
    }
  })
})

describe('honesty gates', () => {
  it('offers no timeline capabilities on a scheduled match', () => {
    const scheduled = makeMatch({ phase: 'scheduled', homeScore: null, awayScore: null })
    const available = ids(scheduled)
    expect(available).not.toContain('fork-match')
    expect(available).not.toContain('match-story')
    expect(available).not.toContain('similar-matches')
    // …and nothing that needs a score.
    expect(available).not.toContain('rarity')
  })

  it('withholds the fork from an uncovered finished match', () => {
    expect(ids(makeMatch({ hasEventCoverage: false }))).not.toContain('fork-match')
    expect(ids(makeMatch({ hasEventCoverage: true }))).toContain('fork-match')
  })

  it('withholds the fork from a live match — you cannot fork what is unfinished', () => {
    expect(ids(makeMatch({ phase: 'live', minute: 63 }))).not.toContain('fork-match')
  })

  it('offers live win probability only while the match is running', () => {
    expect(ids(makeMatch({ phase: 'live', minute: 63 }))).toContain('live-winprob')
    expect(ids(makeMatch({ phase: 'finished' }))).not.toContain('live-winprob')
    expect(ids(makeMatch({ phase: 'scheduled' }))).not.toContain('live-winprob')
  })

  it('offers rarity on a live match with a score', () => {
    expect(ids(makeMatch({ phase: 'live', homeScore: 0, awayScore: 2, minute: 63 }))).toContain(
      'rarity'
    )
  })
})

describe('deep links', () => {
  it('sends the fork to the What if tab', () => {
    const fork = CAPABILITIES.find((c) => c.id === 'fork-match')!
    expect(fork.href(makeMatch())).toBe(`/matches/733123?tab=${WHATIF_TAB}`)
  })

  it('encodes ids that need it', () => {
    const h2h = CAPABILITIES.find((c) => c.id === 'head-to-head')!
    expect(h2h.href(makeMatch({ matchId: 'a b/c' }))).toBe('/matches/a%20b%2Fc?tab=h2h')
  })

  it('points league capabilities at the league page', () => {
    const justice = CAPABILITIES.find((c) => c.id === 'justice-ledger')!
    expect(justice.href(LEAGUE)).toBe('/leagues/eng.1')
  })
})

describe('grouping', () => {
  it('omits verbs with nothing to offer rather than rendering an empty header', () => {
    const scheduled = makeMatch({ phase: 'scheduled', homeScore: null, awayScore: null })
    const verbs = groupedCapabilitiesFor(scheduled).map((g) => g.verb)
    expect(verbs).not.toContain('counterfact')
    expect(verbs).toContain('predict')
  })

  it('returns groups in the canonical verb order', () => {
    const verbs = groupedCapabilitiesFor(makeMatch()).map((g) => g.verb)
    expect(verbs).toEqual([...VERBS].filter((v) => verbs.includes(v)))
  })

  it('always offers something, even with no subject at all', () => {
    expect(groupedCapabilitiesFor(GLOBAL_CONTEXT).length).toBeGreaterThan(0)
  })

  it('never drops a capability during grouping', () => {
    const ctx = makeMatch()
    const grouped = groupedCapabilitiesFor(ctx).flatMap((g) => g.capabilities).length
    expect(grouped).toBe(capabilitiesFor(ctx).length)
  })
})
