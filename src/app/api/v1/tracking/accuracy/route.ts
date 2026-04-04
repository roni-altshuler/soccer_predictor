import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

interface CompletedPrediction {
  league: string
  match_date: string
  confidence: number
  predicted_home_win: number
  predicted_draw: number
  predicted_away_win: number
  actual_winner: string | null
  winner_correct: boolean | null
  scoreline_correct: boolean | null
}

interface PredictionFile {
  predictions?: CompletedPrediction[]
}

function normalizeConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0
  return value > 1 ? value / 100 : value
}

function loadCompleted() {
  const dataDir = path.join(process.cwd(), 'backend', 'data', 'predictions')
  if (!fs.existsSync(dataDir)) return [] as CompletedPrediction[]

  const files = fs.readdirSync(dataDir).filter(f => f.startsWith('predictions_') && f.endsWith('.json'))
  const all: CompletedPrediction[] = []

  for (const file of files.sort()) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf-8')) as PredictionFile
      if (Array.isArray(data.predictions)) {
        all.push(...data.predictions.filter((p) => p.actual_winner !== null))
      }
    } catch { /* skip */ }
  }

  return all
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const league = searchParams.get('league') || null
  const days = searchParams.get('days') ? parseInt(searchParams.get('days')!, 10) : null

  let completed = loadCompleted()

  // Apply filters
  if (league) {
    completed = completed.filter((p) => p.league === league)
  }
  if (days) {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    completed = completed.filter((p) => new Date(p.match_date) >= cutoff)
  }

  const total = completed.length
  if (total === 0) {
    return NextResponse.json({
      total_predictions: 0,
      correct_predictions: 0,
      accuracy: 0,
      result_accuracy: 0,
      score_accuracy: 0,
      weighted_accuracy: 0,
      by_confidence: {
        high: { total: 0, correct: 0, accuracy: 0 },
        medium: { total: 0, correct: 0, accuracy: 0 },
        low: { total: 0, correct: 0, accuracy: 0 },
      },
      recent_form: [],
    })
  }

  const correct = completed.filter((p) => p.winner_correct).length
  const scoreCorrect = completed.filter((p) => p.scoreline_correct).length
  const weightedAccuracy = total > 0 ? ((correct * 0.65) + (scoreCorrect * 0.35)) / total : 0

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

  // Recent form (last 20)
  const sorted = [...completed].sort((a, b) => b.match_date.localeCompare(a.match_date))
  const form = sorted.slice(0, 20).map((p) => p.winner_correct ? 'W' : 'L')

  return NextResponse.json({
    total_predictions: total,
    correct_predictions: correct,
    accuracy: Math.round((correct / total) * 1000) / 1000,
    result_accuracy: Math.round((correct / total) * 1000) / 1000,
    score_accuracy: Math.round((scoreCorrect / total) * 1000) / 1000,
    weighted_accuracy: Math.round(weightedAccuracy * 1000) / 1000,
    brier_score: Math.round((brier / total) * 10000) / 10000,
    log_loss: Math.round((logLoss / total) * 10000) / 10000,
    expected_calibration_error: Math.round(ece * 10000) / 10000,
    by_confidence: {
      high: { total: high.length, correct: high.filter((p) => p.winner_correct).length, accuracy: Math.round(acc(high) * 1000) / 1000 },
      medium: { total: med.length, correct: med.filter((p) => p.winner_correct).length, accuracy: Math.round(acc(med) * 1000) / 1000 },
      low: { total: low.length, correct: low.filter((p) => p.winner_correct).length, accuracy: Math.round(acc(low) * 1000) / 1000 },
    },
    recent_form: form,
  })
}
