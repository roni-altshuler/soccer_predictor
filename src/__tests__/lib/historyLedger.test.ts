import {
  applyFilters,
  callLabel,
  competitionsOf,
  DEFAULT_FILTERS,
  formatConfidence,
  formatDateRange,
  formatLedgerDate,
  formatPredictedScore,
  formatScore,
  formatShortDate,
  isSettled,
  outcomeOf,
  pageBounds,
  parseDayParts,
  sortNewestFirst,
  summarise,
  toCSV,
  type LedgerRecord,
} from '@/lib/historyLedger'

function record(overrides: Partial<LedgerRecord> = {}): LedgerRecord {
  return {
    match_id: '1',
    home_team: 'Arsenal',
    away_team: 'Chelsea',
    league: 'Premier League',
    match_date: '2026-05-10',
    predicted_winner: 'home',
    predicted_scoreline: '2-1',
    predicted_home_win: 0.51,
    predicted_draw: 0.27,
    predicted_away_win: 0.22,
    confidence: 51.2,
    actual_winner: 'home',
    actual_home_goals: 2,
    actual_away_goals: 0,
    winner_correct: true,
    ...overrides,
  }
}

describe('outcomeOf / isSettled', () => {
  it('classifies a correct call', () => {
    expect(outcomeOf(record())).toBe('correct')
    expect(isSettled(record())).toBe(true)
  })

  it('classifies a wrong call', () => {
    expect(outcomeOf(record({ winner_correct: false }))).toBe('incorrect')
  })

  it('treats a null verdict as pending, never as a miss', () => {
    const pending = record({
      winner_correct: null,
      actual_winner: null,
      actual_home_goals: null,
      actual_away_goals: null,
    })
    expect(outcomeOf(pending)).toBe('pending')
    expect(isSettled(pending)).toBe(false)
  })
})

describe('callLabel', () => {
  it('names the side we called', () => {
    expect(callLabel(record({ predicted_winner: 'home' }))).toBe('Arsenal')
    expect(callLabel(record({ predicted_winner: 'away' }))).toBe('Chelsea')
    expect(callLabel(record({ predicted_winner: 'draw' }))).toBe('Draw')
  })

  it('does not invent a call when none was published', () => {
    expect(callLabel(record({ predicted_winner: null }))).toBe('—')
  })
})

describe('date formatting', () => {
  it('parses the leading day without timezone drift', () => {
    expect(parseDayParts('2026-05-10T19:45:00Z')).toEqual({
      year: 2026,
      month: 5,
      day: 10,
    })
  })

  it('rejects garbage rather than guessing', () => {
    expect(parseDayParts('not-a-date')).toBeNull()
    expect(parseDayParts('')).toBeNull()
    expect(parseDayParts(undefined)).toBeNull()
    expect(parseDayParts('2026-13-01')).toBeNull()
  })

  it('formats long and short variants', () => {
    expect(formatLedgerDate('2026-05-10')).toBe('10 May 2026')
    expect(formatShortDate('2026-05-10')).toBe('10 May')
    expect(formatLedgerDate('nonsense')).toBe('—')
  })

  it('spans a range and collapses a repeated year', () => {
    const rows = [record({ match_date: '2026-03-22' }), record({ match_date: '2026-07-26' })]
    expect(formatDateRange(rows)).toBe('22 Mar – 26 Jul 2026')
  })

  it('keeps both years when the range crosses one', () => {
    const rows = [record({ match_date: '2025-12-28' }), record({ match_date: '2026-01-04' })]
    expect(formatDateRange(rows)).toBe('28 Dec 2025 – 4 Jan 2026')
  })

  it('returns a single date when the span is one day', () => {
    expect(formatDateRange([record({ match_date: '2026-05-10' })])).toBe('10 May 2026')
  })

  it('returns null rather than a fabricated range when no date parses', () => {
    expect(formatDateRange([])).toBeNull()
    expect(formatDateRange([record({ match_date: 'unknown' })])).toBeNull()
  })
})

describe('numeric formatting', () => {
  it('renders tracker confidence as a whole percentage', () => {
    expect(formatConfidence(51.2)).toBe('51%')
    expect(formatConfidence(100)).toBe('100%')
  })

  it('accepts a 0–1 fraction too', () => {
    expect(formatConfidence(0.512)).toBe('51%')
  })

  it('never prints a number it does not have', () => {
    expect(formatConfidence(null)).toBe('—')
    expect(formatConfidence(undefined)).toBe('—')
    expect(formatConfidence(Number.NaN)).toBe('—')
  })

  it('formats scores with an en dash and omits unplayed ones', () => {
    expect(formatScore(record())).toBe('2–0')
    expect(formatScore(record({ actual_home_goals: null }))).toBeNull()
    expect(formatPredictedScore(record())).toBe('2–1')
    expect(formatPredictedScore(record({ predicted_scoreline: null }))).toBeNull()
  })
})

describe('applyFilters', () => {
  const now = new Date('2026-05-20T00:00:00Z')
  const rows = [
    record({ match_id: 'a', match_date: '2026-05-18', winner_correct: true }),
    record({ match_id: 'b', match_date: '2026-05-01', winner_correct: false }),
    record({
      match_id: 'c',
      match_date: '2026-05-19',
      league: 'La Liga',
      home_team: 'Real Betis',
      away_team: 'Sevilla',
      winner_correct: null,
      actual_winner: null,
      actual_home_goals: null,
      actual_away_goals: null,
    }),
  ]

  it('defaults to settled predictions only', () => {
    const out = applyFilters(rows, DEFAULT_FILTERS, now)
    expect(out.map((r) => r.match_id)).toEqual(['a', 'b'])
  })

  it('isolates correct and incorrect calls', () => {
    expect(
      applyFilters(rows, { ...DEFAULT_FILTERS, outcome: 'correct' }, now).map((r) => r.match_id)
    ).toEqual(['a'])
    expect(
      applyFilters(rows, { ...DEFAULT_FILTERS, outcome: 'incorrect' }, now).map((r) => r.match_id)
    ).toEqual(['b'])
    expect(
      applyFilters(rows, { ...DEFAULT_FILTERS, outcome: 'pending' }, now).map((r) => r.match_id)
    ).toEqual(['c'])
    expect(applyFilters(rows, { ...DEFAULT_FILTERS, outcome: 'all' }, now)).toHaveLength(3)
  })

  it('filters by competition', () => {
    const out = applyFilters(
      rows,
      { ...DEFAULT_FILTERS, outcome: 'all', competition: 'La Liga' },
      now
    )
    expect(out.map((r) => r.match_id)).toEqual(['c'])
  })

  it('filters by rolling period', () => {
    const out = applyFilters(rows, { ...DEFAULT_FILTERS, outcome: 'all', period: 7 }, now)
    expect(out.map((r) => r.match_id)).toEqual(['a', 'c'])
  })

  it('matches team or competition text, case-insensitively', () => {
    expect(
      applyFilters(rows, { ...DEFAULT_FILTERS, outcome: 'all', query: 'sevilla' }, now).map(
        (r) => r.match_id
      )
    ).toEqual(['c'])
    expect(
      applyFilters(rows, { ...DEFAULT_FILTERS, outcome: 'all', query: '  ARSENAL ' }, now)
    ).toHaveLength(2)
  })

  it('combines filters conjunctively', () => {
    const out = applyFilters(
      rows,
      { outcome: 'settled', competition: 'Premier League', period: 7, query: 'chelsea' },
      now
    )
    expect(out.map((r) => r.match_id)).toEqual(['a'])
  })
})

describe('summarise', () => {
  it('counts each bucket and derives settled', () => {
    const rows = [
      record({ winner_correct: true }),
      record({ winner_correct: false }),
      record({ winner_correct: null }),
    ]
    expect(summarise(rows)).toEqual({
      total: 3,
      settled: 2,
      correct: 1,
      incorrect: 1,
      pending: 1,
    })
  })

  it('reports zeroes for an empty window', () => {
    expect(summarise([])).toEqual({
      total: 0,
      settled: 0,
      correct: 0,
      incorrect: 0,
      pending: 0,
    })
  })
})

describe('sortNewestFirst', () => {
  it('orders by date descending with a stable id tiebreak', () => {
    const rows = [
      record({ match_id: '2', match_date: '2026-05-01' }),
      record({ match_id: '9', match_date: '2026-05-10' }),
      record({ match_id: '1', match_date: '2026-05-10' }),
    ]
    expect(sortNewestFirst(rows).map((r) => r.match_id)).toEqual(['1', '9', '2'])
  })

  it('does not mutate its input', () => {
    const rows = [record({ match_id: 'a', match_date: '2026-01-01' }), record({ match_id: 'b' })]
    const copy = [...rows]
    sortNewestFirst(rows)
    expect(rows).toEqual(copy)
  })
})

describe('competitionsOf', () => {
  it('ranks by frequency then name', () => {
    const rows = [
      record({ league: 'La Liga' }),
      record({ league: 'Premier League' }),
      record({ league: 'Premier League' }),
      record({ league: '' }),
    ]
    expect(competitionsOf(rows)).toEqual(['Premier League', 'La Liga'])
  })
})

describe('pageBounds', () => {
  it('describes a middle page', () => {
    expect(pageBounds(172, 2, 50)).toEqual({ from: 51, to: 100, pageCount: 4, page: 2 })
  })

  it('clamps an out-of-range page', () => {
    expect(pageBounds(172, 99, 50)).toEqual({ from: 151, to: 172, pageCount: 4, page: 4 })
    expect(pageBounds(172, -3, 50)).toEqual({ from: 1, to: 50, pageCount: 4, page: 1 })
  })

  it('collapses to zero for an empty result set', () => {
    expect(pageBounds(0, 1, 50)).toEqual({ from: 0, to: 0, pageCount: 1, page: 1 })
  })
})

describe('toCSV', () => {
  it('emits a stable header and one line per record', () => {
    const csv = toCSV([record()])
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe(
      'match_date,competition,home_team,away_team,our_call,predicted_scoreline,confidence_pct,prob_home,prob_draw,prob_away,final_score,actual_winner,call_correct'
    )
    expect(lines[1]).toBe(
      '2026-05-10,Premier League,Arsenal,Chelsea,home,2-1,51,0.5100,0.2700,0.2200,2-0,home,yes'
    )
  })

  it('quotes separators inside team names', () => {
    const csv = toCSV([record({ home_team: 'Brighton, Hove' })])
    expect(csv).toContain('"Brighton, Hove"')
  })

  it('leaves unsettled fields blank rather than guessing', () => {
    const csv = toCSV([
      record({
        winner_correct: null,
        actual_winner: null,
        actual_home_goals: null,
        actual_away_goals: null,
        confidence: null,
      }),
    ])
    const line = csv.trim().split('\n')[1]
    expect(line.endsWith(',,,')).toBe(true)
  })
})
