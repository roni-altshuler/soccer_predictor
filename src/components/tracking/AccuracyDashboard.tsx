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

interface OverallMetrics {
  total_predictions: number
  completed_predictions: number
  winner_correct_count: number
  winner_accuracy: number
  exact_scoreline_count: number
  exact_scoreline_rate: number
  brier_score: number
  high_confidence_accuracy: number
  medium_confidence_accuracy: number
  low_confidence_accuracy: number
  recent_accuracy: number
  avg_goals_difference: number
  within_1_goal_rate: number
}

interface AccuracySummary {
  overall: OverallMetrics
  last_30_days: OverallMetrics
  by_league: Record<string, any>
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

/* ──────────────────────────────────────────────────────────────────────
   Helpers
   ────────────────────────────────────────────────────────────────────── */

function pct(n: number): string {
  return (n * 100).toFixed(1) + '%'
}

function accuracyColor(a: number): string {
  if (a >= 0.65) return '#22c55e'
  if (a >= 0.5) return '#f59e0b'
  return '#ef4444'
}

function winnerLabel(w: string): string {
  if (w === 'home') return 'Home'
  if (w === 'away') return 'Away'
  return 'Draw'
}

/* ──────────────────────────────────────────────────────────────────────
   Main Component
   ────────────────────────────────────────────────────────────────────── */

export default function AccuracyDashboard() {
  const [summary, setSummary] = useState<AccuracySummary | null>(null)
  const [trend, setTrend] = useState<TrendData | null>(null)
  const [loading, setLoading] = useState(true)
  const [trendWindow, setTrendWindow] = useState(10)
  const [fetcherStatus, setFetcherStatus] = useState<any>(null)
  const [fetching, setFetching] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [summaryRes, trendRes, statusRes] = await Promise.all([
        fetch('/api/v1/tracking/accuracy/summary'),
        fetch(`/api/v1/tracking/accuracy/trend?window=${trendWindow}`),
        fetch('/api/v1/tracking/outcome-status'),
      ])
      if (summaryRes.ok) setSummary(await summaryRes.json())
      if (trendRes.ok) setTrend(await trendRes.json())
      if (statusRes.ok) setFetcherStatus(await statusRes.json())
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
    <div className="space-y-6">
      {/* ── Headline Metric ── */}
      <HeadlineCard metrics={m} streak={summary.current_streak} form={summary.recent_form} />

      {/* ── 30-day vs All-time Comparison ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MetricCard title="All-time" metrics={m} />
        <MetricCard title="Last 30 Days" metrics={summary.last_30_days} />
      </div>

      {/* ── Accuracy Trend Chart ── */}
      {trend && trend.data_points > 0 && (
        <TrendChart trend={trend} window={trendWindow} onWindowChange={setTrendWindow} />
      )}

      {/* ── By-League Breakdown ── */}
      {Object.keys(summary.by_league).length > 0 && (
        <LeagueBreakdown data={summary.by_league} />
      )}

      {/* ── Predicted vs Actual Table ── */}
      <PredictedVsActual predictions={summary.recent_predictions} />

      {/* ── Outcome Fetcher Status ── */}
      <FetcherPanel
        status={fetcherStatus}
        fetching={fetching}
        onFetch={triggerFetch}
      />
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────────────
   HeadlineCard – big "8/10 correct" display
   ────────────────────────────────────────────────────────────────────── */

function HeadlineCard({
  metrics,
  streak,
  form,
}: {
  metrics: OverallMetrics
  streak: { type: string; count: number }
  form: string[]
}) {
  const acc = metrics.winner_accuracy
  const color = accuracyColor(acc)

  return (
    <div className="bg-[var(--card-bg)] border rounded-2xl p-6" style={{ borderColor: 'var(--border-color)' }}>
      <div className="flex flex-col md:flex-row items-center gap-6">
        {/* Big donut */}
        <div className="relative w-40 h-40 flex-shrink-0">
          <svg viewBox="0 0 128 128" className="w-full h-full -rotate-90">
            <circle cx="64" cy="64" r="52" stroke="var(--muted-bg)" strokeWidth="10" fill="none" />
            <circle
              cx="64"
              cy="64"
              r="52"
              stroke={color}
              strokeWidth="10"
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${acc * 326.7} 326.7`}
              className="transition-all duration-700"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-extrabold" style={{ color }}>{pct(acc)}</span>
            <span className="text-xs text-[var(--text-tertiary)]">Accuracy</span>
          </div>
        </div>

        {/* Stats */}
        <div className="flex-1 text-center md:text-left space-y-3">
          <h2 className="text-2xl font-bold text-[var(--text-primary)]">
            <span style={{ color }}>{metrics.winner_correct_count}</span> /{' '}
            {metrics.completed_predictions} correct
          </h2>
          <p className="text-[var(--text-secondary)] text-sm">
            Exact scoreline: {metrics.exact_scoreline_count} ({pct(metrics.exact_scoreline_rate)})
            &nbsp;·&nbsp; Brier Score: {metrics.brier_score.toFixed(3)}
          </p>

          {/* Recent form badges */}
          <div className="flex gap-1 justify-center md:justify-start">
            {form.slice(0, 15).map((r, i) => (
              <span
                key={i}
                className={`w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold text-white ${
                  r === 'W' ? 'bg-green-500' : 'bg-red-400'
                }`}
              >
                {r}
              </span>
            ))}
          </div>

          {streak.type !== 'N/A' && (
            <p className="text-sm text-[var(--text-tertiary)]">
              Current streak: {streak.count}{' '}
              {streak.type === 'W' ? '✅ correct' : '❌ incorrect'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────────────
   MetricCard – mini stat card (all-time or 30-day)
   ────────────────────────────────────────────────────────────────────── */

function MetricCard({ title, metrics }: { title: string; metrics: OverallMetrics }) {
  const rows = [
    { label: 'Winner Accuracy', value: pct(metrics.winner_accuracy) },
    { label: 'High Confidence', value: pct(metrics.high_confidence_accuracy) },
    { label: 'Med Confidence', value: pct(metrics.medium_confidence_accuracy) },
    { label: 'Low Confidence', value: pct(metrics.low_confidence_accuracy) },
    { label: 'Within 1 goal', value: pct(metrics.within_1_goal_rate) },
    { label: 'Avg goals diff', value: metrics.avg_goals_difference.toFixed(2) },
  ]

  return (
    <div className="bg-[var(--card-bg)] border rounded-2xl p-5" style={{ borderColor: 'var(--border-color)' }}>
      <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-3 uppercase tracking-wide">
        {title}
      </h3>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex justify-between text-sm">
            <span className="text-[var(--text-tertiary)]">{r.label}</span>
            <span className="font-medium text-[var(--text-primary)]">{r.value}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-[var(--text-tertiary)] mt-3">
        Based on {metrics.completed_predictions} completed predictions
      </p>
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────────────
   TrendChart – SVG rolling accuracy line chart
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

  const W = 600
  const H = 200
  const PAD = 40

  const xs = points.map((_, i) => PAD + (i / (points.length - 1)) * (W - 2 * PAD))
  const minA = Math.min(...points.map((p) => p.accuracy)) - 0.05
  const maxA = Math.max(...points.map((p) => p.accuracy)) + 0.05
  const ys = points.map((p) => PAD + (1 - (p.accuracy - minA) / (maxA - minA)) * (H - 2 * PAD))

  const pathD = points.map((_, i) => `${i === 0 ? 'M' : 'L'}${xs[i].toFixed(1)},${ys[i].toFixed(1)}`).join(' ')

  // Area fill
  const areaD = pathD + ` L${xs[xs.length - 1].toFixed(1)},${H - PAD} L${xs[0].toFixed(1)},${H - PAD} Z`

  // Y-axis labels
  const yLabels = [minA, (minA + maxA) / 2, maxA].map((v) => ({
    value: v,
    y: PAD + (1 - (v - minA) / (maxA - minA)) * (H - 2 * PAD),
  }))

  return (
    <div className="bg-[var(--card-bg)] border rounded-2xl p-5" style={{ borderColor: 'var(--border-color)' }}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide">
          Accuracy Over Time (rolling {window})
        </h3>
        <div className="flex gap-1">
          {[10, 20, 50].map((w) => (
            <button
              key={w}
              onClick={() => onWindowChange(w)}
              className={`px-2 py-0.5 rounded text-xs ${
                window === w
                  ? 'bg-[var(--accent-primary)] text-white'
                  : 'bg-[var(--muted-bg)] text-[var(--text-tertiary)]'
              }`}
            >
              {w}
            </button>
          ))}
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        {/* Grid lines */}
        {yLabels.map((l, i) => (
          <g key={i}>
            <line x1={PAD} y1={l.y} x2={W - PAD} y2={l.y} stroke="var(--border-color)" strokeDasharray="4" />
            <text x={PAD - 4} y={l.y + 4} textAnchor="end" fontSize="10" fill="var(--text-tertiary)">
              {pct(l.value)}
            </text>
          </g>
        ))}

        {/* 50% reference line */}
        {(() => {
          const y50 = PAD + (1 - (0.5 - minA) / (maxA - minA)) * (H - 2 * PAD)
          return y50 >= PAD && y50 <= H - PAD ? (
            <line x1={PAD} y1={y50} x2={W - PAD} y2={y50} stroke="#f59e0b" strokeDasharray="6 3" opacity={0.5} />
          ) : null
        })()}

        {/* Area fill */}
        <path d={areaD} fill="url(#trendGrad)" opacity={0.2} />

        {/* Line */}
        <path d={pathD} fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

        {/* Dots */}
        {points.map((p, i) => (
          <circle key={i} cx={xs[i]} cy={ys[i]} r="3" fill={accuracyColor(p.accuracy)} />
        ))}

        <defs>
          <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" />
            <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>

      <p className="text-xs text-[var(--text-tertiary)] mt-2 text-center">
        {points.length} data points · Latest: {pct(points[points.length - 1].accuracy)}
      </p>
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────────────
   LeagueBreakdown
   ────────────────────────────────────────────────────────────────────── */

function LeagueBreakdown({ data }: { data: Record<string, any> }) {
  const leagues = Object.entries(data).sort(
    (a: any, b: any) => (b[1].accuracy ?? 0) - (a[1].accuracy ?? 0),
  )

  return (
    <div className="bg-[var(--card-bg)] border rounded-2xl p-5" style={{ borderColor: 'var(--border-color)' }}>
      <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-4 uppercase tracking-wide">
        Accuracy by League
      </h3>
      <div className="space-y-3">
        {leagues.map(([league, stats]: any) => (
          <div key={league}>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-[var(--text-primary)] capitalize">{league.replace(/_/g, ' ')}</span>
              <span className="text-[var(--text-secondary)]">
                {stats.correct ?? 0}/{stats.total ?? 0} ({pct(stats.accuracy ?? 0)})
              </span>
            </div>
            <div className="h-2 rounded-full bg-[var(--muted-bg)] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${(stats.accuracy ?? 0) * 100}%`,
                  backgroundColor: accuracyColor(stats.accuracy ?? 0),
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────────────
   PredictedVsActual – table of recent predictions with outcomes
   ────────────────────────────────────────────────────────────────────── */

function PredictedVsActual({ predictions }: { predictions: PredSummary[] }) {
  if (predictions.length === 0) return null

  return (
    <div className="bg-[var(--card-bg)] border rounded-2xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
      <div className="p-5 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <h3 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide">
          Predicted vs Actual
        </h3>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[var(--muted-bg)]">
              <th className="text-left px-4 py-2 text-[var(--text-tertiary)] font-medium">Match</th>
              <th className="text-center px-4 py-2 text-[var(--text-tertiary)] font-medium">Predicted</th>
              <th className="text-center px-4 py-2 text-[var(--text-tertiary)] font-medium">Actual</th>
              <th className="text-center px-4 py-2 text-[var(--text-tertiary)] font-medium">Result</th>
              <th className="text-center px-4 py-2 text-[var(--text-tertiary)] font-medium">Confidence</th>
            </tr>
          </thead>
          <tbody className="divide-y" style={{ borderColor: 'var(--border-color)' }}>
            {predictions.map((p) => {
              const isCorrect = p.winner_correct
              return (
                <tr key={p.match_id} className="hover:bg-[var(--muted-bg)] transition-colors">
                  <td className="px-4 py-3">
                    <div className="text-[var(--text-primary)] font-medium">
                      {p.home_team} vs {p.away_team}
                    </div>
                    <div className="text-xs text-[var(--text-tertiary)]">
                      {p.match_date} · {p.league?.replace(/_/g, ' ')}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="text-[var(--text-primary)] font-medium">{p.predicted_scoreline}</div>
                    <div className="text-xs text-[var(--text-tertiary)]">
                      {winnerLabel(p.predicted_winner)}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {p.actual_scoreline ? (
                      <>
                        <div className="text-[var(--text-primary)] font-medium">{p.actual_scoreline}</div>
                        <div className="text-xs text-[var(--text-tertiary)]">
                          {p.actual_winner ? winnerLabel(p.actual_winner) : ''}
                        </div>
                      </>
                    ) : (
                      <span className="text-amber-500 text-xs">Pending</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {isCorrect === true && (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-500 font-medium">
                        ✓ Correct
                      </span>
                    )}
                    {isCorrect === false && (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 font-medium">
                        ✗ Wrong
                      </span>
                    )}
                    {isCorrect === null && (
                      <span className="text-xs text-[var(--text-tertiary)]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <div className="w-16 h-1.5 rounded-full bg-[var(--muted-bg)] overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${p.confidence * 100}%`,
                            backgroundColor: accuracyColor(p.confidence),
                          }}
                        />
                      </div>
                      <span className="text-xs text-[var(--text-secondary)] w-10">
                        {pct(p.confidence)}
                      </span>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────────────
   FetcherPanel – status and manual trigger
   ────────────────────────────────────────────────────────────────────── */

function FetcherPanel({
  status,
  fetching,
  onFetch,
}: {
  status: any
  fetching: boolean
  onFetch: () => void
}) {
  return (
    <div className="bg-[var(--card-bg)] border rounded-2xl p-5" style={{ borderColor: 'var(--border-color)' }}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-1">
            Auto-Outcome Fetcher
          </h3>
          <p className="text-xs text-[var(--text-tertiary)]">
            Automatically checks ESPN for finished matches every 30 minutes and updates predictions.
          </p>
          {status && (
            <p className="text-xs text-[var(--text-tertiary)] mt-1">
              Last run: {status.last_run ?? 'Never'} · Outcomes since retrain:{' '}
              {status.outcomes_since_retrain}/{status.retrain_threshold}
            </p>
          )}
        </div>
        <button
          onClick={onFetch}
          disabled={fetching}
          className="px-4 py-2 bg-[var(--accent-primary)] text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
        >
          {fetching ? 'Fetching…' : 'Fetch Now'}
        </button>
      </div>
    </div>
  )
}
