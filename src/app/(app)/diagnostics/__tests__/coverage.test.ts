import {
  type CompetitionCoverage,
  coveragePercent,
  groupByGender,
  loadCoverage,
  parseCoverage,
  seasonLabel,
  seasonsNewestFirst,
  sortByMatches,
} from '../coverage'

function comp(overrides: Partial<CompetitionCoverage>): CompetitionCoverage {
  return {
    competition_id: 'eng.1',
    name: 'Premier League',
    gender: 'M',
    matches: 100,
    covered: 50,
    with_events: 45,
    verified_empty: 5,
    uncovered: 50,
    coverage: 0.5,
    seasons: [],
    ...overrides,
  }
}

describe('parseCoverage', () => {
  it('accepts a structurally valid artifact', () => {
    const artifact = {
      schema: 1,
      generated_at: '2026-01-01T00:00:00+00:00',
      totals: { matches: 1, covered: 1, with_events: 1, verified_empty: 0, uncovered: 0, coverage: 1 },
      competitions: [],
    }
    expect(parseCoverage(artifact)).toEqual(artifact)
  })

  it('rejects malformed payloads instead of half-rendering', () => {
    expect(parseCoverage(null)).toBeNull()
    expect(parseCoverage('nope')).toBeNull()
    expect(parseCoverage({})).toBeNull()
    expect(parseCoverage({ schema: 1, generated_at: 'x', totals: null, competitions: [] })).toBeNull()
    expect(parseCoverage({ schema: 1, generated_at: 'x', totals: {}, competitions: 'no' })).toBeNull()
  })
})

describe('grouping and sorting', () => {
  const rows = [
    comp({ competition_id: 'usa.1.w', gender: 'F', matches: 200 }),
    comp({ competition_id: 'esp.1', gender: 'M', matches: 300 }),
    comp({ competition_id: 'eng.1', gender: 'M', matches: 300 }),
    comp({ competition_id: 'mys.1', gender: null, matches: 10 }),
  ]

  it('sorts by corpus size with a stable id tiebreak', () => {
    expect(sortByMatches(rows).map((c) => c.competition_id)).toEqual([
      'eng.1',
      'esp.1',
      'usa.1.w',
      'mys.1',
    ])
  })

  it('splits universes; unknown gender rides with the men\'s group', () => {
    const { men, women } = groupByGender(rows)
    expect(men.map((c) => c.competition_id)).toEqual(['eng.1', 'esp.1', 'mys.1'])
    expect(women.map((c) => c.competition_id)).toEqual(['usa.1.w'])
  })

  it('does not mutate its input', () => {
    const ids = rows.map((c) => c.competition_id)
    sortByMatches(rows)
    groupByGender(rows)
    expect(rows.map((c) => c.competition_id)).toEqual(ids)
  })

  it('orders seasons newest-first for display', () => {
    const seasons = [
      { season: 2022, matches: 1, covered: 1, with_events: 1, verified_empty: 0, uncovered: 0, coverage: 1 },
      { season: 2024, matches: 1, covered: 0, with_events: 0, verified_empty: 0, uncovered: 1, coverage: 0 },
    ]
    expect(seasonsNewestFirst(seasons).map((s) => s.season)).toEqual([2024, 2022])
  })
})

describe('labels', () => {
  it('renders season start-years and the unlabelled bucket', () => {
    expect(seasonLabel(2024)).toBe('2024')
    expect(seasonLabel(-1)).toBe('Unlabelled')
  })

  it('formats coverage ratios defensively', () => {
    expect(coveragePercent(0.438)).toBe('43.8%')
    expect(coveragePercent(1)).toBe('100.0%')
    expect(coveragePercent(0)).toBe('0.0%')
    expect(coveragePercent(1.2)).toBe('100.0%')
    expect(coveragePercent(Number.NaN)).toBe('0.0%')
  })
})

describe('loadCoverage (committed artifact)', () => {
  it('parses the committed artifact with internally consistent totals', () => {
    const artifact = loadCoverage()
    // The artifact is committed alongside this code; if it were ever
    // removed the page must fall back to the empty state (null), so both
    // shapes are legal — but a loaded artifact must be consistent.
    if (artifact === null) return
    expect(artifact.schema).toBe(1)
    const { totals, competitions } = artifact
    expect(totals.covered + totals.uncovered).toBe(totals.matches)
    const summed = competitions.reduce((acc, c) => acc + c.matches, 0)
    expect(summed).toBe(totals.matches)
  })
})
