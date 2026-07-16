import { GOAL_TYPES, reconstructTimeline, type AnnotatedBeat } from './story'
import type { MatchDetails } from './types'

/**
 * Counterfactual Machine — pure fork-state math (docs/VISION_2030.md).
 *
 * "Fork a real match": pick a minute, optionally remove real events that had
 * happened by then (or add one hypothetical goal), and hand the resulting
 * match state to the simulation kernel, which plays out the continuation.
 * This module owns everything that must be exactly right BEFORE the kernel
 * is asked anything:
 *
 * - The timeline is `story.ts`'s reconstruction, unchanged: lexicographic
 *   (minute, addedTime) ordering and own goals credited to the scoring side.
 *   If the goal events do not reproduce the final score, there is no fork
 *   feature at all — a counterfactual over an unverified timeline is a guess.
 * - Added-time folding follows the same convention: an event at 45+3 belongs
 *   to minute 45 (first-half stoppage runs before the second half kicks off),
 *   so forking at 45 includes it and forking at 44 does not.
 * - Events after the fork point have not happened yet in the forked universe:
 *   they are excluded from the state automatically and their removals are
 *   inert ({@link effectiveRemovals} prunes them).
 * - The one hypothetical goal is state math only — "+1 by minute t" — never
 *   a fabricated scorer.
 */

/** The extra match-detail tab id (kept out of types.ts — finished-match only). */
export const WHATIF_TAB = 'whatif' as const
export type WhatIfTab = typeof WHATIF_TAB
export const WHATIF_TAB_LABEL = 'What if'

export const FORK_MINUTE_MIN = 1
export const FORK_MINUTE_MAX = 90

/**
 * Team-size sanity cap: a side reduced below seven players forfeits, so no
 * live state can carry more than five red cards for one team. Defensive only
 * — the UI never adds reds, this guards against a malformed event feed.
 */
export const MAX_REDS = 5

/** The state the kernel is asked to continue from — mirrors the fork contract. */
export interface ForkState {
  minute: number
  homeGoals: number
  awayGoals: number
  homeReds: number
  awayReds: number
}

/** A timeline beat with a stable id (its index in the reconstructed timeline). */
export interface ForkEvent extends AnnotatedBeat {
  id: number
}

const EMPTY_REMOVALS: ReadonlySet<number> = new Set()

/**
 * The forkable timeline: `story.ts`'s reconstruction with stable ids, gated
 * exactly like the story/river — null final score, an unplaceable event, an
 * empty timeline, or goals that do not reproduce the final score all mean
 * the feature renders nothing.
 */
export function buildForkTimeline(match: MatchDetails): ForkEvent[] | null {
  if (match.home_score === null || match.away_score === null) return null
  const annotated = reconstructTimeline(match)
  if (annotated === null || annotated.length === 0) return null
  const last = annotated[annotated.length - 1]
  if (last.scoreAfter.home !== match.home_score || last.scoreAfter.away !== match.away_score) {
    return null
  }
  return annotated.map((beat, id) => ({ ...beat, id }))
}

/** True when a finished match clears every structural gate for forking. */
export function isForkEligible(match: MatchDetails): boolean {
  return buildForkTimeline(match) !== null
}

/** Clamp a scrubber value onto the legal fork range (whole minutes, 1–90). */
export function clampForkMinute(minute: number): number {
  if (!Number.isFinite(minute)) return FORK_MINUTE_MIN
  return Math.max(FORK_MINUTE_MIN, Math.min(FORK_MINUTE_MAX, Math.round(minute)))
}

/**
 * Has this event happened by fork minute t? The rule is on the BASE minute:
 * minute ≤ t. That folds added time identically to story.ts's lexicographic
 * ordering — 45+3 happened by t=45 (and by any later t), a 46' event has
 * not happened by t=45. Extra-time events (base minute > 90) are never
 * inside a fork, since t caps at 90.
 */
export function hasHappenedBy(event: Pick<AnnotatedBeat, 'minute'>, forkMinute: number): boolean {
  return event.minute <= forkMinute
}

/**
 * Removals restricted to events that had actually happened by the fork:
 * a removal of a future event is meaningless (it never entered the state)
 * and is pruned rather than honoured.
 */
export function effectiveRemovals(
  events: readonly ForkEvent[],
  forkMinute: number,
  removedIds: ReadonlySet<number>
): Set<number> {
  const minute = clampForkMinute(forkMinute)
  const effective = new Set<number>()
  for (const e of events) {
    if (removedIds.has(e.id) && hasHappenedBy(e, minute)) effective.add(e.id)
  }
  return effective
}

/**
 * The match state at fork minute t after applying the user's edits:
 * count every state-changing event with base minute ≤ t (skipping removed
 * ids), then apply the optional hypothetical goal. Own goals need no special
 * casing — the timeline already credits them to the side whose score
 * increments. Reds are clamped at {@link MAX_REDS} per side.
 */
export function stateAtMinute(
  events: readonly ForkEvent[],
  forkMinute: number,
  removedIds: ReadonlySet<number> = EMPTY_REMOVALS,
  addedGoal: 'home' | 'away' | null = null
): ForkState {
  const minute = clampForkMinute(forkMinute)
  let homeGoals = 0
  let awayGoals = 0
  let homeReds = 0
  let awayReds = 0
  for (const e of events) {
    if (!hasHappenedBy(e, minute)) continue
    if (removedIds.has(e.id)) continue
    if (GOAL_TYPES.has(e.type)) {
      if (e.team === 'home') homeGoals += 1
      else awayGoals += 1
    } else if (e.type === 'red_card') {
      if (e.team === 'home') homeReds += 1
      else awayReds += 1
    }
  }
  if (addedGoal === 'home') homeGoals += 1
  if (addedGoal === 'away') awayGoals += 1
  return {
    minute,
    homeGoals,
    awayGoals,
    homeReds: Math.min(homeReds, MAX_REDS),
    awayReds: Math.min(awayReds, MAX_REDS),
  }
}

/** Two fork states describe the identical situation (one kernel call, not two). */
export function statesEqual(a: ForkState, b: ForkState): boolean {
  return (
    a.minute === b.minute &&
    a.homeGoals === b.homeGoals &&
    a.awayGoals === b.awayGoals &&
    a.homeReds === b.homeReds &&
    a.awayReds === b.awayReds
  )
}

/**
 * One factual line describing a fork state: the score, plus player counts
 * when a side is short. "1–1 · Arsenal down to 10". Counted facts only.
 */
export function forkStateLine(state: ForkState, homeName: string, awayName: string): string {
  let line = `${state.homeGoals}–${state.awayGoals}`
  if (state.homeReds > 0) line += ` · ${homeName} down to ${11 - state.homeReds}`
  if (state.awayReds > 0) line += ` · ${awayName} down to ${11 - state.awayReds}`
  return line
}
