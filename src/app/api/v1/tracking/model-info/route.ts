import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const LEAGUE_DISPLAY: Record<string, string> = {
  'eng.1': 'Premier League',
  'esp.1': 'La Liga',
  'ger.1': 'Bundesliga',
  'ita.1': 'Serie A',
  'fra.1': 'Ligue 1',
  'ned.1': 'Eredivisie',
  'por.1': 'Primeira Liga',
  'usa.1': 'MLS',
  'uefa.champions': 'Champions League',
  'uefa.europa': 'Europa League',
  'uefa.europa.conf': 'Conference League',
  'fifa.world': 'FIFA World Cup',
  'uefa.euro': 'UEFA Euro',
  'conmebol.america': 'Copa America',
  global: 'Global Cross-League',
}

interface ModelMetadata {
  league: string
  trained_at: string
  samples: number
  train_samples: number
  test_samples: number
  metrics: Record<string, number>
  architecture: {
    outcome_layers: number[]
    goals_layers: number[]
    ensemble_models: string[]
  }
}

interface LeagueModelInfo {
  league_key: string
  display_name: string
  model_type: 'neural_ensemble' | 'elo_poisson'
  is_fitted: boolean
  trained_at: string | null
  samples: number
  metrics: Record<string, number>
  architecture: {
    outcome_layers: number[]
    goals_layers: number[]
    ensemble_models: string[]
  } | null
}

interface ModelSelectionDecision {
  league_key: string
  display_name: string
  decision: string
  reason: string
  global_blend_weight: number
  sample_size: number | null
  best_accuracy: number | null
  league_accuracy: number | null
  global_accuracy: number | null
  best_f1_macro: number | null
}

interface ModelSelectionPolicy {
  generated_at?: string
  promoted_leagues?: string[]
  league_decisions?: Record<string, {
    decision?: string
    reason?: string
    global_blend_weight?: number
    same_fixture_comparison?: {
      sample_size?: number
      best_metrics?: Record<string, number>
      league?: Record<string, number>
      global?: Record<string, number>
    }
  }>
}

interface QualityGateCheck {
  id: string
  label: string
  status: 'pass' | 'monitor' | 'fail'
  value: number | null
  threshold: string
  note: string
}

interface LeagueQualityGate {
  league_key: string
  display_name: string
  status: 'pass' | 'monitor' | 'fail'
  samples: number
  accuracy: number | null
  f1_macro: number | null
  log_loss: number | null
  mean_brier: number | null
  notes: string[]
}

function metricValue(source: Record<string, number> | undefined, key: string): number | null {
  const value = source?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function meanBrier(source: Record<string, number> | undefined): number | null {
  const values = ['brier_home_win', 'brier_draw', 'brier_away_win']
    .map(key => metricValue(source, key))
    .filter((value): value is number => value != null)
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function minGate(value: number | null, pass: number, monitor: number): 'pass' | 'monitor' | 'fail' {
  if (value == null) return 'fail'
  if (value >= pass) return 'pass'
  if (value >= monitor) return 'monitor'
  return 'fail'
}

function maxGate(value: number | null, pass: number, monitor: number): 'pass' | 'monitor' | 'fail' {
  if (value == null) return 'fail'
  if (value <= pass) return 'pass'
  if (value <= monitor) return 'monitor'
  return 'fail'
}

function combineStatuses(statuses: Array<'pass' | 'monitor' | 'fail'>): 'pass' | 'monitor' | 'fail' {
  if (statuses.includes('fail')) return 'fail'
  if (statuses.includes('monitor')) return 'monitor'
  return 'pass'
}

function buildLeagueGate(key: string, info: LeagueModelInfo): LeagueQualityGate {
  const metrics = info.metrics || {}
  const accuracy = metricValue(metrics, 'ensemble_accuracy')
  const f1 = metricValue(metrics, 'ensemble_f1_macro')
  const logLoss = metricValue(metrics, 'ensemble_log_loss')
  const brier = meanBrier(metrics)
  const sampleStatus = minGate(info.samples, 500, 250)
  const accuracyStatus = minGate(accuracy, 0.44, 0.38)
  const f1Status = minGate(f1, 0.40, 0.34)
  const logLossStatus = maxGate(logLoss, 1.08, 1.16)
  const brierStatus = maxGate(brier, 0.215, 0.235)
  const status = combineStatuses([sampleStatus, accuracyStatus, f1Status, logLossStatus, brierStatus])
  const notes: string[] = []

  if (sampleStatus !== 'pass') notes.push('needs more settled historical samples')
  if (accuracyStatus !== 'pass') notes.push('outcome accuracy below production threshold')
  if (f1Status !== 'pass') notes.push('macro F1 indicates weak class balance')
  if (logLossStatus !== 'pass' || brierStatus !== 'pass') notes.push('calibration needs monitoring')
  if (notes.length === 0) notes.push('meets current governance thresholds')

  return {
    league_key: key,
    display_name: info.display_name,
    status,
    samples: info.samples,
    accuracy,
    f1_macro: f1,
    log_loss: logLoss,
    mean_brier: brier,
    notes,
  }
}

export async function GET() {
  const modelsDir = path.join(process.cwd(), 'backend', 'data', 'models')
  const paramsFile = path.join(process.cwd(), 'backend', 'data', 'league_params.json')
  const adjustmentsFile = path.join(process.cwd(), 'backend', 'data', 'predictions', 'model_adjustments.json')
  const modelSelectionFile = path.join(modelsDir, 'model_selection.json')
  const trainingResultsFile = path.join(process.cwd(), 'backend', 'data', 'training_results.json')

  // Load league params
  let leagueKeys = Object.keys(LEAGUE_DISPLAY)
  try {
    if (fs.existsSync(paramsFile)) {
      const params = JSON.parse(fs.readFileSync(paramsFile, 'utf-8'))
      if (params.leagues) {
        leagueKeys = Object.keys(params.leagues)
      }
    }
  } catch { /* use defaults */ }
  if (!leagueKeys.includes('global')) {
    leagueKeys = [...leagueKeys, 'global']
  }

  // Load adjustments (live accuracy data from train_feedback)
  let adjustments: Record<string, Record<string, number>> = {}
  try {
    if (fs.existsSync(adjustmentsFile)) {
      const adjData = JSON.parse(fs.readFileSync(adjustmentsFile, 'utf-8'))
      adjustments = adjData.by_league || {}
    }
  } catch { /* skip */ }

  // Map display name → key for matching adjustments
  const displayToKey: Record<string, string> = {}
  for (const [k, v] of Object.entries(LEAGUE_DISPLAY)) {
    displayToKey[v] = k
  }

  const result: Record<string, LeagueModelInfo> = {}

  for (const key of leagueKeys) {
    const display = LEAGUE_DISPLAY[key] || key
    const metadataFile = path.join(modelsDir, key, 'metadata.json')
    
    let info: LeagueModelInfo = {
      league_key: key,
      display_name: display,
      model_type: 'elo_poisson',
      is_fitted: false,
      trained_at: null,
      samples: 0,
      metrics: {},
      architecture: null,
    }

    // Check for trained neural model
    try {
      if (fs.existsSync(metadataFile)) {
        const meta: ModelMetadata = JSON.parse(fs.readFileSync(metadataFile, 'utf-8'))
        info = {
          ...info,
          model_type: 'neural_ensemble',
          is_fitted: true,
          trained_at: meta.trained_at,
          samples: meta.samples,
          metrics: meta.metrics || {},
          architecture: meta.architecture || null,
        }
      }
    } catch { /* not trained yet */ }

    // Merge live accuracy from feedback loop
    const adjKey = display
    if (adjustments[adjKey]) {
      info.metrics = {
        ...info.metrics,
        live_accuracy: adjustments[adjKey].accuracy,
        live_brier: adjustments[adjKey].brier_score,
        live_predictions: adjustments[adjKey].predictions,
      }
    }

    result[key] = info
  }

  // Count neural vs baseline
  const neuralCount = Object.values(result).filter(m => m.is_fitted).length
  const totalCount = Object.keys(result).length
  let modelSelection: {
    generated_at?: string
    promoted_leagues: string[]
    decision_counts: Record<string, number>
    decisions: ModelSelectionDecision[]
  } | null = null

  try {
    if (fs.existsSync(modelSelectionFile)) {
      const policy: ModelSelectionPolicy = JSON.parse(fs.readFileSync(modelSelectionFile, 'utf-8'))
      const decisions = Object.entries(policy.league_decisions || {}).map(([key, decision]) => {
        const comparison = decision.same_fixture_comparison
        const best = comparison?.best_metrics
        const league = comparison?.league
        const global = comparison?.global
        return {
          league_key: key,
          display_name: LEAGUE_DISPLAY[key] || key,
          decision: decision.decision || 'league',
          reason: decision.reason || 'policy_unavailable',
          global_blend_weight: typeof decision.global_blend_weight === 'number' ? decision.global_blend_weight : 0,
          sample_size: typeof comparison?.sample_size === 'number' ? comparison.sample_size : null,
          best_accuracy: metricValue(best, 'accuracy'),
          league_accuracy: metricValue(league, 'accuracy'),
          global_accuracy: metricValue(global, 'accuracy'),
          best_f1_macro: metricValue(best, 'f1_macro'),
        }
      })
      const decisionCounts = decisions.reduce<Record<string, number>>((acc, item) => {
        acc[item.decision] = (acc[item.decision] || 0) + 1
        return acc
      }, {})
      modelSelection = {
        generated_at: policy.generated_at,
        promoted_leagues: policy.promoted_leagues || [],
        decision_counts: decisionCounts,
        decisions,
      }
    }
  } catch { /* skip model-selection policy */ }

  let qualityGate: {
    generated_at: string | null
    guarantee: false
    standard: string
    overall_status: 'pass' | 'monitor' | 'fail'
    checks: QualityGateCheck[]
    league_gates: LeagueQualityGate[]
    guardrails: string[]
  } | null = null

  try {
    const globalInfo = result.global
    const globalMetrics = globalInfo?.metrics || {}
    const globalAccuracy = metricValue(globalMetrics, 'ensemble_accuracy')
    const globalF1 = metricValue(globalMetrics, 'ensemble_f1_macro')
    const globalLogLoss = metricValue(globalMetrics, 'ensemble_log_loss')
    const globalBrier = meanBrier(globalMetrics)
    let trainedAt: string | null = globalInfo?.trained_at || null

    if (fs.existsSync(trainingResultsFile)) {
      const trainingResults = JSON.parse(fs.readFileSync(trainingResultsFile, 'utf-8'))
      trainedAt = trainingResults.trained_at || trainedAt
    }

    const checks: QualityGateCheck[] = [
      {
        id: 'global_samples',
        label: 'Global training coverage',
        status: minGate(globalInfo?.samples ?? null, 50000, 25000),
        value: globalInfo?.samples ?? null,
        threshold: 'pass >= 50,000 matches',
        note: 'Cross-league model should be trained on a broad historical base.',
      },
      {
        id: 'global_accuracy',
        label: 'Global 1X2 accuracy',
        status: minGate(globalAccuracy, 0.48, 0.44),
        value: globalAccuracy,
        threshold: 'pass >= 48%',
        note: 'Measured on the chronological test split.',
      },
      {
        id: 'global_f1',
        label: 'Global macro F1',
        status: minGate(globalF1, 0.45, 0.40),
        value: globalF1,
        threshold: 'pass >= 45%',
        note: 'Protects against a model that only performs well on one outcome class.',
      },
      {
        id: 'global_log_loss',
        label: 'Global log loss',
        status: maxGate(globalLogLoss, 1.05, 1.12),
        value: globalLogLoss,
        threshold: 'pass <= 1.05',
        note: 'Lower is better and punishes overconfident misses.',
      },
      {
        id: 'global_brier',
        label: 'Mean Brier score',
        status: maxGate(globalBrier, 0.21, 0.235),
        value: globalBrier,
        threshold: 'pass <= 0.210',
        note: 'A calibration-focused probability score across H/D/A outputs.',
      },
    ]

    const leagueGates = Object.entries(result)
      .filter(([key, info]) => key !== 'global' && info.is_fitted)
      .map(([key, info]) => buildLeagueGate(key, info))
      .sort((a, b) => {
        const rank = { fail: 0, monitor: 1, pass: 2 }
        return rank[a.status] - rank[b.status]
      })

    const globalStatus = combineStatuses(checks.map(check => check.status))
    const leagueNeedsWork = leagueGates.some(gate => gate.status !== 'pass')
    qualityGate = {
      generated_at: trainedAt,
      guarantee: false,
      standard: 'sportsbook-style governance: source coverage, chronological holdout, calibration, model-selection gates, and market-implied comparison',
      overall_status: globalStatus === 'fail' ? 'fail' : leagueNeedsWork ? 'monitor' : 'pass',
      checks,
      league_gates: leagueGates,
      guardrails: [
        'No betting guarantee is displayed or returned by the API.',
        'Provider-missing fields remain unavailable instead of being fabricated.',
        'Live win probability is withheld unless score, clock, pre-match model, and live stats are present.',
        'Market intelligence uses user-supplied odds and removes overround before comparing model edge.',
        'Data-quality CI blocks empty Euro, Copa America, Champions League, and Europa League source files.',
      ],
    }
  } catch {
    qualityGate = null
  }

  return NextResponse.json({
    leagues: result,
    model_selection: modelSelection,
    quality_gate: qualityGate,
    summary: {
      total_leagues: totalCount,
      neural_ensemble_count: neuralCount,
      elo_poisson_count: totalCount - neuralCount,
      all_trained: neuralCount === totalCount,
    },
  })
}
