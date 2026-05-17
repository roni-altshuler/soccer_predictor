import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

type Outcome = 'home' | 'draw' | 'away'

interface Prediction {
  match_date: string
  home_team: string
  away_team: string
  predicted_winner?: string
  actual_winner: string | null
  predicted_home_win?: number
  predicted_draw?: number
  predicted_away_win?: number
  home_win_prob?: number
  draw_prob?: number
  away_win_prob?: number
}

interface PredictionFile {
  predictions?: Prediction[]
}

const OUTCOME_INDEX: Record<Outcome, number> = { home: 0, draw: 1, away: 2 }

function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}

function normalizeProbs(prediction: Prediction): [number, number, number] {
  const home = Number(prediction.predicted_home_win ?? prediction.home_win_prob ?? 0)
  const draw = Number(prediction.predicted_draw ?? prediction.draw_prob ?? 0)
  const away = Number(prediction.predicted_away_win ?? prediction.away_win_prob ?? 0)
  const clean = [home, draw, away].map((value) => Number.isFinite(value) && value > 0 ? value : 0)
  const total = clean[0] + clean[1] + clean[2]
  if (total <= 0) return [1 / 3, 1 / 3, 1 / 3]
  return [clean[0] / total, clean[1] / total, clean[2] / total]
}

function actualWinner(prediction: Prediction): Outcome | null {
  if (prediction.actual_winner === 'home' || prediction.actual_winner === 'draw' || prediction.actual_winner === 'away') {
    return prediction.actual_winner
  }
  return null
}

function predictedWinner(prediction: Prediction): Outcome {
  if (prediction.predicted_winner === 'home' || prediction.predicted_winner === 'draw' || prediction.predicted_winner === 'away') {
    return prediction.predicted_winner
  }
  const [home, draw, away] = normalizeProbs(prediction)
  if (home >= draw && home >= away) return 'home'
  if (away >= draw && away >= home) return 'away'
  return 'draw'
}

function loadCompleted(): Prediction[] {
  const dataDir = path.join(process.cwd(), 'backend', 'data', 'predictions')
  if (!fs.existsSync(dataDir)) return []

  const files = fs.readdirSync(dataDir).filter((file) => file.startsWith('predictions_') && file.endsWith('.json'))
  const predictions: Prediction[] = []

  for (const file of files.sort()) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf-8')) as PredictionFile
      if (Array.isArray(data.predictions)) {
        predictions.push(...data.predictions.filter((prediction) => actualWinner(prediction) !== null))
      }
    } catch {
      // Skip malformed files instead of failing the dashboard.
    }
  }

  return predictions.sort((a, b) => a.match_date.localeCompare(b.match_date))
}

function computeBatch(batch: Prediction[]) {
  const count = batch.length
  if (count === 0) {
    return {
      accuracy: 0,
      avg_confidence: 0,
      brier_score: 0,
      log_loss: 0,
      expected_calibration_error: 0,
      overconfidence: 0,
    }
  }

  const binCounts = new Array<number>(10).fill(0)
  const binCorrect = new Array<number>(10).fill(0)
  const binConfidence = new Array<number>(10).fill(0)
  let correct = 0
  let confidenceSum = 0
  let brierSum = 0
  let logLossSum = 0

  for (const prediction of batch) {
    const actual = actualWinner(prediction)
    if (!actual) continue

    const probs = normalizeProbs(prediction)
    const predicted = predictedWinner(prediction)
    const confidence = Math.max(...probs)
    const isCorrect = predicted === actual
    const actualIndex = OUTCOME_INDEX[actual]
    const actualVector = [0, 0, 0]
    actualVector[actualIndex] = 1

    correct += isCorrect ? 1 : 0
    confidenceSum += confidence
    brierSum += ((probs[0] - actualVector[0]) ** 2 + (probs[1] - actualVector[1]) ** 2 + (probs[2] - actualVector[2]) ** 2) / 3
    logLossSum += -Math.log(Math.max(1e-12, probs[actualIndex]))

    const bin = Math.min(9, Math.floor(confidence * 10))
    binCounts[bin] += 1
    binCorrect[bin] += isCorrect ? 1 : 0
    binConfidence[bin] += confidence
  }

  let ece = 0
  for (let i = 0; i < 10; i += 1) {
    if (binCounts[i] === 0) continue
    const avgConfidence = binConfidence[i] / binCounts[i]
    const accuracy = binCorrect[i] / binCounts[i]
    ece += Math.abs(avgConfidence - accuracy) * (binCounts[i] / count)
  }

  const accuracy = correct / count
  const avgConfidence = confidenceSum / count

  return {
    accuracy: round4(accuracy),
    avg_confidence: round4(avgConfidence),
    brier_score: round4(brierSum / count),
    log_loss: round4(logLossSum / count),
    expected_calibration_error: round4(ece),
    overconfidence: round4(avgConfidence - accuracy),
  }
}

export async function GET(request: NextRequest) {
  const window = Math.max(20, Math.min(300, parseInt(request.nextUrl.searchParams.get('window') || '100', 10)))
  const step = Math.max(5, Math.min(window, parseInt(request.nextUrl.searchParams.get('step') || '25', 10)))
  const completed = loadCompleted()

  if (completed.length < window) {
    return NextResponse.json({
      window,
      step,
      data_points: 0,
      trend: [],
      latest: null,
    })
  }

  const trend = []
  for (let end = window; end <= completed.length; end += step) {
    const batch = completed.slice(end - window, end)
    trend.push({
      index: end,
      date: batch[batch.length - 1].match_date,
      sample_match: `${batch[batch.length - 1].home_team} vs ${batch[batch.length - 1].away_team}`,
      sample_size: batch.length,
      ...computeBatch(batch),
    })
  }

  const lastEnd = completed.length
  const latestBatch = completed.slice(lastEnd - window, lastEnd)
  const latest = {
    index: lastEnd,
    date: latestBatch[latestBatch.length - 1].match_date,
    sample_size: latestBatch.length,
    ...computeBatch(latestBatch),
  }

  return NextResponse.json({
    window,
    step,
    data_points: trend.length,
    trend,
    latest,
  }, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}
