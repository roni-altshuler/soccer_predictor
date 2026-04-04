import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

type Outcome = 'home' | 'draw' | 'away'
type AlertSeverity = 'high' | 'medium' | 'low'

interface Prediction {
  match_id: string
  league: string
  match_date: string
  prediction_timestamp?: string
  predicted_home_win: number
  predicted_draw: number
  predicted_away_win: number
  predicted_winner: string
  actual_winner: string | null
}

interface MetricBlock {
  sample_size: number
  accuracy: number
  avg_confidence: number
  brier_score: number
  log_loss: number
  expected_calibration_error: number
  draw_actual_rate: number
  draw_predicted_rate: number
  draw_probability_gap: number
}

interface ReliabilityBin {
  bucket: string
  range_min: number
  range_max: number
  sample_size: number
  avg_confidence: number
  accuracy: number
  calibration_gap: number
}

interface WalkForwardFold {
  fold: number
  train_size: number
  test_size: number
  end_date: string | null
  accuracy: number
  brier_score: number
  log_loss: number
  expected_calibration_error: number
}

interface DriftAlert {
  severity: AlertSeverity
  metric: string
  change: number
  message: string
}

interface TuningParams {
  blend_nn_base: number
  blend_nn_min: number
  blend_nn_max: number
  entropy_sensitivity: number
  draw_min_prob: number
  draw_margin: number
  source_sample_size?: number
}

interface TuningPayload {
  default?: TuningParams
  leagues?: Record<string, TuningParams & { display_name?: string }>
}

interface LeagueDiagnostics extends MetricBlock {
  reliability_bins: ReliabilityBin[]
  confusion_matrix: {
    labels: Outcome[]
    matrix: number[][]
    normalized: number[][]
  }
  walk_forward: {
    window_size: number
    step_size: number
    folds: WalkForwardFold[]
  }
  drift_alerts: DriftAlert[]
  tuning: TuningParams
}

const VALID_OUTCOMES: Outcome[] = ['home', 'draw', 'away']
const OUTCOME_INDEX: Record<Outcome, number> = { home: 0, draw: 1, away: 2 }

const LEAGUE_NAME_TO_KEY: Record<string, string> = {
  'Premier League': 'eng.1',
  'La Liga': 'esp.1',
  Bundesliga: 'ger.1',
  'Serie A': 'ita.1',
  'Ligue 1': 'fra.1',
  MLS: 'usa.1',
  'Champions League': 'uefa.champions',
  'Europa League': 'uefa.europa',
  'Conference League': 'uefa.europa.conf',
  Eredivisie: 'ned.1',
  'Primeira Liga': 'por.1',
  'FIFA World Cup': 'fifa.world',
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.max(minValue, Math.min(maxValue, value))
}

function normalizeProbs(pred: Prediction): [number, number, number] {
  const home = Number.isFinite(pred.predicted_home_win) ? Math.max(0, pred.predicted_home_win) : 0
  const draw = Number.isFinite(pred.predicted_draw) ? Math.max(0, pred.predicted_draw) : 0
  const away = Number.isFinite(pred.predicted_away_win) ? Math.max(0, pred.predicted_away_win) : 0
  const total = home + draw + away
  if (total <= 0) return [1 / 3, 1 / 3, 1 / 3]
  return [home / total, draw / total, away / total]
}

function getPredictedWinner(pred: Prediction): Outcome {
  if (pred.predicted_winner === 'home' || pred.predicted_winner === 'draw' || pred.predicted_winner === 'away') {
    return pred.predicted_winner
  }

  const [home, draw, away] = normalizeProbs(pred)
  if (home >= draw && home >= away) return 'home'
  if (away >= draw && away >= home) return 'away'
  return 'draw'
}

function getActualWinner(pred: Prediction): Outcome | null {
  if (pred.actual_winner === 'home' || pred.actual_winner === 'draw' || pred.actual_winner === 'away') {
    return pred.actual_winner
  }
  return null
}

function computeMetrics(predictions: Prediction[]): MetricBlock {
  const total = predictions.length
  if (total === 0) {
    return {
      sample_size: 0,
      accuracy: 0,
      avg_confidence: 0,
      brier_score: 0,
      log_loss: 0,
      expected_calibration_error: 0,
      draw_actual_rate: 0,
      draw_predicted_rate: 0,
      draw_probability_gap: 0,
    }
  }

  const binCounts = new Array<number>(10).fill(0)
  const binAcc = new Array<number>(10).fill(0)
  const binConf = new Array<number>(10).fill(0)

  let correct = 0
  let confSum = 0
  let brierSum = 0
  let logLossSum = 0
  let drawActualCount = 0
  let drawPredSum = 0

  for (const pred of predictions) {
    const actual = getActualWinner(pred)
    if (!actual) continue

    const probs = normalizeProbs(pred)
    const predicted = getPredictedWinner(pred)

    if (predicted === actual) correct += 1

    const confidence = Math.max(...probs)
    confSum += confidence

    const actualVec = [0, 0, 0]
    actualVec[OUTCOME_INDEX[actual]] = 1
    brierSum += ((probs[0] - actualVec[0]) ** 2 + (probs[1] - actualVec[1]) ** 2 + (probs[2] - actualVec[2]) ** 2) / 3
    logLossSum += -Math.log(Math.max(1e-12, probs[OUTCOME_INDEX[actual]]))

    if (actual === 'draw') drawActualCount += 1
    drawPredSum += probs[1]

    const idx = Math.min(9, Math.floor(confidence * 10))
    binCounts[idx] += 1
    binConf[idx] += confidence
    binAcc[idx] += predicted === actual ? 1 : 0
  }

  let ece = 0
  for (let i = 0; i < 10; i += 1) {
    const count = binCounts[i]
    if (count === 0) continue
    const avgConf = binConf[i] / count
    const avgAcc = binAcc[i] / count
    ece += Math.abs(avgAcc - avgConf) * (count / total)
  }

  const accuracy = correct / total
  const drawActualRate = drawActualCount / total
  const drawPredRate = drawPredSum / total

  return {
    sample_size: total,
    accuracy: round4(accuracy),
    avg_confidence: round4(confSum / total),
    brier_score: round4(brierSum / total),
    log_loss: round4(logLossSum / total),
    expected_calibration_error: round4(ece),
    draw_actual_rate: round4(drawActualRate),
    draw_predicted_rate: round4(drawPredRate),
    draw_probability_gap: round4(drawActualRate - drawPredRate),
  }
}

function computeReliabilityBins(predictions: Prediction[]): ReliabilityBin[] {
  const bins = Array.from({ length: 10 }, () => ({ count: 0, conf: 0, acc: 0 }))

  for (const pred of predictions) {
    const actual = getActualWinner(pred)
    if (!actual) continue

    const probs = normalizeProbs(pred)
    const confidence = Math.max(...probs)
    const predicted = getPredictedWinner(pred)
    const idx = Math.min(9, Math.floor(confidence * 10))

    bins[idx].count += 1
    bins[idx].conf += confidence
    bins[idx].acc += predicted === actual ? 1 : 0
  }

  return bins.map((bin, idx) => {
    const low = idx / 10
    const high = (idx + 1) / 10
    if (bin.count === 0) {
      return {
        bucket: `${low.toFixed(1)}-${high.toFixed(1)}`,
        range_min: round4(low),
        range_max: round4(high),
        sample_size: 0,
        avg_confidence: 0,
        accuracy: 0,
        calibration_gap: 0,
      }
    }

    const avgConf = bin.conf / bin.count
    const accuracy = bin.acc / bin.count
    return {
      bucket: `${low.toFixed(1)}-${high.toFixed(1)}`,
      range_min: round4(low),
      range_max: round4(high),
      sample_size: bin.count,
      avg_confidence: round4(avgConf),
      accuracy: round4(accuracy),
      calibration_gap: round4(accuracy - avgConf),
    }
  })
}

function computeConfusionMatrix(predictions: Prediction[]): LeagueDiagnostics['confusion_matrix'] {
  const matrix = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]

  for (const pred of predictions) {
    const actual = getActualWinner(pred)
    if (!actual) continue

    const predicted = getPredictedWinner(pred)
    matrix[OUTCOME_INDEX[predicted]][OUTCOME_INDEX[actual]] += 1
  }

  const normalized = matrix.map((row) => {
    const rowTotal = row[0] + row[1] + row[2]
    if (rowTotal <= 0) return [0, 0, 0]
    return [round4(row[0] / rowTotal), round4(row[1] / rowTotal), round4(row[2] / rowTotal)]
  })

  return {
    labels: VALID_OUTCOMES,
    matrix,
    normalized,
  }
}

function sortPredictions(predictions: Prediction[]): Prediction[] {
  return [...predictions].sort((a, b) => {
    if (a.match_date !== b.match_date) return a.match_date.localeCompare(b.match_date)
    if ((a.prediction_timestamp || '') !== (b.prediction_timestamp || '')) {
      return (a.prediction_timestamp || '').localeCompare(b.prediction_timestamp || '')
    }
    return a.match_id.localeCompare(b.match_id)
  })
}

function computeWalkForward(predictions: Prediction[]): LeagueDiagnostics['walk_forward'] {
  const ordered = sortPredictions(predictions)
  const n = ordered.length

  if (n < 60) {
    return { window_size: 0, step_size: 0, folds: [] }
  }

  const minTrain = Math.max(36, Math.min(120, Math.floor(n / 2)))
  const testWindow = Math.max(12, Math.min(24, Math.floor(n / 6)))
  const step = testWindow

  const folds: WalkForwardFold[] = []
  let fold = 1
  for (let start = minTrain; start + testWindow <= n; start += step) {
    const testSlice = ordered.slice(start, start + testWindow)
    const metrics = computeMetrics(testSlice)

    folds.push({
      fold,
      train_size: start,
      test_size: testSlice.length,
      end_date: testSlice[testSlice.length - 1]?.match_date ?? null,
      accuracy: metrics.accuracy,
      brier_score: metrics.brier_score,
      log_loss: metrics.log_loss,
      expected_calibration_error: metrics.expected_calibration_error,
    })
    fold += 1
  }

  return {
    window_size: testWindow,
    step_size: step,
    folds,
  }
}

function computeDriftAlerts(predictions: Prediction[]): DriftAlert[] {
  const ordered = sortPredictions(predictions)
  const n = ordered.length
  if (n < 50) return []

  const window = Math.min(30, Math.floor(n / 2))
  const previous = ordered.slice(n - (2 * window), n - window)
  const recent = ordered.slice(n - window)

  const prevMetrics = computeMetrics(previous)
  const recentMetrics = computeMetrics(recent)

  const alerts: DriftAlert[] = []

  const accDrop = recentMetrics.accuracy - prevMetrics.accuracy
  if (accDrop <= -0.08) {
    alerts.push({
      severity: 'high',
      metric: 'accuracy',
      change: round4(accDrop),
      message: 'Accuracy dropped sharply in the most recent match window.',
    })
  } else if (accDrop <= -0.05) {
    alerts.push({
      severity: 'medium',
      metric: 'accuracy',
      change: round4(accDrop),
      message: 'Accuracy drift detected against previous results.',
    })
  }

  const brierRise = recentMetrics.brier_score - prevMetrics.brier_score
  if (brierRise >= 0.04) {
    alerts.push({
      severity: 'high',
      metric: 'brier_score',
      change: round4(brierRise),
      message: 'Probability quality worsened (higher Brier score).',
    })
  } else if (brierRise >= 0.02) {
    alerts.push({
      severity: 'medium',
      metric: 'brier_score',
      change: round4(brierRise),
      message: 'Brier score trending upward in recent matches.',
    })
  }

  if (recentMetrics.expected_calibration_error >= 0.12) {
    alerts.push({
      severity: 'high',
      metric: 'expected_calibration_error',
      change: round4(recentMetrics.expected_calibration_error),
      message: 'Calibration error is materially elevated.',
    })
  } else if (recentMetrics.expected_calibration_error >= 0.08) {
    alerts.push({
      severity: 'medium',
      metric: 'expected_calibration_error',
      change: round4(recentMetrics.expected_calibration_error),
      message: 'Calibration drift emerging; confidence is ahead of hit rate.',
    })
  }

  return alerts
}

function suggestTuning(metrics: MetricBlock, sampleSize: number): TuningParams {
  const overconfidence = metrics.avg_confidence - metrics.accuracy

  let blendBase = 0.69 - (overconfidence * 0.35) - (Math.max(0, metrics.expected_calibration_error - 0.08) * 0.3)
  blendBase = clamp(blendBase, 0.58, 0.82)

  let entropySensitivity = 0.16 + Math.max(0, metrics.accuracy - 0.5) * 0.2
  entropySensitivity = clamp(entropySensitivity, 0.1, 0.25)

  let drawMinProb = 0.23 + (metrics.draw_probability_gap * 0.55)
  drawMinProb = clamp(drawMinProb, 0.16, 0.35)

  let drawMargin = 0.02 + (metrics.draw_probability_gap * 0.4)
  drawMargin = clamp(drawMargin, 0, 0.1)

  const blendMin = clamp(blendBase - 0.11, 0.5, 0.76)
  const blendMax = clamp(blendBase + 0.13, 0.64, 0.9)

  return {
    blend_nn_base: round4(blendBase),
    blend_nn_min: round4(blendMin),
    blend_nn_max: round4(blendMax),
    entropy_sensitivity: round4(entropySensitivity),
    draw_min_prob: round4(drawMinProb),
    draw_margin: round4(drawMargin),
    source_sample_size: sampleSize,
  }
}

function loadPredictions(): Prediction[] {
  const predictionsDir = path.join(process.cwd(), 'backend', 'data', 'predictions')
  if (!fs.existsSync(predictionsDir)) return []

  const files = fs.readdirSync(predictionsDir).filter((fileName) => fileName.startsWith('predictions_') && fileName.endsWith('.json'))
  const rows: Prediction[] = []

  for (const fileName of files.sort()) {
    try {
      const filePath = path.join(predictionsDir, fileName)
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { predictions?: Prediction[] }
      if (Array.isArray(parsed.predictions)) rows.push(...parsed.predictions)
    } catch {
      // Skip malformed files to keep API resilient.
    }
  }

  return rows.filter((pred) => getActualWinner(pred) !== null)
}

function loadTuningPayload(): TuningPayload {
  const tuningPath = path.join(process.cwd(), 'backend', 'data', 'model_tuning.json')
  if (!fs.existsSync(tuningPath)) return {}

  try {
    return JSON.parse(fs.readFileSync(tuningPath, 'utf-8')) as TuningPayload
  } catch {
    return {}
  }
}

export async function GET() {
  const completedPredictions = loadPredictions()
  const tuningPayload = loadTuningPayload()

  const byLeague = new Map<string, Prediction[]>()
  for (const prediction of completedPredictions) {
    const league = prediction.league || 'Unknown'
    const bucket = byLeague.get(league) || []
    bucket.push(prediction)
    byLeague.set(league, bucket)
  }

  const leagueDiagnostics: Record<string, LeagueDiagnostics> = {}
  const allAlerts: Array<{ league: string } & DriftAlert> = []

  for (const [league, rows] of Array.from(byLeague.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    const metrics = computeMetrics(rows)
    const leagueKey = LEAGUE_NAME_TO_KEY[league] || league
    const tunedFromFile = tuningPayload.leagues?.[leagueKey]
    const tuning = tunedFromFile || suggestTuning(metrics, rows.length)

    const diagnostics: LeagueDiagnostics = {
      ...metrics,
      reliability_bins: computeReliabilityBins(rows),
      confusion_matrix: computeConfusionMatrix(rows),
      walk_forward: computeWalkForward(rows),
      drift_alerts: computeDriftAlerts(rows),
      tuning,
    }

    for (const alert of diagnostics.drift_alerts) {
      allAlerts.push({ league, ...alert })
    }

    leagueDiagnostics[league] = diagnostics
  }

  const severityRank: Record<AlertSeverity, number> = {
    high: 0,
    medium: 1,
    low: 2,
  }

  const topAlerts = allAlerts
    .sort((a, b) => {
      const rankDelta = severityRank[a.severity] - severityRank[b.severity]
      if (rankDelta !== 0) return rankDelta
      return Math.abs(b.change) - Math.abs(a.change)
    })
    .slice(0, 25)

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    total_completed_predictions: completedPredictions.length,
    league_count: Object.keys(leagueDiagnostics).length,
    tuning_source: Object.keys(tuningPayload.leagues || {}).length > 0 ? 'backend/data/model_tuning.json' : 'diagnostics_fallback',
    leagues: leagueDiagnostics,
    top_alerts: topAlerts,
  })
}
