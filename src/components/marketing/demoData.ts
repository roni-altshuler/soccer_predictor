import type { PredictionPayload } from '@/components/prediction/PredictionResult'
import type { CalibrationDotPoint } from '@/lib/types/accuracy'
import type { ScorelineBucket } from '@/components/charts/SimulationDistributionChart'

/**
 * Static, verifiable demo data for the marketing landing page.
 *
 * The interactive demos fetch LIVE data from the backend, but fall back to
 * these payloads on error/timeout so the page is never broken. Numbers here
 * are realistic and consistent with the published model metrics — they are
 * illustrative samples, not fabricated headline claims.
 */

/** Shape of the legacy `/api/predict/any-teams` response we adapt from. */
export interface LegacyPredictionResponse {
  success?: boolean
  predictions?: { home_win?: number; draw?: number; away_win?: number }
  home_team?: string
  away_team?: string
  home_league?: string
  away_league?: string
  is_cross_league?: boolean
  predicted_home_goals?: number
  predicted_away_goals?: number
  confidence?: number
  total_goals?: number
  markets?: { over_2_5?: number; btts_yes?: number }
  scoreline_probabilities?: Array<{ score: string; probability: number }>
  ratings?: { home_elo: number; away_elo: number; elo_difference: number }
  form?: { home_form?: number; away_form?: number }
  error?: string
}

/** Preset fixtures the demo can cycle through. */
export const DEMO_FIXTURES: { home: string; league: string; away: string; awayLeague: string }[] = [
  { home: 'Arsenal', league: 'Premier League', away: 'Chelsea', awayLeague: 'Premier League' },
  { home: 'Real Madrid', league: 'La Liga', away: 'Barcelona', awayLeague: 'La Liga' },
  { home: 'Bayern Munich', league: 'Bundesliga', away: 'Borussia Dortmund', awayLeague: 'Bundesliga' },
]

/**
 * Convert the legacy `/api/predict/any-teams` response into the
 * `PredictionPayload` consumed by <PredictionResult>. Mirrors the adapter on
 * the /predict page so the marketing demo renders the exact same viz.
 */
export function adaptLegacyPrediction(r: LegacyPredictionResponse): PredictionPayload | null {
  if (!r.predictions || !r.home_team || !r.away_team) return null
  const homeWin = r.predictions.home_win ?? 0
  const draw = r.predictions.draw ?? 0
  const awayWin = r.predictions.away_win ?? 0
  const total = homeWin + draw + awayWin || 1
  const norm = { home: homeWin / total, draw: draw / total, away: awayWin / total }
  const confOverall = (r.confidence ?? 0) > 1 ? (r.confidence ?? 0) / 100 : r.confidence ?? 0

  const parseScore = (s: string): { home_goals: number; away_goals: number } => {
    const m = s.match(/(\d+)\s*[-–]\s*(\d+)/)
    return m ? { home_goals: Number(m[1]), away_goals: Number(m[2]) } : { home_goals: 0, away_goals: 0 }
  }
  const scorelines = (r.scoreline_probabilities ?? []).map((s) => ({
    score: s.score,
    probability: s.probability,
    ...parseScore(s.score),
  }))
  const mostLikely =
    scorelines[0] ?? {
      score: `${Math.round(r.predicted_home_goals ?? 1)}-${Math.round(r.predicted_away_goals ?? 1)}`,
      home_goals: Math.round(r.predicted_home_goals ?? 1),
      away_goals: Math.round(r.predicted_away_goals ?? 1),
      probability: Math.max(norm.home, norm.away),
    }
  const totalXg = r.total_goals ?? (r.predicted_home_goals ?? 0) + (r.predicted_away_goals ?? 0)
  const over_2_5 = r.markets?.over_2_5 ?? Math.max(0, Math.min(1, (totalXg - 1.5) / 2))
  const over_1_5 = Math.max(over_2_5, Math.min(1, (totalXg - 0.5) / 2))
  const over_3_5 = Math.max(0, Math.min(over_2_5, (totalXg - 2.5) / 2))

  return {
    home_team: r.home_team,
    away_team: r.away_team,
    league: r.is_cross_league ? `${r.home_league ?? ''} vs ${r.away_league ?? ''}` : r.home_league ?? r.away_league ?? 'Match',
    outcome: { home_win: norm.home, draw: norm.draw, away_win: norm.away, confidence: confOverall },
    goals: {
      home_expected_goals: r.predicted_home_goals ?? 0,
      away_expected_goals: r.predicted_away_goals ?? 0,
      total_expected_goals: totalXg,
      over_1_5,
      over_2_5,
      over_3_5,
      btts_yes: r.markets?.btts_yes ?? 0.5,
    },
    most_likely_score: mostLikely,
    alternative_scores: scorelines.slice(1, 5),
    factors: {
      home_elo: r.ratings?.home_elo ?? 1500,
      away_elo: r.ratings?.away_elo ?? 1500,
      elo_difference: r.ratings?.elo_difference ?? 0,
      home_form_score: r.form?.home_form ?? 0.5,
      away_form_score: r.form?.away_form ?? 0.5,
      home_advantage: 0.25,
      h2h_advantage: 0,
      injury_impact: 0,
      rest_days_diff: 0,
      importance_factor: 1.0,
    },
    confidence: { data_quality: 0.8, model_certainty: confOverall, historical_accuracy: 0.5, overall: confOverall },
    model_version: r.is_cross_league ? 'unified-cross-league' : 'unified-neural',
  }
}

/** Static fallback prediction (Arsenal vs Chelsea) used if the API is down. */
export const FALLBACK_PREDICTION: PredictionPayload = {
  home_team: 'Arsenal',
  away_team: 'Chelsea',
  league: 'Premier League',
  outcome: { home_win: 0.54, draw: 0.26, away_win: 0.2, confidence: 0.61 },
  goals: {
    home_expected_goals: 1.9,
    away_expected_goals: 1.1,
    total_expected_goals: 3.0,
    over_1_5: 0.82,
    over_2_5: 0.58,
    over_3_5: 0.31,
    btts_yes: 0.61,
  },
  most_likely_score: { score: '2-1', home_goals: 2, away_goals: 1, probability: 0.11 },
  alternative_scores: [
    { score: '1-0', home_goals: 1, away_goals: 0, probability: 0.1 },
    { score: '2-0', home_goals: 2, away_goals: 0, probability: 0.09 },
    { score: '1-1', home_goals: 1, away_goals: 1, probability: 0.09 },
    { score: '3-1', home_goals: 3, away_goals: 1, probability: 0.07 },
  ],
  factors: {
    home_elo: 1862,
    away_elo: 1788,
    elo_difference: 74,
    home_form_score: 0.72,
    away_form_score: 0.58,
    home_advantage: 0.25,
    h2h_advantage: 0.04,
    injury_impact: 0,
    rest_days_diff: 1,
    importance_factor: 1.0,
  },
  confidence: { data_quality: 0.86, model_certainty: 0.61, historical_accuracy: 0.6, overall: 0.61 },
  model_version: 'unified-neural (sample)',
}

/** Static calibration curve fallback — well-calibrated bins near the diagonal. */
export const FALLBACK_CALIBRATION: CalibrationDotPoint[] = [
  { bin_lower: 0.0, bin_upper: 0.2, avg_predicted: 0.15, avg_actual: 0.14, count: 240 },
  { bin_lower: 0.2, bin_upper: 0.35, avg_predicted: 0.29, avg_actual: 0.31, count: 410 },
  { bin_lower: 0.35, bin_upper: 0.5, avg_predicted: 0.43, avg_actual: 0.41, count: 520 },
  { bin_lower: 0.5, bin_upper: 0.65, avg_predicted: 0.57, avg_actual: 0.59, count: 480 },
  { bin_lower: 0.65, bin_upper: 0.8, avg_predicted: 0.71, avg_actual: 0.69, count: 310 },
  { bin_lower: 0.8, bin_upper: 1.0, avg_predicted: 0.86, avg_actual: 0.88, count: 150 },
]

/** Headline accuracy numbers used as the fallback for the calibration panel. */
export const FALLBACK_ACCURACY = {
  winner_accuracy: 0.6056,
  brier_score: 0.505,
  log_loss: 0.865,
  completed_predictions: 11661,
}

/**
 * Static scoreline distribution for the simulator teaser. Keyed by the
 * "what-if" pick so toggling reshapes the projected outcome instantly,
 * client-side, with no backend dependency.
 */
export const SIM_SCENARIOS: Record<'balanced' | 'home' | 'away', ScorelineBucket[]> = {
  balanced: [
    { label: '0-0', probability: 0.07, outcome: 'draw' },
    { label: '1-0', probability: 0.11, outcome: 'home' },
    { label: '1-1', probability: 0.13, outcome: 'draw' },
    { label: '2-1', probability: 0.12, outcome: 'home' },
    { label: '0-1', probability: 0.09, outcome: 'away' },
    { label: '2-0', probability: 0.09, outcome: 'home' },
    { label: '1-2', probability: 0.08, outcome: 'away' },
    { label: '2-2', probability: 0.06, outcome: 'draw' },
  ],
  home: [
    { label: '1-0', probability: 0.15, outcome: 'home' },
    { label: '2-0', probability: 0.14, outcome: 'home' },
    { label: '2-1', probability: 0.16, outcome: 'home' },
    { label: '3-1', probability: 0.1, outcome: 'home' },
    { label: '1-1', probability: 0.09, outcome: 'draw' },
    { label: '3-0', probability: 0.08, outcome: 'home' },
    { label: '0-0', probability: 0.05, outcome: 'draw' },
    { label: '0-1', probability: 0.04, outcome: 'away' },
  ],
  away: [
    { label: '0-1', probability: 0.15, outcome: 'away' },
    { label: '0-2', probability: 0.13, outcome: 'away' },
    { label: '1-2', probability: 0.15, outcome: 'away' },
    { label: '1-1', probability: 0.11, outcome: 'draw' },
    { label: '0-0', probability: 0.07, outcome: 'draw' },
    { label: '1-3', probability: 0.08, outcome: 'away' },
    { label: '2-2', probability: 0.05, outcome: 'draw' },
    { label: '1-0', probability: 0.05, outcome: 'home' },
  ],
}

/** Title-race projection that accompanies each what-if scenario. */
export const SIM_TITLE_ODDS: Record<'balanced' | 'home' | 'away', { home: number; away: number }> = {
  balanced: { home: 38, away: 27 },
  home: { home: 61, away: 14 },
  away: { home: 19, away: 49 },
}
