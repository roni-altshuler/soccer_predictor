import { clampDiff, intentKey, minuteBucket, normalizeIntent } from '../schema'

describe('schema — key grammar mirrors @/lib/rarity', () => {
  test('minuteBucket floors onto the 5-minute grid, clamps 90+', () => {
    expect(minuteBucket(4)).toBe(0)
    expect(minuteBucket(74)).toBe(70)
    expect(minuteBucket(93)).toBe(90)
    expect(minuteBucket(-3)).toBe(0)
  })

  test('clampDiff truncates and clamps to [-3, 3]', () => {
    expect(clampDiff(-9)).toBe(-3)
    expect(clampDiff(2.9)).toBe(2)
    expect(clampDiff(5)).toBe(3)
  })

  test('intentKey composes the canonical "G:diff:bucket" key', () => {
    expect(intentKey({ gender: 'M', diff: -2, minute: 79, outcome: 'win' })).toBe('M:-2:75')
    expect(intentKey({ gender: 'F', diff: 4, minute: 999, outcome: 'draw' })).toBe('F:3:90')
  })
})

describe('schema — normalizeIntent coerces + guards', () => {
  test('clamps, buckets, and defaults a missing outcome to win', () => {
    expect(normalizeIntent({ gender: 'women', diff: -9, minute: 79 })).toEqual({
      gender: 'F',
      diff: -3,
      minute: 75,
      outcome: 'win',
    })
  })

  test('accepts numeric or string diff/minute and a valid outcome', () => {
    expect(normalizeIntent({ gender: 'M', diff: '-2', minute: '70', outcome: 'loss' })).toEqual({
      gender: 'M',
      diff: -2,
      minute: 70,
      outcome: 'loss',
    })
  })

  test('rejects an unresolvable gender or non-finite numbers', () => {
    expect(normalizeIntent({ gender: 'x', diff: -2, minute: 70 })).toBeNull()
    expect(normalizeIntent({ gender: 'M', diff: 'abc', minute: 70 })).toBeNull()
    expect(normalizeIntent({ gender: 'M', diff: -2, minute: '' })).toBeNull()
  })

  test('an invalid outcome falls back to win rather than failing', () => {
    expect(normalizeIntent({ gender: 'M', diff: 0, minute: 45, outcome: 'nonsense' })?.outcome).toBe('win')
  })
})
