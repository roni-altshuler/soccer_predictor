import { getLeagueAccent } from '@/lib/leagueAccents'

import {
  GOAL_TYPES,
  STORY_MIN_SAMPLE,
  TURNING_POINT_MIN_DELTA,
  clampDiff,
  minuteBucket,
  reconstructTimeline,
  storyStateKey,
  type StoryFetch,
} from './story'
import type { MatchDetails } from './types'

/**
 * Momentum river builder — the stacked empirical outcome bands behind
 * `MomentumRiver.tsx` (docs/VISION_2030.md §3.3; sibling of `story.ts`).
 *
 * From the HOME side's perspective, every instant of a finished match is an
 * artifact state `<gender>:<scoreDiff>:<5-minute bucket>` whose exact
 * historical {w, d, l}/n counts ARE the win/draw/loss probabilities. The
 * river is that step function over the match clock: it changes ONLY where
 * the underlying counts change — at score-changing events and at 5-minute
 * bucket boundaries — and is rendered exactly as steps, never smoothed into
 * a fake continuous evolution.
 *
 * It reuses `story.ts`'s pipeline wholesale: the same timeline reconstruction
 * (lexicographic (minute, addedTime) ordering, own goals credited to the
 * scoring side), the same key grid (`storyStateKey`), the same rarity API,
 * and the same honesty gates:
 * - final score missing, an unplaceable event, or events that do not
 *   reproduce the final score → null (never a guessed curve);
 * - no goal events → null (mirrors the story's "nothing to narrate");
 * - red cards and clamped goals (+3 → +4) do not move on the key grid, so
 *   the bands do NOT step there — only the event marker is drawn;
 * - every rendered span must be backed by n ≥ {@link STORY_MIN_SAMPLE}
 *   counted matches; a single thin span sinks the whole river (a band with
 *   an interpolated hole would be a fabrication).
 *
 * Added time follows story.ts: buckets come from the effective minute
 * (45+3 → 48 → bucket 45), and the chart x-axis pins first-half stoppage at
 * 45 while second-half stoppage spreads into a presentational "90+" zone
 * ([90, {@link RIVER_DOMAIN_MAX}]) that renders the artifact's terminal 90
 * bucket — the zone's width is presentation; its counts are not.
 */

/** Chart domain end: 90 regulation minutes + a 5-unit presentational "90+" zone. */
export const RIVER_DOMAIN_MAX = 95

/** One constant-probability span of the river. Fractions are exact w/d/l over n. */
export interface RiverSegment {
  /** Chart-minute span [x0, x1) — see {@link riverChartX} for the axis. */
  x0: number
  x1: number
  /** Artifact key backing this span (gender:diff:bucket). */
  key: string
  pHome: number
  pDraw: number
  pAway: number
  /** Exact counts behind the fractions. */
  n: number
  w: number
  d: number
  l: number
}

export interface RiverMarker {
  /** Chart-minute position (added time normalized — 45+3 → 45, 90+4 → 94). */
  x: number
  minute: number
  addedTime?: number
  type: 'goal' | 'own_goal' | 'penalty_goal' | 'red_card'
  team: 'home' | 'away'
  player: string
  scoreAfter: { home: number; away: number }
}

/** The story's turning point restated on the river's axis (same Δ rule). */
export interface RiverTurningPoint {
  x: number
  minute: number
  addedTime?: number
  scoreAfter: { home: number; away: number }
  /** Signed Δ in the home side's historical win rate across the goal. */
  deltaWinRate: number
}

export interface MomentumRiverData {
  segments: RiverSegment[]
  markers: RiverMarker[]
  turningPoint?: RiverTurningPoint
  /** x-axis domain end ({@link RIVER_DOMAIN_MAX}). */
  domainMax: number
  /** Smallest sample size across the rendered spans (always ≥ STORY_MIN_SAMPLE). */
  minN: number
  /** Corpus size reported by the artifact (0 when the API omits it). */
  matchesCovered: number
}

interface StateCounts {
  n: number
  w: number
  d: number
  l: number
  matches_covered?: number
}

/**
 * Map a clock position onto the chart axis: first-half stoppage pins at 45
 * (a 45+3 goal renders at HT, before a 46' goal at 46 — same chronology as
 * story.ts's lexicographic ordering), second-half stoppage and extra time
 * clamp into the [90, RIVER_DOMAIN_MAX] "90+" zone.
 */
export function riverChartX(minute: number, addedTime?: number): number {
  const effective = minute + (addedTime ?? 0)
  if (minute <= 45) return Math.min(effective, 45)
  return Math.min(effective, RIVER_DOMAIN_MAX)
}

/** Bucket for a chart minute: regulation floors onto the 5-grid, the 90+ zone is bucket 90. */
function bucketAtChartX(x: number): number {
  return minuteBucket(Math.min(x, 90))
}

async function fetchDistinctCounts(
  gender: 'M' | 'F',
  states: Array<{ diff: number; minute: number }>,
  fetchImpl: StoryFetch
): Promise<Map<string, StateCounts>> {
  const byKey = new Map<string, { diff: number; minute: number }>()
  for (const s of states) {
    const key = storyStateKey(gender, s.diff, s.minute)
    if (!byKey.has(key)) byKey.set(key, s)
  }

  const counts = new Map<string, StateCounts>()
  await Promise.all(
    [...byKey.entries()].map(async ([key, s]) => {
      try {
        const res = await fetchImpl(
          `/api/v1/rarity?gender=${gender}&diff=${clampDiff(s.diff)}&minute=${minuteBucket(s.minute)}`
        )
        if (!res.ok) return
        const json = (await res.json()) as Partial<StateCounts> | null
        if (
          json &&
          typeof json.n === 'number' &&
          typeof json.w === 'number' &&
          typeof json.d === 'number' &&
          typeof json.l === 'number'
        ) {
          counts.set(key, {
            n: json.n,
            w: json.w,
            d: json.d,
            l: json.l,
            ...(typeof json.matches_covered === 'number'
              ? { matches_covered: json.matches_covered }
              : {}),
          })
        }
      } catch {
        // Missing artifact / offline — the gate below returns null.
      }
    })
  )
  return counts
}

export async function buildMomentumRiver(
  match: MatchDetails,
  fetchImpl: StoryFetch = fetch
): Promise<MomentumRiverData | null> {
  // Structural gates — identical to buildMatchStory's, in the same order.
  if (match.home_score === null || match.away_score === null) return null

  const annotated = reconstructTimeline(match)
  if (annotated === null || annotated.length === 0) return null

  const last = annotated[annotated.length - 1]
  if (last.scoreAfter.home !== match.home_score || last.scoreAfter.away !== match.away_score) {
    return null
  }

  // Mirror the story's "no goal beats → nothing": a red-cards-only match has
  // no state flips on the artifact grid, so a river would just restate drift.
  if (!annotated.some((b) => GOAL_TYPES.has(b.type))) return null

  const gender = getLeagueAccent(match.leagueId || match.league).gender

  // 1) Constant-diff pieces on the chart axis. Zero-width pieces (an event at
  //    kickoff, two events at the same chart x) render nothing and are dropped.
  const pieces: Array<{ x0: number; x1: number; diff: number }> = []
  const markers: RiverMarker[] = []
  let cursor = 0
  let diff = 0
  for (const b of annotated) {
    const x = riverChartX(b.minute, b.addedTime)
    if (x > cursor) pieces.push({ x0: cursor, x1: x, diff })
    cursor = Math.max(cursor, x)
    diff = b.diffAfter
    markers.push({
      x,
      minute: b.minute,
      ...(b.addedTime !== undefined ? { addedTime: b.addedTime } : {}),
      type: b.type,
      team: b.team,
      player: b.player,
      scoreAfter: b.scoreAfter,
    })
  }
  if (cursor < RIVER_DOMAIN_MAX) pieces.push({ x0: cursor, x1: RIVER_DOMAIN_MAX, diff })

  // 2) Split each piece at 5-minute bucket boundaries — the only other place
  //    the underlying counts (and therefore the bands) are allowed to change.
  const spans: Array<{ x0: number; x1: number; diff: number; bucket: number }> = []
  for (const p of pieces) {
    let a = p.x0
    while (a < p.x1) {
      const bucket = bucketAtChartX(a)
      const boundary = bucket >= 90 ? RIVER_DOMAIN_MAX : bucket + 5
      const b = Math.min(p.x1, boundary)
      spans.push({ x0: a, x1: b, diff: p.diff, bucket })
      a = b
    }
  }

  // 3) Merge adjacent spans that share a key: red cards and clamped goals
  //    (+3 → +4) change nothing on the grid, so no step may be drawn there.
  const merged: Array<{ x0: number; x1: number; diff: number; bucket: number; key: string }> = []
  for (const s of spans) {
    const key = storyStateKey(gender, s.diff, s.bucket)
    const prev = merged[merged.length - 1]
    if (prev && prev.key === key && prev.x1 === s.x0) {
      prev.x1 = s.x1
    } else {
      merged.push({ ...s, key })
    }
  }

  // 4) Goal transitions for the turning point — story.ts's exact semantics:
  //    keys at the goal's effective minute, no Δ when clamping collapses them.
  const transitions = annotated
    .filter((b) => GOAL_TYPES.has(b.type))
    .map((b) => ({
      beat: b,
      keyBefore: storyStateKey(gender, b.diffBefore, b.effectiveMinute),
      keyAfter: storyStateKey(gender, b.diffAfter, b.effectiveMinute),
      before: { diff: b.diffBefore, minute: b.effectiveMinute },
      after: { diff: b.diffAfter, minute: b.effectiveMinute },
    }))

  const wanted: Array<{ diff: number; minute: number }> = [
    ...merged.map((s) => ({ diff: s.diff, minute: s.bucket })),
    ...transitions.flatMap((t) => [t.before, t.after]),
  ]
  const counts = await fetchDistinctCounts(gender, wanted, fetchImpl)

  // 5) The river's own honesty gate: EVERY rendered span must be counted at
  //    least STORY_MIN_SAMPLE times. One thin span → no river at all.
  const segments: RiverSegment[] = []
  let minN = Number.POSITIVE_INFINITY
  let matchesCovered = 0
  for (const s of merged) {
    const c = counts.get(s.key)
    if (!c || c.n < STORY_MIN_SAMPLE) return null
    minN = Math.min(minN, c.n)
    matchesCovered = Math.max(matchesCovered, c.matches_covered ?? 0)
    segments.push({
      x0: s.x0,
      x1: s.x1,
      key: s.key,
      pHome: c.w / c.n,
      pDraw: c.d / c.n,
      pAway: c.l / c.n,
      n: c.n,
      w: c.w,
      d: c.d,
      l: c.l,
    })
  }
  if (segments.length === 0) return null

  // 6) Turning point — largest receipted |Δ| past the story's threshold,
  //    ties to the earlier goal (strict > keeps the first).
  let turningPoint: RiverTurningPoint | undefined
  let bestAbs = 0
  for (const t of transitions) {
    if (t.keyBefore === t.keyAfter) continue
    const before = counts.get(t.keyBefore)
    const after = counts.get(t.keyAfter)
    if (!before || !after || before.n < STORY_MIN_SAMPLE || after.n < STORY_MIN_SAMPLE) continue
    const delta = after.w / after.n - before.w / before.n
    if (Math.abs(delta) > bestAbs) {
      bestAbs = Math.abs(delta)
      turningPoint = {
        x: riverChartX(t.beat.minute, t.beat.addedTime),
        minute: t.beat.minute,
        ...(t.beat.addedTime !== undefined ? { addedTime: t.beat.addedTime } : {}),
        scoreAfter: t.beat.scoreAfter,
        deltaWinRate: delta,
      }
    }
  }
  if (bestAbs < TURNING_POINT_MIN_DELTA) turningPoint = undefined

  return {
    segments,
    markers,
    ...(turningPoint ? { turningPoint } : {}),
    domainMax: RIVER_DOMAIN_MAX,
    minN,
    matchesCovered,
  }
}
