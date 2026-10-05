import type { AttributionItem } from '@/lib/types/attribution'
import { isValidProbabilityTriple } from '@/lib/probabilityValidation'

export interface DerivedMarkets {
  over_under?: Record<string, { over: number; under: number }>
  btts?: { yes: number; no: number }
  correct_score_top5?: Array<{ home: number; away: number; probability: number }>
}

export interface MatchPredictionData {
  home_win: number
  draw: number
  away_win: number
  predicted_score: { home: number; away: number } | null
  confidence: number | null
  /** Explicit goal expectancy, separate from a v1 most-likely scoreline. */
  expected_goals?: { home: number | null; away: number | null; total: number | null }
  /** Compatibility alias for the published/contract-defined expected total. */
  total_goals?: number | null
  over_1_5?: number | null
  over_2_5?: number | null
  over_3_5?: number | null
  btts_yes?: number | null
  most_likely_score?: string
  model_version?: string
  confidence_band?: 'Low' | 'Medium' | 'High'
  derived_markets?: DerivedMarkets | null
  attribution?: AttributionItem[] | null
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const number = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
const probability = (value: unknown): number | null => {
  const n = number(value)
  return n !== null && n <= 1 ? n : null
}
const confidenceBand = (pct: number | null) =>
  pct === null ? undefined : pct >= 70 ? 'High' as const : pct >= 55 ? 'Medium' as const : 'Low' as const

function publishedScore(value: unknown) {
  const score = object(value)
  if ([score.home_goals, score.away_goals].every((n) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0)) {
    return { home: score.home_goals as number, away: score.away_goals as number }
  }
  const parsed = typeof score.score === 'string' ? /^(\d+)\s*[-–]\s*(\d+)$/.exec(score.score.trim()) : null
  const pair = parsed ? { home: Number(parsed[1]), away: Number(parsed[2]) } : null
  return pair && [pair.home, pair.away].every(Number.isSafeInteger) ? pair : null
}

/** Keep only complete published market rows; null is never coerced to zero. */
function derivedMarkets(value: unknown): DerivedMarkets | null {
  const raw = object(value)
  const over_under: NonNullable<DerivedMarkets['over_under']> = {}
  for (const [line, value] of Object.entries(object(raw.over_under))) {
    const row = object(value)
    const over = probability(row.over), under = probability(row.under)
    if (over !== null && under !== null) over_under[line] = { over, under }
  }
  const btts = object(raw.btts)
  const yes = probability(btts.yes), no = probability(btts.no)
  const scores = Array.isArray(raw.correct_score_top5) ? raw.correct_score_top5.flatMap((value) => {
    const row = object(value)
    const p = probability(row.probability)
    if (p === null || ![row.home, row.away].every((n) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0)) return []
    return [{ home: row.home as number, away: row.away as number, probability: p }]
  }) : []
  const result: DerivedMarkets = {}
  if (Object.keys(over_under).length) result.over_under = over_under
  if (yes !== null && no !== null) result.btts = { yes, no }
  if (scores.length) result.correct_score_top5 = scores
  return Object.keys(result).length ? result : null
}

/** Normalize the v1 backend contract used by /api/match/[id]. */
export function normalizeUnifiedMatchPrediction(value: unknown): MatchPredictionData | null {
  const data = object(value), outcome = object(data.outcome), goals = object(data.goals)
  const triple = { home: outcome.home_win, draw: outcome.draw, away: outcome.away_win }
  if (!isValidProbabilityTriple(triple)) return null
  const conf = probability(object(data.confidence).overall) ?? probability(outcome.confidence)
  const confidence = conf === null ? null : Math.round(conf * 100)
  const score = publishedScore(data.most_likely_score)
  const markets = object(data.derived_markets), overs = object(markets.over_under)
  const total = number(goals.total_expected_goals)
  return {
    home_win: triple.home, draw: triple.draw, away_win: triple.away,
    predicted_score: score,
    confidence,
    expected_goals: { home: number(goals.home_expected_goals), away: number(goals.away_expected_goals), total },
    total_goals: total,
    over_1_5: probability(goals.over_1_5) ?? probability(object(overs['1.5']).over),
    over_2_5: probability(goals.over_2_5) ?? probability(object(overs['2.5']).over),
    over_3_5: probability(goals.over_3_5) ?? probability(object(overs['3.5']).over),
    btts_yes: probability(goals.btts_yes) ?? probability(object(markets.btts).yes),
    most_likely_score: score ? `${score.home}-${score.away}` : undefined,
    model_version: typeof data.model_version === 'string' ? data.model_version : undefined,
    confidence_band: confidenceBand(confidence),
    derived_markets: derivedMarkets(data.derived_markets),
    attribution: Array.isArray(data.attribution) && data.attribution.length ? data.attribution as AttributionItem[] : null,
  }
}

/** /api/predict/unified explicitly publishes the two predicted goals as xG. */
export function normalizeBackendMatchPrediction(value: unknown): MatchPredictionData | null {
  const data = object(value), probs = object(data.probabilities)
  const pct = [number(probs.home_win), number(probs.draw), number(probs.away_win)]
  if (pct.some((p) => p === null)) return null
  const triple = { home: pct[0]! / 100, draw: pct[1]! / 100, away: pct[2]! / 100 }
  if (!isValidProbabilityTriple(triple)) return null
  const conf = probability(typeof data.confidence === 'number' ? data.confidence / 100 : null)
  const confidence = conf === null ? null : Math.round(conf * 100)
  const home = number(data.predicted_home_goals), away = number(data.predicted_away_goals)
  // Sum only when both contract-defined xG values are actually present.
  const total = home !== null && away !== null ? number(home + away) : null
  return {
    home_win: triple.home, draw: triple.draw, away_win: triple.away,
    predicted_score: home !== null && away !== null ? { home, away } : null,
    confidence,
    expected_goals: { home, away, total },
    total_goals: total,
    confidence_band: confidenceBand(confidence),
    model_version: typeof data.model_used === 'string' ? data.model_used : undefined,
    derived_markets: derivedMarkets(data.derived_markets),
  }
}
