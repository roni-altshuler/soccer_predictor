import { type PredictionPayload } from '@/components/prediction/PredictionResult'

import type { MatchDetails } from './types'
import { isValidProbabilityTriple } from '@/lib/probabilityValidation'
import { availableNumber, availableProbability, parseScore, validScorelines } from '@/components/prediction/predictionEvidence'

/**
 * Convert the `MatchDetails.prediction` shape — populated by `/api/match/[id]`
 * — into the unified `PredictionPayload` consumed by the showcase
 * visualisation on the Prediction tab.
 */
export function adaptMatchPrediction(match: MatchDetails): PredictionPayload | null {
  const p = match.prediction
  if (!p || !isValidProbabilityTriple({ home: p.home_win, draw: p.draw, away: p.away_win })) return null
  const confidence = availableProbability(typeof p.confidence === 'number' ? p.confidence / 100 : null)
  const scorelines = validScorelines((p.derived_markets?.correct_score_top5 ?? []).map((s) => ({
    score: `${s.home}-${s.away}`, home_goals: s.home, away_goals: s.away, probability: s.probability,
  })))
  const reportedScore = parseScore(p.most_likely_score)
  const estimate = p.predicted_score
  const headline = reportedScore ?? (
    availableNumber(estimate?.home) !== null && availableNumber(estimate?.away) !== null &&
    estimate.home >= 0 && estimate.away >= 0
      ? { home_goals: Math.round(estimate.home), away_goals: Math.round(estimate.away) } : null
  )
  return {
    match_id: match.id, home_team: match.home_team, away_team: match.away_team, league: match.league ?? 'Match',
    outcome: { home_win: p.home_win, draw: p.draw, away_win: p.away_win, confidence },
    goals: {
      // predicted_score can be the mode, so it is not evidence of expected goals.
      home_expected_goals: availableNumber(p.expected_goals?.home),
      away_expected_goals: availableNumber(p.expected_goals?.away),
      total_expected_goals: availableNumber(p.expected_goals?.total) ?? availableNumber(p.total_goals),
      over_1_5: availableProbability(p.over_1_5) ?? availableProbability(p.derived_markets?.over_under?.['1.5']?.over),
      over_2_5: availableProbability(p.over_2_5) ?? availableProbability(p.derived_markets?.over_under?.['2.5']?.over),
      over_3_5: availableProbability(p.over_3_5) ?? availableProbability(p.derived_markets?.over_under?.['3.5']?.over),
      btts_yes: availableProbability(p.btts_yes) ?? availableProbability(p.derived_markets?.btts?.yes),
    },
    most_likely_score: scorelines[0] ?? (headline ? {
      score: `${headline.home_goals}-${headline.away_goals}`, ...headline, probability: null,
    } : null),
    alternative_scores: scorelines.slice(1),
    // Standings and H2H on the match page are context, not model inputs.
    factors: null,
    confidence: { overall: confidence },
    attribution: Array.isArray(p.attribution) && p.attribution.length > 0 ? p.attribution : null,
    model_version: p.model_version,
  }
}

/** Verdict for the finished-match AI pick card. Message is empty when unusable. */
export function getPredictionVerdict(
  match: MatchDetails
): { type: 'exact' | 'close' | 'miss'; message: string } {
  if (!match.prediction?.predicted_score || match.home_score === null || match.away_score === null) {
    return { type: 'miss', message: '' }
  }

  const predictedHome = match.prediction.predicted_score.home
  const predictedAway = match.prediction.predicted_score.away
  const actualHome = match.home_score
  const actualAway = match.away_score

  if (predictedHome === actualHome && predictedAway === actualAway) {
    return { type: 'exact', message: 'Exact prediction' }
  }

  const predictedDiff = predictedHome - predictedAway
  const actualDiff = actualHome - actualAway
  if (Math.abs(predictedDiff - actualDiff) <= 1) {
    return { type: 'close', message: 'Close prediction' }
  }

  return { type: 'miss', message: `Predicted ${Math.round(predictedHome)}-${Math.round(predictedAway)}` }
}
