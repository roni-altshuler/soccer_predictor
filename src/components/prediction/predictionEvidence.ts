import type { PredictionPayload } from './PredictionResult'

export function availableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function availableProbability(value: unknown): number | null {
  const number = availableNumber(value)
  return number !== null && number >= 0 && number <= 1 ? number : null
}

export function parseScore(value: unknown) {
  if (typeof value !== 'string') return null
  const match = /^(\d+)\s*[-–]\s*(\d+)$/.exec(value.trim())
  return match ? { home_goals: Number(match[1]), away_goals: Number(match[2]) } : null
}

/** Top-K distribution values keep their original probabilities; never renormalise. */
export function validScorelines(scores: Array<PredictionPayload['most_likely_score']>) {
  const seen = new Set<string>()
  const valid = scores.filter((score): score is NonNullable<PredictionPayload['most_likely_score']> => {
    if (!score || availableProbability(score.probability) === null || score.probability === 0) return false
    if (![score.home_goals, score.away_goals].every((n) => Number.isSafeInteger(n) && n >= 0)) return false
    const key = `${score.home_goals}-${score.away_goals}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).sort((a, b) => b.probability! - a.probability!)
  return valid.reduce((sum, s) => sum + s.probability!, 0) <= 1.01 ? valid : []
}
