import { brierScore } from '@/lib/forecastScoring'
import { getLeagueAccent, SERVED_COMPETITION_IDS } from '@/lib/leagueAccents'
import { isServingModel } from '@/lib/predictionScope'
import type { PredictionArchiveEntry } from '@/lib/server/recordedForecast'

type Triple = [number, number, number]
export type EvidenceMatch = {
  id: string; date: string; home: string; away: string; model: string; source: string
  recordedAt: string; forecastOffsetSupplied: boolean; p: Triple; expectedGoals: [number | null, number | null]
  elo: [number | null, number | null]; result: { goals: [number, number]; knownAt: string; outcome: number } | null
}
export type EvidenceData = {
  available: boolean; leagueId: string; gender: string; asOf: string; from: string
  records: EvidenceMatch[]; files: string[]; failedFiles: string[]
  counts: { scopedRows: number; invalid: number; timingExcluded: number; duplicates: number; conflicts: number; resultsWithheld: number }
}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const positive = (v: unknown) => finite(v) && v >= 0 ? v : null
const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0
const text = (v: unknown): v is string => typeof v === 'string' && Boolean(v.trim())
export function validEvidenceDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    !Number.isNaN(Date.parse(v)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v
}
/** Interpret naive stamps nominally as UTC, never as the browser's timezone.
 * Outcome tracker uses utcnow; batch forecasts use local now without an offset.
 * Forecast eligibility therefore also guards the latest possible UTC instant.
 */
function stamp(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(v) || !validEvidenceDate(v.slice(0, 10))) return null
  const ms = Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(v) ? v : `${v}Z`)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

/** Observational archive audit, not a refit/backtest or proof of training cutoff.
 * Date-only fixtures require forecast < start of match day. Same-day forecasts
 * cannot establish ordering and are excluded. Results must be known by cutoff.
 */
export function matchEvidence(entries: PredictionArchiveEntry[], leagueId: string, gender: string, asOf: string, from: string, failedFiles: string[] = []): EvidenceData {
  const data: EvidenceData = { available: failedFiles.length === 0, leagueId, gender, asOf, from, records: [], files: [], failedFiles,
    counts: { scopedRows: 0, invalid: 0, timingExcluded: 0, duplicates: 0, conflicts: 0, resultsWithheld: 0 } }
  if (gender !== 'M' || !(SERVED_COMPETITION_IDS as readonly string[]).includes(leagueId)) return { ...data, available: false }
  if (!validEvidenceDate(asOf) || !validEvidenceDate(from) || from > asOf) return { ...data, available: false }
  const cutoff = Date.parse(`${asOf}T00:00:00Z`) + 86400000 - 1
  const groups = new Map<string, { forecast: EvidenceMatch; raw: Record<string, unknown> }[]>()
  const ids = new Map<string, Set<string>>()
  const files = new Set<string>()
  for (const entry of entries) {
    if (!entry.row || typeof entry.row !== 'object') continue
    const r = entry.row as Record<string, unknown>
    if (typeof r.league !== 'string' || getLeagueAccent(r.league).competitionId !== leagueId || r.gender !== gender || !isServingModel(typeof r.model_used === 'string' ? r.model_used : null)) continue
    data.counts.scopedRows++
    const p = [r.predicted_home_win, r.predicted_draw, r.predicted_away_win]
    const sum = p.every(finite) ? (p as number[]).reduce((a, b) => a + b, 0) : NaN
    if (!text(r.match_id) || !/^\d+$/.test(r.match_id) || !text(r.home_team) || !text(r.away_team) ||
      r.home_team.trim().toLowerCase() === r.away_team.trim().toLowerCase() || !validEvidenceDate(r.match_date) ||
      !p.every((v) => finite(v) && v >= 0 && v <= 1) || Math.abs(sum - 1) > 0.001) { data.counts.invalid++; continue }
    const made = stamp(r.prediction_timestamp)
    const forecastOffsetSupplied = typeof r.prediction_timestamp === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(r.prediction_timestamp)
    // A civil timestamp in UTC-12 can be twelve hours later than nominal UTC.
    // Without an explicit offset require even that instant to precede match day.
    const latestMade = made ? Date.parse(made) + (forecastOffsetSupplied ? 0 : 12 * 3600000) : NaN
    if (!made || latestMade >= Date.parse(`${r.match_date}T00:00:00Z`) || latestMade > cutoff || r.match_date > asOf || r.match_date < from) { data.counts.timingExcluded++; continue }
    const home = r.home_team.trim(), away = r.away_team.trim()
    const key = `${r.match_date}:${home.toLowerCase()}:${away.toLowerCase()}`
    const forecast: EvidenceMatch = { id: r.match_id, date: r.match_date, home, away, model: String(r.model_used), source: entry.source, recordedAt: made, forecastOffsetSupplied,
      // Only rounding drift within .001 is normalised; never repair bad inputs.
      p: (p as number[]).map((v) => v / sum) as Triple, expectedGoals: [positive(r.predicted_home_goals), positive(r.predicted_away_goals)],
      elo: [positive(r.home_elo), positive(r.away_elo)], result: null }
    groups.set(key, [...(groups.get(key) ?? []), { forecast, raw: r }])
    ids.set(r.match_id, new Set([...(ids.get(r.match_id) ?? []), key]))
    files.add(entry.source)
  }
  for (const candidates of groups.values()) {
    candidates.sort((a, b) => a.forecast.recordedAt.localeCompare(b.forecast.recordedAt) || a.forecast.source.localeCompare(b.forecast.source) || a.forecast.id.localeCompare(b.forecast.id) || a.forecast.home.localeCompare(b.forecast.home) || a.forecast.away.localeCompare(b.forecast.away))
    const first = candidates[0].forecast
    const sameTime = candidates.filter((c) => c.forecast.recordedAt === first.recordedAt)
    const signature = (f: EvidenceMatch) => JSON.stringify([f.model, f.p, f.expectedGoals, f.elo])
    if (candidates.some((c) => (ids.get(c.forecast.id)?.size ?? 0) > 1) || new Set(sameTime.map((c) => signature(c.forecast))).size > 1) { data.counts.conflicts += candidates.length; continue }
    data.counts.duplicates += candidates.length - 1
    // Outcomes are a separate temporal join; never take the last file order.
    const results = candidates.flatMap(({ raw: r }) => {
      const knownAt = stamp(r.outcome_timestamp)
      if (!knownAt || Date.parse(knownAt) > cutoff || Date.parse(knownAt) < Date.parse(`${first.date}T00:00:00Z`)) return []
      if (!count(r.actual_home_goals) || !count(r.actual_away_goals)) return [{ goals: null, knownAt, outcome: -1 }]
      const outcome = r.actual_home_goals > r.actual_away_goals ? 0 : r.actual_home_goals === r.actual_away_goals ? 1 : 2
      if (r.actual_winner !== ['home', 'draw', 'away'][outcome]) return [{ goals: null, knownAt, outcome: -1 }]
      return [{ goals: [r.actual_home_goals, r.actual_away_goals] as [number, number], knownAt, outcome }]
    }).sort((a, b) => b.knownAt.localeCompare(a.knownAt))
    if (results.length && results[0].goals && new Set(results.filter((r) => r.knownAt === results[0].knownAt).map((r) => JSON.stringify(r.goals))).size === 1) first.result = { ...results[0], goals: results[0].goals }
    else data.counts.resultsWithheld++
    data.records.push(first)
  }
  data.records.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
  data.files = [...files].sort()
  return data
}

/** Score only visible, settled, deduplicated rows, using the existing Brier scale. */
export function scoreEvidence(records: EvidenceMatch[]) {
  const settled = records.filter((r) => r.result)
  const bins = Array.from({ length: 5 }, (_, i) => ({ low: i / 5, high: (i + 1) / 5, n: 0, stated: 0, observed: 0 }))
  let brier = 0, loss = 0, goalError = 0, goalN = 0
  for (const row of settled) {
    const result = row.result!
    brier += brierScore(row.p, result.outcome)
    loss -= Math.log(Math.max(1e-12, row.p[result.outcome]))
    const confidence = Math.max(...row.p), idx = row.p.indexOf(confidence)
    const bin = bins[Math.min(4, Math.floor(confidence * 5))]
    bin.n++; bin.stated += confidence; bin.observed += idx === result.outcome ? 1 : 0
    if (row.expectedGoals.every((v) => v !== null)) {
      goalN++; goalError += (Math.abs(row.expectedGoals[0]! - result.goals[0]) + Math.abs(row.expectedGoals[1]! - result.goals[1])) / 2
    }
  }
  const reliability = bins.filter((b) => b.n).map((b) => ({ ...b, stated: b.stated / b.n, observed: b.observed / b.n }))
  const n = settled.length
  return { n, brier: n ? brier / n : null, logLoss: n ? loss / n : null,
    ece: n ? reliability.reduce((s, b) => s + Math.abs(b.stated - b.observed) * b.n / n, 0) : null,
    goalN, goalMae: goalN ? goalError / goalN : null, reliability }
}
