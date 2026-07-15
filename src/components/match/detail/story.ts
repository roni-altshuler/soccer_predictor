import { getLeagueAccent } from '@/lib/leagueAccents'

import type { MatchDetails } from './types'

/**
 * Story builder — Phase 0 Story Compiler (docs/VISION_2030.md §3.3, §11).
 *
 * Turns a FINISHED match into acts and beats where every number is an exact
 * count from the rarity artifact (`/api/v1/rarity`): at each score change the
 * home side's (score diff, 5-minute bucket) state maps to historical
 * {w,d,l}/n outcome counts, and the goal's Δ in historical win rate — a
 * difference of two counted rates, never a model — is the beat's receipt.
 *
 * Honesty rules, in order of severity:
 * - If the goal events do not reproduce the final score, there is NO story
 *   (`coverage: 'none'`) — a minute-level narrative over an unverified
 *   timeline would be a guess.
 * - A beat's Δ renders only when BOTH states were counted at least
 *   {@link STORY_MIN_SAMPLE} times; below that the beat keeps its factual
 *   sentence but carries no rate claim.
 * - The largest |Δ| is labelled "turning point" only when it clears
 *   {@link TURNING_POINT_MIN_DELTA} — never stretch for drama.
 * - If no goal beat has a usable Δ (thin artifact — e.g. the women's keys
 *   before their backfill lands), coverage is 'none' and the caller renders
 *   nothing: without receipts the story is just the timeline restated.
 *
 * Act headers are template-built from countable facts only (goal counts,
 * spans, score transitions). No LLM, no adjectives beyond what was counted.
 */

/** Below this sample size a historical rate is too thin to cite (mirrors RARITY_MIN_SAMPLE). */
export const STORY_MIN_SAMPLE = 50

/** Minimum |Δ win rate| (as a fraction) for the "turning point" label: 15 percentage points. */
export const TURNING_POINT_MIN_DELTA = 0.15

/** An opening/closing stretch shorter than this is folded into the neighbouring act. */
const QUIET_ACT_MIN_MINUTES = 20

/** Beats further apart than this start a new act. */
const ACT_GAP_MINUTES = 15

// The artifact's key grid. Restated from `src/lib/rarity.ts` (and
// `backend/scripts/build_rarity.py`) because that module is server-only —
// it reads the filesystem and must never enter a client bundle.
const DIFF_MIN = -3
const DIFF_MAX = 3
const BUCKET_MAX = 90

/** Score-changing event types — shared with `momentum.ts` (the river reuses this pipeline). */
export const GOAL_TYPES = new Set(['goal', 'own_goal', 'penalty_goal'])

/** Floor a raw minute onto the 5-minute state grid; 90+ (incl. ET) → 90. */
export function minuteBucket(minute: number): number {
  if (!Number.isFinite(minute) || minute <= 0) return 0
  return Math.min(BUCKET_MAX, Math.floor(minute / 5) * 5)
}

/** Clamp a score difference to the artifact's [-3, +3] key space. */
export function clampDiff(diff: number): number {
  if (!Number.isFinite(diff)) return 0
  return Math.max(DIFF_MIN, Math.min(DIFF_MAX, Math.trunc(diff)))
}

/** Canonical artifact key — matches src/lib/rarity.ts `rarityKey`. */
export function storyStateKey(gender: 'M' | 'F', diff: number, minute: number): string {
  return `${gender}:${clampDiff(diff)}:${minuteBucket(minute)}`
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export type StoryCoverage = 'full' | 'partial' | 'none'

export type StoryBeatType = 'goal' | 'own_goal' | 'penalty_goal' | 'red_card'

/** Exact-count receipts behind a beat's Δ — every field is a warehouse count. */
export interface StoryRates {
  /** Historical win rate (fraction) for the home side's state before the beat. */
  before: number
  /** Historical win rate (fraction) for the home side's state after the beat. */
  after: number
  n_before: number
  n_after: number
  w_before: number
  w_after: number
}

export interface StoryBeat {
  minute: number
  addedTime?: number
  type: StoryBeatType
  player: string
  team: 'home' | 'away'
  scoreAfter: { home: number; away: number }
  /**
   * Signed Δ in the HOME side's historical win rate (fraction). Present only
   * when both states cleared {@link STORY_MIN_SAMPLE} and the beat actually
   * flipped the artifact's state key (red cards never do — the key space has
   * no player-count axis; a Δ of 0 from an identical key is not a count).
   */
  deltaWinRate?: number
  rates?: StoryRates
}

export interface StoryAct {
  /** Factual one-line header, template-built from countable facts. */
  header: string
  beats: StoryBeat[]
}

export interface StoryBeatRef {
  actIndex: number
  beatIndex: number
}

export interface MatchStory {
  acts: StoryAct[]
  turningPoint?: StoryBeatRef
  coverage: StoryCoverage
}

/** Minimal fetch shape so tests can inject a mock without faking a Response. */
export type StoryFetch = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>

const NO_STORY: MatchStory = { acts: [], coverage: 'none' }

// ---------------------------------------------------------------------------
// Timeline reconstruction
// ---------------------------------------------------------------------------

/**
 * A state-changing event with its running score and home-diff transition.
 * Exported for `momentum.ts` — the river builds on the identical timeline.
 */
export interface AnnotatedBeat {
  type: StoryBeatType
  minute: number
  addedTime?: number
  /** Chronological minute: base + added time (45+3 → 48; used for buckets/gaps). */
  effectiveMinute: number
  player: string
  team: 'home' | 'away'
  scoreAfter: { home: number; away: number }
  /** Home-perspective score diff before/after this beat. */
  diffBefore: number
  diffAfter: number
}

/**
 * State-changing events (goals + red cards) in true chronological order,
 * annotated with the running score. Ordering is lexicographic on
 * (minute, addedTime): a 45+3 goal happened before a 46' goal even though its
 * effective minute (48) is later — first-half stoppage runs before the second
 * half kicks off. Returns null when any event can't be placed on the clock.
 * Exported for `momentum.ts` so story and river never disagree on a timeline.
 */
export function reconstructTimeline(match: MatchDetails): AnnotatedBeat[] | null {
  const picked: Array<Omit<AnnotatedBeat, 'scoreAfter' | 'diffBefore' | 'diffAfter'>> = []
  for (const e of match.events) {
    const type = e.type as string
    if (!GOAL_TYPES.has(type) && type !== 'red_card') continue
    const minute = Number(e.minute)
    const addedTime = e.addedTime != null ? Number(e.addedTime) : undefined
    if (!Number.isFinite(minute) || (addedTime !== undefined && !Number.isFinite(addedTime))) {
      // An unplaceable state change poisons every downstream minute claim.
      return null
    }
    picked.push({
      type: type as StoryBeatType,
      minute,
      ...(addedTime !== undefined ? { addedTime } : {}),
      effectiveMinute: minute + (addedTime ?? 0),
      player: e.player,
      team: e.team,
    })
  }
  picked.sort((a, b) => a.minute - b.minute || (a.addedTime ?? 0) - (b.addedTime ?? 0))

  const annotated: AnnotatedBeat[] = []
  let home = 0
  let away = 0
  for (const e of picked) {
    const diffBefore = home - away
    if (GOAL_TYPES.has(e.type)) {
      // Goals are credited to the SCORING side — the payload already
      // attributes own goals to the side whose score increments.
      if (e.team === 'home') home += 1
      else away += 1
    }
    annotated.push({ ...e, scoreAfter: { home, away }, diffBefore, diffAfter: home - away })
  }
  return annotated
}

// ---------------------------------------------------------------------------
// Rate fetching — one request per DISTINCT state the match passed through
// ---------------------------------------------------------------------------

interface StateCounts {
  n: number
  w: number
}

async function fetchDistinctRates(
  gender: 'M' | 'F',
  states: Array<{ diff: number; minute: number }>,
  fetchImpl: StoryFetch
): Promise<Map<string, StateCounts>> {
  const byKey = new Map<string, { diff: number; minute: number }>()
  for (const s of states) {
    const key = storyStateKey(gender, s.diff, s.minute)
    if (!byKey.has(key)) byKey.set(key, s)
  }

  const rates = new Map<string, StateCounts>()
  await Promise.all(
    [...byKey.entries()].map(async ([key, s]) => {
      try {
        const res = await fetchImpl(
          `/api/v1/rarity?gender=${gender}&diff=${clampDiff(s.diff)}&minute=${minuteBucket(s.minute)}`
        )
        if (!res.ok) return
        const json = (await res.json()) as Partial<StateCounts> | null
        if (json && typeof json.n === 'number' && typeof json.w === 'number') {
          rates.set(key, { n: json.n, w: json.w })
        }
      } catch {
        // Missing artifact / offline — the beat simply keeps no rate claim.
      }
    })
  )
  return rates
}

// ---------------------------------------------------------------------------
// Act headers — countable facts only, template-built
// ---------------------------------------------------------------------------

const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
  'nineteen', 'twenty',
]

function numberWord(n: number): string {
  return n >= 0 && n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : String(n)
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function teamName(match: MatchDetails, side: 'home' | 'away'): string {
  return side === 'home' ? match.home_team : match.away_team
}

/** Header for an act containing exactly one goal — a score-transition fact. */
function singleGoalHeader(match: MatchDetails, g: AnnotatedBeat): string {
  const scorer = g.team
  const own = scorer === 'home' ? g.scoreAfter.home : g.scoreAfter.away
  const opp = scorer === 'home' ? g.scoreAfter.away : g.scoreAfter.home
  const min = g.minute
  if (own === opp) return `Level at ${own}-${opp} after ${min} minutes`
  if (own > opp) {
    return g.diffBefore === 0
      ? `${teamName(match, scorer)} ahead after ${min} minutes`
      : `${teamName(match, scorer)} ${own}-${opp} up after ${min} minutes`
  }
  return `${teamName(match, scorer)} pull one back after ${min} minutes`
}

/**
 * Header for a beat cluster. `redsBefore` is the per-side red-card count
 * entering the cluster, so "down to ten/nine" states a counted fact.
 */
function clusterHeader(
  match: MatchDetails,
  cluster: AnnotatedBeat[],
  redsBefore: { home: number; away: number }
): string {
  const goals = cluster.filter((b) => GOAL_TYPES.has(b.type))
  const reds = cluster.filter((b) => b.type === 'red_card')

  if (goals.length === 0) {
    if (reds.length === 1) {
      const side = reds[0].team
      const remaining = 11 - (redsBefore[side] + 1)
      return `${teamName(match, side)} down to ${numberWord(remaining)} after ${reds[0].minute} minutes`
    }
    const span = Math.max(1, cluster[cluster.length - 1].effectiveMinute - cluster[0].effectiveMinute)
    return `${capitalize(numberWord(reds.length))} red cards in ${numberWord(span)} minutes`
  }

  if (goals.length === 1) return singleGoalHeader(match, goals[0])

  const span = Math.max(1, goals[goals.length - 1].effectiveMinute - goals[0].effectiveMinute)
  const firstHalf = goals.every((g) => g.minute <= 45)
  const secondHalf = goals.every((g) => g.minute > 45)
  const halfWord = firstHalf ? ' first-half' : secondHalf ? ' second-half' : ''
  const redsPart =
    reds.length === 1 ? ' and a red card' : reds.length > 1 ? ` and ${numberWord(reds.length)} red cards` : ''
  return `${capitalize(numberWord(goals.length))} goals${redsPart} in ${numberWord(span)}${halfWord} minutes`
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

export async function buildMatchStory(
  match: MatchDetails,
  fetchImpl: StoryFetch = fetch
): Promise<MatchStory> {
  if (match.home_score === null || match.away_score === null) return NO_STORY

  const annotated = reconstructTimeline(match)
  if (annotated === null) return NO_STORY

  // Integrity guard (same convention as RarityStamp): the goal events must
  // reproduce the final score exactly, or there is no story at all.
  const last = annotated[annotated.length - 1]
  const finalReconstructed = last?.scoreAfter ?? { home: 0, away: 0 }
  if (finalReconstructed.home !== match.home_score || finalReconstructed.away !== match.away_score) {
    return NO_STORY
  }

  // A match with no state-changing events has no beats to narrate — silence,
  // never filler (the page's timeline already shows the nothing that happened).
  if (annotated.length === 0) return NO_STORY

  const gender = getLeagueAccent(match.leagueId || match.league).gender

  // Batch the distinct states goal beats pass through (red cards don't move
  // on the artifact's grid, so they contribute no lookups).
  const wanted: Array<{ diff: number; minute: number }> = []
  for (const b of annotated) {
    if (!GOAL_TYPES.has(b.type)) continue
    wanted.push({ diff: b.diffBefore, minute: b.effectiveMinute })
    wanted.push({ diff: b.diffAfter, minute: b.effectiveMinute })
  }
  const rates = await fetchDistinctRates(gender, wanted, fetchImpl)

  // Beats, with Δ receipts wherever the counts allow them.
  const beats: StoryBeat[] = annotated.map((b) => {
    const beat: StoryBeat = {
      minute: b.minute,
      ...(b.addedTime !== undefined ? { addedTime: b.addedTime } : {}),
      type: b.type,
      player: b.player,
      team: b.team,
      scoreAfter: b.scoreAfter,
    }
    if (!GOAL_TYPES.has(b.type)) return beat

    const keyBefore = storyStateKey(gender, b.diffBefore, b.effectiveMinute)
    const keyAfter = storyStateKey(gender, b.diffAfter, b.effectiveMinute)
    // A goal from +3 to +4 clamps onto the same key: the artifact pools 3+
    // leads, so there is no counted flip to cite for this beat.
    if (keyBefore === keyAfter) return beat

    const before = rates.get(keyBefore)
    const after = rates.get(keyAfter)
    if (!before || !after || before.n < STORY_MIN_SAMPLE || after.n < STORY_MIN_SAMPLE) return beat

    const rateBefore = before.w / before.n
    const rateAfter = after.w / after.n
    beat.deltaWinRate = rateAfter - rateBefore
    beat.rates = {
      before: rateBefore,
      after: rateAfter,
      n_before: before.n,
      n_after: after.n,
      w_before: before.w,
      w_after: after.w,
    }
    return beat
  })

  // Coverage: how many GOAL beats carry receipts. No receipts → no story.
  const goalBeats = beats.filter((b) => b.type !== 'red_card')
  const withDelta = goalBeats.filter((b) => b.deltaWinRate !== undefined).length
  if (withDelta === 0) return NO_STORY
  const coverage: StoryCoverage = withDelta === goalBeats.length ? 'full' : 'partial'

  // Acts: optional opening quiet stretch → beat clusters (a gap over
  // ACT_GAP_MINUTES starts a new act) → optional closing quiet stretch.
  const clusters: Array<{ start: number; items: AnnotatedBeat[] }> = []
  annotated.forEach((e, i) => {
    const current = clusters[clusters.length - 1]
    if (current && e.effectiveMinute - current.items[current.items.length - 1].effectiveMinute <= ACT_GAP_MINUTES) {
      current.items.push(e)
    } else {
      clusters.push({ start: i, items: [e] })
    }
  })

  const acts: StoryAct[] = []
  const refByBeatIndex = new Map<number, StoryBeatRef>()

  const first = annotated[0]
  if (first.effectiveMinute >= QUIET_ACT_MIN_MINUTES) {
    acts.push({ header: `Nothing separated them for ${first.minute} minutes`, beats: [] })
  }

  const redsSoFar = { home: 0, away: 0 }
  for (const cluster of clusters) {
    const header = clusterHeader(match, cluster.items, redsSoFar)
    for (const e of cluster.items) {
      if (e.type === 'red_card') redsSoFar[e.team] += 1
    }
    const actIndex = acts.length
    const actBeats = cluster.items.map((_, i) => {
      refByBeatIndex.set(cluster.start + i, { actIndex, beatIndex: i })
      return beats[cluster.start + i]
    })
    acts.push({ header, beats: actBeats })
  }

  const closing = 90 - last.effectiveMinute
  if (closing >= QUIET_ACT_MIN_MINUTES) {
    acts.push({ header: `No goals in the final ${closing} minutes`, beats: [] })
  }

  // Turning point: largest |Δ| among receipted beats, labelled only past the
  // threshold — never stretch for drama. Ties go to the earlier beat.
  let turningPoint: StoryBeatRef | undefined
  let bestAbs = 0
  beats.forEach((b, i) => {
    if (b.deltaWinRate === undefined) return
    if (Math.abs(b.deltaWinRate) > bestAbs) {
      bestAbs = Math.abs(b.deltaWinRate)
      turningPoint = refByBeatIndex.get(i)
    }
  })
  if (bestAbs < TURNING_POINT_MIN_DELTA) turningPoint = undefined

  return { acts, ...(turningPoint ? { turningPoint } : {}), coverage }
}
