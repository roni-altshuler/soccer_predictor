import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

import type { CalibrationDotPoint, FlatAccuracyResponse } from '@/lib/types/accuracy'

interface CompletedPrediction {
  league: string
  match_date: string
  gender?: 'M' | 'F' | null
  confidence: number
  predicted_home_win: number
  predicted_draw: number
  predicted_away_win: number
  predicted_winner?: 'home' | 'draw' | 'away' | null
  actual_winner: string | null
  winner_correct: boolean | null
  scoreline_correct: boolean | null
  scoreline_in_top5?: boolean | null
}

interface PredictionFile {
  predictions?: CompletedPrediction[]
}

function normalizeConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0
  return value > 1 ? value / 100 : value
}

function loadAll() {
  const dataDir = path.join(process.cwd(), 'backend', 'data', 'predictions')
  if (!fs.existsSync(dataDir)) return [] as CompletedPrediction[]

  const files = fs.readdirSync(dataDir).filter(f => f.startsWith('predictions_') && f.endsWith('.json'))
  const all: CompletedPrediction[] = []

  for (const file of files.sort()) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf-8')) as PredictionFile
      if (Array.isArray(data.predictions)) {
        all.push(...data.predictions)
      }
    } catch { /* skip */ }
  }

  return all
}

// Kept (currently unused) — useful if a caller wants only-settled records.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function loadCompleted() {
  return loadAll().filter((p) => p.actual_winner !== null)
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const league = searchParams.get('league') || null
  const days = searchParams.get('days') ? parseInt(searchParams.get('days')!, 10) : null
  const gender = searchParams.get('gender')
  const wantedGender = gender === 'F' || gender === 'M' ? gender : null

  // Total includes pending; completed only those with an actual outcome.
  let pool = loadAll()
  if (wantedGender) {
    pool = pool.filter((p) => (p.gender || 'M').toString().toUpperCase() === wantedGender)
  }
  if (league) {
    pool = pool.filter((p) => p.league === league)
  }
  if (days) {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    pool = pool.filter((p) => new Date(p.match_date) >= cutoff)
  }

  const totalPredictions = pool.length
  const completed = pool.filter((p) => p.actual_winner !== null)
  const pendingPredictions = totalPredictions - completed.length

  const total = completed.length
  if (total === 0) {
    const empty: FlatAccuracyResponse = {
      // legacy field names the older tracking-summary surfaces expected:
      total_predictions: totalPredictions,
      correct_predictions: 0,
      accuracy: 0,
      result_accuracy: 0,
      score_accuracy: 0,
      weighted_accuracy: 0,
      // canonical AccuracyResponse field names consumed by /accuracy:
      completed_predictions: 0,
      pending_predictions: pendingPredictions,
      winner_correct_count: 0,
      winner_accuracy: 0,
      avg_confidence: 0,
      exact_scoreline_count: 0,
      exact_scoreline_rate: 0,
      scoreline_top5_count: 0,
      scoreline_top5_eligible: 0,
      scoreline_top5_rate: 0,
      weighted_accuracy_score: 0,
      avg_goals_difference: 0,
      within_1_goal_rate: 0,
      recent_accuracy: 0,
      brier_score: 0,
      log_loss: 0,
      expected_calibration_error: 0,
      high_confidence_accuracy: 0,
      medium_confidence_accuracy: 0,
      low_confidence_accuracy: 0,
      home_win_predicted: 0,
      home_win_correct: 0,
      draw_predicted: 0,
      draw_correct: 0,
      away_win_predicted: 0,
      away_win_correct: 0,
      calibration_bins: [],
      by_confidence: {
        high: { total: 0, correct: 0, accuracy: 0 },
        medium: { total: 0, correct: 0, accuracy: 0 },
        low: { total: 0, correct: 0, accuracy: 0 },
      },
      recent_form: [],
    }
    return NextResponse.json(empty)
  }

  const correct = completed.filter((p) => p.winner_correct).length
  const scoreCorrect = completed.filter((p) => p.scoreline_correct).length
  const weightedAccuracy = total > 0 ? ((correct * 0.65) + (scoreCorrect * 0.35)) / total : 0

  // Top-5 scoreline coverage — only records that stored the PMF top-5 list
  // count toward the rate, so legacy rounded-xG records don't dilute it.
  const top5Eligible = completed.filter((p) => p.scoreline_in_top5 !== null && p.scoreline_in_top5 !== undefined)
  const top5Hits = top5Eligible.filter((p) => p.scoreline_in_top5).length

  // Probability quality metrics
  let brier = 0
  let logLoss = 0
  const binCounts = new Array<number>(10).fill(0)
  const binConf = new Array<number>(10).fill(0)
  const binAcc = new Array<number>(10).fill(0)

  for (const p of completed) {
    const raw = [
      Math.max(0, Number(p.predicted_home_win) || 0),
      Math.max(0, Number(p.predicted_draw) || 0),
      Math.max(0, Number(p.predicted_away_win) || 0),
    ]
    const sum = raw[0] + raw[1] + raw[2]
    const probs = sum > 0 ? raw.map(v => v / sum) : [1 / 3, 1 / 3, 1 / 3]
    const actualIdx = p.actual_winner === 'home' ? 0 : p.actual_winner === 'draw' ? 1 : 2
    const actual = [0, 0, 0]
    actual[actualIdx] = 1

    brier += ((probs[0] - actual[0]) ** 2 + (probs[1] - actual[1]) ** 2 + (probs[2] - actual[2]) ** 2) / 3
    logLoss += -Math.log(Math.max(1e-12, probs[actualIdx]))

    const conf = Math.max(...probs)
    const predIdx = probs.indexOf(conf)
    const binIdx = Math.min(9, Math.floor(conf * 10))
    binCounts[binIdx] += 1
    binConf[binIdx] += conf
    binAcc[binIdx] += predIdx === actualIdx ? 1 : 0
  }

  let ece = 0
  for (let i = 0; i < 10; i++) {
    if (binCounts[i] === 0) continue
    const avgConf = binConf[i] / binCounts[i]
    const avgAcc = binAcc[i] / binCounts[i]
    ece += Math.abs(avgAcc - avgConf) * (binCounts[i] / total)
  }

  // By confidence breakdown
  const high = completed.filter((p) => normalizeConfidence(p.confidence) >= 0.55)
  const med = completed.filter((p) => normalizeConfidence(p.confidence) >= 0.42 && normalizeConfidence(p.confidence) < 0.55)
  const low = completed.filter((p) => normalizeConfidence(p.confidence) < 0.42)
  const acc = (arr: CompletedPrediction[]) => arr.length > 0 ? arr.filter((p) => p.winner_correct).length / arr.length : 0

  // Recent form (last 20) — chronologically newest first
  const sorted = [...completed].sort((a, b) => b.match_date.localeCompare(a.match_date))
  const form = sorted.slice(0, 20).map((p) => p.winner_correct ? 'W' : 'L')

  // Per-class breakdown for the confusion matrix view on /accuracy.
  const predictedWinner = (p: CompletedPrediction): 'home' | 'draw' | 'away' => {
    if (p.predicted_winner === 'home' || p.predicted_winner === 'draw' || p.predicted_winner === 'away') {
      return p.predicted_winner
    }
    const h = Number(p.predicted_home_win) || 0
    const d = Number(p.predicted_draw) || 0
    const a = Number(p.predicted_away_win) || 0
    return h >= d && h >= a ? 'home' : a >= d ? 'away' : 'draw'
  }

  const homePred = completed.filter((p) => predictedWinner(p) === 'home')
  const drawPred = completed.filter((p) => predictedWinner(p) === 'draw')
  const awayPred = completed.filter((p) => predictedWinner(p) === 'away')

  // Recent accuracy: last 50 predictions, newest first
  const last50 = sorted.slice(0, 50)
  const recentAccuracy = last50.length > 0
    ? last50.filter((p) => p.winner_correct).length / last50.length
    : 0

  // Calibration bins for the dot-plot.
  const calibrationBins: CalibrationDotPoint[] = []
  for (let i = 0; i < 10; i++) {
    if (binCounts[i] === 0) continue
    calibrationBins.push({
      bin_lower: i / 10,
      bin_upper: (i + 1) / 10,
      avg_predicted: binConf[i] / binCounts[i],
      avg_actual: binAcc[i] / binCounts[i],
      count: binCounts[i],
    })
  }

  const response: FlatAccuracyResponse = {
    // Legacy field names retained for old summary surfaces:
    total_predictions: totalPredictions,
    correct_predictions: correct,
    accuracy: Math.round((correct / total) * 1000) / 1000,
    result_accuracy: Math.round((correct / total) * 1000) / 1000,
    score_accuracy: Math.round((scoreCorrect / total) * 1000) / 1000,
    weighted_accuracy: Math.round(weightedAccuracy * 1000) / 1000,
    // Canonical fields consumed by /accuracy:
    completed_predictions: total,
    pending_predictions: pendingPredictions,
    winner_accuracy: Math.round((correct / total) * 1000) / 1000,
    winner_correct_count: correct,
    recent_accuracy: Math.round(recentAccuracy * 1000) / 1000,
    avg_confidence: 0,
    exact_scoreline_count: scoreCorrect,
    exact_scoreline_rate: Math.round((scoreCorrect / total) * 1000) / 1000,
    scoreline_top5_count: top5Hits,
    scoreline_top5_eligible: top5Eligible.length,
    scoreline_top5_rate: top5Eligible.length > 0 ? Math.round((top5Hits / top5Eligible.length) * 1000) / 1000 : 0,
    weighted_accuracy_score: Math.round(weightedAccuracy * 1000) / 1000,
    avg_goals_difference: 0,
    within_1_goal_rate: 0,
    brier_score: Math.round((brier / total) * 10000) / 10000,
    log_loss: Math.round((logLoss / total) * 10000) / 10000,
    expected_calibration_error: Math.round(ece * 10000) / 10000,
    home_win_predicted: homePred.length,
    home_win_correct: homePred.filter((p) => p.winner_correct).length,
    draw_predicted: drawPred.length,
    draw_correct: drawPred.filter((p) => p.winner_correct).length,
    away_win_predicted: awayPred.length,
    away_win_correct: awayPred.filter((p) => p.winner_correct).length,
    calibration_bins: calibrationBins,
    high_confidence_accuracy: Math.round(acc(high) * 1000) / 1000,
    medium_confidence_accuracy: Math.round(acc(med) * 1000) / 1000,
    low_confidence_accuracy: Math.round(acc(low) * 1000) / 1000,
    by_confidence: {
      high: { total: high.length, correct: high.filter((p) => p.winner_correct).length, accuracy: Math.round(acc(high) * 1000) / 1000 },
      medium: { total: med.length, correct: med.filter((p) => p.winner_correct).length, accuracy: Math.round(acc(med) * 1000) / 1000 },
      low: { total: low.length, correct: low.filter((p) => p.winner_correct).length, accuracy: Math.round(acc(low) * 1000) / 1000 },
    },
    recent_form: form,
  }
  return NextResponse.json(response)
}
