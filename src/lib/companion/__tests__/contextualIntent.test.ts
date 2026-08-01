/**
 * Contextual intent — the derivation that lets a question inherit its match.
 *
 * The gates here are the point: a derived intent must be a real question about
 * a real state, or it must be `null`. Anything in between is a base rate
 * dressed up as being about the match on screen.
 */

import { contextualPrompts, deriveAskIntent, diffFor, trailingSide } from '../contextualIntent'
import { GLOBAL_CONTEXT, type MatchContext } from '../context'

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

describe('trailingSide / diffFor', () => {
  it('identifies the side that is behind', () => {
    expect(trailingSide(makeMatch())).toBe('home')
    expect(trailingSide(makeMatch({ homeScore: 3, awayScore: 1 }))).toBe('away')
  })

  it('defaults a level match to home', () => {
    expect(trailingSide(makeMatch({ homeScore: 1, awayScore: 1 }))).toBe('home')
  })

  it('signs the difference from the chosen side', () => {
    const m = makeMatch()
    expect(diffFor(m, 'home')).toBe(-2)
    expect(diffFor(m, 'away')).toBe(2)
  })
})

describe('deriveAskIntent', () => {
  it('derives the trailing side by default on a live match', () => {
    expect(deriveAskIntent(makeMatch())).toEqual({
      gender: 'M',
      diff: -2,
      minute: 60,
      outcome: 'win',
    })
  })

  it('floors the minute onto the artifact grid', () => {
    expect(deriveAskIntent(makeMatch({ minute: 89 }))?.minute).toBe(85)
    expect(deriveAskIntent(makeMatch({ minute: 90 }))?.minute).toBe(90)
    // Stoppage time collapses onto 90 rather than falling off the grid.
    expect(deriveAskIntent(makeMatch({ minute: 96 }))?.minute).toBe(90)
  })

  it('clamps a blowout into the artifact key space', () => {
    const rout = makeMatch({ homeScore: 0, awayScore: 6 })
    expect(deriveAskIntent(rout)?.diff).toBe(-3)
  })

  it('carries the women’s universe through', () => {
    expect(deriveAskIntent(makeMatch({ gender: 'F' }))?.gender).toBe('F')
  })

  it('honours an explicit side', () => {
    expect(deriveAskIntent(makeMatch(), { side: 'away' })?.diff).toBe(2)
  })

  it('refuses a scheduled match — no state to interpret', () => {
    const scheduled = makeMatch({ phase: 'scheduled', homeScore: null, awayScore: null, minute: null })
    expect(deriveAskIntent(scheduled)).toBeNull()
  })

  it('refuses a finished match with neither a minute nor an anchor', () => {
    const done = makeMatch({ phase: 'finished', minute: null })
    expect(deriveAskIntent(done)).toBeNull()
    expect(deriveAskIntent(done, { minute: 75 })?.minute).toBe(75)
  })

  it('asks a finished match at its anchor, using the anchor’s own score', () => {
    // Arsenal trailed 0-2 at 63' and won 3-2. The context carries FULL TIME
    // (3-2); the anchor carries the moment worth asking about (0-2).
    const done = makeMatch({
      phase: 'finished',
      minute: null,
      homeScore: 3,
      awayScore: 2,
      anchor: { minute: 63, homeScore: 0, awayScore: 2 },
    })
    expect(deriveAskIntent(done)).toEqual({
      gender: 'M',
      diff: -2,
      minute: 60,
      outcome: 'win',
    })
  })

  it('lets an explicit scrub minute override the anchor', () => {
    const done = makeMatch({
      phase: 'finished',
      minute: null,
      homeScore: 3,
      awayScore: 2,
      anchor: { minute: 63, homeScore: 0, awayScore: 2 },
    })
    // Scrubbing asks about the CURRENT context score at that minute.
    expect(deriveAskIntent(done, { minute: 80 })?.minute).toBe(80)
    expect(deriveAskIntent(done, { minute: 80 })?.diff).toBe(-1)
  })

  it('refuses a non-match context', () => {
    expect(deriveAskIntent(GLOBAL_CONTEXT)).toBeNull()
  })
})

describe('contextualPrompts', () => {
  it('names the real teams for a side that is behind', () => {
    const prompts = contextualPrompts(makeMatch())
    expect(prompts.map((p) => p.id)).toEqual([
      'comeback',
      'rescue-point',
      'hold-on',
      'throw-away',
    ])
    expect(prompts[0].label).toBe("Can Arsenal come back from 2 goals down at 60'?")
    expect(prompts[0].intent.outcome).toBe('win')
    expect(prompts[1].intent.outcome).toBe('avoid_defeat')
  })

  it('flips the difference when asking about the leader’s lead', () => {
    const holdOn = contextualPrompts(makeMatch()).find((p) => p.id === 'hold-on')!
    expect(holdOn.label).toBe("How safe is Chelsea's 2-goal lead?")
    expect(holdOn.intent.diff).toBe(2)
  })

  it('asks deadlock questions when level', () => {
    const prompts = contextualPrompts(makeMatch({ homeScore: 1, awayScore: 1 }))
    expect(prompts.map((p) => p.id)).toEqual(['break-deadlock', 'stays-level'])
    expect(prompts[1].intent.outcome).toBe('draw')
  })

  it('always asks from the trailing bench, whichever side that is', () => {
    // Home 2-0 up: the question is Chelsea's, not Arsenal's.
    const prompts = contextualPrompts(makeMatch({ homeScore: 2, awayScore: 0 }))
    expect(prompts[0].label).toBe("Can Chelsea come back from 2 goals down at 60'?")
    expect(prompts[0].intent.diff).toBe(-2)
    // …and the leader's view is the mirrored intent.
    const throwAway = prompts.find((p) => p.id === 'throw-away')!
    expect(throwAway.intent.diff).toBe(2)
    expect(throwAway.intent.outcome).toBe('loss')
  })

  it('returns nothing rather than generic examples when it cannot pose a question', () => {
    expect(contextualPrompts(GLOBAL_CONTEXT)).toEqual([])
    expect(contextualPrompts(makeMatch({ phase: 'finished', minute: null }))).toEqual([])
  })

  it('names the team that was behind AT THE ANCHOR, not the eventual winner', () => {
    // Chelsea (away) led 2-0 at 63'; Arsenal (home) won 3-2. The question is
    // Arsenal's, and it must be phrased in the past.
    const prompts = contextualPrompts(
      makeMatch({
        phase: 'finished',
        minute: null,
        homeScore: 3,
        awayScore: 2,
        anchor: { minute: 63, homeScore: 0, awayScore: 2 },
      })
    )
    expect(prompts[0].id).toBe('comeback')
    expect(prompts[0].label).toBe(
      "Arsenal were 2 goals down at 60' — how often does that end in a win?"
    )
    expect(prompts[0].intent.diff).toBe(-2)
    const holdOn = prompts.find((p) => p.id === 'hold-on')!
    expect(holdOn.label).toBe("How often did Chelsea's 2-goal lead hold?")
  })

  it('speaks in the present tense while the match is running', () => {
    const prompts = contextualPrompts(makeMatch())
    expect(prompts[0].label).toContain('Can Arsenal come back')
  })

  it('says "a goal down", not "1 down"', () => {
    const prompts = contextualPrompts(makeMatch({ homeScore: 0, awayScore: 1 }))
    expect(prompts[0].label).toBe("Can Arsenal come back from a goal down at 60'?")
    const holdOn = prompts.find((p) => p.id === 'hold-on')!
    expect(holdOn.label).toBe("How safe is Chelsea's one-goal lead?")
  })

  it('uses a bare apostrophe for club names ending in s', () => {
    // "Whitecaps's" is what a template writes; "Whitecaps'" is what a person
    // writes. Seen on a real match page before it was fixed.
    const prompts = contextualPrompts(
      makeMatch({ home: 'FC Cincinnati', away: 'Vancouver Whitecaps', homeScore: 0, awayScore: 1 })
    )
    const holdOn = prompts.find((p) => p.id === 'hold-on')!
    expect(holdOn.label).toBe("How safe is Vancouver Whitecaps' one-goal lead?")
  })

  it('re-poses a finished match at a scrubbed minute', () => {
    const prompts = contextualPrompts(makeMatch({ phase: 'finished', minute: null }), { minute: 79 })
    expect(prompts.length).toBeGreaterThan(0)
    expect(prompts[0].intent.minute).toBe(75)
  })
})
