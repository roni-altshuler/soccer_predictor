'use client'

import { useEffect, useMemo, useState } from 'react'

type AlertSeverity = 'high' | 'medium' | 'low'

type Outcome = 'home' | 'draw' | 'away'

interface DriftAlert {
  severity: AlertSeverity
  metric: string
  change: number
  message: string
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

interface TuningParams {
  blend_nn_base: number
  blend_nn_min: number
  blend_nn_max: number
  entropy_sensitivity: number
  draw_min_prob: number
  draw_margin: number
  source_sample_size?: number
}

interface LeagueDiagnostics {
  sample_size: number
  accuracy: number
  avg_confidence: number
  brier_score: number
  log_loss: number
  expected_calibration_error: number
  draw_actual_rate: number
  draw_predicted_rate: number
  draw_probability_gap: number
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

interface GlobalAlert extends DriftAlert {
  league: string
}

interface DiagnosticsResponse {
  generated_at: string
  total_completed_predictions: number
  league_count: number
  tuning_source: string
  leagues: Record<string, LeagueDiagnostics>
  top_alerts: GlobalAlert[]
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function metricColor(value: number): string {
  if (value >= 0.6) return '#22c55e'
  if (value >= 0.48) return '#f59e0b'
  return '#ef4444'
}

function severityBadge(severity: AlertSeverity): string {
  if (severity === 'high') return 'bg-red-500/15 text-red-300 border border-red-500/30'
  if (severity === 'medium') return 'bg-amber-500/15 text-amber-200 border border-amber-500/30'
  return 'bg-cyan-500/15 text-cyan-200 border border-cyan-500/30'
}

function WalkForwardChart({ folds }: { folds: WalkForwardFold[] }) {
  if (folds.length < 2) {
    return <p className="text-xs text-[var(--text-tertiary)]">Not enough completed matches for walk-forward folds yet.</p>
  }

  const width = 640
  const height = 220
  const pad = 36
  const accuracies = folds.map((f) => f.accuracy)
  const minA = Math.max(0, Math.min(...accuracies) - 0.04)
  const maxA = Math.min(1, Math.max(...accuracies) + 0.04)
  const denom = Math.max(0.02, maxA - minA)

  const xs = folds.map((_, idx) => pad + (idx / (folds.length - 1)) * (width - (pad * 2)))
  const ys = folds.map((fold) => pad + (1 - ((fold.accuracy - minA) / denom)) * (height - (pad * 2)))

  const linePath = xs.map((x, idx) => `${idx === 0 ? 'M' : 'L'}${x.toFixed(2)},${ys[idx].toFixed(2)}`).join(' ')
  const areaPath = `${linePath} L${xs[xs.length - 1].toFixed(2)},${(height - pad).toFixed(2)} L${xs[0].toFixed(2)},${(height - pad).toFixed(2)} Z`

  const guideValues = [minA, (minA + maxA) / 2, maxA]

  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        {guideValues.map((v) => {
          const y = pad + (1 - ((v - minA) / denom)) * (height - (pad * 2))
          return (
            <g key={v}>
              <line x1={pad} y1={y} x2={width - pad} y2={y} stroke="var(--border-color)" strokeDasharray="4 3" />
              <text x={pad - 5} y={y + 3} textAnchor="end" fill="var(--text-tertiary)" fontSize="9">
                {pct(v)}
              </text>
            </g>
          )
        })}

        <path d={areaPath} fill="url(#diagArea)" opacity={0.2} />
        <path d={linePath} fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

        {folds.map((fold, idx) => (
          <circle key={fold.fold} cx={xs[idx]} cy={ys[idx]} r="2.8" fill={metricColor(fold.accuracy)}>
            <title>{`Fold ${fold.fold}: ${pct(fold.accuracy)}`}</title>
          </circle>
        ))}

        <defs>
          <linearGradient id="diagArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" />
            <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
      <p className="text-[10px] text-[var(--text-tertiary)] text-center">
        {folds.length} folds · latest {pct(folds[folds.length - 1].accuracy)}
      </p>
    </div>
  )
}

export default function DiagnosticsDashboard() {
  const [data, setData] = useState<DiagnosticsResponse | null>(null)
  const [selectedLeague, setSelectedLeague] = useState<string>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadDiagnostics() {
      setLoading(true)
      try {
        const response = await fetch('/api/v1/tracking/diagnostics')
        if (!response.ok) return
        const payload = (await response.json()) as DiagnosticsResponse
        setData(payload)
        const leagues = Object.keys(payload.leagues)
        if (leagues.length > 0) {
          setSelectedLeague((prev) => (prev && payload.leagues[prev]) ? prev : leagues[0])
        }
      } catch (error) {
        console.error('Failed to load diagnostics:', error)
      } finally {
        setLoading(false)
      }
    }

    loadDiagnostics()
  }, [])

  const leagueNames = useMemo(() => Object.keys(data?.leagues || {}), [data])
  const activeLeague = selectedLeague && data?.leagues[selectedLeague]
    ? selectedLeague
    : leagueNames[0]
  const leagueData = activeLeague ? data?.leagues[activeLeague] : undefined

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-28 rounded-2xl bg-[var(--muted-bg)]" />
        <div className="h-64 rounded-2xl bg-[var(--muted-bg)]" />
        <div className="h-64 rounded-2xl bg-[var(--muted-bg)]" />
      </div>
    )
  }

  if (!data || !leagueData) {
    return (
      <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-6 text-sm text-[var(--text-tertiary)]">
        No diagnostics available yet. Complete more matches to generate walk-forward and calibration diagnostics.
      </div>
    )
  }

  const confusion = leagueData.confusion_matrix

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 md:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">Audit Snapshot</p>
            <h2 className="text-lg md:text-xl font-bold text-[var(--text-primary)]">Walk-forward and Drift Diagnostics</h2>
            <p className="text-xs text-[var(--text-tertiary)] mt-1">
              {data.total_completed_predictions} completed predictions across {data.league_count} leagues · tuning source {data.tuning_source}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {leagueNames.map((league) => (
              <button
                key={league}
                onClick={() => setSelectedLeague(league)}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] border transition-colors ${
                  activeLeague === league
                    ? 'bg-[var(--accent-primary)] text-white border-transparent'
                    : 'bg-[var(--muted-bg)] text-[var(--text-secondary)] border-[var(--border-color)] hover:text-[var(--text-primary)]'
                }`}
              >
                {league}
              </button>
            ))}
          </div>
        </div>
      </section>

      {data.top_alerts.length > 0 && (
        <section className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 md:p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-3">Top Drift Alerts</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {data.top_alerts.slice(0, 6).map((alert, idx) => (
              <div key={`${alert.league}-${alert.metric}-${idx}`} className="rounded-lg border border-[var(--border-color)] bg-[var(--muted-bg)] p-2.5">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs font-semibold text-[var(--text-primary)]">{alert.league}</p>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${severityBadge(alert.severity)}`}>
                    {alert.severity.toUpperCase()}
                  </span>
                </div>
                <p className="text-[11px] text-[var(--text-secondary)] leading-snug">{alert.message}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="grid grid-cols-1 lg:grid-cols-4 gap-3">
        <MetricCard label="League Accuracy" value={pct(leagueData.accuracy)} tone={metricColor(leagueData.accuracy)} sub={`n=${leagueData.sample_size}`} />
        <MetricCard label="Brier Score" value={leagueData.brier_score.toFixed(3)} tone="#22c55e" sub="Lower is better" />
        <MetricCard label="Log Loss" value={leagueData.log_loss.toFixed(3)} tone="#38bdf8" sub="Lower is better" />
        <MetricCard label="ECE" value={leagueData.expected_calibration_error.toFixed(3)} tone="#f59e0b" sub="Calibration gap" />
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 md:p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-3">Confusion Matrix</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[var(--text-tertiary)]">
                  <th className="text-left py-2 pr-2">Pred \ Actual</th>
                  {confusion.labels.map((label) => (
                    <th key={label} className="text-center py-2 px-2 uppercase">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {confusion.labels.map((predLabel, rowIdx) => (
                  <tr key={predLabel}>
                    <td className="py-2 pr-2 text-[var(--text-secondary)] uppercase">{predLabel}</td>
                    {confusion.labels.map((actualLabel, colIdx) => {
                      const value = confusion.matrix[rowIdx][colIdx] || 0
                      const norm = confusion.normalized[rowIdx]?.[colIdx] || 0
                      const diagonal = rowIdx === colIdx
                      const bg = diagonal
                        ? `rgba(16, 185, 129, ${0.12 + (norm * 0.55)})`
                        : `rgba(239, 68, 68, ${0.08 + (norm * 0.45)})`
                      return (
                        <td key={`${predLabel}-${actualLabel}`} className="px-2 py-2 text-center">
                          <span className="inline-flex min-w-[44px] justify-center rounded-md px-2 py-1 text-[11px] font-semibold text-[var(--text-primary)]" style={{ backgroundColor: bg }}>
                            {value}
                          </span>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 md:p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-3">Reliability Curve Buckets</h3>
          <div className="space-y-2">
            {leagueData.reliability_bins.filter((bin) => bin.sample_size > 0).map((bin) => {
              const confWidth = Math.max(2, bin.avg_confidence * 100)
              const accWidth = Math.max(2, bin.accuracy * 100)
              return (
                <div key={bin.bucket} className="grid grid-cols-[72px_1fr_70px] items-center gap-2.5">
                  <span className="text-[10px] text-[var(--text-tertiary)]">{bin.bucket}</span>
                  <div>
                    <div className="h-2 rounded-full bg-[var(--muted-bg)] overflow-hidden relative">
                      <div className="h-full bg-cyan-500/70" style={{ width: `${confWidth}%` }} />
                      <div className="h-full absolute left-0 top-0 bg-emerald-500/85" style={{ width: `${accWidth}%` }} />
                    </div>
                    <div className="flex items-center justify-between mt-1 text-[10px] text-[var(--text-tertiary)]">
                      <span>n={bin.sample_size}</span>
                      <span>gap {pct(Math.abs(bin.calibration_gap))}</span>
                    </div>
                  </div>
                  <span className="text-[10px] text-right text-[var(--text-secondary)]">{pct(bin.accuracy)}</span>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-5 gap-5">
        <div className="xl:col-span-3 rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 md:p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-3">Walk-forward Stability</h3>
          <WalkForwardChart folds={leagueData.walk_forward.folds} />
        </div>

        <div className="xl:col-span-2 rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 md:p-5 space-y-4">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-2">Current Tuning</h3>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <TuningChip label="NN Base" value={leagueData.tuning.blend_nn_base.toFixed(3)} />
              <TuningChip label="NN Min" value={leagueData.tuning.blend_nn_min.toFixed(3)} />
              <TuningChip label="NN Max" value={leagueData.tuning.blend_nn_max.toFixed(3)} />
              <TuningChip label="Entropy" value={leagueData.tuning.entropy_sensitivity.toFixed(3)} />
              <TuningChip label="Draw Min" value={leagueData.tuning.draw_min_prob.toFixed(3)} />
              <TuningChip label="Draw Margin" value={leagueData.tuning.draw_margin.toFixed(3)} />
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-2">League Drift Alerts</h3>
            {leagueData.drift_alerts.length === 0 ? (
              <p className="text-xs text-[var(--text-tertiary)]">No active drift alerts for this league.</p>
            ) : (
              <div className="space-y-2">
                {leagueData.drift_alerts.map((alert, idx) => (
                  <div key={`${alert.metric}-${idx}`} className="rounded-lg border border-[var(--border-color)] bg-[var(--muted-bg)] p-2.5">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-[var(--text-primary)]">{alert.metric.replace(/_/g, ' ')}</p>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${severityBadge(alert.severity)}`}>
                        {alert.severity.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-[11px] text-[var(--text-secondary)] mt-1">{alert.message}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

function MetricCard({ label, value, tone, sub }: { label: string; value: string; tone: string; sub: string }) {
  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-3.5">
      <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">{label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color: tone }}>{value}</p>
      <p className="text-[10px] text-[var(--text-tertiary)] mt-1">{sub}</p>
    </div>
  )
}

function TuningChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--muted-bg)] px-2 py-1.5">
      <p className="text-[10px] text-[var(--text-tertiary)]">{label}</p>
      <p className="text-xs font-semibold text-[var(--text-primary)]">{value}</p>
    </div>
  )
}
