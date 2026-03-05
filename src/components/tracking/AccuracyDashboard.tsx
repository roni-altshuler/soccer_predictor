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
  home_win_predicted?: number
  home_win_correct?: number
  draw_predicted?: number
  draw_correct?: number
  away_win_predicted?: number
  away_win_correct?: number
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
  const [modelInfo, setModelInfo] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [trendWindow, setTrendWindow] = useState(10)
  const [fetcherStatus, setFetcherStatus] = useState<any>(null)
  const [fetching, setFetching] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [summaryRes, trendRes, statusRes, modelRes] = await Promise.all([
        fetch('/api/v1/tracking/accuracy/summary'),
        fetch('/api/v1/tracking/accuracy/trend?window=' + trendWindow),
        fetch('/api/v1/tracking/outcome-status'),
        fetch('/api/v1/tracking/model-info'),
      ])
      if (summaryRes.ok) setSummary(await summaryRes.json())
      if (trendRes.ok) setTrend(await trendRes.json())
      if (statusRes.ok) setFetcherStatus(await statusRes.json())
      if (modelRes.ok) setModelInfo(await modelRes.json())
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

      {/* Key Performance Indicators */}
      <KPIGrid metrics={m} last30={summary.last_30_days} />

      {/* Outcome Accuracy */}
      <OutcomeAccuracy metrics={m} />

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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ModelCard modelInfo={modelInfo} />
        <FetcherPanel status={fetcherStatus} fetching={fetching} onFetch={triggerFetch} />
      </div>
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
  const outcomeColor = accuracyColor(outcomeAcc)
  const scoreColor = accuracyColor(scoreAcc)

  return (
    <div className="bg-[var(--card-bg)] border rounded-2xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
      <div className="p-6">
        <div className="flex flex-col md:flex-row items-center gap-8">
          {/* Outcome Accuracy Ring */}
          <div className="flex flex-col items-center gap-2">
            <div className="relative w-32 h-32">
              <svg viewBox="0 0 128 128" className="w-full h-full -rotate-90">
                <circle cx="64" cy="64" r="52" stroke="var(--muted-bg)" strokeWidth="8" fill="none" />
                <circle
                  cx="64" cy="64" r="52"
                  stroke={outcomeColor} strokeWidth="8" fill="none"
                  strokeLinecap="round"
                  strokeDasharray={outcomeAcc * 326.7 + ' 326.7'}
                  className="transition-all duration-700"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold" style={{ color: outcomeColor }}>{pct(outcomeAcc)}</span>
              </div>
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-[var(--text-primary)]">Outcome Accuracy</p>
              <p className="text-xs text-[var(--text-tertiary)]">
                {metrics.winner_correct_count}/{metrics.completed_predictions} correct
              </p>
            </div>
          </div>

          {/* Scoreline Accuracy Ring */}
          <div className="flex flex-col items-center gap-2">
            <div className="relative w-32 h-32">
              <svg viewBox="0 0 128 128" className="w-full h-full -rotate-90">
                <circle cx="64" cy="64" r="52" stroke="var(--muted-bg)" strokeWidth="8" fill="none" />
                <circle
                  cx="64" cy="64" r="52"
                  stroke={scoreColor} strokeWidth="8" fill="none"
                  strokeLinecap="round"
                  strokeDasharray={scoreAcc * 326.7 + ' 326.7'}
                  className="transition-all duration-700"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold" style={{ color: scoreColor }}>{pct(scoreAcc)}</span>
              </div>
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-[var(--text-primary)]">Scoreline Accuracy</p>
              <p className="text-xs text-[var(--text-tertiary)]">
                {metrics.exact_scoreline_count ?? 0}/{metrics.completed_predictions} exact
              </p>
            </div>
          </div>

          {/* Stats + Form */}
          <div className="flex-1 space-y-4">
            <div>
              <p className="text-sm font-medium text-[var(--text-secondary)] mb-1">Recent Form (Last 15)</p>
              <div className="flex gap-1 flex-wrap">
                {form.slice(0, 15).map((r, i) => (
                  <span
                    key={i}
                    className={'w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold text-white ' + (r === 'W' ? 'bg-emerald-500' : 'bg-red-400')}
                  >
                    {r === 'W' ? '\u2713' : '\u2717'}
                  </span>
                ))}
              </div>
            </div>
            {streak.type !== 'N/A' && (
              <p className="text-xs text-[var(--text-tertiary)]">
                Current streak: <span className="font-semibold text-[var(--text-primary)]">{streak.count}</span>{' '}
                {streak.type === 'W' ? 'correct' : 'incorrect'} in a row
              </p>
            )}
            <div className="flex gap-4 text-xs text-[var(--text-tertiary)]">
              <span>Brier: <span className="font-medium text-[var(--text-primary)]">{(metrics.brier_score ?? 0).toFixed(3)}</span></span>
              <span>Avg Goal Diff: <span className="font-medium text-[var(--text-primary)]">{(metrics.avg_goals_difference ?? 0).toFixed(2)}</span></span>
              <span>Within 1 Goal: <span className="font-medium text-[var(--text-primary)]">{pct(metrics.within_1_goal_rate ?? 0)}</span></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────────────
   KPIGrid — 6 clean stat cards
   ────────────────────────────────────────────────────────────────────── */

function KPIGrid({ metrics, last30 }: { metrics: OverallMetrics; last30: OverallMetrics }) {
  const kpis = [
    {
      label: 'All-Time Outcome',
      value: pct(metrics.winner_accuracy),
      sub: metrics.completed_predictions + ' matches',
      color: accuracyColor(metrics.winner_accuracy),
    },
    {
      label: 'Last 30 Days',
      value: last30.completed_predictions > 0 ? pct(last30.winner_accuracy) : '\u2014',
      sub: last30.completed_predictions + ' matches',
      color: last30.completed_predictions > 0 ? accuracyColor(last30.winner_accuracy) : '#888',
    },
    {
      label: 'High Confidence',
      value: pct(metrics.high_confidence_accuracy),
      sub: 'Confidence \u2265 55%',
      color: accuracyColor(metrics.high_confidence_accuracy),
    },
    {
      label: 'Medium Confidence',
      value: pct(metrics.medium_confidence_accuracy),
      sub: 'Confidence 42\u201355%',
      color: accuracyColor(metrics.medium_confidence_accuracy),
    },
    {
      label: 'Low Confidence',
      value: pct(metrics.low_confidence_accuracy),
      sub: 'Confidence < 42%',
      color: accuracyColor(metrics.low_confidence_accuracy),
    },
    {
      label: 'Exact Scoreline',
      value: pct(metrics.exact_scoreline_rate),
      sub: (metrics.exact_scoreline_count ?? 0) + ' of ' + metrics.completed_predictions,
      color: accuracyColor(metrics.exact_scoreline_rate),
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {kpis.map((k) => (
        <div key={k.label} className="bg-[var(--card-bg)] border rounded-xl p-4 text-center" style={{ borderColor: 'var(--border-color)' }}>
          <p className="text-2xl font-bold" style={{ color: k.color }}>{k.value}</p>
          <p className="text-xs font-medium text-[var(--text-primary)] mt-1">{k.label}</p>
          <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">{k.sub}</p>
        </div>
      ))}
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

function LeagueBreakdown({ data }: { data: Record<string, any> }) {
  const leagues = Object.entries(data).sort((a: any, b: any) => (b[1].total ?? 0) - (a[1].total ?? 0))

  return (
    <div className="bg-[var(--card-bg)] border rounded-2xl p-5" style={{ borderColor: 'var(--border-color)' }}>
      <h3 className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider mb-4">
        Accuracy by League
      </h3>
      <div className="space-y-3">
        {leagues.map(([league, stats]: any) => {
          const acc = stats.accuracy ?? 0
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
              <span className="text-[10px] text-[var(--text-tertiary)] w-16 text-right">
                {stats.correct ?? 0}/{stats.total ?? 0}
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
            <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">{totalCount} total predictions</p>
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

function ModelCard({ modelInfo }: { modelInfo: any }) {
  const methods = [
    { icon: '\uD83E\uDDE0', name: 'Neural Ensemble', desc: 'Per-league MLP + XGBoost + LightGBM + GradientBoosting + RandomForest' },
    { icon: '\uD83D\uDCCA', name: 'Dixon-Coles Poisson', desc: 'Corrected bivariate Poisson for scoreline prediction' },
    { icon: '\u26A1', name: 'ELO Ratings', desc: 'Dynamic ratings with league coefficients and goal-difference weighting' },
    { icon: '\uD83D\uDD04', name: 'Online Learning', desc: 'Auto-updating neural nets and ELO after each matchday' },
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
            <span className="text-base mt-0.5">{m.icon}</span>
            <div>
              <p className="text-xs font-semibold text-[var(--text-primary)]">{m.name}</p>
              <p className="text-[10px] text-[var(--text-tertiary)] leading-relaxed">{m.desc}</p>
            </div>
          </div>
        ))}
      </div>
      {neuralCount > 0 && (
        <p className="text-[10px] text-[var(--text-tertiary)] mt-3 pt-3 border-t" style={{ borderColor: 'var(--border-color)' }}>
          {neuralCount} league-specific neural models trained · 38-feature pipeline
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
  status: any
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
