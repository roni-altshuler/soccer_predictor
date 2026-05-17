'use client'

import { useState, useEffect, useCallback } from 'react'

/* ──────────────────────────────────────────────────────────────────────
   Types
   ────────────────────────────────────────────────────────────────────── */

interface TrendPoint {
  index: number
  date: string
  accuracy: number
  correct: number
  total: number
  sample_match: string
}

interface PredSummary {
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

interface CalibrationBin {
  bucket: string
  count: number
  avg_confidence: number
  accuracy: number
}

interface OverallMetrics {
  total_predictions: number
  completed_predictions: number
  pending_predictions?: number
  winner_correct_count: number
  winner_accuracy: number
  avg_confidence?: number
  exact_scoreline_count: number
  exact_scoreline_rate: number
  weighted_accuracy_score?: number
  brier_score: number
  log_loss?: number
  expected_calibration_error?: number
  high_confidence_accuracy: number
  medium_confidence_accuracy: number
  low_confidence_accuracy: number
  threshold_qualified_predictions?: number
  threshold_qualified_accuracy?: number
  threshold_qualification_rate?: number
  threshold_lift?: number
  recent_accuracy: number
  avg_goals_difference: number
  within_1_goal_rate: number
  home_win_predicted?: number
  home_win_correct?: number
  draw_predicted?: number
  draw_correct?: number
  away_win_predicted?: number
  away_win_correct?: number
  calibration_bins?: CalibrationBin[]
}

interface TrackingPolicy {
  min_confidence: number
  min_edge: number
}

interface LeagueSummaryItem {
  league: string
  total: number
  predictions: number
  pending: number
  accuracy: number
  weighted_accuracy: number
  weightedAccuracy?: number
  correct: number
  scoreline_accuracy: number
  brier_score: number
  log_loss: number
  expected_calibration_error: number
}

interface ModelInfoResponse {
  summary?: {
    neural_ensemble_count?: number
  }
  model_selection?: {
    generated_at?: string
    promoted_leagues: string[]
    decision_counts: Record<string, number>
    decisions: ModelSelectionDecision[]
  } | null
  quality_gate?: ModelQualityGate | null
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

interface ModelQualityGate {
  generated_at: string | null
  guarantee: false
  standard: string
  overall_status: 'pass' | 'monitor' | 'fail'
  checks: QualityGateCheck[]
  league_gates: LeagueQualityGate[]
  guardrails: string[]
}

interface FetcherStatusResponse {
  last_run?: string
  outcomes_since_retrain?: number
  retrain_threshold?: number
}

interface AccuracySummary {
  overall: OverallMetrics
  last_30_days: OverallMetrics
  by_league: Record<string, LeagueSummaryItem>
  policy?: TrackingPolicy
  recent_form: string[]
  current_streak: { type: string; count: number }
  recent_predictions: PredSummary[]
}

interface TrendData {
  window: number
  data_points: number
  trend: TrendPoint[]
  latest_accuracy: number | null
}

interface CalibrationTrendPoint {
  index: number
  date: string
  sample_size: number
  accuracy: number
  avg_confidence: number
  brier_score: number
  log_loss: number
  expected_calibration_error: number
  overconfidence: number
  sample_match?: string
}

interface CalibrationTrendData {
  window: number
  step: number
  data_points: number
  trend: CalibrationTrendPoint[]
  latest: CalibrationTrendPoint | null
}

/* ──────────────────────────────────────────────────────────────────────
   Helpers
   ────────────────────────────────────────────────────────────────────── */

function pct(n: number): string {
  return (n * 100).toFixed(1) + '%'
}

function pp(n: number): string {
  const sign = n > 0 ? '+' : ''
  return sign + (n * 100).toFixed(1) + 'pp'
}

function accuracyColor(a: number): string {
  if (a >= 0.6) return '#22c55e'
  if (a >= 0.45) return '#f59e0b'
  return '#ef4444'
}

function winnerLabel(w: string): string {
  if (w === 'home') return 'H'
  if (w === 'away') return 'A'
  return 'D'
}

/* ──────────────────────────────────────────────────────────────────────
   Main Component
   ────────────────────────────────────────────────────────────────────── */

export default function AccuracyDashboard() {
  const [summary, setSummary] = useState<AccuracySummary | null>(null)
  const [trend, setTrend] = useState<TrendData | null>(null)
  const [modelInfo, setModelInfo] = useState<ModelInfoResponse | null>(null)
  const [calibrationTrend, setCalibrationTrend] = useState<CalibrationTrendData | null>(null)
  const [loading, setLoading] = useState(true)
  const [trendWindow, setTrendWindow] = useState(10)
  const [fetcherStatus, setFetcherStatus] = useState<FetcherStatusResponse | null>(null)
  const [fetching, setFetching] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [summaryRes, trendRes, statusRes, modelRes, calibrationTrendRes] = await Promise.all([
        fetch('/api/v1/tracking/accuracy/summary'),
        fetch('/api/v1/tracking/accuracy/trend?window=' + trendWindow),
        fetch('/api/v1/tracking/outcome-status'),
        fetch('/api/v1/tracking/model-info'),
        fetch('/api/v1/tracking/calibration-trend?window=100&step=25'),
      ])
      if (summaryRes.ok) setSummary(await summaryRes.json())
      if (trendRes.ok) setTrend(await trendRes.json())
      if (statusRes.ok) setFetcherStatus(await statusRes.json())
      if (modelRes.ok) setModelInfo(await modelRes.json())
      if (calibrationTrendRes.ok) setCalibrationTrend(await calibrationTrendRes.json())
    } catch (e) {
      console.error('Failed to fetch accuracy data:', e)
    } finally {
      setLoading(false)
    }
  }, [trendWindow])

  useEffect(() => { load() }, [load])

  const triggerFetch = async () => {
    setFetching(true)
    try {
      await fetch('/api/v1/tracking/fetch-outcomes', { method: 'POST' })
      await load()
    } finally {
      setFetching(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-40 bg-[var(--muted-bg)] rounded-2xl" />
        <div className="h-64 bg-[var(--muted-bg)] rounded-2xl" />
        <div className="h-96 bg-[var(--muted-bg)] rounded-2xl" />
      </div>
    )
  }

  if (!summary) {
    return (
      <div className="text-center py-12 text-[var(--text-tertiary)]">
        No accuracy data available yet. Make some predictions first!
      </div>
    )
  }

  const m = summary.overall

  return (
    <div className="space-y-5">
      {/* Hero Metrics Row */}
      <HeroMetrics metrics={m} streak={summary.current_streak} form={summary.recent_form} />

      <div className="grid grid-cols-1 xl:grid-cols-[1.35fr_0.9fr] gap-5">
        <BettingEdgeDesk metrics={m} last30={summary.last_30_days} policy={summary.policy} />
        <CalibrationPanel metrics={m} />
      </div>

      <CalibrationTrendHistory data={calibrationTrend} />

      <OutcomeAccuracy metrics={m} />

      <ModelQualityGatePanel gate={modelInfo?.quality_gate ?? null} />

      {/* Accuracy Over Time */}
      {trend && trend.data_points > 0 && (
        <TrendChart trend={trend} window={trendWindow} onWindowChange={setTrendWindow} />
      )}

      {/* League Breakdown */}
      {Object.keys(summary.by_league).length > 0 && (
        <LeagueBreakdown data={summary.by_league} />
      )}

      {/* Prediction History */}
      <PredictionHistory initialPredictions={summary.recent_predictions} />

      {/* Model Info + Fetch */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <ModelCard modelInfo={modelInfo} />
        <ModelPolicyCard policy={modelInfo?.model_selection ?? null} />
        <FetcherPanel status={fetcherStatus} fetching={fetching} onFetch={triggerFetch} />
      </div>
    </div>
  )
}

function BettingEdgeDesk({
  metrics,
  last30,
  policy,
}: {
  metrics: OverallMetrics
  last30: OverallMetrics
  policy?: TrackingPolicy
}) {
  const baseline = 1 / 3
  const qualified = metrics.threshold_qualified_predictions ?? 0
  const qualifiedAcc = metrics.threshold_qualified_accuracy ?? 0
  const qualificationRate = metrics.threshold_qualification_rate ?? 0
  const thresholdLift = metrics.threshold_lift ?? 0
  const recentDelta = last30.completed_predictions > 0 ? last30.winner_accuracy - metrics.winner_accuracy : 0
  const confidenceGap = metrics.high_confidence_accuracy - metrics.low_confidence_accuracy
  const policyConf = Math.round((policy?.min_confidence ?? 0.55) * 100)
  const policyEdge = Math.round((policy?.min_edge ?? 0.12) * 100)

  const cards = [
    {
      label: 'Model Edge vs Random',
      value: pp(metrics.winner_accuracy - baseline),
      tone: metrics.winner_accuracy - baseline >= 0.08 ? '#22c55e' : metrics.winner_accuracy - baseline >= 0.03 ? '#f59e0b' : '#ef4444',
      note: '1X2 hit rate over 33.3% random baseline',
    },
    {
      label: 'Policy Pick Accuracy',
      value: qualified > 0 ? pct(qualifiedAcc) : 'N/A',
      tone: qualified === 0 ? '#94a3b8' : accuracyColor(qualifiedAcc),
      note: qualified > 0
        ? `${qualified} picks (${pct(qualificationRate)} of settled picks)`
        : `Need picks above ${policyConf}% confidence and ${policyEdge}pp edge`,
    },
    {
      label: 'Policy Lift',
      value: qualified > 0 ? pp(thresholdLift) : 'N/A',
      tone: qualified === 0 ? '#94a3b8' : thresholdLift >= 0.03 ? '#22c55e' : thresholdLift >= 0 ? '#f59e0b' : '#ef4444',
      note: 'Difference between filtered picks and all settled picks',
    },
    {
      label: 'High vs Low Conf Gap',
      value: pp(confidenceGap),
      tone: confidenceGap >= 0.1 ? '#22c55e' : confidenceGap >= 0.04 ? '#f59e0b' : '#ef4444',
      note: `${pct(metrics.high_confidence_accuracy)} (high) vs ${pct(metrics.low_confidence_accuracy)} (low)`,
    },
    {
      label: 'Recent Momentum',
      value: last30.completed_predictions > 0 ? pp(recentDelta) : 'N/A',
      tone: last30.completed_predictions === 0 ? '#94a3b8' : recentDelta >= 0.03 ? '#22c55e' : recentDelta >= -0.03 ? '#f59e0b' : '#ef4444',
      note: last30.completed_predictions > 0
        ? `Last 30 days (${last30.completed_predictions} settled picks)`
        : 'Need more recent settled picks for momentum',
    },
  ]

  return (
    <div className="bg-[var(--card-bg)] border rounded-2xl p-5" style={{ borderColor: 'var(--border-color)' }}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
        <h3 className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-normal">Decision Edge Desk</h3>
        <span className="text-[10px] text-[var(--text-tertiary)]">
          Edge, selectivity, and confidence separation from settled real results.
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl border p-3 bg-[var(--muted-bg)]" style={{ borderColor: 'var(--border-color)' }}>
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">{card.label}</p>
            <p className="text-xl font-bold mt-1" style={{ color: card.tone }}>{card.value}</p>
            <p className="text-[10px] mt-1 text-[var(--text-tertiary)] leading-relaxed">{card.note}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function gateTone(status: 'pass' | 'monitor' | 'fail'): string {
  if (status === 'pass') return '#22c55e'
  if (status === 'monitor') return '#f59e0b'
  return '#ef4444'
}

function gateLabel(status: 'pass' | 'monitor' | 'fail'): string {
  if (status === 'pass') return 'Pass'
  if (status === 'monitor') return 'Monitor'
  return 'Needs work'
}

function formatGateValue(check: QualityGateCheck): string {
  if (check.value == null) return 'N/A'
  if (check.id.includes('samples')) return Math.round(check.value).toLocaleString()
  if (check.id.includes('loss') || check.id.includes('brier')) return check.value.toFixed(3)
  return pct(check.value)
}

function ModelQualityGatePanel({ gate }: { gate: ModelQualityGate | null }) {
  const leagueAlerts = (gate?.league_gates || [])
    .filter(item => item.status !== 'pass')
    .slice(0, 6)
  const leagueRows = [...(gate?.league_gates || [])].sort((a, b) => {
    const statusRank = { fail: 0, monitor: 1, pass: 2 }
    return statusRank[a.status] - statusRank[b.status] || (a.accuracy ?? 0) - (b.accuracy ?? 0)
  })

  return (
    <div className="bg-[var(--card-bg)] border rounded-2xl p-5" style={{ borderColor: 'var(--border-color)' }}>
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3 mb-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-normal text-[var(--text-tertiary)]">Sportsbook-Style Governance</p>
          <h3 className="mt-1 text-xl font-black text-[var(--text-primary)]">Model quality gate</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--text-secondary)]">
            This board checks coverage, calibration, and holdout performance before presenting model confidence. It is a probability audit layer, not a betting guarantee.
          </p>
        </div>
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--muted-bg)] px-4 py-3 min-w-[170px]">
          <p className="text-[10px] uppercase text-[var(--text-tertiary)]">Overall Gate</p>
          <p className="mt-1 text-2xl font-black" style={{ color: gate ? gateTone(gate.overall_status) : '#94a3b8' }}>
            {gate ? gateLabel(gate.overall_status) : 'N/A'}
          </p>
          <p className="text-[10px] text-[var(--text-tertiary)]">
            {gate?.generated_at ? new Date(gate.generated_at).toLocaleDateString() : 'No artifact'}
          </p>
        </div>
      </div>

      {gate ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-4">
            {gate.checks.map(check => (
              <div key={check.id} className="rounded-xl border bg-[var(--muted-bg)] p-3" style={{ borderColor: 'var(--border-color)' }}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[10px] uppercase tracking-normal text-[var(--text-tertiary)]">{check.label}</p>
                  <span className="h-2 w-2 rounded-full mt-1.5" style={{ backgroundColor: gateTone(check.status) }} />
                </div>
                <p className="mt-2 text-lg font-black" style={{ color: gateTone(check.status) }}>{formatGateValue(check)}</p>
                <p className="text-[10px] text-[var(--text-tertiary)]">{check.threshold}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_0.9fr] gap-4">
            <div className="rounded-xl border border-[var(--border-color)] bg-[var(--muted-bg)] p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <p className="text-[10px] font-semibold uppercase tracking-normal text-[var(--text-tertiary)]">League Attention Queue</p>
                <span className="text-[10px] text-[var(--text-tertiary)]">{leagueAlerts.length} shown</span>
              </div>
              {leagueAlerts.length > 0 ? (
                <div className="space-y-2">
                  {leagueAlerts.map(item => (
                    <div key={item.league_key} className="flex items-center justify-between gap-3 rounded-lg bg-[var(--card-bg)] border border-[var(--border-color)] px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-[var(--text-primary)]">{item.display_name}</p>
                        <p className="text-[10px] text-[var(--text-tertiary)] truncate">{item.notes[0]}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-bold" style={{ color: gateTone(item.status) }}>{gateLabel(item.status)}</p>
                        <p className="text-[10px] text-[var(--text-tertiary)]">
                          {item.accuracy != null ? pct(item.accuracy) : 'N/A'} acc · n={item.samples.toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[var(--text-secondary)]">All trained leagues currently meet the configured quality thresholds.</p>
              )}
            </div>

            <div className="rounded-xl border border-[var(--border-color)] bg-[var(--muted-bg)] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-normal text-[var(--text-tertiary)] mb-3">Guardrails</p>
              <div className="space-y-2">
                {gate.guardrails.slice(0, 5).map(item => (
                  <div key={item} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[var(--accent-primary)]" />
                    <p className="text-xs leading-5 text-[var(--text-secondary)]">{item}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {leagueRows.length > 0 && (
            <div className="mt-4 rounded-xl border border-[var(--border-color)] overflow-hidden">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 px-4 py-3 bg-[var(--muted-bg)] border-b border-[var(--border-color)]">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-normal text-[var(--text-tertiary)]">Per-League Model Drilldown</p>
                  <p className="text-[10px] text-[var(--text-tertiary)]">Accuracy, F1, log-loss, and Brier checks from saved training artifacts.</p>
                </div>
                <span className="text-[10px] text-[var(--text-tertiary)]">{leagueRows.length} competitions</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-normal text-[var(--text-tertiary)] bg-[var(--card-bg)]">
                      <th className="px-4 py-2 text-left font-semibold">League</th>
                      <th className="px-3 py-2 text-left font-semibold">Status</th>
                      <th className="px-3 py-2 text-right font-semibold">Samples</th>
                      <th className="px-3 py-2 text-right font-semibold">Accuracy</th>
                      <th className="px-3 py-2 text-right font-semibold">F1</th>
                      <th className="px-3 py-2 text-right font-semibold">Log Loss</th>
                      <th className="px-3 py-2 text-right font-semibold">Brier</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-color)]">
                    {leagueRows.map(item => (
                      <tr key={item.league_key} className="hover:bg-[var(--muted-bg)]/55">
                        <td className="px-4 py-2.5">
                          <p className="font-semibold text-[var(--text-primary)]">{item.display_name}</p>
                          <p className="text-[10px] text-[var(--text-tertiary)]">{item.notes[0] || 'Quality gate evaluated'}</p>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ color: gateTone(item.status), backgroundColor: gateTone(item.status) + '1A' }}>
                            {gateLabel(item.status)}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right text-[var(--text-secondary)]">{item.samples.toLocaleString()}</td>
                        <td className="px-3 py-2.5 text-right font-semibold" style={{ color: item.accuracy != null ? accuracyColor(item.accuracy) : '#94a3b8' }}>
                          {item.accuracy != null ? pct(item.accuracy) : 'N/A'}
                        </td>
                        <td className="px-3 py-2.5 text-right text-[var(--text-secondary)]">{item.f1_macro != null ? pct(item.f1_macro) : 'N/A'}</td>
                        <td className="px-3 py-2.5 text-right text-[var(--text-secondary)]">{item.log_loss != null ? item.log_loss.toFixed(3) : 'N/A'}</td>
                        <td className="px-3 py-2.5 text-right text-[var(--text-secondary)]">{item.mean_brier != null ? item.mean_brier.toFixed(3) : 'N/A'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-[var(--text-secondary)]">
          Run the full historical retraining and model-info generation to populate the quality gate.
        </p>
      )}
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────────────
   HeroMetrics — Primary accuracy display
   ────────────────────────────────────────────────────────────────────── */

function HeroMetrics({
  metrics,
  streak,
  form,
}: {
  metrics: OverallMetrics
  streak: { type: string; count: number }
  form: string[]
}) {
  const outcomeAcc = metrics.winner_accuracy
  const scoreAcc = metrics.exact_scoreline_rate
  const weightedAcc = metrics.weighted_accuracy_score ?? ((metrics.winner_accuracy * 0.65) + (metrics.exact_scoreline_rate * 0.35))
  const outcomeColor = accuracyColor(outcomeAcc)
  const weightedColor = accuracyColor(weightedAcc)
  const confidenceGap = Math.abs((metrics.avg_confidence ?? 0) - metrics.winner_accuracy)
  const pending = metrics.pending_predictions ?? Math.max(metrics.total_predictions - metrics.completed_predictions, 0)
  const formWins = form.filter((r) => r === 'W').length
  const formRate = form.length > 0 ? formWins / form.length : 0
  const scoreBar = Math.min(100, Math.max(2, scoreAcc * 100))
  const outcomeBar = Math.min(100, Math.max(2, outcomeAcc * 100))
  const weightedBar = Math.min(100, Math.max(2, weightedAcc * 100))

  return (
    <div className="border border-[var(--border-color)] bg-[var(--card-bg)] overflow-hidden">
      <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="p-5 md:p-6 border-b xl:border-b-0 xl:border-r border-[var(--border-color)]">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-normal text-[var(--text-tertiary)]">AI Visualization Board</p>
              <h2 className="mt-1 text-2xl font-black text-[var(--text-primary)]">Model performance report</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
                Outcome accuracy is scored only after real match results are fetched. Scoreline accuracy is tracked separately because exact scores are a much stricter target than 1X2 outcomes.
              </p>
            </div>
            <div className="min-w-[150px] rounded-lg border border-[var(--border-color)] bg-[var(--muted-bg)] p-3">
              <p className="text-[10px] uppercase tracking-normal text-[var(--text-tertiary)]">Audit Score</p>
              <p className="mt-1 text-3xl font-black" style={{ color: weightedColor }}>{pct(weightedAcc)}</p>
              <p className="text-[11px] text-[var(--text-secondary)]">65% outcome, 35% scoreline</p>
            </div>
          </div>

          <div className="mt-6 space-y-4">
            <MetricRail
              label="1X2 outcome hit rate"
              value={pct(outcomeAcc)}
              detail={`${metrics.winner_correct_count}/${metrics.completed_predictions} settled picks`}
              width={outcomeBar}
              color={outcomeColor}
            />
            <MetricRail
              label="Exact scoreline hit rate"
              value={pct(scoreAcc)}
              detail={`${metrics.exact_scoreline_count ?? 0}/${metrics.completed_predictions} exact scores`}
              width={scoreBar}
              color={accuracyColor(scoreAcc)}
            />
            <MetricRail
              label="Weighted audit score"
              value={pct(weightedAcc)}
              detail="Blends outcome value and scoreline precision"
              width={weightedBar}
              color={weightedColor}
            />
          </div>
        </div>

        <div className="p-5 md:p-6">
          <div className="grid grid-cols-2 gap-3">
            <AuditTile label="Completed" value={metrics.completed_predictions.toLocaleString()} note={`${pending.toLocaleString()} pending`} />
            <AuditTile label="Avg Confidence" value={pct(metrics.avg_confidence ?? 0)} note={`${pct(confidenceGap)} calibration gap`} />
            <AuditTile label="Brier" value={(metrics.brier_score ?? 0).toFixed(3)} note="Lower is better" />
            <AuditTile label="Within 1 Goal" value={pct(metrics.within_1_goal_rate ?? 0)} note="Score closeness" />
          </div>

          <div className="mt-5 rounded-lg border border-[var(--border-color)] bg-[var(--muted-bg)] p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-normal text-[var(--text-tertiary)]">Recent settled form</p>
                <p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">
                  {form.length > 0 ? `${pct(formRate)} over last ${form.length}` : 'Waiting for settled picks'}
                </p>
              </div>
              {streak.type !== 'N/A' && (
                <p className="text-xs text-[var(--text-secondary)]">
                  Streak <span className="font-semibold text-[var(--text-primary)]">{streak.count}</span> {streak.type === 'W' ? 'correct' : 'missed'}
                </p>
              )}
            </div>
            <div className="mt-3 grid grid-cols-10 gap-1">
              {form.slice(0, 10).map((r, i) => (
                <div
                  key={i}
                  className={`h-7 rounded flex items-center justify-center text-[10px] font-bold ${
                    r === 'W'
                      ? 'bg-emerald-500/18 text-emerald-300'
                      : 'bg-red-500/18 text-red-300'
                  }`}
                >
                  {r === 'W' ? '✓' : '×'}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function MetricRail({
  label,
  value,
  detail,
  width,
  color,
}: {
  label: string
  value: string
  detail: string
  width: number
  color: string
}) {
  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--text-primary)]">{label}</p>
          <p className="text-xs text-[var(--text-tertiary)]">{detail}</p>
        </div>
        <p className="text-lg font-black" style={{ color }}>{value}</p>
      </div>
      <div className="mt-2 h-2 rounded-full bg-[var(--muted-bg)] overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${width}%`, backgroundColor: color }} />
      </div>
    </div>
  )
}

function AuditTile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--muted-bg)] p-3">
      <p className="text-[10px] font-semibold uppercase tracking-normal text-[var(--text-tertiary)]">{label}</p>
      <p className="mt-1 text-xl font-black text-[var(--text-primary)]">{value}</p>
      <p className="text-[11px] text-[var(--text-secondary)]">{note}</p>
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────────────
   CalibrationPanel — probability reliability checks
   ────────────────────────────────────────────────────────────────────── */

function CalibrationPanel({ metrics }: { metrics: OverallMetrics }) {
  const bins = (metrics.calibration_bins || []).filter((b) => b.count > 0)

  return (
    <div className="bg-[var(--card-bg)] border rounded-2xl p-5" style={{ borderColor: 'var(--border-color)' }}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
        <h3 className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
          Probability Calibration
        </h3>
        <div className="flex flex-wrap gap-2 text-[10px] text-[var(--text-tertiary)]">
          <span className="px-2 py-1 rounded bg-[var(--muted-bg)]">Brier {(metrics.brier_score ?? 0).toFixed(3)}</span>
          <span className="px-2 py-1 rounded bg-[var(--muted-bg)]">LogLoss {(metrics.log_loss ?? 0).toFixed(3)}</span>
          <span className="px-2 py-1 rounded bg-[var(--muted-bg)]">ECE {(metrics.expected_calibration_error ?? 0).toFixed(3)}</span>
        </div>
      </div>

      {bins.length === 0 ? (
        <p className="text-xs text-[var(--text-tertiary)]">Not enough completed predictions to build reliability bins yet.</p>
      ) : (
        <div className="space-y-2.5">
          {bins.map((bin) => {
            const confidenceWidth = Math.max(2, bin.avg_confidence * 100)
            const accuracyWidth = Math.max(2, bin.accuracy * 100)
            const gap = Math.abs(bin.accuracy - bin.avg_confidence)
            return (
              <div key={bin.bucket} className="grid grid-cols-[72px_1fr_72px] items-center gap-3">
                <span className="text-[10px] text-[var(--text-tertiary)]">{bin.bucket}</span>
                <div className="space-y-1">
                  <div className="h-2 rounded-full bg-[var(--muted-bg)] overflow-hidden relative">
                    <div className="h-full bg-cyan-500/70" style={{ width: `${confidenceWidth}%` }} />
                    <div className="h-full bg-emerald-500 absolute left-0 top-0" style={{ width: `${accuracyWidth}%`, opacity: 0.8 }} />
                  </div>
                  <div className="flex justify-between text-[10px] text-[var(--text-tertiary)]">
                    <span>n={bin.count}</span>
                    <span>gap {pct(gap)}</span>
                  </div>
                </div>
                <span className="text-[10px] text-right text-[var(--text-secondary)]">{pct(bin.accuracy)}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CalibrationTrendHistory({ data }: { data: CalibrationTrendData | null }) {
  if (!data || data.data_points < 2 || !data.latest) {
    return (
      <div className="bg-[var(--card-bg)] border rounded-2xl p-5" style={{ borderColor: 'var(--border-color)' }}>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">Calibration Trend History</p>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          More settled predictions are needed before rolling calibration history can be plotted.
        </p>
      </div>
    )
  }

  const points = data.trend
  const W = 600
  const H = 170
  const PAD = 34
  const xFor = (index: number) => PAD + (index / Math.max(1, points.length - 1)) * (W - 2 * PAD)
  const yFor = (value: number) => PAD + (1 - Math.min(0.25, Math.max(0, value)) / 0.25) * (H - 2 * PAD)
  const ecePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${xFor(index).toFixed(1)},${yFor(point.expected_calibration_error).toFixed(1)}`).join(' ')
  const brierPath = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${xFor(index).toFixed(1)},${yFor(point.brier_score / 2).toFixed(1)}`).join(' ')
  const latest = data.latest
  const statusColor = latest.expected_calibration_error <= 0.06
    ? '#22c55e'
    : latest.expected_calibration_error <= 0.1
      ? '#f59e0b'
      : '#ef4444'

  return (
    <div className="bg-[var(--card-bg)] border rounded-2xl p-5" style={{ borderColor: 'var(--border-color)' }}>
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">Calibration Trend History</p>
          <h3 className="mt-1 text-lg font-black text-[var(--text-primary)]">Rolling reliability drift</h3>
          <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
            Tracks expected calibration error, Brier score, confidence, and hit rate across chronological windows of settled real outcomes.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[460px]">
          <AuditTile label="Latest ECE" value={latest.expected_calibration_error.toFixed(3)} note={`window ${data.window}`} />
          <AuditTile label="Brier" value={latest.brier_score.toFixed(3)} note="lower is better" />
          <AuditTile label="Avg Conf" value={pct(latest.avg_confidence)} note="rolling prior" />
          <AuditTile label="Accuracy" value={pct(latest.accuracy)} note="same window" />
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-[var(--border-color)] bg-[var(--muted-bg)] p-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Rolling calibration error and Brier trend">
          {[0.05, 0.1, 0.15, 0.2].map((value) => {
            const y = yFor(value)
            return (
              <g key={value}>
                <line x1={PAD} x2={W - PAD} y1={y} y2={y} stroke="var(--border-color)" strokeDasharray="4 4" />
                <text x={PAD - 6} y={y + 3} textAnchor="end" fontSize="9" fill="var(--text-tertiary)">{value.toFixed(2)}</text>
              </g>
            )
          })}
          <path d={brierPath} fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity={0.75} />
          <path d={ecePath} fill="none" stroke={statusColor} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          {points.map((point, index) => (
            <circle key={`${point.index}-${point.date}`} cx={xFor(index)} cy={yFor(point.expected_calibration_error)} r="2.2" fill={statusColor} />
          ))}
        </svg>
        <div className="mt-2 flex flex-wrap gap-3 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
          <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: statusColor }} />ECE</span>
          <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-sky-400" />Brier / 2</span>
          <span>{data.data_points} rolling windows · step {data.step}</span>
        </div>
      </div>
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────────────
   OutcomeAccuracy — Home/Draw/Away accuracy bars
   ────────────────────────────────────────────────────────────────────── */

function OutcomeAccuracy({ metrics }: { metrics: OverallMetrics }) {
  const outcomes = [
    { label: 'Home Win', predicted: metrics.home_win_predicted ?? 0, correct: metrics.home_win_correct ?? 0, color: '#22c55e' },
    { label: 'Draw', predicted: metrics.draw_predicted ?? 0, correct: metrics.draw_correct ?? 0, color: '#f59e0b' },
    { label: 'Away Win', predicted: metrics.away_win_predicted ?? 0, correct: metrics.away_win_correct ?? 0, color: '#6366f1' },
  ]

  const totalPredicted = outcomes.reduce((s, o) => s + o.predicted, 0) || 1

  return (
    <div className="bg-[var(--card-bg)] border rounded-2xl p-5" style={{ borderColor: 'var(--border-color)' }}>
      <h3 className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider mb-4">
        Accuracy by Predicted Outcome
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {outcomes.map((o) => {
          const acc = o.predicted > 0 ? o.correct / o.predicted : 0
          const share = o.predicted / totalPredicted
          return (
            <div key={o.label} className="space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium text-[var(--text-primary)]">{o.label}</span>
                <span className="text-lg font-bold" style={{ color: o.color }}>{pct(acc)}</span>
              </div>
              <div className="h-2 rounded-full bg-[var(--muted-bg)] overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500" style={{ width: acc * 100 + '%', backgroundColor: o.color }} />
              </div>
              <div className="flex justify-between text-[10px] text-[var(--text-tertiary)]">
                <span>{o.correct}/{o.predicted} correct</span>
                <span>{pct(share)} of all picks</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────────────
   TrendChart — SVG rolling accuracy line
   ────────────────────────────────────────────────────────────────────── */

function TrendChart({
  trend,
  window,
  onWindowChange,
}: {
  trend: TrendData
  window: number
  onWindowChange: (w: number) => void
}) {
  const points = trend.trend
  if (points.length < 2) return null

  const W = 600, H = 180, PAD = 40
  const xs = points.map((_: TrendPoint, i: number) => PAD + (i / (points.length - 1)) * (W - 2 * PAD))
  const minA = Math.min(...points.map((p: TrendPoint) => p.accuracy)) - 0.05
  const maxA = Math.max(...points.map((p: TrendPoint) => p.accuracy)) + 0.05
  const ys = points.map((p: TrendPoint) => PAD + (1 - (p.accuracy - minA) / (maxA - minA)) * (H - 2 * PAD))
  const pathD = points.map((_: TrendPoint, i: number) => (i === 0 ? 'M' : 'L') + xs[i].toFixed(1) + ',' + ys[i].toFixed(1)).join(' ')
  const areaD = pathD + ' L' + xs[xs.length - 1].toFixed(1) + ',' + (H - PAD) + ' L' + xs[0].toFixed(1) + ',' + (H - PAD) + ' Z'
  const yLabels = [minA, (minA + maxA) / 2, maxA].map(v => ({ value: v, y: PAD + (1 - (v - minA) / (maxA - minA)) * (H - 2 * PAD) }))

  return (
    <div className="bg-[var(--card-bg)] border rounded-2xl p-5" style={{ borderColor: 'var(--border-color)' }}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
          Rolling Accuracy (window: {window})
        </h3>
        <div className="flex gap-1">
          {[10, 20, 50].map(w => (
            <button
              key={w}
              onClick={() => onWindowChange(w)}
              className={'px-2.5 py-1 rounded-md text-xs font-medium transition-colors ' + (window === w
                ? 'bg-[var(--accent-primary)] text-white'
                : 'bg-[var(--muted-bg)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
              )}
            >
              {w}
            </button>
          ))}
        </div>
      </div>

      <svg viewBox={'0 0 ' + W + ' ' + H} className="w-full" preserveAspectRatio="xMidYMid meet">
        {yLabels.map((l, i) => (
          <g key={i}>
            <line x1={PAD} y1={l.y} x2={W - PAD} y2={l.y} stroke="var(--border-color)" strokeDasharray="4" />
            <text x={PAD - 4} y={l.y + 4} textAnchor="end" fontSize="9" fill="var(--text-tertiary)">{pct(l.value)}</text>
          </g>
        ))}
        {(() => {
          const y50 = PAD + (1 - (0.5 - minA) / (maxA - minA)) * (H - 2 * PAD)
          return y50 >= PAD && y50 <= H - PAD ? (
            <line x1={PAD} y1={y50} x2={W - PAD} y2={y50} stroke="#f59e0b" strokeDasharray="6 3" opacity={0.4} />
          ) : null
        })()}
        <path d={areaD} fill="url(#trendGrad)" opacity={0.15} />
        <path d={pathD} fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p: TrendPoint, i: number) => (
          <circle key={i} cx={xs[i]} cy={ys[i]} r="2.5" fill={accuracyColor(p.accuracy)} />
        ))}
        <defs>
          <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" />
            <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>

      <p className="text-[10px] text-[var(--text-tertiary)] mt-1 text-center">
        {points.length} data points · Latest: {pct(points[points.length - 1].accuracy)}
      </p>
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────────────
   LeagueBreakdown — horizontal bar chart
   ────────────────────────────────────────────────────────────────────── */

function LeagueBreakdown({ data }: { data: Record<string, LeagueSummaryItem> }) {
  const leagues = Object.entries(data).sort((a, b) => (b[1].total ?? 0) - (a[1].total ?? 0))

  return (
    <div className="bg-[var(--card-bg)] border rounded-2xl p-5" style={{ borderColor: 'var(--border-color)' }}>
      <h3 className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider mb-4">
        League Evaluation Table
      </h3>
      <div className="space-y-3">
        {leagues.map(([league, stats]) => {
          const acc = stats.accuracy ?? 0
          const weighted = stats.weighted_accuracy ?? stats.weightedAccuracy ?? acc
          return (
            <div key={league} className="flex items-center gap-3">
              <span className="text-xs text-[var(--text-primary)] font-medium w-32 truncate capitalize">
                {league.replace(/_/g, ' ')}
              </span>
              <div className="flex-1 h-2 rounded-full bg-[var(--muted-bg)] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: acc * 100 + '%', backgroundColor: accuracyColor(acc) }}
                />
              </div>
              <span className="text-xs font-medium w-20 text-right" style={{ color: accuracyColor(acc) }}>
                {pct(acc)}
              </span>
              <span className="text-[10px] text-[var(--text-tertiary)] w-24 text-right">
                Wtd {pct(weighted)}
              </span>
              <span className="text-[10px] text-[var(--text-tertiary)] w-20 text-right">
                {(stats.correct ?? 0)}/{(stats.total ?? 0)} done
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────────────
   PredictionHistory — table with SEPARATE outcome + scoreline columns
   ────────────────────────────────────────────────────────────────────── */

function PredictionHistory({ initialPredictions }: { initialPredictions: PredSummary[] }) {
  const [predictions, setPredictions] = useState<PredSummary[]>(initialPredictions)
  const [availableLeagues, setAvailableLeagues] = useState<string[]>([])
  const [selectedLeague, setSelectedLeague] = useState('')
  const [timeRange, setTimeRange] = useState('all')
  const [statusFilter, setStatusFilter] = useState('completed')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [loadingPreds, setLoadingPreds] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)

  const fetchPredictions = useCallback(async (p: number = 1) => {
    setLoadingPreds(true)
    try {
      const params = new URLSearchParams({ page: String(p), limit: '25', status: statusFilter })
      if (selectedLeague) params.set('league', selectedLeague)
      if (timeRange !== 'all') params.set('time_range', timeRange)
      const res = await fetch('/api/v1/tracking/predictions?' + params)
      if (res.ok) {
        const data = await res.json()
        setPredictions(data.predictions || [])
        setTotalPages(data.total_pages || 1)
        setTotalCount(data.count || 0)
        if (data.available_leagues) setAvailableLeagues(data.available_leagues)
        setPage(p)
      }
    } catch (e) {
      console.error('Failed to fetch predictions:', e)
    } finally {
      setLoadingPreds(false)
      setHasLoaded(true)
    }
  }, [selectedLeague, timeRange, statusFilter])

  useEffect(() => { fetchPredictions(1) }, [fetchPredictions])

  return (
    <div className="bg-[var(--card-bg)] border rounded-2xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
      {/* Header */}
      <div className="px-5 py-4 border-b flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3" style={{ borderColor: 'var(--border-color)' }}>
        <div>
          <h3 className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
            Prediction History
          </h3>
          {hasLoaded && (
            <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">{totalCount} records · pending picks are not scored until the match finishes</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="text-xs px-2.5 py-1.5 rounded-lg border bg-[var(--muted-bg)] border-[var(--border-color)] text-[var(--text-primary)]">
            <option value="completed">Completed</option>
            <option value="pending">Pending</option>
            <option value="">All</option>
          </select>
          <select value={timeRange} onChange={e => setTimeRange(e.target.value)} className="text-xs px-2.5 py-1.5 rounded-lg border bg-[var(--muted-bg)] border-[var(--border-color)] text-[var(--text-primary)]">
            <option value="all">All Time</option>
            <option value="week">Last 7 Days</option>
            <option value="month">Last 30 Days</option>
            <option value="season">This Season</option>
          </select>
          <select value={selectedLeague} onChange={e => setSelectedLeague(e.target.value)} className="text-xs px-2.5 py-1.5 rounded-lg border bg-[var(--muted-bg)] border-[var(--border-color)] text-[var(--text-primary)]">
            <option value="">All Leagues</option>
            {availableLeagues.map(l => (
              <option key={l} value={l}>{l.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        {loadingPreds ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin h-5 w-5 border-2 border-[var(--accent-primary)] border-t-transparent rounded-full" />
          </div>
        ) : predictions.length === 0 ? (
          <div className="text-center py-12 text-[var(--text-tertiary)] text-sm">
            No predictions found
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[var(--muted-bg)] text-[var(--text-tertiary)] text-[10px] uppercase tracking-wider">
                <th className="text-left px-4 py-2.5 font-medium">Match</th>
                <th className="text-center px-3 py-2.5 font-medium">Predicted</th>
                <th className="text-center px-3 py-2.5 font-medium">Actual</th>
                <th className="text-center px-3 py-2.5 font-medium">Outcome</th>
                <th className="text-center px-3 py-2.5 font-medium">Scoreline</th>
                <th className="text-center px-3 py-2.5 font-medium">Edge</th>
                <th className="text-center px-3 py-2.5 font-medium">Confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: 'var(--border-color)' }}>
              {predictions.map((p) => (
                <tr key={p.match_id} className="hover:bg-[var(--muted-bg)]/50 transition-colors">
                  {/* Match */}
                  <td className="px-4 py-2.5">
                    <div className="text-[var(--text-primary)] font-medium text-xs">{p.home_team} vs {p.away_team}</div>
                    <div className="text-[10px] text-[var(--text-tertiary)]">{p.match_date} · {p.league?.replace(/_/g, ' ')}</div>
                  </td>
                  {/* Predicted */}
                  <td className="px-3 py-2.5 text-center">
                    <span className="text-[var(--text-primary)] font-semibold">{p.predicted_scoreline}</span>
                    <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-[var(--muted-bg)] text-[var(--text-tertiary)]">
                      {winnerLabel(p.predicted_winner)}
                    </span>
                  </td>
                  {/* Actual */}
                  <td className="px-3 py-2.5 text-center">
                    {p.actual_scoreline ? (
                      <>
                        <span className="text-[var(--text-primary)] font-semibold">{p.actual_scoreline}</span>
                        <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-[var(--muted-bg)] text-[var(--text-tertiary)]">
                          {p.actual_winner ? winnerLabel(p.actual_winner) : ''}
                        </span>
                      </>
                    ) : (
                      <span className="text-amber-500 text-[10px]">Pending</span>
                    )}
                  </td>
                  {/* Outcome (win/draw/loss correct?) */}
                  <td className="px-3 py-2.5 text-center">
                    {p.winner_correct === true && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 font-semibold">
                        {'\u2713'}
                      </span>
                    )}
                    {p.winner_correct === false && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 font-semibold">
                        {'\u2717'}
                      </span>
                    )}
                    {p.winner_correct === null && <span className="text-[10px] text-[var(--text-tertiary)]">{'\u2014'}</span>}
                  </td>
                  {/* Scoreline (exact match?) */}
                  <td className="px-3 py-2.5 text-center">
                    {p.scoreline_correct === true && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 font-semibold">
                        {'\u2713'}
                      </span>
                    )}
                    {p.scoreline_correct === false && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 font-semibold">
                        {'\u2717'}
                      </span>
                    )}
                    {p.scoreline_correct === null && <span className="text-[10px] text-[var(--text-tertiary)]">{'\u2014'}</span>}
                  </td>
                  {/* Model edge vs baseline */}
                  <td className="px-3 py-2.5 text-center">
                    {(() => {
                      const maxProb = Math.max(p.home_win_prob ?? 0, p.draw_prob ?? 0, p.away_win_prob ?? 0)
                      const edge = maxProb - (1 / 3)
                      const tone = edge >= 0.12 ? 'text-emerald-400' : edge >= 0.06 ? 'text-amber-400' : 'text-slate-400'
                      const sign = edge > 0 ? '+' : ''
                      return (
                        <span className={`text-[10px] font-semibold ${tone}`}>
                          {sign}{(edge * 100).toFixed(1)}pp
                        </span>
                      )
                    })()}
                  </td>
                  {/* Confidence */}
                  <td className="px-3 py-2.5 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <div className="w-12 h-1.5 rounded-full bg-[var(--muted-bg)] overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: p.confidence * 100 + '%', backgroundColor: accuracyColor(p.confidence) }} />
                      </div>
                      <span className="text-[10px] text-[var(--text-secondary)] w-8">{pct(p.confidence)}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-5 py-3 border-t text-xs" style={{ borderColor: 'var(--border-color)' }}>
          <span className="text-[var(--text-tertiary)]">Page {page}/{totalPages}</span>
          <div className="flex gap-1">
            <button onClick={() => fetchPredictions(1)} disabled={page <= 1 || loadingPreds} className="px-2 py-1 rounded border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--muted-bg)] disabled:opacity-30">{'\u00AB\u00AB'}</button>
            <button onClick={() => fetchPredictions(page - 1)} disabled={page <= 1 || loadingPreds} className="px-2 py-1 rounded border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--muted-bg)] disabled:opacity-30">{'\u2039'}</button>
            <button onClick={() => fetchPredictions(page + 1)} disabled={page >= totalPages || loadingPreds} className="px-2 py-1 rounded border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--muted-bg)] disabled:opacity-30">{'\u203A'}</button>
            <button onClick={() => fetchPredictions(totalPages)} disabled={page >= totalPages || loadingPreds} className="px-2 py-1 rounded border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--muted-bg)] disabled:opacity-30">{'\u00BB\u00BB'}</button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────────────
   ModelCard — compact model architecture summary
   ────────────────────────────────────────────────────────────────────── */

function ModelCard({ modelInfo }: { modelInfo: ModelInfoResponse | null }) {
  const methods = [
    { code: 'NN', name: 'Neural Ensemble', desc: 'Per-league MLP + XGBoost + LightGBM + GradientBoosting + RandomForest' },
    { code: 'xG', name: 'Dixon-Coles Poisson', desc: 'Corrected bivariate Poisson for scoreline prediction' },
    { code: 'ELO', name: 'ELO Ratings', desc: 'Dynamic ratings with league coefficients and goal-difference weighting' },
    { code: 'OL', name: 'Online Learning', desc: 'Auto-updating neural nets and ELO after each matchday' },
  ]

  const neuralCount = modelInfo?.summary?.neural_ensemble_count ?? 0

  return (
    <div className="bg-[var(--card-bg)] border rounded-2xl p-5" style={{ borderColor: 'var(--border-color)' }}>
      <h3 className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider mb-3">
        Model Architecture
      </h3>
      <div className="space-y-3">
        {methods.map(m => (
          <div key={m.name} className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-7 w-9 items-center justify-center rounded border border-[var(--border-color)] bg-[var(--muted-bg)] text-[10px] font-bold text-[var(--accent-primary)]">{m.code}</span>
            <div>
              <p className="text-xs font-semibold text-[var(--text-primary)]">{m.name}</p>
              <p className="text-[10px] text-[var(--text-tertiary)] leading-relaxed">{m.desc}</p>
            </div>
          </div>
        ))}
      </div>
      {neuralCount > 0 && (
        <p className="text-[10px] text-[var(--text-tertiary)] mt-3 pt-3 border-t" style={{ borderColor: 'var(--border-color)' }}>
          {neuralCount} league-specific neural models trained · 66-feature pipeline
        </p>
      )}
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────────────
   ModelPolicyCard — league/global/hybrid routing policy
   ────────────────────────────────────────────────────────────────────── */

function ModelPolicyCard({ policy }: { policy: ModelInfoResponse['model_selection'] | null }) {
  const decisionTone: Record<string, string> = {
    global: '#22c55e',
    blend: '#38bdf8',
    league: '#f59e0b',
    global_fallback: '#a78bfa',
  }
  const topDecisions = (policy?.decisions || [])
    .filter(d => d.decision !== 'global_fallback')
    .sort((a, b) => (b.global_blend_weight - a.global_blend_weight) || (b.sample_size || 0) - (a.sample_size || 0))
    .slice(0, 6)

  return (
    <div className="bg-[var(--card-bg)] border rounded-2xl p-5" style={{ borderColor: 'var(--border-color)' }}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
            Model Selection Policy
          </h3>
          <p className="text-[10px] text-[var(--text-tertiary)] mt-1">
            {policy?.generated_at ? new Date(policy.generated_at).toLocaleString() : 'No policy artifact'}
          </p>
        </div>
        <span className="rounded-full border border-[var(--border-color)] bg-[var(--muted-bg)] px-2 py-1 text-[10px] font-semibold text-[var(--text-primary)]">
          {policy?.promoted_leagues.length || 0} global
        </span>
      </div>

      {policy ? (
        <>
          <div className="grid grid-cols-4 gap-2 mb-4">
            {['league', 'blend', 'global', 'global_fallback'].map(key => (
              <div key={key} className="rounded-lg border border-[var(--border-color)] bg-[var(--muted-bg)] p-2">
                <p className="text-sm font-black" style={{ color: decisionTone[key] || 'var(--text-primary)' }}>
                  {policy.decision_counts[key] || 0}
                </p>
                <p className="text-[9px] uppercase text-[var(--text-tertiary)]">{key.replace('_', ' ')}</p>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            {topDecisions.map(decision => (
              <div key={decision.league_key} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--muted-bg)] px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-[var(--text-primary)]">{decision.display_name}</p>
                  <p className="text-[10px] text-[var(--text-tertiary)]">
                    n={decision.sample_size ?? 'N/A'} · best {decision.best_accuracy != null ? pct(decision.best_accuracy) : 'N/A'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold uppercase" style={{ color: decisionTone[decision.decision] || 'var(--text-primary)' }}>
                    {decision.decision.replace('_', ' ')}
                  </p>
                  <p className="text-[10px] text-[var(--text-tertiary)]">
                    {decision.global_blend_weight > 0 ? `${Math.round(decision.global_blend_weight * 100)}% global` : 'league'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="text-[10px] text-[var(--text-tertiary)] leading-relaxed">
          Run the global retraining job to generate model-selection routing.
        </p>
      )}
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────────────
   FetcherPanel — outcome fetch status + trigger
   ────────────────────────────────────────────────────────────────────── */

function FetcherPanel({
  status,
  fetching,
  onFetch,
}: {
  status: FetcherStatusResponse | null
  fetching: boolean
  onFetch: () => void
}) {
  return (
    <div className="bg-[var(--card-bg)] border rounded-2xl p-5 flex flex-col justify-between" style={{ borderColor: 'var(--border-color)' }}>
      <div>
        <h3 className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider mb-2">
          Outcome Fetcher
        </h3>
        <p className="text-[10px] text-[var(--text-tertiary)] leading-relaxed">
          Automatically checks ESPN for finished matches and updates prediction outcomes. Runs every 30 minutes via GitHub Actions.
        </p>
        {status && (
          <div className="mt-3 space-y-1 text-[10px] text-[var(--text-tertiary)]">
            <p>Last run: <span className="text-[var(--text-primary)] font-medium">{status.last_run ?? 'Never'}</span></p>
            <p>Outcomes since retrain: <span className="text-[var(--text-primary)] font-medium">{status.outcomes_since_retrain ?? 0}/{status.retrain_threshold ?? 50}</span></p>
          </div>
        )}
      </div>
      <button
        onClick={onFetch}
        disabled={fetching}
        className="mt-4 w-full px-4 py-2.5 bg-[var(--accent-primary)] text-white rounded-lg text-xs font-semibold disabled:opacity-50 hover:opacity-90 transition-opacity"
      >
        {fetching ? 'Fetching\u2026' : 'Fetch Outcomes Now'}
      </button>
    </div>
  )
}
