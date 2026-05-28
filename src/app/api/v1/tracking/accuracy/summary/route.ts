import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

import type {
  AccuracyMetrics,
  AccuracySummaryResponse,
  CalibrationHistogramBin,
  LeagueAccuracySummary,
} from '@/lib/types/accuracy'

interface Prediction {
  match_id: string
  home_team: string
  away_team: string
  league: string
  match_date: string
  predicted_home_win: number
  predicted_draw: number
  predicted_away_win: number
  predicted_home_goals: number
  predicted_away_goals: number
  predicted_scoreline: string
  predicted_winner: string
  confidence: number
  edge_score?: number
  threshold_qualified?: boolean
  home_elo: number
  away_elo: number
  actual_home_goals: number | null
  actual_away_goals: number | null
  actual_winner: string | null
  winner_correct: boolean | null
  scoreline_correct: boolean | null
  goals_diff: number | null
  prediction_timestamp: string
  outcome_timestamp: string | null
}

function readPolicyThreshold(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseFloat(raw)
  if (!Number.isFinite(parsed)) return fallback
  return parsed
}

const POLICY_MIN_CONFIDENCE = Math.min(1, Math.max(0, readPolicyThreshold('PREDICTION_POLICY_MIN_CONFIDENCE', 0.55)))
const POLICY_MIN_EDGE = Math.min(1, Math.max(0, readPolicyThreshold('PREDICTION_POLICY_MIN_EDGE', 0.12)))

function normalizeConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0
  return value > 1 ? value / 100 : value
}

function normalizeProbabilities(home: number, draw: number, away: number): [number, number, number] {
  const raw = [
    Math.max(0, Number.isFinite(home) ? home : 0),
    Math.max(0, Number.isFinite(draw) ? draw : 0),
    Math.max(0, Number.isFinite(away) ? away : 0),
  ]
  const s = raw[0] + raw[1] + raw[2]
  if (s <= 0) return [1 / 3, 1 / 3, 1 / 3]
  return [raw[0] / s, raw[1] / s, raw[2] / s]
}

function edgeFromProbabilities(home: number, draw: number, away: number): number {
  const [ph, pd, pa] = normalizeProbabilities(home, draw, away)
  return Math.max(ph, pd, pa) - (1 / 3)
}

function winnerIndex(winner: string | null): number {
  if (winner === 'home') return 0
  if (winner === 'draw') return 1
  return 2
}

function emptyCalibrationBins(): CalibrationHistogramBin[] {
  return Array.from({ length: 10 }, (_, i) => ({
    bucket: `${(i / 10).toFixed(1)}-${((i + 1) / 10).toFixed(1)}`,
    count: 0,
    avg_confidence: 0,
    accuracy: 0,
  }))
}

function computeMetricBlock(completed: Prediction[], totalPredictions: number): AccuracyMetrics {
  const count = completed.length

  if (count === 0) {
    return {
      total_predictions: totalPredictions,
      completed_predictions: 0,
      pending_predictions: Math.max(0, totalPredictions),
      winner_correct_count: 0,
      winner_accuracy: 0,
      avg_confidence: 0,
      exact_scoreline_count: 0,
      exact_scoreline_rate: 0,
      weighted_accuracy_score: 0,
      avg_goals_difference: 0,
      within_1_goal_rate: 0,
      brier_score: 0,
      log_loss: 0,
      expected_calibration_error: 0,
      high_confidence_accuracy: 0,
      medium_confidence_accuracy: 0,
      low_confidence_accuracy: 0,
      threshold_qualified_predictions: 0,
      threshold_qualified_accuracy: 0,
      threshold_qualification_rate: 0,
      threshold_lift: 0,
      recent_accuracy: 0,
      home_win_predicted: 0,
      home_win_correct: 0,
      draw_predicted: 0,
      draw_correct: 0,
      away_win_predicted: 0,
      away_win_correct: 0,
      calibration_bins: emptyCalibrationBins(),
    }
  }

  const winnerCorrect = completed.filter(p => p.winner_correct).length
  const scoreCorrect = completed.filter(p => p.scoreline_correct).length
  const avgConfidence = completed.reduce((sum, p) => sum + normalizeConfidence(p.confidence), 0) / count
  const weightedAccuracy = ((winnerCorrect * 0.65) + (scoreCorrect * 0.35)) / count

  const goalsDiffs = completed.filter(p => p.goals_diff !== null).map(p => Math.abs(p.goals_diff!))
  const avgGoalsDiff = goalsDiffs.length > 0 ? goalsDiffs.reduce((a, b) => a + b, 0) / goalsDiffs.length : 0
  const within1Goal = goalsDiffs.length > 0 ? goalsDiffs.filter(d => d <= 1).length / goalsDiffs.length : 0

  let brierSum = 0
  let logLossSum = 0
  const binCounts = new Array<number>(10).fill(0)
  const binConfSum = new Array<number>(10).fill(0)
  const binAccSum = new Array<number>(10).fill(0)

  for (const p of completed) {
    const [ph, pd, pa] = normalizeProbabilities(p.predicted_home_win, p.predicted_draw, p.predicted_away_win)
    const aIdx = winnerIndex(p.actual_winner)
    const actual = [0, 0, 0]
    actual[aIdx] = 1

    brierSum += ((ph - actual[0]) ** 2 + (pd - actual[1]) ** 2 + (pa - actual[2]) ** 2) / 3
    logLossSum += -Math.log(Math.max(1e-12, [ph, pd, pa][aIdx]))

    const probs = [ph, pd, pa]
    const confidence = Math.max(...probs)
    const predictedIdx = probs.indexOf(confidence)
    const isCorrect = predictedIdx === aIdx ? 1 : 0
    const binIdx = Math.min(9, Math.floor(confidence * 10))
    binCounts[binIdx] += 1
    binConfSum[binIdx] += confidence
    binAccSum[binIdx] += isCorrect
  }

  let ece = 0
  const calibrationBins: CalibrationHistogramBin[] = Array.from({ length: 10 }, (_, i) => {
    const n = binCounts[i]
    if (n === 0) {
      return {
        bucket: `${(i / 10).toFixed(1)}-${((i + 1) / 10).toFixed(1)}`,
        count: 0,
        avg_confidence: 0,
        accuracy: 0,
      }
    }
    const avgConf = binConfSum[i] / n
    const avgAcc = binAccSum[i] / n
    ece += Math.abs(avgAcc - avgConf) * (n / count)
    return {
      bucket: `${(i / 10).toFixed(1)}-${((i + 1) / 10).toFixed(1)}`,
      count: n,
      avg_confidence: Math.round(avgConf * 1000) / 1000,
      accuracy: Math.round(avgAcc * 1000) / 1000,
    }
  })

  const highConf = completed.filter(p => normalizeConfidence(p.confidence) >= 0.55)
  const medConf = completed.filter(p => normalizeConfidence(p.confidence) >= 0.42 && normalizeConfidence(p.confidence) < 0.55)
  const lowConf = completed.filter(p => normalizeConfidence(p.confidence) < 0.42)
  const confAcc = (arr: Prediction[]) => arr.length > 0 ? arr.filter(p => p.winner_correct).length / arr.length : 0

  const qualified = completed.filter((p) => {
    if (typeof p.threshold_qualified === 'boolean') return p.threshold_qualified
    const edge = Number.isFinite(p.edge_score ?? NaN)
      ? Number(p.edge_score)
      : edgeFromProbabilities(p.predicted_home_win, p.predicted_draw, p.predicted_away_win)
    return normalizeConfidence(p.confidence) >= POLICY_MIN_CONFIDENCE && edge >= POLICY_MIN_EDGE
  })
  const qualifiedAccuracy = confAcc(qualified)
  const thresholdLift = qualified.length > 0 ? qualifiedAccuracy - (winnerCorrect / count) : 0

  const recentCompleted = [...completed].sort((a, b) => b.match_date.localeCompare(a.match_date)).slice(0, 50)
  const recentAccuracy = recentCompleted.length > 0
    ? recentCompleted.filter(p => p.winner_correct).length / recentCompleted.length
    : 0

  return {
    total_predictions: totalPredictions,
    completed_predictions: count,
    pending_predictions: Math.max(0, totalPredictions - count),
    winner_correct_count: winnerCorrect,
    winner_accuracy: Math.round((winnerCorrect / count) * 1000) / 1000,
    avg_confidence: Math.round(avgConfidence * 1000) / 1000,
    exact_scoreline_count: scoreCorrect,
    exact_scoreline_rate: Math.round((scoreCorrect / count) * 1000) / 1000,
    weighted_accuracy_score: Math.round(weightedAccuracy * 1000) / 1000,
    avg_goals_difference: Math.round(avgGoalsDiff * 100) / 100,
    within_1_goal_rate: Math.round(within1Goal * 1000) / 1000,
    brier_score: Math.round((brierSum / count) * 10000) / 10000,
    log_loss: Math.round((logLossSum / count) * 10000) / 10000,
    expected_calibration_error: Math.round(ece * 10000) / 10000,
    high_confidence_accuracy: Math.round(confAcc(highConf) * 1000) / 1000,
    medium_confidence_accuracy: Math.round(confAcc(medConf) * 1000) / 1000,
    low_confidence_accuracy: Math.round(confAcc(lowConf) * 1000) / 1000,
    threshold_qualified_predictions: qualified.length,
    threshold_qualified_accuracy: Math.round(qualifiedAccuracy * 1000) / 1000,
    threshold_qualification_rate: Math.round((qualified.length / count) * 1000) / 1000,
    threshold_lift: Math.round(thresholdLift * 1000) / 1000,
    recent_accuracy: Math.round(recentAccuracy * 1000) / 1000,
    home_win_predicted: completed.filter(p => p.predicted_winner === 'home').length,
    home_win_correct: completed.filter(p => p.predicted_winner === 'home' && p.winner_correct).length,
    draw_predicted: completed.filter(p => p.predicted_winner === 'draw').length,
    draw_correct: completed.filter(p => p.predicted_winner === 'draw' && p.winner_correct).length,
    away_win_predicted: completed.filter(p => p.predicted_winner === 'away').length,
    away_win_correct: completed.filter(p => p.predicted_winner === 'away' && p.winner_correct).length,
    calibration_bins: calibrationBins,
  }
}

function loadAllPredictions(): Prediction[] {
  const dataDir = path.join(process.cwd(), 'backend', 'data', 'predictions')
  if (!fs.existsSync(dataDir)) return []

  const files = fs.readdirSync(dataDir).filter(f => f.startsWith('predictions_') && f.endsWith('.json'))
  const all: Prediction[] = []

  for (const file of files.sort()) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf-8'))
      if (data.predictions) all.push(...data.predictions)
    } catch {
      // skip corrupt files
    }
  }

  return all
}

export async function GET() {
  const predictions = loadAllPredictions()
  const completed = predictions.filter(p => p.actual_winner !== null)
  const overall = computeMetricBlock(completed, predictions.length)

  const leagues = Array.from(new Set(completed.map(p => p.league)))
  const byLeague: Record<string, LeagueAccuracySummary> = {}
  for (const league of leagues) {
    const completedLeague = completed.filter(p => p.league === league)
    const leagueTotal = predictions.filter(p => p.league === league).length
    const leagueMetrics = computeMetricBlock(completedLeague, leagueTotal)

    byLeague[league] = {
      league,
      total: leagueMetrics.completed_predictions,
      predictions: leagueMetrics.completed_predictions,
      pending: leagueMetrics.pending_predictions,
      accuracy: leagueMetrics.winner_accuracy,
      weighted_accuracy: leagueMetrics.weighted_accuracy_score,
      correct: leagueMetrics.winner_correct_count,
      scoreline_accuracy: leagueMetrics.exact_scoreline_rate,
      brier_score: leagueMetrics.brier_score,
      log_loss: leagueMetrics.log_loss,
      expected_calibration_error: leagueMetrics.expected_calibration_error,
    }
  }

  const recentPreds = [...completed].sort((a, b) => b.match_date.localeCompare(a.match_date)).slice(0, 20)
  const recentForm = recentPreds.map(p => p.winner_correct ? 'W' : 'L')

  let streakType: string | null = null
  let streakCount = 0
  for (const f of recentForm) {
    if (!streakType) {
      streakType = f
      streakCount = 1
    } else if (f === streakType) {
      streakCount += 1
    } else {
      break
    }
  }

  const cutoff30 = new Date()
  cutoff30.setDate(cutoff30.getDate() - 30)
  const last30 = completed.filter(p => new Date(p.match_date) >= cutoff30)
  const last30Metrics = computeMetricBlock(last30, last30.length)

  const response: AccuracySummaryResponse = {
    overall,
    last_30_days: last30Metrics,
    by_league: byLeague,
    policy: {
      min_confidence: POLICY_MIN_CONFIDENCE,
      min_edge: POLICY_MIN_EDGE,
    },
    recent_form: recentForm.slice(0, 10),
    current_streak: { type: streakType || 'N/A', count: streakCount },
    recent_predictions: recentPreds.slice(0, 20).map(p => ({
      match_id: p.match_id,
      home_team: p.home_team,
      away_team: p.away_team,
      league: p.league,
      match_date: p.match_date,
      predicted_winner: p.predicted_winner,
      predicted_scoreline: p.predicted_scoreline,
      actual_scoreline: p.actual_home_goals !== null ? `${p.actual_home_goals}-${p.actual_away_goals}` : null,
      actual_winner: p.actual_winner,
      winner_correct: p.winner_correct,
      scoreline_correct: p.scoreline_correct,
      confidence: normalizeConfidence(p.confidence),
      home_win_prob: p.predicted_home_win,
      draw_prob: p.predicted_draw,
      away_win_prob: p.predicted_away_win,
    })),
  }
  return NextResponse.json(response)
}
