import type { ThreeWayProbabilities } from '@/lib/liveWinProbability'

import type { EngineForkState, ForkDistribution } from './engineClient'
import type { MatchDetails } from './types'

/**
 * Pure helpers for the live win-probability v2 panel — kept out of the React
 * component so the derivation logic is unit-testable and client-safe (no fs,
 * no server-only imports).
 *
 * v2 puts the roll-forward kernel on the CURRENT live state as the headline
 * read, with the exact-count historical base rate (the same rarity function
 * the story/river use) shown alongside for honesty. Both are honest: a state
 * the kernel can't anchor, or a base rate with too thin a sample, simply is
 * not shown.
 */

/**
 * Below this sample the count-based historical base rate is too thin to
 * surface as a comparison — mirrors `RARITY_MIN_SAMPLE` in `src/lib/rarity.ts`.
 */
export const BASE_RATE_MIN_SAMPLE = 50

/** Exact-count W/D/L for a live state, as the rarity route returns it. */
export interface RarityCountsResponse {
  n: number
  w: number
  d: number
  l: number
}

/**
 * Read the kernel's continuation state off a live match: the clock, the score,
 * and the red-card count per side (from the goal/card event feed). Returns
 * `null` when the clock or score is incomplete — the kernel then does not run
 * and the panel falls back to existing behaviour.
 */
export function deriveEngineLiveState(match: MatchDetails): EngineForkState | null {
  const minute = match.minute
  if (typeof minute !== 'number' || !Number.isFinite(minute) || minute < 0) return null
  if (typeof match.home_score !== 'number' || typeof match.away_score !== 'number') return null

  let homeReds = 0
  let awayReds = 0
  for (const event of match.events) {
    if (event.type !== 'red_card') continue
    if (event.team === 'home') homeReds += 1
    else if (event.team === 'away') awayReds += 1
  }

  return {
    minute: Math.max(0, Math.floor(minute)),
    homeGoals: Math.max(0, Math.floor(match.home_score)),
    awayGoals: Math.max(0, Math.floor(match.away_score)),
    homeReds,
    awayReds,
  }
}

/** Map the kernel's continuation distribution onto the three-way outcome shape. */
export function distributionToProbabilities(distribution: ForkDistribution): ThreeWayProbabilities {
  return {
    home_win: distribution.pHome,
    draw: distribution.pDraw,
    away_win: distribution.pAway,
  }
}

/** A historical base rate: three-way rates plus the sample it rests on. */
export interface BaseRate {
  probabilities: ThreeWayProbabilities
  sample: number
}

/**
 * Turn the exact-count W/D/L (queried from the HOME side's score difference)
 * into a three-way historical base rate. `w` = home wins, `d` = draws,
 * `l` = home losses (away wins). Returns `null` when the sample is below
 * `BASE_RATE_MIN_SAMPLE` — too thin to claim honestly.
 */
export function rarityToBaseRate(counts: RarityCountsResponse | null): BaseRate | null {
  if (!counts || typeof counts.n !== 'number' || counts.n < BASE_RATE_MIN_SAMPLE) return null
  const { n, w, d, l } = counts
  if (n <= 0) return null
  return {
    probabilities: { home_win: w / n, draw: d / n, away_win: l / n },
    sample: n,
  }
}
