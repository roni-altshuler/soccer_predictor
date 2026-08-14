/**
 * What the model called, tournament by tournament, against who actually won.
 *
 * `tournaments.json` carries one entry per edition, and a finished edition
 * records three things together: the forecast as it stood at the first
 * knockout round, the champion, and the probability that forecast had put on
 * them. That is a per-competition record of calls, and it is the only
 * tournament-level record this site has.
 *
 * **It is a backtest, and every consumer must say so.** The forecast for a
 * 2021 edition was reconstructed by a model refit on the seasons before it —
 * honest, and not something a reader could have seen in 2021. Presenting it as
 * a published record would break the one rule this project holds hardest.
 */

export interface EditionCall {
  competitionId: string
  season: number
  champion: string
  /** What the forecast gave the eventual champion, 0..1. */
  p: number
  /** Whether the champion was the model's own favourite. */
  calledIt: boolean
  madeAtRound?: string
  madeOn?: string
}

export interface CallRecord {
  editions: number
  /** Share of editions where the model's favourite lifted it. */
  calledRate: number
  /** Mean probability put on the eventual champion. */
  meanP: number
  /** Mean −ln(p) on the champion. Lower is better. */
  logLoss: number
  best: EditionCall | null
  worst: EditionCall | null
}

interface Edition {
  competition_id: string
  season: number
  actual_champion?: string
  probability_on_actual?: number
  called_it?: boolean
  forecast_made_at_round?: string
  forecast_from?: string
}

/**
 * Clamped, for the same reason the bracket backtest clamps: a champion the
 * forecast gave exactly zero is a data fault, and one infinite term would
 * swallow a competition's whole mean and render the panel blank with no clue
 * why.
 */
const FLOOR = 1e-6
const surprisal = (p: number) => -Math.log(Math.max(p, FLOOR))

/** Every settled call, newest first. Editions with no champion are not calls. */
export function callsFor(editions: Edition[], competitionId?: string): EditionCall[] {
  return editions
    .filter(
      (e) =>
        (!competitionId || e.competition_id === competitionId) &&
        Boolean(e.actual_champion) &&
        typeof e.probability_on_actual === 'number' &&
        Number.isFinite(e.probability_on_actual),
    )
    .map((e) => ({
      competitionId: e.competition_id,
      season: e.season,
      champion: e.actual_champion as string,
      p: e.probability_on_actual as number,
      calledIt: Boolean(e.called_it),
      madeAtRound: e.forecast_made_at_round,
      madeOn: e.forecast_from,
    }))
    .sort((a, b) => b.season - a.season)
}

/**
 * The record over a set of calls, or null when there are none.
 *
 * Null rather than a zeroed record: zeros render as a model that got
 * everything wrong, and "not measured here" is a different statement.
 */
export function callRecord(calls: EditionCall[]): CallRecord | null {
  if (!calls.length) return null

  const byP = [...calls].sort((a, b) => b.p - a.p)
  return {
    editions: calls.length,
    calledRate: calls.filter((c) => c.calledIt).length / calls.length,
    meanP: calls.reduce((a, c) => a + c.p, 0) / calls.length,
    logLoss: calls.reduce((a, c) => a + surprisal(c.p), 0) / calls.length,
    best: byP[0] ?? null,
    worst: byP[byP.length - 1] ?? null,
  }
}

/** Competitions with at least one settled call, in the order given. */
export function competitionsWithCalls(editions: Edition[]): string[] {
  const seen = new Set<string>()
  for (const call of callsFor(editions)) seen.add(call.competitionId)
  return [...seen]
}
