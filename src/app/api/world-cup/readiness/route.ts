import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const WORLD_CUP_START = '2026-06-11'
const WORLD_CUP_FINAL = '2026-07-19'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ModelMetadata = {
  model_version?: string
  trained_at?: string
  last_online_update?: string
  last_online_update_samples?: number
  samples?: number
  train_samples?: number
  test_samples?: number
  n_features?: number
  metrics?: Record<string, unknown>
}

type DiagnosticsFile = {
  generated_at?: string
  leagues?: Record<string, Record<string, unknown>>
}

type LeagueRecordFile = {
  leagues?: Record<string, Record<string, unknown>>
}

function readJson<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T
  } catch {
    return null
  }
}

function numberField(record: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = record?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function metric(meta: ModelMetadata | null, key: string): number | null {
  const value = meta?.metrics?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export async function GET() {
  const dataDir = path.join(process.cwd(), 'backend', 'data')
  const worldCupMeta = readJson<ModelMetadata>(path.join(dataDir, 'models', 'fifa.world', 'metadata.json'))
  const globalMeta = readJson<ModelMetadata>(path.join(dataDir, 'models', 'global', 'metadata.json'))
  const diagnostics = readJson<DiagnosticsFile>(path.join(dataDir, 'model_diagnostics.json'))
  const tuning = readJson<LeagueRecordFile>(path.join(dataDir, 'model_tuning.json'))
  const params = readJson<LeagueRecordFile>(path.join(dataDir, 'league_params.json'))

  const worldCupDiagnostics = diagnostics?.leagues?.['World Cup'] || null
  const worldCupParams = params?.leagues?.['fifa.world'] || null
  const worldCupTuning = tuning?.leagues?.['fifa.world'] || null

  return NextResponse.json({
    tournament: 'FIFA World Cup 2026',
    league_key: 'fifa.world',
    dates: {
      opening_match: WORLD_CUP_START,
      final: WORLD_CUP_FINAL,
    },
    model: {
      available: Boolean(worldCupMeta),
      model_version: worldCupMeta?.model_version || null,
      trained_at: worldCupMeta?.trained_at || null,
      samples: worldCupMeta?.samples || 0,
      train_samples: worldCupMeta?.train_samples || 0,
      test_samples: worldCupMeta?.test_samples || 0,
      n_features: worldCupMeta?.n_features || 0,
      ensemble_accuracy: metric(worldCupMeta, 'ensemble_accuracy'),
      nn_accuracy: metric(worldCupMeta, 'nn_accuracy'),
      ensemble_log_loss: metric(worldCupMeta, 'ensemble_log_loss'),
      goals_mae_home: metric(worldCupMeta, 'goals_mae_home'),
      goals_mae_away: metric(worldCupMeta, 'goals_mae_away'),
      global_model_available: Boolean(globalMeta),
      global_model_trained_at: globalMeta?.trained_at || null,
      global_model_last_online_update: globalMeta?.last_online_update || null,
      global_model_last_online_update_samples: globalMeta?.last_online_update_samples || 0,
    },
    diagnostics: worldCupDiagnostics ? {
      generated_at: diagnostics?.generated_at || null,
      sample_size: numberField(worldCupDiagnostics, 'sample_size') || 0,
      accuracy: numberField(worldCupDiagnostics, 'accuracy'),
      brier_score: numberField(worldCupDiagnostics, 'brier_score'),
      expected_calibration_error: numberField(worldCupDiagnostics, 'expected_calibration_error'),
      draw_actual_rate: numberField(worldCupDiagnostics, 'draw_actual_rate'),
      draw_predicted_rate: numberField(worldCupDiagnostics, 'draw_predicted_rate'),
    } : null,
    calibration: {
      league_params_available: Boolean(worldCupParams),
      tuning_available: Boolean(worldCupTuning),
      avg_goals: numberField(worldCupParams, 'avg_goals'),
      draw_rate: numberField(worldCupParams, 'draw_rate'),
      home_adv: numberField(worldCupParams, 'home_adv'),
      blend_nn_base: numberField(worldCupTuning, 'blend_nn_base'),
      blend_nn_min: numberField(worldCupTuning, 'blend_nn_min'),
      blend_nn_max: numberField(worldCupTuning, 'blend_nn_max'),
    },
    data_integrity: {
      fixture_source: 'ESPN/FotMob public endpoints',
      prediction_source: 'Unified neural-first API with calibrated ELO-Poisson fallback',
      unavailable_fields_policy: 'Hide missing venue, weather, referee, H2H, and model fields instead of fabricating values.',
      simulated_weather_enabled: process.env.ALLOW_SIMULATED_WEATHER === 'true',
    },
  }, {
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
  })
}
