import { accuracyTimeline, awareTime, exactScoreSummary, filterPublishedRows, parsePublishedRecord, probabilityDetails, recordSummary, scorelineAssessment, verifiedLeadHours, type PublishedPick, type PublishedRecord } from '@/lib/publishedTrackRecord'

export const emptyFilter = { competition: '', season: '', from: '', to: '' }
// Synthetic unit fixtures only. Browser evidence uses the real generated export.
export function game(key: string, date: string, correct = true, over: Partial<PublishedPick> = {}): PublishedPick {
  const row: PublishedPick = { key, fixtureUid: key, competitionId: 'eng.1', season: Number(date.slice(0, 4)), phase: null,
    date, kickoffAt: `${date}T19:00:00Z`, home: `Home ${key}`, away: `Away ${key}`,
    generatedAt: `${date}T08:00:00Z`, trainedThrough: '2025-01-01', modelVersion: 'recorded-v1',
    probabilities: [.2, .6, .2], pick: 'D', actual: correct ? { home: 1, away: 1, outcome: 'D' } : { home: 2, away: 0, outcome: 'H' },
    forecastPeriod: 'regulation', scorelinePeriod: 'regulation', scoreForecast: { home: 1, away: 1 }, scoreForecastStatus: 'recorded', resultPeriod: null, resultEvidence: null,
    settledAt: `${date}T22:00:00Z`, status: 'scored', reason: '', ...over }
  if (!('resultPeriod' in over)) row.resultPeriod = row.actual ? 'regulation' : null
  if (!('settledAt' in over) && !row.actual) row.settledAt = null
  if (!('resultEvidence' in over) && row.actual) row.resultEvidence = { provider: 'espn', competitionId: row.competitionId,
    eventId: [...key].map(c => c.codePointAt(0)).join('') || '1', receiptSha256: 'a'.repeat(64), observedAt: row.settledAt!, period: 'regulation' }
  return row
}
export function artifact(rows: PublishedPick[] = []): PublishedRecord {
  return { schemaVersion: 2, outcomePeriod: 'regulation', cohort: 'immutable_snapshot_history', basis: 'verified_live_published', selection: 'last_before_authoritative_kickoff',
    generatedAt: '2027-01-02T12:00:00Z', coverageFrom: '2025-01-01', historyThrough: null, resultThrough: null,
    snapshotRows: rows.length, snapshotFixtures: rows.length, rows }
}

it('uses exact correct/settled counts including draws, never a rounded aggregate', () => {
  const rows = [game('a', '2026-08-15'), game('b', '2026-08-16', false), game('c', '2026-08-17')]
  expect(recordSummary(rows)).toMatchObject({ correct: 2, settled: 3, percent: 200 / 3 })
  expect(probabilityDetails(rows).n).toBe(3)
  expect(recordSummary([]).percent).toBeNull()
  expect(recordSummary([game('pending', '2026-08-15', true, { status: 'pending', actual: null })]).settled).toBe(0)
})

it('uses three-way argmax rather than an NBA-style binary threshold', () => {
  const home = game('home', '2026-08-15', false, { probabilities: [.4, .35, .25], pick: 'H' })
  const draw = game('draw', '2026-08-15', true, { probabilities: [.33, .34, .33] })
  expect(parsePublishedRecord(artifact([home, draw])).rows).toHaveLength(2)
  expect(recordSummary([home, draw])).toMatchObject({ correct: 2, settled: 2, percent: 100 })
})

it('weights unequal weeks by games and retains dips without smoothing', () => {
  const rows = [game('only', '2026-08-03'), ...Array.from({ length: 9 }, (_, i) => game(String(i), '2026-08-10', false))]
  const points = accuracyTimeline(rows.reverse(), 'week', '2026-08-15T12:00:00Z', emptyFilter)
  expect(points.map(p => p.cumulative)).toEqual([100, 10])
  expect(points[1]).toMatchObject({ correct: 1, settled: 10, periodCorrect: 0, periodSettled: 9, recentSettled: 10, partial: true, to: '2026-08-15' })
  expect(points[1].time - points[0].time).toBeGreaterThan(5 * 86400000)
})

it('uses last 20 settled games with an explicitly smaller early denominator', () => {
  const rows = Array.from({ length: 25 }, (_, i) => game(String(i).padStart(2, '0'), `2026-08-${String(i + 1).padStart(2, '0')}`, i < 5))
  const points = accuracyTimeline(rows, 'day', '2026-09-01T00:00:00Z', emptyFilter)
  expect(points[0]).toMatchObject({ recentCorrect: 1, recentSettled: 1, recent: 100 })
  expect(points.at(-1)).toMatchObject({ correct: 5, settled: 25, cumulative: 20, recentCorrect: 0, recentSettled: 20, recent: 0, recentFrom: '2026-08-06' })
})

it('never exposes half an equal-time event set and is stable under input reordering', () => {
  const rows = Array.from({ length: 22 }, (_, i) => game(String(i).padStart(2, '0'), '2026-08-15', i < 2))
  const points = accuracyTimeline(rows, 'day', artifact().generatedAt, emptyFilter)
  expect(points).toHaveLength(1)
  expect(points[0]).toMatchObject({ correct: 2, settled: 22, recentCorrect: 0, recentSettled: 20 })
  expect(accuracyTimeline(rows.reverse(), 'day', artifact().generatedAt, emptyFilter)).toEqual(points)
})

it('uses real calendar spacing across empty weeks, year and season rollover', () => {
  const rows = [game('a', '2026-12-27'), game('b', '2026-12-28', false), game('c', '2027-01-01'), game('d', '2027-01-25')]
  const points = accuracyTimeline(rows, 'week', '2027-02-01T00:00:00Z', emptyFilter)
  expect(points.map(p => p.key)).toEqual(['2026-12-21', '2026-12-28', '2027-01-25'])
  expect(points[2].time - points[1].time).toBe(28 * 86400000)
  expect(points[1]).toMatchObject({ correct: 2, settled: 3, periodCorrect: 1, periodSettled: 2 })
})

it('labels the first calendar week partial when retained history began midweek', () => {
  const points = accuracyTimeline([game('a', '2026-08-15')], 'week', '2026-08-20T00:00:00Z', emptyFilter, '2026-08-11')
  expect(points[0]).toMatchObject({ from: '2026-08-11', to: '2026-08-16', partial: true, correct: 1, settled: 1 })
})

it('applies identical date/competition/season scope and labels clipped calendar weeks', () => {
  const all = [game('a', '2026-08-10'), game('b', '2026-08-12', false), game('c', '2026-08-13', true, { competitionId: 'ita.1' }), game('d', '2026-08-14', true, { season: 2025 }), game('e', '2026-08-16')]
  const f = { competition: 'eng.1', season: '2026', from: '2026-08-12', to: '2026-08-15' }
  const rows = filterPublishedRows(all, f)
  expect(rows.map(r => r.key)).toEqual(['b'])
  expect(accuracyTimeline(rows, 'week', artifact().generatedAt, f)[0]).toMatchObject({ from: '2026-08-12', to: '2026-08-15', partial: true, correct: 0, settled: 1, cumulative: 0 })
})

it.each(['2026-02-30T19:00:00Z', '2026-08-15T24:00:00Z', '2026-08-15', '2026-08-15T19:00:00'])('rejects impossible or unknown exact time %s', stamp => {
  expect(awareTime(stamp)).toBeNull()
  expect(() => parsePublishedRecord(artifact([game('a', '2026-08-15', true, { generatedAt: stamp })]))).toThrow()
})

it.each([
  { generatedAt: '2026-08-15T19:00:00Z' }, { generatedAt: '2026-08-15T20:00:00Z' },
  { settledAt: '2026-08-15T18:59:59Z' }, { settledAt: '2027-02-01T00:00:00Z' },
  { trainedThrough: '2026-08-15' }, { trainedThrough: '2026-02-30' }, { modelVersion: '' },
  { probabilities: [.9, .9, .9] }, { pick: 'H' }, { actual: { home: 1, away: 1, outcome: 'A' } },
] as Partial<PublishedPick>[])('rejects entire artifact for invalid scored proof %j', over => {
  expect(() => parsePublishedRecord(artifact([game('a', '2026-08-15', true, over)]))).toThrow()
})

it('accepts offset-aware valid proof, rejects duplicate event IDs and malformed excluded rows', () => {
  const g = game('a', '2026-08-15', true, { generatedAt: '2026-08-15T20:00:00+02:00' })
  expect(parsePublishedRecord(artifact([g])).rows).toHaveLength(1)
  expect(() => parsePublishedRecord(artifact([g, g]))).toThrow()
  expect(() => parsePublishedRecord(artifact([game('x', '2026-08-15', false, { status: 'unverified', probabilities: {} as never })]))).toThrow()
  expect(parsePublishedRecord(artifact()).rows).toEqual([])
})

it('rejects the old period-less artifact instead of displaying its former percentage', () => {
  expect(() => parsePublishedRecord({ ...artifact([game('a', '2026-08-15')]), schemaVersion: 1 })).toThrow()
})

it.each([
  { forecastPeriod: null }, { forecastPeriod: 'including_extra_time' }, { resultPeriod: null },
  { resultEvidence: null },
] as Partial<PublishedPick>[])('rejects a scored row with unknown or mismatched period evidence %j', change => {
  expect(() => parsePublishedRecord(artifact([game('a', '2026-08-15', true, change)]))).toThrow()
})

it.each([
  { provider: 'other' }, { competitionId: 'other' }, { eventId: 'unknown' },
  { receiptSha256: 'missing' }, { observedAt: '2026-08-15T21:00:00Z' }, { period: 'including_extra_time' },
])('rejects inconsistent result proof %j', change => {
  const row = game('a', '2026-08-15')
  row.resultEvidence = { ...row.resultEvidence!, ...change } as PublishedPick['resultEvidence']
  expect(() => parsePublishedRecord(artifact([row]))).toThrow()
})

it('keeps a known regulation result visible without grading an unknown forecast period', () => {
  const row = game('a', '2026-08-15', true, { status: 'unverified', forecastPeriod: null })
  expect(parsePublishedRecord(artifact([row])).rows[0].actual?.outcome).toBe('D')
  expect(recordSummary([row]).settled).toBe(0)
  expect(accuracyTimeline([row], 'day', artifact().generatedAt, emptyFilter)).toEqual([])
})

it('assesses exact scores separately and keeps missing/ambiguous forecasts in outcome accuracy', () => {
  const rows = [game('hit', '2026-08-15'), game('miss', '2026-08-15', true, { scoreForecast: { home: 0, away: 0 } }),
    game('missing', '2026-08-15', true, { scoreForecast: null, scoreForecastStatus: 'missing' }),
    game('invalid', '2026-08-15', true, { scoreForecast: null, scoreForecastStatus: 'invalid' }),
    game('conflict', '2026-08-15', true, { scoreForecast: null, scoreForecastStatus: 'ambiguous' }),
    game('period', '2026-08-15', true, { scorelinePeriod: 'including_extra_time' }),
    game('pending', '2026-08-15', true, { status: 'pending', actual: null })]
  expect(recordSummary(rows)).toMatchObject({ correct: 6, settled: 6, percent: 100 })
  expect(exactScoreSummary(rows)).toEqual({ correct: 1, assessed: 2, percent: 50, missing: 1, invalid: 1, ambiguous: 1, periodUnverified: 1, unscored: 1 })
  expect(scorelineAssessment(rows[1])).toBe('incorrect')
  expect(exactScoreSummary([rows[2]]).percent).toBeNull()
  expect(exactScoreSummary([]).percent).toBeNull()
})

it('only reports a precise horizon for an eligible aware pre-event record', () => {
  expect(verifiedLeadHours(game('a', '2026-08-15'))).toBe(11)
  expect(verifiedLeadHours(game('a', '2026-08-15', true, { generatedAt: '2026-08-15T20:00:00+02:00' }))).toBe(1)
  expect(verifiedLeadHours(game('a', '2026-08-15', true, { status: 'unverified' }))).toBeNull()
  expect(verifiedLeadHours(game('a', '2026-08-15', true, { generatedAt: '2026-08-15T08:00:00' }))).toBeNull()
})
