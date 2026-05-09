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

function metricValue(source: Record<string, number> | undefined, key: string): number | null {
  const value = source?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export async function GET() {
  const modelsDir = path.join(process.cwd(), 'backend', 'data', 'models')
  const paramsFile = path.join(process.cwd(), 'backend', 'data', 'league_params.json')
  const adjustmentsFile = path.join(process.cwd(), 'backend', 'data', 'predictions', 'model_adjustments.json')
  const modelSelectionFile = path.join(modelsDir, 'model_selection.json')

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

  return NextResponse.json({
    leagues: result,
    model_selection: modelSelection,
    summary: {
      total_leagues: totalCount,
      neural_ensemble_count: neuralCount,
      elo_poisson_count: totalCount - neuralCount,
      all_trained: neuralCount === totalCount,
    },
  })
}
