/**
 * Almanac v0 — pure query grammar for the Rarity Engine question builder.
 *
 * This module is deliberately React-free and filesystem-free so it can be
 * imported by the client page AND unit-tested in isolation. The state→key
 * mapping (`clampDiff`, `minuteBucket`, `stateKey`) mirrors, exactly, the
 * server grammar in `src/lib/rarity.ts` (itself pinned to
 * `backend/scripts/build_rarity.py`). It is re-implemented here rather than
 * imported because `@/lib/rarity` pulls in `fs`/`path` at module load and must
 * never reach the client bundle. If the artifact key grammar changes, change
 * it in both places.
 */

/** Universe of play. Mirrors `RarityGender` in `@/lib/rarity`. */
export type Universe = 'M' | 'F'

/** Which side of level a team sits on. */
export type Direction = 'trailing' | 'level' | 'leading'

/** A fully-specified Almanac question — the three builder controls. */
export interface AlmanacQuery {
  gender: Universe
  /** Queried side's score difference (negative = trailing), clamped to [-3, 3]. */
  diff: number
  /** Minute floored onto the 5-minute state grid, [0, 90]. */
  minute: number
}

export const DIFF_MIN = -3
export const DIFF_MAX = 3
export const MINUTE_STEP = 5
export const MINUTE_MAX = 90

/** Below this sample size a rarity claim is too thin to trust (mirrors `@/lib/rarity`). */
export const THIN_SAMPLE = 50

/** The builder opens on the classic comeback so the page answers on first paint. */
export const DEFAULT_DIFF = -2
export const DEFAULT_MINUTE = 70

/** Every 5-minute grid point the artifact counts on: 0, 5, …, 90. */
export const MINUTE_OPTIONS: number[] = Array.from(
  { length: MINUTE_MAX / MINUTE_STEP + 1 },
  (_, i) => i * MINUTE_STEP
)

// -- state → artifact key (mirror of @/lib/rarity) ---------------------------

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

/** Canonical artifact key — must match `rarityKey` in `@/lib/rarity`. */
export function stateKey(query: AlmanacQuery): string {
  return `${query.gender}:${clampDiff(query.diff)}:${minuteBucket(query.minute)}`
}

// -- direction / magnitude split (the two-axis state control) ----------------

/** Turn a signed diff into the "Trailing / Level / Leading" control value. */
export function directionOf(diff: number): Direction {
  const d = clampDiff(diff)
  return d < 0 ? 'trailing' : d > 0 ? 'leading' : 'level'
}

/** Goal magnitude of the diff (1/2/3); level defaults to 1 so the control keeps a value. */
export function magnitudeOf(diff: number): number {
  return Math.abs(clampDiff(diff)) || 1
}

/** Compose a signed diff from the two control axes. */
export function diffFrom(direction: Direction, magnitude: number): number {
  if (direction === 'level') return 0
  const m = Math.abs(clampDiff(magnitude)) || 1
  return direction === 'trailing' ? -m : m
}

// -- plain-English grammar ---------------------------------------------------

/** English ordinal: 1 → "1st", 70 → "70th", 12 → "12th". */
export function ordinal(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  const suffix = ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
  return `${n}${suffix}`
}

/** Goal-count word; a clamped 3 means "three or more" (the artifact pools 3+). */
export function magnitudeWord(magnitude: number): string {
  const m = Math.abs(clampDiff(magnitude))
  if (m >= 3) return 'three or more'
  return m === 2 ? 'two' : 'one'
}

/** "trailing by two" · "level" · "leading by one" — from a signed diff. */
export function statePhrase(diff: number): string {
  const d = clampDiff(diff)
  if (d === 0) return 'level'
  return `${d < 0 ? 'trailing by' : 'leading by'} ${magnitudeWord(d)}`
}

/** "at the 70th minute" · "at kickoff" — from a minute. */
export function atMinutePhrase(minute: number): string {
  const b = minuteBucket(minute)
  return b === 0 ? 'at kickoff' : `at the ${ordinal(b)} minute`
}

/** Title-case minute label for the slider read-out: "70th minute" · "Kickoff". */
export function minuteLabel(minute: number): string {
  const b = minuteBucket(minute)
  return b === 0 ? 'Kickoff' : `${ordinal(b)} minute`
}

/**
 * The whole product in one sentence:
 * "How often does a team trailing by two at the 70th minute go on to win?"
 */
export function buildQuestion(query: AlmanacQuery): string {
  return `How often does a team ${statePhrase(query.diff)} ${atMinutePhrase(query.minute)} go on to win?`
}

// -- URL <-> query -----------------------------------------------------------

/** Parse deep-link params into a clamped query; a shared URL wins over the fallback. */
export function parseQuery(
  raw: { gender?: string | null; diff?: string | null; minute?: string | null },
  fallbackGender: Universe = 'M'
): AlmanacQuery {
  const g = (raw.gender ?? '').trim().toUpperCase()
  const gender: Universe =
    g === 'F' || g === 'WOMEN' ? 'F' : g === 'M' || g === 'MEN' ? 'M' : fallbackGender
  const diffN = Number.parseInt(raw.diff ?? '', 10)
  const minuteN = Number.parseInt(raw.minute ?? '', 10)
  return {
    gender,
    diff: Number.isFinite(diffN) ? clampDiff(diffN) : DEFAULT_DIFF,
    minute: Number.isFinite(minuteN) ? minuteBucket(minuteN) : DEFAULT_MINUTE,
  }
}

/** Canonical shareable query string (no leading "?"). */
export function queryToSearch(query: AlmanacQuery): string {
  return `gender=${query.gender}&diff=${clampDiff(query.diff)}&minute=${minuteBucket(query.minute)}`
}

// -- starter questions (fill the builder; they query, never hardcode answers) -

export interface Preset {
  id: string
  label: string
  query: AlmanacQuery
}

export const PRESETS: Preset[] = [
  { id: 'classic-comeback', label: 'The classic comeback', query: { gender: 'M', diff: -2, minute: 70 } },
  { id: 'late-equalizer', label: 'The late equalizer', query: { gender: 'M', diff: -1, minute: 85 } },
  { id: 'holding-the-lead', label: 'Holding a one-goal lead from 60’', query: { gender: 'M', diff: 1, minute: 60 } },
  { id: 'two-up-safe', label: 'Two up at 80’ — safe?', query: { gender: 'M', diff: 2, minute: 80 } },
  { id: 'level-at-half', label: 'Level at half-time', query: { gender: 'M', diff: 0, minute: 45 } },
  { id: 'womens-comeback', label: 'Women’s comeback — two down at 65’', query: { gender: 'F', diff: -2, minute: 65 } },
]
