import { focusFigure, narrate, verifyNarration } from '../narrate'
import type { AskIntent } from '../schema'

// The classic comeback state (M:-2:70) — real counts from the committed artifact.
const COUNTS = { n: 6119, w: 32, d: 244, l: 5843 }
const INTENT: AskIntent = { gender: 'M', diff: -2, minute: 70, outcome: 'win' }

describe('narrate — templated narration is honest by construction', () => {
  test('every sentence states only numbers that appear in the computed result', () => {
    const { sentences, allowedKeys } = narrate(INTENT, COUNTS)
    expect(sentences.length).toBeGreaterThan(0)
    for (const s of sentences) {
      const v = verifyNarration(s, allowedKeys)
      expect(v.ok).toBe(true)
    }
  })

  test('the exact counts appear in the prose', () => {
    const { sentences } = narrate(INTENT, COUNTS)
    const joined = sentences.join(' ')
    expect(joined).toContain('6,119') // n
    expect(joined).toContain('32') // w (the focus count)
    expect(joined).toContain('244') // d
    expect(joined).toContain('5,843') // l
  })

  test('an n=0 state narrates the honest "hasn’t happened" answer, no headline', () => {
    const res = narrate(INTENT, { n: 0, w: 0, d: 0, l: 0 })
    expect(res.headline).toBeNull()
    expect(res.sentences.join(' ')).toMatch(/hasn’t come up|no rate/i)
  })

  test('a thin sample earns a caveat sentence', () => {
    const res = narrate({ ...INTENT, gender: 'F' }, { n: 29, w: 0, d: 2, l: 27 })
    expect(res.sentences.join(' ')).toMatch(/only 29 such matches/i)
  })
})

describe('verifyNarration — the numeric + banned-term honesty gate', () => {
  test('rejects an injected ungrounded number', () => {
    const { allowedKeys } = narrate(INTENT, COUNTS)
    const tampered = 'Across 6,119 such matches the trailing side went on to win 32 (0.5%). But really it is 42%.'
    const v = verifyNarration(tampered, allowedKeys)
    expect(v.ok).toBe(false)
    expect(v.ungroundedNumbers).toContain('42%')
  })

  test('rejects a banned term (a model/provider/betting word)', () => {
    const { allowedKeys } = narrate(INTENT, COUNTS)
    expect(verifyNarration('The model rates it 32 of 6,119.', allowedKeys).ok).toBe(false)
    expect(verifyNarration('The model rates it 32 of 6,119.', allowedKeys).bannedTerms).toContain('model')
    expect(verifyNarration('Good odds on a comeback.', allowedKeys).bannedTerms).toContain('odds')
  })

  test('accepts a grounded percent and its count forms', () => {
    const { allowedKeys } = narrate(INTENT, COUNTS)
    // 5,843 lost = 95.5%; both the count and the percent are grounded.
    expect(verifyNarration('They lost 5,843 (95.5%).', allowedKeys).ok).toBe(true)
  })
})

describe('focusFigure — the spotlight number tracks the outcome', () => {
  test('win → w, avoid_defeat → w+d, draw → d, loss → l', () => {
    expect(focusFigure(COUNTS, 'win').count).toBe(32)
    expect(focusFigure(COUNTS, 'avoid_defeat').count).toBe(32 + 244)
    expect(focusFigure(COUNTS, 'draw').count).toBe(244)
    expect(focusFigure(COUNTS, 'loss').count).toBe(5843)
    expect(focusFigure(COUNTS, 'loss').rate).toBeCloseTo(5843 / 6119, 6)
  })
})
