/**
 * Ask Pitchverse (Almanac v1) — the constrained intent schema.
 *
 * This module is the *definition of what we can honestly answer*. A natural-
 * language question is only "supported" if it maps cleanly onto an `AskIntent`;
 * anything that doesn't is refused rather than guessed. Every field here is a
 * knob the committed exact-count artifact (`backend/data/rarity/state_outcomes
 * .json`) is keyed on — so a valid intent always resolves to a real tally.
 *
 * Pure: React-free and filesystem-free, so it is importable by the client page,
 * the Node API route, and the unit tests alike. The `clampDiff`/`minuteBucket`
 * grammar mirrors, exactly, `@/lib/rarity` and `almanac/query.ts` (the codebase
 * keeps three synchronized copies on purpose — the fs-bound one can't reach the
 * client, and this one must stay dependency-free). If the artifact key grammar
 * changes, change it in all places.
 */

/** Universe of play. Mirrors `RarityGender` in `@/lib/rarity`. */
export type Universe = 'M' | 'F'

/**
 * Which figure the question puts in the spotlight. The compute always returns
 * the full W/D/L split; `outcome` only decides which number is the headline and
 * which verb the narration uses.
 *
 * - `win`          — the queried side went on to win (comeback / held-lead-to-win).
 * - `avoid_defeat` — won OR drew (stayed unbeaten / at least a point).
 * - `draw`         — the match finished level.
 * - `loss`         — the queried side went on to lose (threw it away / stayed down).
 */
export type AskOutcome = 'win' | 'avoid_defeat' | 'draw' | 'loss'

export const ASK_OUTCOMES: readonly AskOutcome[] = ['win', 'avoid_defeat', 'draw', 'loss']

/** A fully-specified, answerable question. */
export interface AskIntent {
  gender: Universe
  /** Queried side's score difference (negative = trailing), clamped to [-3, 3]. */
  diff: number
  /** Minute floored onto the 5-minute state grid, [0, 90]. */
  minute: number
  /** Which outcome the answer leads with. */
  outcome: AskOutcome
}

export const DIFF_MIN = -3
export const DIFF_MAX = 3
export const MINUTE_STEP = 5
export const MINUTE_MAX = 90

/** Below this sample size a claim is too thin to state without a caveat. */
export const THIN_SAMPLE = 50

/** Every 5-minute grid point the artifact counts on: 0, 5, …, 90. */
export const MINUTE_OPTIONS: number[] = Array.from(
  { length: MINUTE_MAX / MINUTE_STEP + 1 },
  (_, i) => i * MINUTE_STEP
)

/** Floor a raw minute onto the 5-minute state grid; 90+ (incl. ET) → 90. */
export function minuteBucket(minute: number): number {
  if (!Number.isFinite(minute) || minute <= 0) return 0
  return Math.min(MINUTE_MAX, Math.floor(minute / MINUTE_STEP) * MINUTE_STEP)
}

/** Clamp a score difference to the artifact's [-3, +3] key space. */
export function clampDiff(diff: number): number {
  if (!Number.isFinite(diff)) return 0
  return Math.max(DIFF_MIN, Math.min(DIFF_MAX, Math.trunc(diff)))
}

export function isUniverse(v: unknown): v is Universe {
  return v === 'M' || v === 'F'
}

export function isAskOutcome(v: unknown): v is AskOutcome {
  return typeof v === 'string' && (ASK_OUTCOMES as readonly string[]).includes(v)
}

/** Canonical artifact key — must match `rarityKey` in `@/lib/rarity`. */
export function intentKey(intent: AskIntent): string {
  return `${intent.gender}:${clampDiff(intent.diff)}:${minuteBucket(intent.minute)}`
}

/**
 * Coerce a loosely-typed candidate (from the LLM parse or a URL) into a valid,
 * on-grid `AskIntent`, or `null` when it can't be trusted. Never throws.
 */
export function normalizeIntent(raw: {
  gender?: unknown
  diff?: unknown
  minute?: unknown
  outcome?: unknown
}): AskIntent | null {
  const g = typeof raw.gender === 'string' ? raw.gender.trim().toUpperCase() : ''
  const gender: Universe | null =
    g === 'F' || g === 'WOMEN' || g === 'W' ? 'F' : g === 'M' || g === 'MEN' ? 'M' : null
  if (gender === null) return null

  const diffN = typeof raw.diff === 'number' ? raw.diff : Number.parseInt(String(raw.diff ?? ''), 10)
  const minuteN =
    typeof raw.minute === 'number' ? raw.minute : Number.parseInt(String(raw.minute ?? ''), 10)
  if (!Number.isFinite(diffN) || !Number.isFinite(minuteN)) return null

  const outcome: AskOutcome = isAskOutcome(raw.outcome) ? raw.outcome : 'win'

  return {
    gender,
    diff: clampDiff(diffN),
    minute: minuteBucket(minuteN),
    outcome,
  }
}

/**
 * The example questions that seed the input's chips and the honest-failure
 * suggestions. Each is a real, in-domain phrasing that the deterministic parser
 * resolves with no LLM key — so the "here's what I *can* answer" list is never
 * aspirational.
 */
export interface ExampleQuestion {
  id: string
  text: string
}

export const EXAMPLE_QUESTIONS: ExampleQuestion[] = [
  { id: 'classic-comeback', text: 'How often do teams win from two goals down at the 70th minute?' },
  { id: 'late-equaliser', text: 'A goal behind with 5 minutes left — do they still avoid defeat?' },
  { id: 'hold-lead', text: 'Do teams a goal up at half-time hold on to win?' },
  { id: 'two-up-safe', text: 'Two goals up at 80 minutes — how safe is that lead?' },
  { id: 'level-half', text: 'Level at half-time, how often does a side go on to win?' },
  { id: 'womens-comeback', text: "In women's football, can a team come back from 2-0 down at 65 minutes?" },
]
