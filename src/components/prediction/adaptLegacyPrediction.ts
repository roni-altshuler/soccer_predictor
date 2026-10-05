import type { AttributionItem } from '@/lib/types/attribution'
import { isValidProbabilityTriple } from '@/lib/probabilityValidation'
import type { PredictionPayload } from './PredictionResult'
import { availableNumber, availableProbability, parseScore, validScorelines } from './predictionEvidence'

interface LegacyPrediction {
  predictions?: { home_win?: number; draw?: number; away_win?: number }
  home_team?: string
  away_team?: string
  home_league?: string
  away_league?: string
  predicted_home_goals?: number
  predicted_away_goals?: number
  confidence?: number
  total_goals?: number
  markets?: { over_2_5?: number; btts_yes?: number }
  scoreline_probabilities?: Array<{ score: string; probability: number }>
  form?: { home_form?: number; away_form?: number }
  ratings?: { home_elo: number; away_elo: number; elo_difference: number }
  attribution?: AttributionItem[] | null
}

/** Shared by the match tab and matchup page. Adapt published evidence only. */
export function adaptLegacyPrediction(
  response: LegacyPrediction,
  context: { home_team: string; away_team: string; league?: string },
): PredictionPayload | null {
  const triple = { home: response.predictions?.home_win, draw: response.predictions?.draw, away: response.predictions?.away_win }
  if (!isValidProbabilityTriple(triple)) return null
  const confidence = availableProbability(typeof response.confidence === 'number' ? response.confidence / 100 : null)
  const scores = validScorelines((response.scoreline_probabilities ?? []).flatMap((s) => {
    const parsed = parseScore(s.score)
    return parsed ? [{ score: s.score, ...parsed, probability: s.probability }] : []
  }))
  const homeGoals = availableNumber(response.predicted_home_goals)
  const awayGoals = availableNumber(response.predicted_away_goals)
  const headline = homeGoals !== null && awayGoals !== null && homeGoals >= 0 && awayGoals >= 0 ? {
    score: `${Math.round(homeGoals)}-${Math.round(awayGoals)}`,
    home_goals: Math.round(homeGoals), away_goals: Math.round(awayGoals), probability: null,
  } : null
  const publishedContext = [
    ['Home rating', response.ratings?.home_elo], ['Away rating', response.ratings?.away_elo],
    ['Home recent form (net points)', response.form?.home_form], ['Away recent form (net points)', response.form?.away_form],
  ] as const
  return {
    home_team: response.home_team ?? context.home_team,
    away_team: response.away_team ?? context.away_team,
    league: context.league ?? response.home_league ?? response.away_league ?? 'Match',
    outcome: { home_win: triple.home, draw: triple.draw, away_win: triple.away, confidence },
    goals: {
      // Legacy predicted goals can be a mode or a goal estimate; do not call them xG.
      home_expected_goals: null, away_expected_goals: null,
      total_expected_goals: availableNumber(response.total_goals),
      over_1_5: null, over_2_5: availableProbability(response.markets?.over_2_5),
      over_3_5: null, btts_yes: availableProbability(response.markets?.btts_yes),
    },
    most_likely_score: scores[0] ?? headline,
    alternative_scores: scores.slice(1),
    factors: null,
    context: publishedContext.flatMap(([label, value]) => availableNumber(value) === null ? [] : [{ label, value: String(value) }]),
    confidence: { overall: confidence },
    attribution: Array.isArray(response.attribution) && response.attribution.length ? response.attribution : null,
  }
}
