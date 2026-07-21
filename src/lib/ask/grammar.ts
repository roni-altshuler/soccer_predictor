/**
 * Plain-English grammar for Ask Pitchverse narration.
 *
 * A mirror of the sentence helpers in `almanac/query.ts` (the source of truth
 * for the structured builder). Duplicated rather than imported so this pure lib
 * stays self-contained and free of any cross-route-group coupling — the same
 * reason `query.ts` re-implements the key grammar from `@/lib/rarity`. Keep the
 * two in step: the words the narration uses must read identically to the words
 * the builder composes.
 */

import { clampDiff, minuteBucket } from './schema'

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

/** Title-case minute label for read-outs: "70th minute" · "Kickoff". */
export function minuteLabel(minute: number): string {
  const b = minuteBucket(minute)
  return b === 0 ? 'Kickoff' : `${ordinal(b)} minute`
}

/** The subject noun-phrase for a state, from the side's point of view. */
export function sidePhrase(diff: number): string {
  const d = clampDiff(diff)
  if (d < 0) return 'the trailing side'
  if (d > 0) return 'the leading side'
  return 'a level side'
}
