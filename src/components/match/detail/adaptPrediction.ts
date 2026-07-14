import { type PredictionPayload } from '@/components/prediction/PredictionResult'

import type { MatchDetails } from './types'

/**
 * Convert the `MatchDetails.prediction` shape — populated by `/api/match/[id]`
 * — into the unified `PredictionPayload` consumed by the showcase
 * visualisation on the Prediction tab.
 */
export function adaptMatchPrediction(match: MatchDetails): PredictionPayload {
  const p = match.prediction!
  const total = p.home_win + p.draw + p.away_win || 1
  const norm = {
    home: p.home_win / total,
    draw: p.draw / total,
    away: p.away_win / total,
  }
  const conf = Math.max(0, Math.min(1, (p.confidence ?? 50) / 100))
  const totalGoals = p.total_goals ?? p.predicted_score.home + p.predicted_score.away
  const over25 = p.over_2_5 ?? Math.max(0, Math.min(1, (totalGoals - 1.5) / 2))
  const over15 = Math.max(over25, Math.min(1, (totalGoals - 0.5) / 2))
  const over35 = Math.max(0, Math.min(over25, (totalGoals - 2.5) / 2))
  const btts = p.btts_yes ?? 0.5
  const topScorelines = (p.derived_markets?.correct_score_top5 ?? []).map((s) => ({
    score: `${s.home}-${s.away}`,
    home_goals: s.home,
    away_goals: s.away,
    probability: s.probability,
  }))

  return {
    match_id: match.id,
    home_team: match.home_team,
    away_team: match.away_team,
    league: match.league ?? 'Match',
    outcome: { home_win: norm.home, draw: norm.draw, away_win: norm.away, confidence: conf },
    goals: {
      home_expected_goals: p.predicted_score.home,
      away_expected_goals: p.predicted_score.away,
      total_expected_goals: totalGoals,
      over_1_5: over15,
      over_2_5: over25,
      over_3_5: over35,
      btts_yes: btts,
    },
    // Real committed top scorelines (when the record carries them) feed the
    // scoreline heatmap — nothing is synthesised. The mode scoreline is the
    // top entry when present; the rounded xG scoreline otherwise.
    most_likely_score: topScorelines[0] ?? {
      score:
        p.most_likely_score ??
        `${Math.round(p.predicted_score.home)}-${Math.round(p.predicted_score.away)}`,
      home_goals: Math.round(p.predicted_score.home),
      away_goals: Math.round(p.predicted_score.away),
      probability: Math.max(norm.home, norm.draw, norm.away),
    },
    alternative_scores: topScorelines.slice(1),
    factors: {
      home_elo: match.homeStanding?.points ? 1500 + match.homeStanding.points * 5 : 1500,
      away_elo: match.awayStanding?.points ? 1500 + match.awayStanding.points * 5 : 1500,
      elo_difference:
        (match.homeStanding?.points ?? 0) * 5 - (match.awayStanding?.points ?? 0) * 5,
      home_form_score: 0.5,
      away_form_score: 0.5,
      home_advantage: 0.25,
      h2h_advantage:
        match.h2h.homeWins + match.h2h.awayWins > 0
          ? (match.h2h.homeWins - match.h2h.awayWins) /
            (match.h2h.homeWins + match.h2h.awayWins)
          : 0,
      injury_impact: 0,
      rest_days_diff: 0,
      importance_factor: 1.0,
    },
    confidence: {
      data_quality: 0.75,
      model_certainty: conf,
      historical_accuracy: 0.5,
      overall: conf,
    },
    // Pass through real attribution only — WhyThisPrediction renders
    // nothing when it's absent.
    attribution: Array.isArray(p.attribution) && p.attribution.length > 0 ? p.attribution : null,
    model_version: p.model_version ?? 'unified-multitask',
  }
}

/** Verdict for the finished-match AI pick card. Message is empty when unusable. */
export function getPredictionVerdict(
  match: MatchDetails
): { type: 'exact' | 'close' | 'miss'; message: string } {
  if (!match.prediction || match.home_score === null || match.away_score === null) {
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
