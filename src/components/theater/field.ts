import { getLeagueAccent } from '@/lib/leagueAccents'

import { RIVER_DOMAIN_MAX, riverChartX } from '../match/detail/momentum'
import {
  GOAL_TYPES,
  STORY_MIN_SAMPLE,
  clampDiff,
  minuteBucket,
  reconstructTimeline,
  type StoryBeatType,
} from '../match/detail/story'
import type { MatchDetails } from '../match/detail/types'

/**
 * Match Theater field builder — the 3D win-chance landscape and the path a
 * finished match carved through it.
 *
 * THE SURFACE is the committed exact-count artifact read as a scalar field:
 * for every (score difference, 5-minute mark) the home side's historical
 * win share w/n over every warehouse match that reached that state. That
 * artifact's key space IS `(diff, bucket)`, so it maps onto a (minute, score
 * difference, win chance) mesh with nothing invented — no interpolation
 * between counted cells, no representative scoreline chosen on the caller's
 * behalf. Uncounted states are simply absent from the mesh.
 *
 * THE PATH is this match's own trajectory across that same field, built on
 * `story.ts`'s timeline reconstruction and `momentum.ts`'s chart axis, so the
 * 3D path and the 2D river can never disagree about where a goal happened.
 * The path lies exactly ON the surface: every height it reports is the same
 * counted number the cell underneath it reports.
 *
 * Honesty gates (any one of them returns null — the caller renders NOTHING):
 * - no final score, an unplaceable event, or events that do not reproduce the
 *   final score;
 * - no goal events (a path with no steps is just a straight line);
 * - a surface too sparse to read as a field;
 * - ANY span of the path resting on a state counted fewer than
 *   {@link STORY_MIN_SAMPLE} times.
 *
 * Pure and synchronous: the caller supplies the fetched field payload, so the
 * whole builder is testable without a network.
 */

/** Chart domain end — shared with the momentum river's axis (90 + a "90+" zone). */
export const THEATER_DOMAIN_MAX = RIVER_DOMAIN_MAX

export const THEATER_DIFF_MIN = -3
export const THEATER_DIFF_MAX = 3
export const THEATER_BUCKET_STEP = 5
export const THEATER_BUCKET_MAX = 90

/**
 * Fewest counted cells that still read as a landscape rather than a few
 * stranded tiles. The men's and women's artifacts both clear this comfortably;
 * a stripped or half-built artifact does not.
 */
export const THEATER_MIN_SURFACE_CELLS = 40

// ---------------------------------------------------------------------------
// Wire + output types
// ---------------------------------------------------------------------------

/** One row of `/api/v1/theater/field` — raw counts, exactly as committed. */
export interface TheaterFieldCell {
  diff: number
  minute: number
  n: number
  w: number
  d: number
  l: number
}

export interface TheaterFieldPayload {
  gender: 'M' | 'F'
  matchesCovered: number
  minSample: number
  cells: TheaterFieldCell[]
}

/** A counted mesh cell: the tile [minute, minute+5) x [diff-½, diff+½]. */
export interface TheaterCell extends TheaterFieldCell {
  /** Exact historical win share for the home side's position — w/n. */
  pHome: number
  pDraw: number
  pAway: number
}

/** A constant-height run of the match path along one score difference. */
export interface TheaterSpan {
  /** Chart-minute span [x0, x1) on the river's axis. */
  x0: number
  x1: number
  diff: number
  bucket: number
  /** Surface height under this run — the cell's exact w/n. */
  pHome: number
  n: number
  /** Running score during this run. */
  home: number
  away: number
}

/** A state-changing event, positioned on the path. */
export interface TheaterEvent {
  x: number
  minute: number
  addedTime?: number
  type: StoryBeatType
  team: 'home' | 'away'
  player: string
  scoreAfter: { home: number; away: number }
  /** Surface heights either side of the step — present only when both are counted. */
  pBefore?: number
  pAfter?: number
}

export interface TheaterData {
  gender: 'M' | 'F'
  /** Every counted cell of the field, ascending by diff then minute. */
  cells: TheaterCell[]
  /** The match path, in chronological order and contiguous across the domain. */
  spans: TheaterSpan[]
  events: TheaterEvent[]
  /** Smallest sample size under the path (always >= STORY_MIN_SAMPLE). */
  minN: number
  matchesCovered: number
  domainMax: number
  finalScore: { home: number; away: number }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cellKey(diff: number, bucket: number): string {
  return `${diff}:${bucket}`
}

/** Bucket for a chart minute: regulation floors onto the 5-grid, the 90+ zone is bucket 90. */
function bucketAtChartX(x: number): number {
  return minuteBucket(Math.min(x, THEATER_BUCKET_MAX))
}

/** Minimal fetch shape so tests can inject a mock without faking a Response. */
export type TheaterFetch = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>

function isCountRow(raw: unknown): raw is TheaterFieldCell {
  if (!raw || typeof raw !== 'object') return false
  const c = raw as Record<string, unknown>
  return (
    typeof c.diff === 'number' &&
    typeof c.minute === 'number' &&
    typeof c.n === 'number' &&
    typeof c.w === 'number' &&
    typeof c.d === 'number' &&
    typeof c.l === 'number'
  )
}

/**
 * Fetch the counted field for one universe. Any failure (route missing,
 * offline, malformed payload) resolves to null — never a partial field.
 */
export async function fetchTheaterField(
  gender: 'M' | 'F',
  fetchImpl: TheaterFetch = fetch
): Promise<TheaterFieldPayload | null> {
  try {
    const res = await fetchImpl(`/api/v1/theater/field?gender=${gender}`)
    if (!res.ok) return null
    const json = (await res.json()) as Record<string, unknown> | null
    if (!json || typeof json !== 'object' || !Array.isArray(json.cells)) return null
    const cells = json.cells.filter(isCountRow)
    if (cells.length === 0) return null
    return {
      gender,
      matchesCovered: typeof json.matchesCovered === 'number' ? json.matchesCovered : 0,
      minSample: typeof json.minSample === 'number' ? json.minSample : STORY_MIN_SAMPLE,
      cells,
    }
  } catch {
    return null
  }
}

/** The universe a match belongs to — same resolution as story/river. */
export function theaterGender(match: MatchDetails): 'M' | 'F' {
  return getLeagueAccent(match.leagueId || match.league).gender
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

export function buildTheaterField(
  match: MatchDetails,
  payload: TheaterFieldPayload | null
): TheaterData | null {
  if (!payload) return null

  // Structural gates — identical to the river's, in the same order.
  if (match.home_score === null || match.away_score === null) return null

  const annotated = reconstructTimeline(match)
  if (annotated === null || annotated.length === 0) return null

  const last = annotated[annotated.length - 1]
  if (last.scoreAfter.home !== match.home_score || last.scoreAfter.away !== match.away_score) {
    return null
  }

  // A path with no score change never leaves its ridge — nothing to show in 3D.
  if (!annotated.some((b) => GOAL_TYPES.has(b.type))) return null

  // 1) The surface: every counted cell, keyed for lookup.
  const byKey = new Map<string, TheaterCell>()
  const cells: TheaterCell[] = []
  for (const row of payload.cells) {
    if (row.n < STORY_MIN_SAMPLE) continue
    if (row.diff < THEATER_DIFF_MIN || row.diff > THEATER_DIFF_MAX) continue
    if (row.minute < 0 || row.minute > THEATER_BUCKET_MAX) continue
    if (row.minute % THEATER_BUCKET_STEP !== 0) continue
    const cell: TheaterCell = {
      ...row,
      pHome: row.w / row.n,
      pDraw: row.d / row.n,
      pAway: row.l / row.n,
    }
    byKey.set(cellKey(row.diff, row.minute), cell)
    cells.push(cell)
  }
  if (cells.length < THEATER_MIN_SURFACE_CELLS) return null
  cells.sort((a, b) => a.diff - b.diff || a.minute - b.minute)

  // 2) Constant-(difference, score) pieces on the chart axis.
  const pieces: Array<{ x0: number; x1: number; diff: number; home: number; away: number }> = []
  const rawEvents: Array<{
    x: number
    beat: (typeof annotated)[number]
  }> = []
  let cursor = 0
  let diff = 0
  let home = 0
  let away = 0
  for (const b of annotated) {
    const x = riverChartX(b.minute, b.addedTime)
    if (x > cursor) pieces.push({ x0: cursor, x1: x, diff, home, away })
    cursor = Math.max(cursor, x)
    // The artifact pools 3+ leads, so a fourth goal keeps the same ridge —
    // the path must not step onto a row the counts do not have.
    diff = clampDiff(b.diffAfter)
    home = b.scoreAfter.home
    away = b.scoreAfter.away
    rawEvents.push({ x, beat: b })
  }
  if (cursor < THEATER_DOMAIN_MAX) {
    pieces.push({ x0: cursor, x1: THEATER_DOMAIN_MAX, diff, home, away })
  }

  // 3) Split at 5-minute boundaries — the only other place the height changes.
  const split: Array<{
    x0: number
    x1: number
    diff: number
    bucket: number
    home: number
    away: number
  }> = []
  for (const p of pieces) {
    let a = p.x0
    while (a < p.x1) {
      const bucket = bucketAtChartX(a)
      const boundary = bucket >= THEATER_BUCKET_MAX ? THEATER_DOMAIN_MAX : bucket + THEATER_BUCKET_STEP
      const b = Math.min(p.x1, boundary)
      split.push({ x0: a, x1: b, diff: p.diff, bucket, home: p.home, away: p.away })
      a = b
    }
  }

  // 4) Merge neighbours that share a cell AND a score: a clamped goal (+3 to
  //    +4) moves neither the height nor the key, so no step may be drawn — but
  //    the readout must still show the score that was actually on the board.
  const merged: typeof split = []
  for (const s of split) {
    const prev = merged[merged.length - 1]
    if (
      prev &&
      prev.diff === s.diff &&
      prev.bucket === s.bucket &&
      prev.home === s.home &&
      prev.away === s.away &&
      prev.x1 === s.x0
    ) {
      prev.x1 = s.x1
    } else {
      merged.push({ ...s })
    }
  }

  // 5) The path's own gate: every run must rest on a counted cell.
  const spans: TheaterSpan[] = []
  let minN = Number.POSITIVE_INFINITY
  for (const s of merged) {
    const cell = byKey.get(cellKey(s.diff, s.bucket))
    if (!cell) return null
    minN = Math.min(minN, cell.n)
    spans.push({
      x0: s.x0,
      x1: s.x1,
      diff: s.diff,
      bucket: s.bucket,
      pHome: cell.pHome,
      n: cell.n,
      home: s.home,
      away: s.away,
    })
  }
  if (spans.length === 0) return null

  // 6) Events, with the heights either side of the step where both are counted.
  const events: TheaterEvent[] = rawEvents.map(({ x, beat }) => {
    const bucket = minuteBucket(beat.effectiveMinute)
    const diffBefore = clampDiff(beat.diffBefore)
    const diffAfter = clampDiff(beat.diffAfter)
    const before = byKey.get(cellKey(diffBefore, bucket))
    const after = byKey.get(cellKey(diffAfter, bucket))
    return {
      x,
      minute: beat.minute,
      ...(beat.addedTime !== undefined ? { addedTime: beat.addedTime } : {}),
      type: beat.type,
      team: beat.team,
      player: beat.player,
      scoreAfter: beat.scoreAfter,
      ...(before && after && diffBefore !== diffAfter
        ? { pBefore: before.pHome, pAfter: after.pHome }
        : {}),
    }
  })

  return {
    gender: payload.gender,
    cells,
    spans,
    events,
    minN,
    matchesCovered: payload.matchesCovered,
    domainMax: THEATER_DOMAIN_MAX,
    finalScore: { home: match.home_score, away: match.away_score },
  }
}
