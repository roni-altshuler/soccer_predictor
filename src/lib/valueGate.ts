/**
 * Whether a league has earned the right to show value flags.
 *
 * From docs/PIVOT_2026-08.md §2.1, which made this product betting-adjacent
 * and set the price of that:
 *
 *   "A dashboard that recommends a bet is only defensible if it can show it
 *   beats the closing line... Until the model demonstrably closes the gap on
 *   the market on a league, that league ships NO value flags."
 *
 * That gate was specified and never built. `src/lib/marketIntelligence.ts` and
 * `BettingIntelligence.tsx` both label an edge purely on its size — a 6-point
 * disagreement with the bookmaker becomes "value_watch" whether the model has
 * a measured record in that league or none at all. On 2026-08-10 it had none
 * in any league, and the flags rendered anyway.
 *
 * An edge is only an edge if the model is at least as good as the price it is
 * disagreeing with. A model .06 Brier behind the close that disagrees by six
 * points has found its own error, not the market's, and every such flag is a
 * losing bet dressed as a signal.
 *
 * WHAT PASSES. A league needs, from the paired market benchmark:
 *   - at least `MIN_PAIRED_FIXTURES` settled fixtures the market also priced,
 *     scored on the serving model; and
 *   - a Brier no worse than the closing line's by more than `NOISE_TOLERANCE`.
 *
 * "No worse than, within noise" rather than "better than" is deliberate. The
 * standard for showing a comparison is parity; the standard for calling
 * something +EV is beating the price, and that is what the edge threshold on
 * top of this gate is for.
 */

export interface LeagueBenchmark {
  n: number
  metrics?: {
    model?: { brier?: number }
    market_shin?: { brier?: number }
    market_proportional?: { brier?: number }
  }
}

export interface MarketBenchmarkArtifact {
  available?: boolean
  paired_benchmark?: {
    by_league?: Record<string, LeagueBenchmark>
  }
}

/**
 * Below this the estimate is noise. A single bad weekend moves a 40-fixture
 * Brier by more than the entire gap being measured.
 */
export const MIN_PAIRED_FIXTURES = 200

/**
 * How far behind the close still counts as parity. The measured spread between
 * the best and worst Wave A league for the market itself is ~.024 Brier, so a
 * tolerance an order of magnitude tighter than that is a real bar.
 */
export const NOISE_TOLERANCE = 0.002

export type GateReason =
  | 'passed'
  | 'no_benchmark'
  | 'league_not_scored'
  | 'sample_too_small'
  | 'behind_the_close'

export interface GateVerdict {
  allowed: boolean
  reason: GateReason
  n: number
  /** Model Brier minus market Brier. Positive means behind the close. */
  gap: number | null
}

export function evaluateValueGate(
  artifact: MarketBenchmarkArtifact | null | undefined,
  league: string | null | undefined,
): GateVerdict {
  const byLeague = artifact?.paired_benchmark?.by_league
  if (!artifact?.available || !byLeague) {
    return { allowed: false, reason: 'no_benchmark', n: 0, gap: null }
  }
  if (!league) {
    return { allowed: false, reason: 'league_not_scored', n: 0, gap: null }
  }

  const block = byLeague[league]
  if (!block) {
    return { allowed: false, reason: 'league_not_scored', n: 0, gap: null }
  }

  const model = block.metrics?.model?.brier
  const market =
    block.metrics?.market_shin?.brier ?? block.metrics?.market_proportional?.brier
  const gap =
    typeof model === 'number' && typeof market === 'number' ? model - market : null

  if (block.n < MIN_PAIRED_FIXTURES) {
    return { allowed: false, reason: 'sample_too_small', n: block.n, gap }
  }
  if (gap === null || gap > NOISE_TOLERANCE) {
    return { allowed: false, reason: 'behind_the_close', n: block.n, gap }
  }
  return { allowed: true, reason: 'passed', n: block.n, gap }
}

/** One sentence a reader can act on, for each way the gate can fail. */
export function explainGate(verdict: GateVerdict, leagueLabel = 'this league'): string {
  switch (verdict.reason) {
    case 'passed':
      return `Scored against the closing line on ${verdict.n.toLocaleString()} fixtures in ${leagueLabel}, where the model is level with the price.`
    case 'no_benchmark':
      return 'The model has never been scored against the closing line here, so nothing below is a value call.'
    case 'league_not_scored':
      return `${leagueLabel} has no settled fixtures scored against the closing line, so nothing below is a value call.`
    case 'sample_too_small':
      return `Only ${verdict.n.toLocaleString()} fixtures in ${leagueLabel} have been scored against the closing line — too few to tell an edge from a good week.`
    case 'behind_the_close':
      return verdict.gap === null
        ? `The model has no measured Brier in ${leagueLabel}, so nothing below is a value call.`
        : `The model is ${verdict.gap.toFixed(4)} Brier behind the closing line in ${leagueLabel}. A disagreement with a better forecaster is our error, not an edge.`
  }
}
