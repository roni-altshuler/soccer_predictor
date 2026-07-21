/**
 * Pure helpers behind /history — the settled-prediction record ledger.
 *
 * Everything here is side-effect free and unit tested so the page component
 * stays a thin rendering layer. No formatting decision that affects what a
 * reader believes about the record should live inside JSX.
 */

/** A prediction row exactly as `/api/v1/tracking/recent` serves it. */
export interface LedgerRecord {
  match_id: string | number
  home_team: string
  away_team: string
  league: string
  match_date: string
  gender?: 'M' | 'F' | null
  predicted_winner?: 'home' | 'draw' | 'away' | null
  predicted_scoreline?: string | null
  predicted_home_win: number
  predicted_draw: number
  predicted_away_win: number
  /** Percentage 0–100 as written by the tracker. */
  confidence?: number | null
  actual_winner: 'home' | 'draw' | 'away' | null
  actual_home_goals: number | null
  actual_away_goals: number | null
  winner_correct: boolean | null
  scoreline_correct?: boolean | null
  scoreline_in_top5?: boolean | null
}

export type LedgerOutcome = 'correct' | 'incorrect' | 'pending'

/** Which slice of the record the reader asked for. */
export type OutcomeFilter = 'settled' | 'correct' | 'incorrect' | 'pending' | 'all'

/** Rolling window, in days back from "now". `0` means no date limit. */
export type PeriodFilter = 0 | 7 | 30 | 90

export interface LedgerFilters {
  outcome: OutcomeFilter
  competition: string
  period: PeriodFilter
  query: string
}

export const DEFAULT_FILTERS: LedgerFilters = {
  outcome: 'settled',
  competition: 'all',
  period: 0,
  query: '',
}

export const OUTCOME_OPTIONS: { value: OutcomeFilter; label: string }[] = [
  { value: 'settled', label: 'Settled only' },
  { value: 'correct', label: 'Correct calls' },
  { value: 'incorrect', label: 'Missed calls' },
  { value: 'pending', label: 'Awaiting result' },
  { value: 'all', label: 'All predictions' },
]

export const PERIOD_OPTIONS: { value: PeriodFilter; label: string }[] = [
  { value: 0, label: 'All dates' },
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
]

export const PAGE_SIZE = 50

/* ------------------------------------------------------------------ */
/* Classification                                                      */
/* ------------------------------------------------------------------ */

/** Settled-and-right, settled-and-wrong, or not yet played. */
export function outcomeOf(record: LedgerRecord): LedgerOutcome {
  if (record.winner_correct === true) return 'correct'
  if (record.winner_correct === false) return 'incorrect'
  return 'pending'
}

export function isSettled(record: LedgerRecord): boolean {
  return outcomeOf(record) !== 'pending'
}

/** Which side we called, spelled out with the team's own name. */
export function callLabel(record: LedgerRecord): string {
  if (record.predicted_winner === 'home') return record.home_team
  if (record.predicted_winner === 'away') return record.away_team
  if (record.predicted_winner === 'draw') return 'Draw'
  return '—'
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

/** Parse the leading `YYYY-MM-DD` of a record date without timezone drift. */
export function parseDayParts(
  isoish: string | null | undefined
): { year: number; month: number; day: number } | null {
  if (!isoish) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoish.trim())
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return { year, month, day }
}

/** `2026-07-26` → `26 Jul 2026`. Unparseable input yields an em dash. */
export function formatLedgerDate(isoish: string | null | undefined): string {
  const parts = parseDayParts(isoish)
  if (!parts) return '—'
  return `${parts.day} ${MONTHS[parts.month - 1]} ${parts.year}`
}

/** `2026-07-26` → `26 Jul` — the compact column variant. */
export function formatShortDate(isoish: string | null | undefined): string {
  const parts = parseDayParts(isoish)
  if (!parts) return '—'
  return `${parts.day} ${MONTHS[parts.month - 1]}`
}

/**
 * Inclusive span of the supplied records, e.g. `22 Mar – 26 Jul 2026`.
 * Returns null when nothing has a usable date, so callers can omit the
 * clause rather than print a fabricated range.
 */
export function formatDateRange(records: LedgerRecord[]): string | null {
  const days = records
    .map((r) => r.match_date?.slice(0, 10))
    .filter((d): d is string => Boolean(parseDayParts(d)))
    .sort()
  if (days.length === 0) return null
  const first = days[0]
  const last = days[days.length - 1]
  if (first === last) return formatLedgerDate(first)
  const a = parseDayParts(first)!
  const b = parseDayParts(last)!
  const left =
    a.year === b.year
      ? `${a.day} ${MONTHS[a.month - 1]}`
      : `${a.day} ${MONTHS[a.month - 1]} ${a.year}`
  return `${left} – ${formatLedgerDate(last)}`
}

/** Tracker confidence is already a percentage; render it as a whole number. */
export function formatConfidence(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const pct = value <= 1 ? value * 100 : value
  return `${Math.round(pct)}%`
}

/** Final score with an en dash, or null while the match is unplayed. */
export function formatScore(record: LedgerRecord): string | null {
  const { actual_home_goals: h, actual_away_goals: a } = record
  if (h == null || a == null) return null
  return `${h}–${a}`
}

/** Predicted scoreline normalised to the same en-dash grammar as the result. */
export function formatPredictedScore(record: LedgerRecord): string | null {
  const raw = record.predicted_scoreline
  if (!raw) return null
  const m = /^(\d+)\s*[-–]\s*(\d+)$/.exec(raw.trim())
  return m ? `${m[1]}–${m[2]}` : raw.trim()
}

/* ------------------------------------------------------------------ */
/* Filtering + summarising                                             */
/* ------------------------------------------------------------------ */

/** Competitions present in the window, most-predicted first. */
export function competitionsOf(records: LedgerRecord[]): string[] {
  const counts = new Map<string, number>()
  for (const r of records) {
    const name = r.league?.trim()
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name)
}

function matchesOutcome(record: LedgerRecord, filter: OutcomeFilter): boolean {
  const outcome = outcomeOf(record)
  switch (filter) {
    case 'all':
      return true
    case 'settled':
      return outcome !== 'pending'
    default:
      return outcome === filter
  }
}

function matchesQuery(record: LedgerRecord, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    record.home_team?.toLowerCase().includes(q) ||
    record.away_team?.toLowerCase().includes(q) ||
    record.league?.toLowerCase().includes(q)
  )
}

function matchesPeriod(record: LedgerRecord, period: PeriodFilter, now: Date): boolean {
  if (!period) return true
  const parts = parseDayParts(record.match_date)
  if (!parts) return false
  const day = Date.UTC(parts.year, parts.month - 1, parts.day)
  const cutoff = now.getTime() - period * 86_400_000
  return day >= cutoff
}

/**
 * Apply every filter in one pass. `now` is injectable so the period filter
 * is deterministic under test.
 */
export function applyFilters(
  records: LedgerRecord[],
  filters: LedgerFilters,
  now: Date = new Date()
): LedgerRecord[] {
  return records.filter(
    (r) =>
      matchesOutcome(r, filters.outcome) &&
      (filters.competition === 'all' || r.league === filters.competition) &&
      matchesPeriod(r, filters.period, now) &&
      matchesQuery(r, filters.query)
  )
}

export interface LedgerSummary {
  total: number
  settled: number
  correct: number
  incorrect: number
  pending: number
}

export function summarise(records: LedgerRecord[]): LedgerSummary {
  let correct = 0
  let incorrect = 0
  let pending = 0
  for (const r of records) {
    const outcome = outcomeOf(r)
    if (outcome === 'correct') correct++
    else if (outcome === 'incorrect') incorrect++
    else pending++
  }
  return {
    total: records.length,
    settled: correct + incorrect,
    correct,
    incorrect,
    pending,
  }
}

/** Newest first, with a stable tiebreak so paging never reshuffles rows. */
export function sortNewestFirst(records: LedgerRecord[]): LedgerRecord[] {
  return [...records].sort((a, b) => {
    const byDate = (b.match_date || '').localeCompare(a.match_date || '')
    if (byDate !== 0) return byDate
    return String(a.match_id).localeCompare(String(b.match_id))
  })
}

/** 1-based inclusive range description for the pagination footer. */
export function pageBounds(
  total: number,
  page: number,
  pageSize: number = PAGE_SIZE
): { from: number; to: number; pageCount: number; page: number } {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const clamped = Math.min(Math.max(1, page), pageCount)
  if (total === 0) return { from: 0, to: 0, pageCount: 1, page: 1 }
  return {
    from: (clamped - 1) * pageSize + 1,
    to: Math.min(total, clamped * pageSize),
    pageCount,
    page: clamped,
  }
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

const CSV_COLUMNS = [
  'match_date',
  'competition',
  'home_team',
  'away_team',
  'our_call',
  'predicted_scoreline',
  'confidence_pct',
  'prob_home',
  'prob_draw',
  'prob_away',
  'final_score',
  'actual_winner',
  'call_correct',
] as const

function csvCell(value: unknown): string {
  if (value == null) return ''
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Flatten the visible ledger to CSV. Header order is stable by contract. */
export function toCSV(records: LedgerRecord[]): string {
  const lines = [CSV_COLUMNS.join(',')]
  for (const r of records) {
    lines.push(
      [
        r.match_date ?? '',
        r.league ?? '',
        r.home_team ?? '',
        r.away_team ?? '',
        r.predicted_winner ?? '',
        r.predicted_scoreline ?? '',
        r.confidence == null ? '' : Math.round(r.confidence <= 1 ? r.confidence * 100 : r.confidence),
        r.predicted_home_win?.toFixed(4) ?? '',
        r.predicted_draw?.toFixed(4) ?? '',
        r.predicted_away_win?.toFixed(4) ?? '',
        r.actual_home_goals != null && r.actual_away_goals != null
          ? `${r.actual_home_goals}-${r.actual_away_goals}`
          : '',
        r.actual_winner ?? '',
        r.winner_correct == null ? '' : r.winner_correct ? 'yes' : 'no',
      ]
        .map(csvCell)
        .join(',')
    )
  }
  return `${lines.join('\n')}\n`
}
