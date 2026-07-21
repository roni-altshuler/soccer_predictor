import { parseQuestion, normalizeQuestion, type DeterministicParse } from '../parse'
import type { AskIntent } from '../schema'

function intentOf(p: DeterministicParse): AskIntent {
  if (!p.supported) throw new Error(`expected supported, got refusal: ${p.reason}`)
  return p.intent
}

describe('deterministic parser — supported phrasings map onto the intent schema', () => {
  const cases: Array<[string, AskIntent]> = [
    [
      'How often do teams win from two goals down at the 70th minute?',
      { gender: 'M', diff: -2, minute: 70, outcome: 'win' },
    ],
    [
      'A goal behind with 5 minutes left — do they still avoid defeat?',
      { gender: 'M', diff: -1, minute: 85, outcome: 'avoid_defeat' },
    ],
    [
      'Do teams a goal up at half-time hold on to win?',
      { gender: 'M', diff: 1, minute: 45, outcome: 'win' },
    ],
    [
      'Two goals up at 80 minutes — how safe is that lead?',
      { gender: 'M', diff: 2, minute: 80, outcome: 'avoid_defeat' },
    ],
    [
      'Level at half-time, how often does a side go on to win?',
      { gender: 'M', diff: 0, minute: 45, outcome: 'win' },
    ],
    [
      "In women's football, can a team come back from 2-0 down at 65 minutes?",
      { gender: 'F', diff: -2, minute: 65, outcome: 'win' },
    ],
    [
      "two nil up at 75'",
      { gender: 'M', diff: 2, minute: 75, outcome: 'win' },
    ],
    [
      'trailing by three at the 80th minute — do they lose?',
      { gender: 'M', diff: -3, minute: 80, outcome: 'loss' },
    ],
    [
      'a goal down at the hour mark, can they draw?',
      { gender: 'M', diff: -1, minute: 60, outcome: 'draw' },
    ],
    [
      "women's team leading by one at kickoff, do they win?",
      { gender: 'F', diff: 1, minute: 0, outcome: 'win' },
    ],
    [
      'with 10 minutes to go and a goal ahead, do they hold on?',
      { gender: 'M', diff: 1, minute: 80, outcome: 'win' },
    ],
    [
      'down 3-1 in the 55th minute — comeback on?',
      { gender: 'M', diff: -2, minute: 55, outcome: 'win' },
    ],
  ]

  test.each(cases)('%s', (question, expected) => {
    expect(intentOf(parseQuestion(question))).toEqual(expected)
  })

  test('minute floors onto the 5-minute grid', () => {
    expect(intentOf(parseQuestion('two goals down at the 74th minute, win?'))).toEqual({
      gender: 'M',
      diff: -2,
      minute: 70,
      outcome: 'win',
    })
  })

  test('deficits beyond three clamp into the [-3, 3] key space', () => {
    expect(intentOf(parseQuestion('four goals down at 60 minutes, can they win?')).diff).toBe(-3)
  })
})

describe('deterministic parser — honest refusals', () => {
  test('a state with no time → need_minute', () => {
    const p = parseQuestion('how often do teams come back from two goals down?')
    expect(p.supported).toBe(false)
    if (!p.supported) expect(p.reason).toBe('need_minute')
  })

  test('a fixture question with no match state → out_of_domain', () => {
    for (const q of [
      'Will Arsenal beat Chelsea on Saturday?',
      'Who will win the Premier League this season?',
      'What is the expected xG for Liverpool?',
      'How many goals will Haaland score?',
      '',
    ]) {
      const p = parseQuestion(q)
      expect(p.supported).toBe(false)
      if (!p.supported) expect(p.reason).toBe('out_of_domain')
    }
  })
})

describe('deterministic parser — confidence + normalization', () => {
  test('a bare direction with no stated count is resolved but low-confidence', () => {
    const p = parseQuestion('a team that is behind at the 70th minute — do they win?')
    expect(p.supported).toBe(true)
    if (p.supported) {
      expect(p.intent).toEqual({ gender: 'M', diff: -1, minute: 70, outcome: 'win' })
      expect(p.confidence).toBe('low')
    }
  })

  test('normalizeQuestion lowercases, unifies quotes/dashes, collapses space', () => {
    expect(normalizeQuestion('  Two  Goals—Down  ')).toBe('two goals-down')
    expect(normalizeQuestion('women’s')).toBe("women's")
  })
})
