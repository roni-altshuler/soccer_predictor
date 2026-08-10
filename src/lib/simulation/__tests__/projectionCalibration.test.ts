import {
  applyKnots,
  calibrateColumn,
  calibrateProjection,
  type CalibratorMetric,
  type ProjectionCalibrator,
} from '@/lib/simulation/projectionCalibration'

/**
 * The correction must fix the overconfidence WITHOUT breaking the two things
 * that make a projected table readable: one champion, and a stable order.
 */

// Shaped like the real fit: accurate at the ends, sagging in the middle.
const title: CalibratorMetric = {
  knots: [
    [0, 0],
    [0.25, 0.22],
    [0.5, 0.45],
    [0.85, 0.78],
    [1, 1],
  ],
  renormalise_to: 1,
  n: 20324,
  ece_before: 0.0033,
}

/**
 * The knots actually shipped in
 * `backend/data/diagnostics/projection_calibrator.json`, so this suite tests
 * the mapping the product applies rather than an invented one.
 */
const REAL_TITLE_KNOTS: [number, number][] = [
  [0, 0],
  [0.0024, 0.0036],
  [0.1434, 0.1274],
  [0.244, 0.2253],
  [0.3514, 0.3828],
  [0.4439, 0.4571],
  [0.5497, 0.4597],
  [0.6472, 0.6864],
  [0.7498, 0.7333],
  [0.8486, 0.7815],
  [0.9796, 0.9766],
  [1, 1],
]

const RELEGATION_KNOTS: [number, number][] = [
  [0, 0],
  [0.0096, 0.0227],
  [0.1444, 0.1748],
  [0.2454, 0.2486],
  [0.3472, 0.3211],
  [0.447, 0.3797],
  [0.5481, 0.4959],
  [0.6491, 0.5628],
  [0.7475, 0.6603],
  [0.8479, 0.7588],
  [0.9721, 0.9309],
  [1, 1],
]

const realTitle: CalibratorMetric = {
  knots: REAL_TITLE_KNOTS,
  renormalise_to: 1,
  n: 20324,
  ece_before: 0.0033,
}

/** A plausible 20-team title race: one clear leader, a long thin tail. */
const REAL_TITLE_COLUMN = [
  0.55, 0.2, 0.12, 0.05, 0.03, 0.02, 0.012, 0.008, 0.005, 0.003,
  0.002, 0.001, 0.001, 0.001, 0.0005, 0.0005, 0.0003, 0.0002, 0.0001, 0,
]

describe('applyKnots', () => {
  it('is exact at the knots', () => {
    expect(applyKnots(title.knots, 0.5)).toBeCloseTo(0.45, 6)
    expect(applyKnots(title.knots, 0.85)).toBeCloseTo(0.78, 6)
  })

  it('interpolates linearly between them', () => {
    // Midway between (0.5,0.45) and (0.85,0.78)
    expect(applyKnots(title.knots, 0.675)).toBeCloseTo(0.615, 6)
  })

  it('pins the ends so certainty stays certain', () => {
    expect(applyKnots(title.knots, 0)).toBe(0)
    expect(applyKnots(title.knots, 1)).toBe(1)
  })

  it('clamps outside [0,1] instead of extrapolating', () => {
    expect(applyKnots(title.knots, -0.5)).toBe(0)
    expect(applyKnots(title.knots, 1.5)).toBe(1)
  })

  it('is monotone, so it can never reorder two teams', () => {
    let prev = -1
    for (let p = 0; p <= 1.0001; p += 0.01) {
      const v = applyKnots(title.knots, p)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })

  it('survives a degenerate knot pair rather than dividing by zero', () => {
    const flat: [number, number][] = [
      [0, 0],
      [0.5, 0.4],
      [0.5, 0.4],
      [1, 1],
    ]
    expect(Number.isFinite(applyKnots(flat, 0.5))).toBe(true)
  })

  it('returns the input when there is no mapping', () => {
    expect(applyKnots([], 0.42)).toBe(0.42)
  })
})

describe('calibrateColumn', () => {
  it('still produces exactly one champion', () => {
    const raw = [0.5, 0.25, 0.15, 0.1]
    const out = calibrateColumn(raw, title)
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6)
  })

  it('moves mass from an overconfident leader to the tail', () => {
    // A four-team toy column is NOT a valid test of this: the fitted map only
    // lifts probabilities below ~3%, so a column with no deep tail shrinks
    // uniformly and renormalising restores it. A real league has sixteen teams
    // in that tail, which is where the mass the leader loses actually goes.
    const raw = REAL_TITLE_COLUMN
    const out = calibrateColumn(raw, realTitle)

    expect(out[0]).toBeLessThan(raw[0]) // leader pulled in
    const tailBefore = raw.slice(4).reduce((a, b) => a + b, 0)
    const tailAfter = out.slice(4).reduce((a, b) => a + b, 0)
    expect(tailAfter).toBeGreaterThan(tailBefore) // and the tail lifted
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6)
  })

  it('matches the correction the backtest measured', () => {
    // Stated ~85% happened ~78%: the map must move a high probability down by
    // roughly that much before renormalisation restores the column's mass.
    expect(applyKnots(realTitle.knots, 0.8486)).toBeCloseTo(0.7815, 3)
    expect(applyKnots(RELEGATION_KNOTS, 0.8479)).toBeCloseTo(0.7588, 3)
  })

  it('preserves the ordering of every team', () => {
    const raw = [0.5, 0.25, 0.15, 0.1]
    const out = calibrateColumn(raw, title)
    for (let i = 1; i < out.length; i++) {
      expect(out[i]).toBeLessThanOrEqual(out[i - 1])
    }
  })

  it('leaves a decided league decided', () => {
    const raw = [1, 0, 0, 0]
    expect(calibrateColumn(raw, title)).toEqual([1, 0, 0, 0])
  })

  it('rescales relegation to its three places', () => {
    const relegation: CalibratorMetric = { ...title, renormalise_to: 3 }
    const raw = [0.9, 0.8, 0.7, 0.4, 0.2, 0.1]
    const out = calibrateColumn(raw, relegation)
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(3, 6)
  })

  it('returns raw values rather than dividing by zero on an all-zero column', () => {
    const raw = [0, 0, 0]
    expect(calibrateColumn(raw, title)).toEqual(raw)
  })

  it('returns raw values when no calibrator has been fitted', () => {
    const raw = [0.5, 0.5]
    expect(calibrateColumn(raw, undefined)).toEqual(raw)
  })

  it('never emits a probability outside [0,1]', () => {
    const raw = [0.99, 0.99, 0.99, 0.99]
    for (const v of calibrateColumn(raw, title)) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
})

describe('calibrateProjection', () => {
  const calibrator: ProjectionCalibrator = {
    metrics: {
      title,
      top_4: { ...title, renormalise_to: 4 },
      relegation: { ...title, renormalise_to: 3 },
    },
  }

  const rows = [
    { team_name: 'A', title_probability: 0.7, top_4_probability: 0.95, relegation_probability: 0.01 },
    { team_name: 'B', title_probability: 0.2, top_4_probability: 0.85, relegation_probability: 0.02 },
    { team_name: 'C', title_probability: 0.1, top_4_probability: 0.6, relegation_probability: 0.05 },
    { team_name: 'D', title_probability: 0.0, top_4_probability: 0.4, relegation_probability: 0.9 },
    { team_name: 'E', title_probability: 0.0, top_4_probability: 0.2, relegation_probability: 0.95 },
  ]

  it('calibrates every displayed column to its own mass', () => {
    const out = calibrateProjection(rows, calibrator)
    const sum = (f: 'title_probability' | 'top_4_probability' | 'relegation_probability') =>
      out.reduce((a, r) => a + (r[f] ?? 0), 0)
    expect(sum('title_probability')).toBeCloseTo(1, 3)
    expect(sum('top_4_probability')).toBeCloseTo(4, 3)
    expect(sum('relegation_probability')).toBeCloseTo(3, 3)
  })

  it('does not mutate the rows it was given', () => {
    const before = JSON.parse(JSON.stringify(rows))
    calibrateProjection(rows, calibrator)
    expect(rows).toEqual(before)
  })

  it('passes rows through untouched when no calibrator exists', () => {
    expect(calibrateProjection(rows, null)).toBe(rows)
  })

  it('keeps the leader the leader', () => {
    const out = calibrateProjection(rows, calibrator)
    expect(out[0].title_probability).toBeGreaterThan(out[1].title_probability!)
    expect(out[1].title_probability).toBeGreaterThan(out[2].title_probability!)
  })
})
