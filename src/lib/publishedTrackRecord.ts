import { scoreEvidence, validEvidenceDate, type EvidenceMatch } from '@/lib/matchEvidence'

export type PickOutcome = 'H' | 'D' | 'A'
export type RecordStatus = 'scored' | 'pending' | 'unverified' | 'retrospective' | 'missing'
export type MatchPeriod = 'regulation' | 'including_extra_time'
export type ScoreForecastStatus = 'recorded' | 'missing' | 'invalid' | 'ambiguous'
export interface PublishedPick {
  key: string; fixtureUid: string | null; competitionId: string; season: number; phase: string | null
  date: string | null; kickoffAt: string | null; home: string; away: string
  generatedAt: string | null; trainedThrough: string | null; modelVersion: string | null
  probabilities: [number, number, number] | null; pick: PickOutcome | null
  forecastPeriod: MatchPeriod | null; scorelinePeriod: MatchPeriod | null
  scoreForecast: { home: number; away: number } | null; scoreForecastStatus: ScoreForecastStatus
  resultPeriod: 'regulation' | null
  resultEvidence: { provider: 'espn'; competitionId: string; eventId: string; receiptSha256: string; observedAt: string; period: 'regulation' } | null
  actual: { home: number; away: number; outcome: PickOutcome } | null
  settledAt: string | null; status: RecordStatus; reason: string
}
export interface PublishedRecord {
  schemaVersion: 2; outcomePeriod: 'regulation'; cohort: 'immutable_snapshot_history'; basis: 'verified_live_published'; selection: 'last_before_authoritative_kickoff'
  generatedAt: string; historyThrough: string | null; resultThrough: string | null
  coverageFrom: string; snapshotRows: number; snapshotFixtures: number; rows: PublishedPick[]
}
export interface RecordFilter { competition: string; season: string; from: string; to: string }
const OUTCOMES = ['H', 'D', 'A'] as const
export const ROLLING_GAMES = 20
export function awareTime(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null
  if (!validEvidenceDate(value.slice(0, 10)) || Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) return null
  const n = Date.parse(value)
  return Number.isFinite(n) ? n : null
}
const goals = (n: unknown) => Number.isSafeInteger(n) && Number(n) >= 0
const period = (value: unknown) => value === null || value === 'regulation' || value === 'including_extra_time'

/** Reject the entire export if a scored row cannot prove its temporal contract.
 * Never repair an invalid score by dropping the inconvenient row on the client.
 */
export function parsePublishedRecord(value: unknown): PublishedRecord {
  if (!value || typeof value !== 'object') throw new Error('Record unavailable')
  const d = value as PublishedRecord
  const cutoff = awareTime(d.generatedAt)
  if (d.schemaVersion !== 2 || d.outcomePeriod !== 'regulation' || d.cohort !== 'immutable_snapshot_history' || d.basis !== 'verified_live_published' || d.selection !== 'last_before_authoritative_kickoff' || cutoff === null || !Array.isArray(d.rows)
    || !validEvidenceDate(d.coverageFrom) || !Number.isSafeInteger(d.snapshotRows) || d.snapshotRows < 0
    || !Number.isSafeInteger(d.snapshotFixtures) || d.snapshotFixtures < 0
    || [d.historyThrough, d.resultThrough].some(t => t !== null && (awareTime(t) === null || awareTime(t)! > cutoff))) throw new Error('Unsupported record')
  const seen = new Set<string>()
  const seenResults = new Set<string>()
  for (const row of d.rows) {
    if (!row || typeof row.key !== 'string' || !row.key || seen.has(row.key) || typeof row.competitionId !== 'string' || !row.competitionId
      || !Number.isSafeInteger(row.season) || typeof row.home !== 'string' || !row.home || typeof row.away !== 'string' || !row.away
      || typeof row.reason !== 'string' || !['scored', 'pending', 'unverified', 'retrospective', 'missing'].includes(row.status)
      || (row.date !== null && !validEvidenceDate(row.date))
      || [row.generatedAt, row.kickoffAt, row.settledAt].some(t => t !== null && awareTime(t) === null)
      || (row.modelVersion !== null && typeof row.modelVersion !== 'string')
      || (row.trainedThrough !== null && !validEvidenceDate(row.trainedThrough))
      || (row.probabilities !== null && (!Array.isArray(row.probabilities) || row.probabilities.length !== 3
        || row.probabilities.some(v => !Number.isFinite(v) || v < 0 || v > 1)
        || Math.abs(row.probabilities.reduce((a, b) => a + b, 0) - 1) > .001))
      || (row.pick !== null && !OUTCOMES.includes(row.pick))
      || !period(row.forecastPeriod) || !period(row.scorelinePeriod)
      || !['recorded', 'missing', 'invalid', 'ambiguous'].includes(row.scoreForecastStatus)
      || (row.scoreForecastStatus === 'recorded'
        ? !row.scoreForecast || !goals(row.scoreForecast.home) || !goals(row.scoreForecast.away)
        : row.scoreForecast !== null)
      || (row.actual !== null && (!goals(row.actual.home) || !goals(row.actual.away)
        || row.actual.outcome !== (row.actual.home > row.actual.away ? 'H' : row.actual.home === row.actual.away ? 'D' : 'A')))) throw new Error('Invalid game record')
    if (row.actual === null) {
      if (row.resultPeriod !== null || row.resultEvidence !== null || row.settledAt !== null) throw new Error('Unverified result acquired evidence')
    } else {
      const evidence = row.resultEvidence, kickoff = awareTime(row.kickoffAt), observed = awareTime(row.settledAt)
      if (row.resultPeriod !== 'regulation' || !evidence || evidence.period !== 'regulation' || evidence.provider !== 'espn'
        || evidence.competitionId !== row.competitionId || typeof evidence.eventId !== 'string' || !/^[1-9][0-9]*$/.test(evidence.eventId)
        || typeof evidence.receiptSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(evidence.receiptSha256)
        || evidence.observedAt !== row.settledAt || kickoff === null || observed === null || !(kickoff < observed && observed <= cutoff)) throw new Error('Result period evidence failed verification')
      const resultKey = `${evidence.competitionId}:${evidence.eventId}`
      if (seenResults.has(resultKey)) throw new Error('Provider result identity is shared')
      seenResults.add(resultKey)
    }
    seen.add(row.key)
    if (row.status === 'pending') {
      const made = awareTime(row.generatedAt), event = awareTime(row.kickoffAt), p = row.probabilities
      if (row.forecastPeriod !== 'regulation' || row.actual !== null || made === null || event === null
        || !(made < event && made <= cutoff) || !row.modelVersion?.trim() || !validEvidenceDate(row.trainedThrough)
        || row.trainedThrough! >= new Date(made).toISOString().slice(0, 10)
        || row.trainedThrough! >= new Date(event).toISOString().slice(0, 10)
        || !p || row.pick !== OUTCOMES[p.indexOf(Math.max(...p))]) throw new Error('Pending forecast failed verification')
    }
    if (row.status !== 'scored') continue
    const made = awareTime(row.generatedAt), event = awareTime(row.kickoffAt), settled = awareTime(row.settledAt)
    const p = row.probabilities
    const result = row.actual
    if (row.forecastPeriod !== 'regulation' || row.resultPeriod !== 'regulation'
      || made === null || event === null || settled === null || !(made < event && event <= settled && settled <= cutoff)
      || !row.modelVersion?.trim() || !validEvidenceDate(row.trainedThrough)
      || row.trainedThrough! >= new Date(made).toISOString().slice(0, 10)
      || row.trainedThrough! >= new Date(event).toISOString().slice(0, 10)
      || row.date !== new Date(event).toISOString().slice(0, 10)
      || !Array.isArray(p) || p.length !== 3 || p.some(v => !Number.isFinite(v) || v < 0 || v > 1)
      || Math.abs(p.reduce((a, b) => a + b, 0) - 1) > .001
      || !result || !goals(result.home) || !goals(result.away)
      || result.outcome !== (result.home > result.away ? 'H' : result.home === result.away ? 'D' : 'A')
      || row.pick !== OUTCOMES[p.indexOf(Math.max(...p))]) throw new Error('Scored game failed verification')
  }
  return d
}

export function filterPublishedRows(rows: PublishedPick[], f: RecordFilter) {
  return rows.filter(r => (!f.competition || r.competitionId === f.competition)
    && (!f.season || String(r.season) === f.season)
    && (!f.from || Boolean(r.date && r.date >= f.from)) && (!f.to || Boolean(r.date && r.date <= f.to)))
}
export function settledPicks(rows: PublishedPick[]) {
  // Event ID is the deterministic order for simultaneous kickoffs. Every
  // calendar bucket includes the full equal-time set before exposing a point.
  return rows.filter(r => r.status === 'scored').sort((a, b) =>
    awareTime(a.kickoffAt)! - awareTime(b.kickoffAt)! || a.key.localeCompare(b.key))
}
export function recordSummary(rows: PublishedPick[]) {
  const settled = settledPicks(rows), correct = settled.filter(r => r.pick === r.actual!.outcome).length
  return { correct, settled: settled.length, percent: settled.length ? 100 * correct / settled.length : null,
    first: settled[0]?.date ?? null, last: settled.at(-1)?.date ?? null,
    pending: rows.filter(r => r.status === 'pending').length,
    unverified: rows.filter(r => r.status === 'unverified').length,
    retrospective: rows.filter(r => r.status === 'retrospective').length,
    missing: rows.filter(r => r.status === 'missing').length }
}

export function scorelineAssessment(row: PublishedPick) {
  if (row.status !== 'scored') return 'unscored' as const
  if (row.scoreForecastStatus !== 'recorded') return row.scoreForecastStatus
  if (row.scorelinePeriod !== 'regulation') return 'period_unverified' as const
  return row.scoreForecast!.home === row.actual!.home && row.scoreForecast!.away === row.actual!.away ? 'correct' as const : 'incorrect' as const
}

export function exactScoreSummary(rows: PublishedPick[]) {
  const states = rows.map(scorelineAssessment)
  const count = (value: ReturnType<typeof scorelineAssessment>) => states.filter(s => s === value).length
  const correct = count('correct'), assessed = correct + count('incorrect')
  return { correct, assessed, percent: assessed ? 100 * correct / assessed : null,
    missing: count('missing'), invalid: count('invalid'), ambiguous: count('ambiguous'),
    periodUnverified: count('period_unverified'), unscored: count('unscored') }
}

export function verifiedLeadHours(row: PublishedPick): number | null {
  if (row.status !== 'scored') return null
  const saved = awareTime(row.generatedAt), kickoff = awareTime(row.kickoffAt)
  return saved !== null && kickoff !== null && saved < kickoff ? (kickoff - saved) / 3600000 : null
}
export interface AccuracyPoint {
  key: string; from: string; to: string; time: number
  correct: number; settled: number; cumulative: number
  periodCorrect: number; periodSettled: number; partial: boolean
  recentCorrect: number; recentSettled: number; recent: number
  recentFrom: string; recentTo: string; versions: string[]
}
const DAY = 86400000
function periodStart(date: string, unit: 'day' | 'week') {
  const t = Date.parse(`${date}T00:00:00Z`)
  return unit === 'day' ? t : t - ((new Date(t).getUTCDay() + 6) % 7) * DAY
}
/** Counts, never means of percentages. Default includes the whole eligible
 * ledger. A selected window applies equally to card, chart and game history.
 */
export function accuracyTimeline(rows: PublishedPick[], unit: 'day' | 'week', asOf: string, filter: RecordFilter, coverageFrom?: string): AccuracyPoint[] {
  const settled = settledPicks(rows), buckets = new Map<number, PublishedPick[]>()
  for (const r of settled) {
    const start = periodStart(r.date!, unit)
    buckets.set(start, [...(buckets.get(start) ?? []), r])
  }
  const points: AccuracyPoint[] = [], seen: PublishedPick[] = []
  let correct = 0
  for (const [start, games] of buckets) {
    const periodCorrect = games.filter(r => r.pick === r.actual!.outcome).length
    correct += periodCorrect; seen.push(...games)
    const recent = seen.slice(-ROLLING_GAMES)
    const recentCorrect = recent.filter(r => r.pick === r.actual!.outcome).length
    const end = Math.min(start + (unit === 'week' ? 7 : 1) * DAY - 1, Date.parse(asOf),
      filter.to ? Date.parse(`${filter.to}T23:59:59Z`) : Infinity)
    const begin = Math.max(start, filter.from ? Date.parse(`${filter.from}T00:00:00Z`) : -Infinity,
      coverageFrom ? Date.parse(`${coverageFrom}T00:00:00Z`) : -Infinity)
    points.push({ key: new Date(start).toISOString().slice(0, 10), from: new Date(begin).toISOString().slice(0, 10),
      to: new Date(end).toISOString().slice(0, 10), time: end,
      correct, settled: seen.length, cumulative: 100 * correct / seen.length,
      periodCorrect, periodSettled: games.length,
      partial: begin > start || end < start + (unit === 'week' ? 7 : 1) * DAY - 1,
      recentCorrect, recentSettled: recent.length, recent: 100 * recentCorrect / recent.length,
      recentFrom: recent[0].date!, recentTo: recent.at(-1)!.date!,
      versions: [...new Set(games.map(r => r.modelVersion!))].sort() })
  }
  return points
}

/** Existing multiclass probability scoring/calibration, on precisely this sample. */
export function probabilityDetails(rows: PublishedPick[]) {
  const records: EvidenceMatch[] = settledPicks(rows).map(r => ({ id: r.key, date: r.date!, home: r.home, away: r.away,
    model: r.modelVersion!, source: 'verified published ledger', recordedAt: r.generatedAt!, forecastOffsetSupplied: true,
    p: r.probabilities!, expectedGoals: [null, null], elo: [null, null],
    result: { goals: [r.actual!.home, r.actual!.away], knownAt: r.settledAt!, outcome: OUTCOMES.indexOf(r.actual!.outcome) } }))
  return scoreEvidence(records)
}

export function outcomeLabel(outcome: PickOutcome | null, row: PublishedPick) {
  return outcome === 'H' ? `${row.home} win` : outcome === 'D' ? 'Draw' : outcome === 'A' ? `${row.away} win` : 'Not recorded'
}
