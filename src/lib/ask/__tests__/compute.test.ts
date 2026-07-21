import { computeAnswer } from '../compute'
import { verifyNarration } from '../narrate'
import { narrate } from '../narrate'
import type { AskIntent } from '../schema'

/**
 * Intent → exact-count mapping, against the REAL committed artifact
 * (`backend/data/rarity/state_outcomes.json`). These pin the numbers the UI
 * shows to the tallies on disk; if the artifact is rebuilt they update together.
 */

describe('computeAnswer — the classic comeback (M:-2:70)', () => {
  const intent: AskIntent = { gender: 'M', diff: -2, minute: 70, outcome: 'win' }
  const { answer, chartSpec, provenance } = computeAnswer(intent)

  test('reports the exact tally', () => {
    expect(answer.numbers.n).toBe(6119)
    expect(answer.numbers.w).toBe(32)
    expect(answer.numbers.d).toBe(244)
    expect(answer.numbers.l).toBe(5843)
    expect(answer.numbers.focusCount).toBe(32)
    expect(answer.thin).toBe(false)
  })

  test('provenance points at the right state', () => {
    expect(provenance.stateKey).toBe('M:-2:70')
    expect(provenance.sampleSize).toBe(6119)
    expect(provenance.basis).toBe('M')
    expect(provenance.matchesCovered).toBeGreaterThan(0)
  })

  test('builds a chart with a real minute-by-minute curve marked at 70', () => {
    expect(chartSpec).toBeDefined()
    expect(chartSpec?.wdl).toEqual({ n: 6119, w: 32, d: 244, l: 5843 })
    expect(chartSpec?.curve.markMinute).toBe(70)
    expect((chartSpec?.curve.points.length ?? 0)).toBeGreaterThan(1)
  })

  test('the narration it emits passes the honesty verifier', () => {
    const { allowedKeys } = narrate(intent, { n: 6119, w: 32, d: 244, l: 5843 })
    for (const s of answer.narration) {
      expect(verifyNarration(s, allowedKeys).ok).toBe(true)
    }
  })
})

describe('computeAnswer — a secure lead (M:2:80, avoid defeat)', () => {
  const { answer, chartSpec } = computeAnswer({ gender: 'M', diff: 2, minute: 80, outcome: 'avoid_defeat' })

  test('focus figure is win + draw', () => {
    expect(answer.numbers.n).toBe(6442)
    expect(answer.numbers.focusCount).toBe(6318 + 116)
    expect(answer.numbers.avoidDefeatRate).toBeCloseTo((6318 + 116) / 6442, 6)
    expect(chartSpec?.focus).toBe('avoid_defeat')
  })
})

describe('computeAnswer — honest empties + thin samples', () => {
  test('an unseen state returns n:0, no headline, no chart', () => {
    const { answer, chartSpec } = computeAnswer({ gender: 'M', diff: -3, minute: 5, outcome: 'win' })
    expect(answer.numbers.n).toBe(0)
    expect(answer.headline).toBeNull()
    expect(chartSpec).toBeUndefined()
  })

  test('a sub-50 sample is flagged thin', () => {
    const { answer } = computeAnswer({ gender: 'F', diff: -2, minute: 10, outcome: 'win' })
    expect(answer.numbers.n).toBe(29)
    expect(answer.thin).toBe(true)
  })
})
