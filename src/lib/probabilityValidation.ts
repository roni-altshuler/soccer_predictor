/**
 * Probability sanity guards for AI prediction outputs.
 *
 * Backend predictions arrive over the wire and are rendered in many places
 * (match detail, /predict, simulator). These helpers let any caller verify
 * the values before trusting them in the UI — catching:
 *
 *   - NaN / undefined / null
 *   - negative probabilities
 *   - probabilities > 1
 *   - triples that don't sum to ~1 (typically a backend bug)
 *
 * The validators are pure functions used primarily by tests and (optionally)
 * by components that want a defensive fallback. They DO NOT mutate UI
 * behaviour today — adding them as runtime checks in production is a
 * follow-up decision.
 */

export interface ProbabilityTriple {
  home: number
  draw: number
  away: number
}

export interface ProbabilityValidationIssue {
  field: keyof ProbabilityTriple | 'sum'
  reason: 'NaN' | 'negative' | 'over-one' | 'sum-mismatch'
  value: number
}

/** Tolerance for floating-point sum-to-one checks (1%). */
export const PROBABILITY_SUM_TOLERANCE = 0.01

/**
 * Returns true iff every field is a finite number in [0, 1] and the three
 * sum to within {@link PROBABILITY_SUM_TOLERANCE} of 1.
 *
 * Use this to gate "trust the model output" decisions.
 */
export function isValidProbabilityTriple(p: unknown): p is ProbabilityTriple {
  if (!p || typeof p !== 'object') return false
  const t = p as Partial<ProbabilityTriple>
  if (
    typeof t.home !== 'number' ||
    typeof t.draw !== 'number' ||
    typeof t.away !== 'number'
  ) {
    return false
  }
  if (
    !Number.isFinite(t.home) ||
    !Number.isFinite(t.draw) ||
    !Number.isFinite(t.away)
  ) {
    return false
  }
  if (t.home < 0 || t.draw < 0 || t.away < 0) return false
  if (t.home > 1 || t.draw > 1 || t.away > 1) return false
  const sum = t.home + t.draw + t.away
  if (Math.abs(sum - 1) > PROBABILITY_SUM_TOLERANCE) return false
  return true
}

/**
 * Returns a human-readable list of every problem with the input. Empty
 * array = valid. Useful for surfacing why a sanity check failed in tests
 * or dev-only console warnings.
 */
export function validateProbabilityTriple(
  p: unknown,
): ProbabilityValidationIssue[] {
  const issues: ProbabilityValidationIssue[] = []
  if (!p || typeof p !== 'object') {
    return [{ field: 'sum', reason: 'NaN', value: NaN }]
  }
  const t = p as Partial<ProbabilityTriple>
  const fields: Array<keyof ProbabilityTriple> = ['home', 'draw', 'away']
  for (const f of fields) {
    const v = t[f]
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      issues.push({ field: f, reason: 'NaN', value: v as number })
      continue
    }
    if (v < 0) issues.push({ field: f, reason: 'negative', value: v })
    if (v > 1) issues.push({ field: f, reason: 'over-one', value: v })
  }
  if (
    typeof t.home === 'number' &&
    typeof t.draw === 'number' &&
    typeof t.away === 'number' &&
    Number.isFinite(t.home) &&
    Number.isFinite(t.draw) &&
    Number.isFinite(t.away)
  ) {
    const sum = t.home + t.draw + t.away
    if (Math.abs(sum - 1) > PROBABILITY_SUM_TOLERANCE) {
      issues.push({ field: 'sum', reason: 'sum-mismatch', value: sum })
    }
  }
  return issues
}

/**
 * Defensively coerce a possibly-malformed triple into a usable one.
 *   - NaN / non-numeric → 0
 *   - negative → 0
 *   - > 1 → 1
 *   - renormalises so the three sum to exactly 1
 *
 * If every value is 0 (worst case), returns a uniform 1/3 distribution
 * so callers don't divide by zero downstream. This is a *defensive*
 * fallback — preferred path is to detect the issue with
 * {@link isValidProbabilityTriple} first and decide upstream whether to
 * show "data unavailable" vs render a normalised value.
 */
export function normalizeProbabilityTriple(p: unknown): ProbabilityTriple {
  const t = (p && typeof p === 'object' ? p : {}) as Partial<ProbabilityTriple>

  const clean = (v: unknown): number => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return 0
    if (v > 1) return 1
    return v
  }

  const home = clean(t.home)
  const draw = clean(t.draw)
  const away = clean(t.away)
  const sum = home + draw + away

  if (sum <= 0) {
    return { home: 1 / 3, draw: 1 / 3, away: 1 / 3 }
  }

  return {
    home: home / sum,
    draw: draw / sum,
    away: away / sum,
  }
}

/**
 * Validate an arbitrary distribution (any number of buckets, e.g. position
 * probabilities). Returns true iff every value is in [0, 1] AND the values
 * sum to ~1 within {@link PROBABILITY_SUM_TOLERANCE}.
 */
export function isValidDistribution(
  values: Iterable<number> | Record<string | number, number>,
): boolean {
  const arr: number[] = Array.isArray(values)
    ? values
    : typeof values === 'object' && values !== null
      ? Object.values(values as Record<string | number, number>)
      : []

  if (arr.length === 0) return false

  let sum = 0
  for (const v of arr) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return false
    if (v < 0 || v > 1) return false
    sum += v
  }
  return Math.abs(sum - 1) <= PROBABILITY_SUM_TOLERANCE
}
