import {
  isValidProbabilityTriple,
  validateProbabilityTriple,
  normalizeProbabilityTriple,
  isValidDistribution,
  PROBABILITY_SUM_TOLERANCE,
} from '@/lib/probabilityValidation'

describe('isValidProbabilityTriple', () => {
  it('accepts a well-formed triple summing to 1', () => {
    expect(isValidProbabilityTriple({ home: 0.5, draw: 0.25, away: 0.25 })).toBe(true)
  })

  it('accepts a triple summing within tolerance of 1', () => {
    expect(
      isValidProbabilityTriple({ home: 0.501, draw: 0.25, away: 0.25 }),
    ).toBe(true)
  })

  it('rejects a triple summing to ≠ 1 outside tolerance', () => {
    expect(isValidProbabilityTriple({ home: 0.6, draw: 0.6, away: 0.6 })).toBe(false)
    expect(isValidProbabilityTriple({ home: 0.1, draw: 0.1, away: 0.1 })).toBe(false)
  })

  it('rejects negative probabilities', () => {
    expect(
      isValidProbabilityTriple({ home: -0.1, draw: 0.6, away: 0.5 }),
    ).toBe(false)
  })

  it('rejects probabilities > 1', () => {
    expect(isValidProbabilityTriple({ home: 1.5, draw: 0.0, away: 0.0 })).toBe(false)
  })

  it('rejects NaN', () => {
    expect(
      isValidProbabilityTriple({ home: NaN, draw: 0.5, away: 0.5 }),
    ).toBe(false)
  })

  it('rejects Infinity', () => {
    expect(
      isValidProbabilityTriple({ home: Infinity, draw: 0.5, away: 0.5 }),
    ).toBe(false)
  })

  it('rejects non-numeric fields', () => {
    expect(
      isValidProbabilityTriple({ home: '0.5', draw: 0.25, away: 0.25 }),
    ).toBe(false)
  })

  it('rejects null / undefined / wrong shape', () => {
    expect(isValidProbabilityTriple(null)).toBe(false)
    expect(isValidProbabilityTriple(undefined)).toBe(false)
    expect(isValidProbabilityTriple({})).toBe(false)
    expect(isValidProbabilityTriple({ home: 1 })).toBe(false)
    expect(isValidProbabilityTriple('not an object')).toBe(false)
  })
})

describe('validateProbabilityTriple', () => {
  it('returns empty issue list for valid input', () => {
    expect(validateProbabilityTriple({ home: 0.5, draw: 0.25, away: 0.25 })).toEqual([])
  })

  it('reports NaN on every NaN field', () => {
    const issues = validateProbabilityTriple({ home: NaN, draw: NaN, away: 0.5 })
    expect(issues).toEqual(
      expect.arrayContaining([
        { field: 'home', reason: 'NaN', value: NaN },
        { field: 'draw', reason: 'NaN', value: NaN },
      ]),
    )
  })

  it('reports negative + sum-mismatch when applicable', () => {
    const issues = validateProbabilityTriple({ home: -0.2, draw: 0.5, away: 0.5 })
    expect(
      issues.some((i) => i.field === 'home' && i.reason === 'negative'),
    ).toBe(true)
    // The sum (0.8) is within tolerance of 1 (off by 0.2 > 0.01), so report.
    expect(
      issues.some((i) => i.field === 'sum' && i.reason === 'sum-mismatch'),
    ).toBe(true)
  })

  it('reports over-one when a field exceeds 1', () => {
    const issues = validateProbabilityTriple({ home: 1.2, draw: 0, away: 0 })
    expect(
      issues.some((i) => i.field === 'home' && i.reason === 'over-one'),
    ).toBe(true)
  })

  it('reports a single issue for null input', () => {
    expect(validateProbabilityTriple(null)).toHaveLength(1)
    expect(validateProbabilityTriple(null)[0].reason).toBe('NaN')
  })
})

describe('normalizeProbabilityTriple', () => {
  it('passes valid input through unchanged', () => {
    const result = normalizeProbabilityTriple({ home: 0.5, draw: 0.25, away: 0.25 })
    expect(result.home).toBeCloseTo(0.5)
    expect(result.draw).toBeCloseTo(0.25)
    expect(result.away).toBeCloseTo(0.25)
  })

  it('renormalises a non-sum-to-1 input', () => {
    // 0.4 + 0.4 + 0.4 = 1.2 → divide each by 1.2 = 0.333...
    const result = normalizeProbabilityTriple({ home: 0.4, draw: 0.4, away: 0.4 })
    expect(result.home).toBeCloseTo(1 / 3)
    expect(result.draw).toBeCloseTo(1 / 3)
    expect(result.away).toBeCloseTo(1 / 3)
    expect(result.home + result.draw + result.away).toBeCloseTo(1, 5)
  })

  it('zeros out negative values then renormalises', () => {
    const result = normalizeProbabilityTriple({ home: -0.1, draw: 0.5, away: 0.5 })
    expect(result.home).toBe(0)
    expect(result.draw).toBeCloseTo(0.5)
    expect(result.away).toBeCloseTo(0.5)
  })

  it('clamps > 1 to 1 then renormalises', () => {
    const result = normalizeProbabilityTriple({ home: 2, draw: 0, away: 0 })
    expect(result.home).toBe(1)
    expect(result.draw).toBe(0)
    expect(result.away).toBe(0)
  })

  it('replaces NaN with 0', () => {
    const result = normalizeProbabilityTriple({ home: NaN, draw: 0.5, away: 0.5 })
    expect(result.home).toBe(0)
    expect(result.draw).toBeCloseTo(0.5)
    expect(result.away).toBeCloseTo(0.5)
  })

  it('falls back to uniform 1/3 when every value is 0 / NaN / negative', () => {
    const result = normalizeProbabilityTriple({ home: 0, draw: 0, away: 0 })
    expect(result.home).toBeCloseTo(1 / 3)
    expect(result.draw).toBeCloseTo(1 / 3)
    expect(result.away).toBeCloseTo(1 / 3)
  })

  it('falls back to uniform 1/3 for null', () => {
    const result = normalizeProbabilityTriple(null)
    expect(result.home + result.draw + result.away).toBeCloseTo(1)
  })

  it('output always sums to exactly 1 after normalisation', () => {
    const inputs = [
      { home: 0.3, draw: 0.4, away: 0.4 },
      { home: 0, draw: 1, away: 0 },
      { home: 1, draw: 1, away: 1 },
      { home: 0.1, draw: 0.2, away: 0.3 },
    ]
    for (const input of inputs) {
      const out = normalizeProbabilityTriple(input)
      expect(out.home + out.draw + out.away).toBeCloseTo(1, 6)
    }
  })
})

describe('isValidDistribution', () => {
  it('accepts an array of probabilities summing to 1', () => {
    expect(isValidDistribution([0.2, 0.3, 0.5])).toBe(true)
  })

  it('accepts a record of position → probability', () => {
    expect(isValidDistribution({ 1: 0.5, 2: 0.3, 3: 0.2 })).toBe(true)
  })

  it('rejects empty input', () => {
    expect(isValidDistribution([])).toBe(false)
    expect(isValidDistribution({})).toBe(false)
  })

  it('rejects when a value is out of [0, 1]', () => {
    expect(isValidDistribution([0.5, 0.5, 0.5])).toBe(false) // sums to 1.5
    expect(isValidDistribution([1.2, -0.2])).toBe(false)
  })

  it('rejects NaN', () => {
    expect(isValidDistribution([NaN, 0.5, 0.5])).toBe(false)
  })

  it('respects the tolerance constant', () => {
    expect(PROBABILITY_SUM_TOLERANCE).toBe(0.01)
    expect(isValidDistribution([0.501, 0.5])).toBe(true) // 1.001 within tolerance
    expect(isValidDistribution([0.6, 0.5])).toBe(false) // 1.1 outside tolerance
  })
})
