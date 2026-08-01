/**
 * @jest-environment node
 *
 * End-to-end: a match context becomes an exact count from the committed
 * artifact, with no language model anywhere in the path.
 *
 * The unit tests above prove the derivation is correct in isolation; this one
 * proves the derived intent actually keys into `backend/data/rarity/` and comes
 * back with real rows. It reads the committed artifact (node environment, not
 * jsdom, because the compute layer touches the filesystem), so it is also a
 * canary for the artifact key grammar drifting out of sync — the three
 * synchronized copies of `clampDiff`/`minuteBucket` that `ask/schema.ts` warns
 * about.
 */

import { computeAnswer } from '@/lib/ask/compute'

import { contextualPrompts, deriveAskIntent } from '../contextualIntent'
import type { MatchContext } from '../context'

const LIVE_COMEBACK: MatchContext = {
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
}

describe('context → exact count', () => {
  it('resolves a live two-goal deficit to real counted matches', () => {
    const intent = deriveAskIntent(LIVE_COMEBACK)
    expect(intent).toEqual({ gender: 'M', diff: -2, minute: 60, outcome: 'win' })

    const { answer, provenance } = computeAnswer(intent!)

    // The artifact must actually have this state — a two-goal deficit at 60'
    // is one of the most common states in football, so a zero here means the
    // key grammar drifted, not that the state is genuinely unseen.
    expect(provenance.sampleSize).toBeGreaterThan(0)
    expect(provenance.stateKey).toBe('M:-2:60')
    expect(provenance.matchesCovered).toBeGreaterThan(0)

    // Internal consistency of the split.
    const { n, w, d, l } = answer.numbers
    expect(w + d + l).toBe(n)
    expect(answer.numbers.winRate).toBeCloseTo(w / n, 10)
    expect(answer.numbers.avoidDefeatRate).toBeCloseTo((w + d) / n, 10)

    // Football sanity: coming back from two down at the hour mark is rare.
    expect(answer.numbers.winRate).toBeLessThan(0.15)

    // Every sentence survived the verifier.
    expect(answer.narration.length).toBeGreaterThan(0)
  })

  it('computes every contextual prompt the Companion would offer', () => {
    for (const prompt of contextualPrompts(LIVE_COMEBACK)) {
      const { answer } = computeAnswer(prompt.intent)
      expect(answer.numbers.n).toBeGreaterThan(0)
      expect(answer.narration.length).toBeGreaterThan(0)
    }
  })

  it('mirrors correctly — the leader’s lead is as safe as the chase is hard', () => {
    const prompts = contextualPrompts(LIVE_COMEBACK)
    const comeback = computeAnswer(prompts.find((p) => p.id === 'comeback')!.intent)
    const holdOn = computeAnswer(prompts.find((p) => p.id === 'hold-on')!.intent)

    // Same state seen from opposite benches: the trailing side's wins are the
    // leading side's losses, and both are drawn from the same match set.
    expect(holdOn.answer.numbers.n).toBe(comeback.answer.numbers.n)
    expect(holdOn.answer.numbers.w).toBe(comeback.answer.numbers.l)
    expect(holdOn.answer.numbers.l).toBe(comeback.answer.numbers.w)
    expect(holdOn.answer.numbers.d).toBe(comeback.answer.numbers.d)
  })

  it('serves the women’s universe from its own counts', () => {
    const intent = deriveAskIntent({ ...LIVE_COMEBACK, gender: 'F' })
    const { provenance } = computeAnswer(intent!)
    expect(provenance.stateKey).toBe('F:-2:60')
    expect(provenance.basis).toBe('F')
  })
})
