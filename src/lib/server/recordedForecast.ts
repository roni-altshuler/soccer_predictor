import { promises as fs } from 'fs'
import path from 'path'

/**
 * What this site said about a fixture BEFORE it was played, and how that scored.
 *
 * This is the project's central claim rendered on the match itself rather than
 * only on `/accuracy`: a forecast was written down, it was written down first,
 * and here is what happened to it. Every part of that sentence has to be
 * defensible from the file, so:
 *
 *   - the forecast is read from `predictions_*.json`, the DURABLE record — a
 *     fixture stays in it after being played, which `season_fixtures.json`
 *     (the remaining set) does not.
 *   - `recordedAt` is the row's own `prediction_timestamp`, and it is compared
 *     against the kickoff the card carries. **A row that cannot be shown to
 *     predate kickoff is returned with `beforeKickoff: false` and the caller
 *     refuses to draw it.** A number produced after the whistle is not a
 *     forecast, and this panel exists precisely to make that distinction
 *     visible rather than to blur it.
 *   - nothing is derived that the record does not contain. No outcome, no
 *     panel — the match simply has not been scored yet.
 *
 * Keyed on the ESPN event id, which all three match surfaces already hold:
 * `/matches/[id]` from its URL, and `/season/fixture` and `/tournaments/tie`
 * from the join they already run to fetch the card.
 */

const DIR = path.join(process.cwd(), 'backend', 'data', 'predictions')

export const OUTCOMES = ['home', 'draw', 'away'] as const
export type Outcome = (typeof OUTCOMES)[number]

export interface RecordedForecast {
  matchId: string
  league: string
  homeTeam: string
  awayTeam: string
  /** home, draw, away — as published, renormalised only if the file drifted. */
  p: [number, number, number]
  recordedAt: string | null
  /** Hours between the forecast being written and kickoff. Null if unknowable. */
  hoursBeforeKickoff: number | null
  beforeKickoff: boolean | null
  outcome: Outcome | null
  homeGoals: number | null
  awayGoals: number | null
  /** Did the largest of the three land on what happened? Null until played. */
  calledIt: boolean | null
  /** The probability this forecast gave the outcome that actually occurred. */
  pActual: number | null
  /** Summed over three outcomes, the scale every number in CLAUDE.md uses. */
  brier: number | null
}

interface Row {
  match_id?: string
  league?: string
  home_team?: string
  away_team?: string
  predicted_home_win?: number
  predicted_draw?: number
  predicted_away_win?: number
  prediction_timestamp?: string
  actual_winner?: string | null
  actual_home_goals?: number | null
  actual_away_goals?: number | null
}

/** Read once per process, re-read when any file's mtime moves. */
let cache: { stamp: string; rows: Map<string, Row> } | null = null

async function index(): Promise<Map<string, Row>> {
  let names: string[]
  try {
    names = (await fs.readdir(DIR)).filter(
      (f) => f.startsWith('predictions_') && f.endsWith('.json'),
    )
  } catch {
    return new Map()
  }
  names.sort()

  const stats = await Promise.all(
    names.map((n) => fs.stat(path.join(DIR, n)).catch(() => null)),
  )
  const stamp = names.map((n, i) => `${n}:${stats[i]?.mtimeMs ?? 0}`).join('|')
  if (cache?.stamp === stamp) return cache.rows

  const rows = new Map<string, Row>()
  for (const name of names) {
    try {
      const blob = JSON.parse(await fs.readFile(path.join(DIR, name), 'utf8'))
      for (const row of (blob.predictions ?? []) as Row[]) {
        // Later files win: the same fixture re-forecast in a later month is the
        // one that was served.
        if (row.match_id) rows.set(String(row.match_id), row)
      }
    } catch {
      // A corrupt month costs that month, never the rest.
    }
  }
  cache = { stamp, rows }
  return rows
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function brierScore(p: readonly number[], idx: number): number {
  return p.reduce((sum, v, i) => sum + (v - (i === idx ? 1 : 0)) ** 2, 0)
}

/**
 * The forecast on file for this ESPN event, or null.
 *
 * `kickoff` is the card's own date. Without it the point-in-time claim cannot
 * be made, so `beforeKickoff` stays null and the caller should say nothing
 * about timing rather than imply it.
 */
export async function recordedForecast(
  matchId: string,
  kickoff?: string | null,
): Promise<RecordedForecast | null> {
  const row = (await index()).get(String(matchId))
  if (!row) return null

  const raw = [row.predicted_home_win, row.predicted_draw, row.predicted_away_win]
  if (!raw.every(finite)) return null
  const total = (raw as number[]).reduce((a, b) => a + b, 0)
  if (total <= 0) return null
  const p = (raw as number[]).map((v) => v / total) as [number, number, number]

  const recordedAt = row.prediction_timestamp || null
  let hoursBeforeKickoff: number | null = null
  let beforeKickoff: boolean | null = null
  if (recordedAt && kickoff) {
    const made = Date.parse(recordedAt)
    const off = Date.parse(kickoff)
    if (Number.isFinite(made) && Number.isFinite(off)) {
      hoursBeforeKickoff = (off - made) / 3_600_000
      beforeKickoff = made < off
    }
  }

  const idx = OUTCOMES.indexOf(row.actual_winner as Outcome)
  const played = idx >= 0

  return {
    matchId: String(matchId),
    league: row.league ?? '',
    homeTeam: row.home_team ?? '',
    awayTeam: row.away_team ?? '',
    p,
    recordedAt,
    hoursBeforeKickoff,
    beforeKickoff,
    outcome: played ? OUTCOMES[idx] : null,
    homeGoals: finite(row.actual_home_goals) ? row.actual_home_goals : null,
    awayGoals: finite(row.actual_away_goals) ? row.actual_away_goals : null,
    calledIt: played ? p.indexOf(Math.max(...p)) === idx : null,
    pActual: played ? p[idx] : null,
    brier: played ? brierScore(p, idx) : null,
  }
}
