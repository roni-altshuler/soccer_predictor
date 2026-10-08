import { matchEvidence, scoreEvidence, validEvidenceDate } from '@/lib/matchEvidence'

const row = (over: Record<string, unknown> = {}) => ({ match_id: '123', league: 'Premier League', gender: 'M', model_used: 'dixon_coles_v1',
  match_date: '2026-09-01', home_team: 'Arsenal', away_team: 'Fulham', predicted_home_win: 0.6, predicted_draw: 0.25, predicted_away_win: 0.15,
  predicted_home_goals: 1.8, predicted_away_goals: 0.9, home_elo: 1600, away_elo: 1450,
  prediction_timestamp: '2026-08-30T12:00:00', outcome_timestamp: '2026-09-01T23:00:00', actual_home_goals: 2, actual_away_goals: 0, actual_winner: 'home', ...over })
const entry = (r = row(), source = 'predictions_2026-09.json') => ({ source, row: r })
const audit = (entries = [entry()], asOf = '2026-09-02', from = '2026-08-01') => matchEvidence(entries, 'eng.1', 'M', asOf, from)

it('scores the dated, deduplicated archive on the existing summed Brier scale', () => {
  const d = audit()
  expect(d.records[0].recordedAt).toBe('2026-08-30T12:00:00.000Z')
  const s = scoreEvidence(d.records)
  expect(s.n).toBe(1); expect(s.brier).toBeCloseTo(0.245); expect(s.logLoss).toBeCloseTo(-Math.log(.6))
  expect(s.goalN).toBe(1); expect(s.goalMae).toBeCloseTo(.55)
  expect(s.reliability).toEqual([{ low: .6, high: .8, n: 1, stated: .6, observed: 1 }])
})

it.each(['2026-09-01T00:00:00', '2026-09-01T12:00:00', '2026-09-02T00:00:00', '', '2026-08-32T12:00:00', '2026-08-31'])('excludes same-day/post-day/unprovable timing %s', (prediction_timestamp) => {
  const d = audit([entry(row({ prediction_timestamp }))]); expect(d.records).toEqual([]); expect(d.counts.timingExcluded).toBe(1)
})
it('uses UTC offsets and includes an outcome at the end of cutoff day only', () => {
  expect(audit([entry()], '2026-09-01').records[0].result).not.toBeNull()
  const d = audit([entry(row({ outcome_timestamp: '2026-09-01T23:30:00-02:00' }))], '2026-09-01')
  expect(d.records[0].result).toBeNull(); expect(scoreEvidence(d.records).brier).toBeNull()
  expect(audit([entry()], '2026-08-31').records).toEqual([])
})
it.each([{ actual_home_goals: null }, { actual_home_goals: '2' }, { actual_away_goals: -1 }, { actual_winner: 'away' },
  { outcome_timestamp: '' }, { outcome_timestamp: '2026-08-31T23:00:00' }])('leaves unverifiable outcomes unscored %p', (over) => {
  const d = audit([entry(row(over))]); expect(d.records[0].result).toBeNull(); expect(scoreEvidence(d.records).n).toBe(0)
})
it('keeps null goal samples unavailable and genuine zero distinct', () => {
  const d = audit([entry(row({ predicted_home_goals: null, predicted_away_goals: 0, home_elo: '1600' }))])
  expect(d.records[0].expectedGoals).toEqual([null, 0]); expect(d.records[0].elo[0]).toBeNull()
  expect(scoreEvidence(d.records)).toMatchObject({ n: 1, goalN: 0, goalMae: null })
})
it.each([{ predicted_draw: -0.1 }, { predicted_home_win: 3 }, { predicted_draw: null }, { predicted_draw: .5 }, { home_team: 'Fulham' }, { match_date: '2026-02-30' }])('refuses invalid input instead of imputing %p', (over) => {
  const d = audit([entry(row(over))]); expect(d.records).toHaveLength(0); expect(d.counts.invalid).toBe(1)
})
it('does not mix gender, league, unknown identity or retired generations', () => {
  const d = audit([entry(row({ gender: 'F' })), entry(row({ league: 'Unknown league' })), entry(row({ league: 'La Liga' })), entry(row({ model_used: 'unified-multitask' })), entry(row({ gender: undefined })), entry()])
  expect(d.records).toHaveLength(1); expect(d.counts.scopedRows).toBe(1)
  expect(matchEvidence([entry()], 'eng.1', 'F', '2026-09-02', '2026-08-01').available).toBe(false)
})
it('is permutation invariant and collapses aliases/duplicate results before scoring', () => {
  const entries = [entry(), entry(row({ match_id: '456' })), entry(row({ prediction_timestamp: '2026-08-31T09:00:00', predicted_home_win: .2, predicted_draw: .3, predicted_away_win: .5 }))]
  const d = audit(entries)
  expect(audit([...entries].reverse())).toEqual(d); expect(d.records).toHaveLength(1)
  expect(d.records[0].p[0]).toBe(.6); expect(d.counts.duplicates).toBe(2); expect(scoreEvidence(d.records).n).toBe(1)
})
it('joins the latest known correction independently of the first forecast', () => {
  const entries = [entry(), entry(row({ actual_home_goals: 0, actual_away_goals: 1, actual_winner: 'away', outcome_timestamp: '2026-09-03T09:00:00' }), 'predictions_2026-10.json')]
  expect(audit(entries, '2026-09-02').records[0].result?.goals).toEqual([2, 0])
  expect(audit(entries, '2026-09-03').records[0].result?.goals).toEqual([0, 1])
  expect(audit(entries, '2026-09-03').records[0].recordedAt).toBe('2026-08-30T12:00:00.000Z')
})
it('withholds an invalid latest correction rather than silently reviving an old result', () => {
  const d = audit([entry(), entry(row({ actual_winner: 'away', outcome_timestamp: '2026-09-02T10:00:00' }))])
  expect(d.records[0].result).toBeNull(); expect(d.counts.resultsWithheld).toBe(1)
})
it('quarantines conflicting same-time forecasts and reused event IDs', () => {
  expect(audit([entry(), entry(row({ predicted_home_goals: 7 }))]).counts.conflicts).toBe(2)
  expect(audit([entry(), entry(row({ match_date: '2026-09-02' }))]).records).toEqual([])
})
it('withholds conflicting same-time results', () => {
  const d = audit([entry(), entry(row({ actual_home_goals: 0, actual_away_goals: 1, actual_winner: 'away' }))])
  expect(d.records).toHaveLength(1); expect(d.records[0].result).toBeNull()
})
it('respects date windows across a season boundary and reports incomplete files', () => {
  const old = entry(row({ match_id: '999', match_date: '2026-05-01', prediction_timestamp: '2026-04-30T10:00:00', outcome_timestamp: '2026-05-01T23:00:00' }))
  expect(audit([old, entry()]).records).toHaveLength(1)
  expect(audit([old, entry()], '2026-09-02', '2026-04-01').records).toHaveLength(2)
  expect(matchEvidence([entry()], 'eng.1', 'M', '2026-09-02', '2026-08-01', ['broken.json']).available).toBe(false)
})
it.each(['2026-02-30', '2026-13-01', 'bad', null])('rejects invalid dates %p', (v) => expect(validEvidenceDate(v)).toBe(false))

it('guards missing forecast offsets without discarding explicit pre-match instants', () => {
  expect(audit([entry(row({ prediction_timestamp: '2026-08-31T12:00:00' }))]).records).toEqual([])
  expect(audit([entry(row({ prediction_timestamp: '2026-08-31T11:59:59' }))]).records[0].forecastOffsetSupplied).toBe(false)
  expect(audit([entry(row({ prediction_timestamp: '2026-08-31T22:00:00Z' }))]).records[0].forecastOffsetSupplied).toBe(true)
})
