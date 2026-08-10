/**
 * What counts as "the model's record".
 *
 * The published track record is a claim about the model that is serving today,
 * in the competitions the product covers. Two filters are needed to make it
 * that, and both were missing.
 *
 * MEASURED 2026-08-10, before this module existed. `/accuracy` printed one hit
 * rate — 44.29% over 1,244 settled picks — pooled from:
 *
 *   - eleven competitions, of which Primeira Liga (132), Eredivisie (127),
 *     MLS (112), Champions League (82), Europa League (78) and the World Cup
 *     (13) are not in the product at all. 43.7% of the sample.
 *   - three model generations, of which 1,162 of 1,244 came from the
 *     pre-pivot net that was retired on 2026-08-08 for reading market
 *     features the serving path fed it as zeros.
 *
 * A number pooled that way describes nothing that exists. It is also the exact
 * thing CLAUDE.md's first standing rule forbids: "any accuracy claim is stated
 * as paired Brier/log-loss against closing odds on named fixtures, or it is
 * not stated."
 *
 * Both filters are deliberately allow-lists. A new competition or a newly
 * promoted model has to be added here on purpose, so the next scope change
 * cannot quietly re-pool the headline.
 */

import { WAVE_A_COMPETITION_IDS, getLeagueAccent } from '@/lib/leagueAccents'

/**
 * Model identifiers whose predictions belong in the published record.
 *
 * Matched as a prefix so a version bump (`dixon_coles_v2`) keeps counting
 * without an edit, while a different family does not.
 *
 * NOT here, and why:
 *   - `elo_poisson`  legacy fallback, retired in the pivot
 *   - `unified-multitask-1.0-*`  trained with market features the serving path
 *     zeroed; its live Brier is .6762 against a .6245 constant on the same 64
 *     fixtures. It is not the model any current claim is about.
 *   - `null`/absent  the pre-pivot generation, which did not stamp a name
 */
export const SERVING_MODEL_PREFIXES = ['dixon_coles'] as const

/** Does this prediction come from a model that currently serves? */
export function isServingModel(modelUsed?: string | null): boolean {
  if (!modelUsed) return false
  const m = modelUsed.toLowerCase()
  return SERVING_MODEL_PREFIXES.some((prefix) => m.startsWith(prefix))
}

/**
 * Is this prediction's competition inside the covered wave?
 *
 * Predictions store a display name ("Premier League"), not a competition id,
 * so this resolves through `leagueAccents` rather than comparing strings.
 */
export function isInScopeLeague(league?: string | null): boolean {
  if (!league) return false
  const accent = getLeagueAccent(league)
  return (WAVE_A_COMPETITION_IDS as readonly string[]).includes(accent.competitionId)
}

export interface ScopeCounts {
  /** Everything on disk, before either filter. */
  total: number
  /** Dropped because the competition is not in the covered wave. */
  outOfScopeLeague: number
  /** Dropped because the model that made them no longer serves. */
  retiredModel: number
  /** What survived both filters. */
  inScope: number
}

/**
 * Apply both filters, reporting what each one removed.
 *
 * The counts are returned rather than logged because the surface should be
 * able to say "1,244 picks exist, 33 are in scope" out loud. A sample that
 * shrinks by 97% is a fact about the product, not an embarrassment to hide:
 * Wave A was in its close season on 2026-08-10 and Dixon-Coles had only just
 * become the serving default, so a thin record is the honest one.
 */
export function scopePredictions<T extends { league?: string | null; model_used?: string | null }>(
  rows: T[],
): { rows: T[]; counts: ScopeCounts } {
  let outOfScopeLeague = 0
  let retiredModel = 0
  const kept: T[] = []

  for (const row of rows) {
    if (!isInScopeLeague(row.league)) {
      outOfScopeLeague += 1
      continue
    }
    if (!isServingModel(row.model_used)) {
      retiredModel += 1
      continue
    }
    kept.push(row)
  }

  return {
    rows: kept,
    counts: {
      total: rows.length,
      outOfScopeLeague,
      retiredModel,
      inScope: kept.length,
    },
  }
}
