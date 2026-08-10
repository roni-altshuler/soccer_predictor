/**
 * Canonical accuracy / tracking response types.
 *
 * Two endpoints emit overlapping data:
 *   - GET /api/v1/tracking/accuracy             → flat metrics + legacy aliases
 *   - GET /api/v1/tracking/accuracy/summary     → nested overall + per-league rollup
 *
 * Both are now typed against the shared shapes below so the route emitters
 * and the React consumers stay in lockstep. Existing wire bytes are NOT
 * changed by this consolidation — only the internal typing.
 */

/**
 * Calibration data ships in two visual representations served by the two
 * endpoints. They share the underlying probability buckets but encode
 * different bucket boundaries — kept distinct because each is rendered
 * by a different component (dot-plot vs reliability histogram).
 */
export interface CalibrationDotPoint {
  bin_lower: number
  bin_upper: number
  avg_predicted: number
  avg_actual: number
  count: number
}

export interface CalibrationHistogramBin {
  bucket: string
  count: number
  avg_confidence: number
  accuracy: number
}

/**
 * Canonical accuracy metric block. Emitted as `overall` and `last_30_days`
 * by /accuracy/summary, and as the bulk of the flat /accuracy response.
 *
 * All probabilities are 0..1.
 */
export interface AccuracyMetrics {
  total_predictions: number
  completed_predictions: number
  pending_predictions: number
  winner_correct_count: number
  winner_accuracy: number
  avg_confidence: number
  exact_scoreline_count: number
  exact_scoreline_rate: number
  /** Actual score appeared in the model's stored top-5 scorelines. Only
   * records written by the PMF-backed pipeline are eligible. */
  scoreline_top5_count?: number
  scoreline_top5_eligible?: number
  scoreline_top5_rate?: number
  weighted_accuracy_score: number
  avg_goals_difference: number
  within_1_goal_rate: number
  brier_score: number
  log_loss: number
  expected_calibration_error: number
  high_confidence_accuracy: number
  medium_confidence_accuracy: number
  low_confidence_accuracy: number
  threshold_qualified_predictions: number
  threshold_qualified_accuracy: number
  threshold_qualification_rate: number
  threshold_lift: number
  recent_accuracy: number
  home_win_predicted: number
  home_win_correct: number
  draw_predicted: number
  draw_correct: number
  away_win_predicted: number
  away_win_correct: number
  calibration_bins: CalibrationHistogramBin[]
}

/** Per-league rollup row emitted by /accuracy/summary `by_league`. */
export interface LeagueAccuracySummary {
  league: string
  total: number
  predictions: number
  pending: number
  accuracy: number
  weighted_accuracy: number
  correct: number
  scoreline_accuracy: number
  brier_score: number
  log_loss: number
  expected_calibration_error: number
}

/** Threshold policy applied to qualified-pick metrics. */
export interface AccuracyPolicy {
  min_confidence: number
  min_edge: number
}

/** Recent-prediction row emitted by /accuracy/summary `recent_predictions`. */
export interface RecentPredictionSummary {
  match_id: string
  home_team: string
  away_team: string
  league: string
  match_date: string
  predicted_winner: string
  predicted_scoreline: string
  actual_scoreline: string | null
  actual_winner: string | null
  winner_correct: boolean | null
  scoreline_correct: boolean | null
  confidence: number
  home_win_prob: number
  draw_prob: number
  away_win_prob: number
}

/** Full /accuracy/summary response shape. */
export interface AccuracySummaryResponse {
  overall: AccuracyMetrics
  last_30_days: AccuracyMetrics
  by_league: Record<string, LeagueAccuracySummary>
  policy?: AccuracyPolicy
  recent_form: string[]
  current_streak: { type: string; count: number }
  recent_predictions: RecentPredictionSummary[]
}

import type { ScopeCounts } from '@/lib/predictionScope'

/** Confidence-bucket counts on the flat /accuracy endpoint. */
export interface ConfidenceBucketRollup {
  total: number
  correct: number
  accuracy: number
}

/**
 * Flat /accuracy endpoint response shape. Mirrors AccuracyMetrics for the
 * canonical fields and keeps the legacy aliases (`accuracy`, `result_accuracy`,
 * etc.) for backwards compatibility with older summary surfaces. The
 * calibration bins on this endpoint use the dot-plot schema.
 *
 * Some canonical fields (`threshold_qualified_*`) live only on /summary.
 * They're declared optional here because the flat endpoint omits them.
 */
export interface FlatAccuracyResponse
  extends Omit<
    AccuracyMetrics,
    | 'calibration_bins'
    | 'threshold_qualified_predictions'
    | 'threshold_qualified_accuracy'
    | 'threshold_qualification_rate'
    | 'threshold_lift'
  > {
  correct_predictions: number
  accuracy: number
  result_accuracy: number
  score_accuracy: number
  weighted_accuracy: number
  calibration_bins: CalibrationDotPoint[]
  recent_form: string[]
  by_confidence: {
    high: ConfidenceBucketRollup
    medium: ConfidenceBucketRollup
    low: ConfidenceBucketRollup
  }
  /**
   * What the scope filters removed, so the surface can state its own
   * denominator. A record covering 33 of 1,244 stored picks is honest only if
   * it says which 33 and why the rest are absent.
   */
  scope?: ScopeCounts
}
