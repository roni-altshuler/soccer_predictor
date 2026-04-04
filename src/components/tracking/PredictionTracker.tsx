'use client'

import { useState, useEffect } from 'react'

interface PredictionResult {
  matchId: string
  homeTeam: string
  awayTeam: string
  date: string
  prediction: {
    homeWinProb: number
    drawProb: number
    awayWinProb: number
    predictedResult: 'home' | 'draw' | 'away'
    confidence: number
    predictedScore?: { home: number; away: number }
  }
  actual?: {
    homeScore: number
    awayScore: number
    result: 'home' | 'draw' | 'away'
  }
  isCorrect?: boolean
  wasPlayed: boolean
}

interface AccuracyMetrics {
  totalPredictions: number
  correctPredictions: number
  accuracy: number
  resultAccuracy: number  // 1X2 accuracy
  scoreAccuracy: number   // Exact score accuracy
  profitLoss?: number     // If betting simulation
  roi?: number
  byConfidence: {
    high: { total: number; correct: number; accuracy: number }
    medium: { total: number; correct: number; accuracy: number }
    low: { total: number; correct: number; accuracy: number }
  }
  recentForm: ('W' | 'L')[]  // Last 10 predictions
}

interface PredictionApiRow {
  match_id?: string
  home_team?: string
  away_team?: string
  match_date?: string
  home_win_prob?: number
  draw_prob?: number
  away_win_prob?: number
  predicted_winner?: string
  confidence?: number
  predicted_scoreline?: string
  actual_scoreline?: string | null
  actual_winner?: string | null
  winner_correct?: boolean | null
  status?: string
}

interface PredictionApiResponse {
  predictions?: PredictionApiRow[]
}

export default function PredictionTracker() {
  const [predictions, setPredictions] = useState<PredictionResult[]>([])
  const [metrics, setMetrics] = useState<AccuracyMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'correct' | 'incorrect' | 'pending'>('all')
  const [timeRange, setTimeRange] = useState<'week' | 'month' | 'season'>('month')

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      try {
        // Fetch predictions and metrics from backend
        const [predictionsRes, metricsRes] = await Promise.all([
          fetch(`/api/v1/tracking/predictions?time_range=${timeRange}`),
          fetch(`/api/v1/tracking/accuracy`)
        ])

        if (predictionsRes.ok) {
          const predData = await predictionsRes.json() as PredictionApiResponse
          // Transform flat API response to PredictionResult shape
          const mapped: PredictionResult[] = (predData.predictions || []).map((p) => {
            const predictedResult: 'home' | 'draw' | 'away' =
              p.predicted_winner === 'away' ? 'away' : p.predicted_winner === 'draw' ? 'draw' : 'home'
            const actualResult: 'home' | 'draw' | 'away' =
              p.actual_winner === 'home' || p.actual_winner === 'away' || p.actual_winner === 'draw'
                ? p.actual_winner
                : 'draw'

            return {
              matchId: p.match_id || '',
              homeTeam: p.home_team || '',
              awayTeam: p.away_team || '',
              date: p.match_date || '',
              prediction: {
                homeWinProb: p.home_win_prob ?? 0,
                drawProb: p.draw_prob ?? 0,
                awayWinProb: p.away_win_prob ?? 0,
                predictedResult,
                confidence: p.confidence ?? 0,
                predictedScore: p.predicted_scoreline ? {
                  home: parseInt(p.predicted_scoreline.split('-')[0]) || 0,
                  away: parseInt(p.predicted_scoreline.split('-')[1]) || 0,
                } : undefined,
              },
              actual: p.actual_scoreline ? {
                homeScore: parseInt(p.actual_scoreline.split('-')[0]) || 0,
                awayScore: parseInt(p.actual_scoreline.split('-')[1]) || 0,
                result: actualResult,
              } : undefined,
              isCorrect: p.winner_correct ?? undefined,
              wasPlayed: p.status === 'completed',
            }
          })
          setPredictions(mapped)
        }

        if (metricsRes.ok) {
          const metricsData = await metricsRes.json()
          setMetrics({
            totalPredictions: metricsData.total_predictions || 0,
            correctPredictions: metricsData.correct_predictions || 0,
            accuracy: metricsData.accuracy || 0,
            resultAccuracy: metricsData.result_accuracy || 0,
            scoreAccuracy: metricsData.score_accuracy || 0,
            profitLoss: metricsData.profit_loss,
            roi: metricsData.roi,
            byConfidence: metricsData.by_confidence || {
              high: { total: 0, correct: 0, accuracy: 0 },
              medium: { total: 0, correct: 0, accuracy: 0 },
              low: { total: 0, correct: 0, accuracy: 0 }
            },
            recentForm: metricsData.recent_form || []
          })
        }
      } catch (error) {
        console.error('Failed to fetch prediction data:', error)
        // Set mock data for demo
        setMetrics({
          totalPredictions: 48,
          correctPredictions: 26,
          accuracy: 0.542,
          resultAccuracy: 0.542,
          scoreAccuracy: 0.083,
          byConfidence: {
            high: { total: 15, correct: 11, accuracy: 0.733 },
            medium: { total: 22, correct: 11, accuracy: 0.500 },
            low: { total: 11, correct: 4, accuracy: 0.364 }
          },
          recentForm: ['W', 'L', 'W', 'W', 'L', 'W', 'L', 'W', 'W', 'L']
        })
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [timeRange])

  const getAccuracyColor = (accuracy: number): string => {
    if (accuracy >= 0.6) return 'text-green-500'
    if (accuracy >= 0.45) return 'text-amber-500'
    return 'text-red-400'
  }

  const filteredPredictions = predictions.filter(p => {
    if (filter === 'all') return true
    if (filter === 'pending') return !p.wasPlayed
    if (filter === 'correct') return p.wasPlayed && p.isCorrect
    if (filter === 'incorrect') return p.wasPlayed && !p.isCorrect
    return true
  })

  if (loading) {
    return (
      <div className="bg-[var(--card-bg)] border rounded-2xl p-8 animate-pulse" style={{ borderColor: 'var(--border-color)' }}>
        <div className="h-6 bg-[var(--muted-bg)] rounded w-48 mb-4" />
        <div className="h-32 bg-[var(--muted-bg)] rounded mb-4" />
        <div className="h-24 bg-[var(--muted-bg)] rounded" />
      </div>
    )
  }

  return (
    <div className="bg-[var(--card-bg)] border rounded-2xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
      {/* Header */}
      <div className="p-6 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-[var(--text-primary)] flex items-center gap-2">
              📊 Prediction Performance
            </h2>
            <p className="text-sm text-[var(--text-tertiary)]">
              Track model accuracy and learn from results
            </p>
          </div>
          <div className="flex gap-2">
            {(['week', 'month', 'season'] as const).map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-3 py-1 rounded-lg text-sm capitalize ${
                  timeRange === range
                    ? 'bg-[var(--accent-primary)] text-white'
                    : 'bg-[var(--muted-bg)] text-[var(--text-secondary)]'
                }`}
              >
                {range}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Accuracy Display */}
      {metrics && (
        <div className="p-6 border-b" style={{ borderColor: 'var(--border-color)' }}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Overall Accuracy */}
            <div className="text-center">
              <div className="relative inline-flex items-center justify-center w-32 h-32 mb-3">
                <svg className="w-32 h-32 transform -rotate-90">
                  <circle
                    cx="64"
                    cy="64"
                    r="56"
                    stroke="currentColor"
                    strokeWidth="8"
                    fill="none"
                    className="text-[var(--muted-bg)]"
                  />
                  <circle
                    cx="64"
                    cy="64"
                    r="56"
                    stroke="url(#accuracyGradient)"
                    strokeWidth="8"
                    fill="none"
                    strokeLinecap="round"
                    strokeDasharray={`${metrics.accuracy * 352} 352`}
                    className="transition-all duration-1000"
                  />
                  <defs>
                    <linearGradient id="accuracyGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor={metrics.accuracy >= 0.6 ? '#22c55e' : metrics.accuracy >= 0.45 ? '#f59e0b' : '#ef4444'} />
                      <stop offset="100%" stopColor={metrics.accuracy >= 0.6 ? '#10b981' : metrics.accuracy >= 0.45 ? '#fbbf24' : '#f97316'} />
                    </linearGradient>
                  </defs>
                </svg>
                <div className="absolute">
                  <p className={`text-3xl font-bold ${getAccuracyColor(metrics.accuracy)}`}>
                    {(metrics.accuracy * 100).toFixed(1)}%
                  </p>
                  <p className="text-xs text-[var(--text-tertiary)]">Accuracy</p>
                </div>
              </div>
              <p className="text-sm text-[var(--text-secondary)]">
                {metrics.correctPredictions} / {metrics.totalPredictions} correct
              </p>
            </div>

            {/* Recent Form */}
            <div className="flex flex-col items-center justify-center">
              <p className="text-sm font-medium text-[var(--text-secondary)] mb-3">Recent Form</p>
              <div className="flex gap-1">
                {metrics.recentForm.map((result, idx) => (
                  <div
                    key={idx}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-white text-sm animate-scaleIn ${
                      result === 'W' ? 'bg-green-500' : 'bg-red-400'
                    }`}
                    style={{ animationDelay: `${idx * 50}ms` }}
                  >
                    {result}
                  </div>
                ))}
              </div>
              <p className="text-xs text-[var(--text-tertiary)] mt-2">Last 10 predictions</p>
            </div>

            {/* Breakdown by Confidence */}
            <div>
              <p className="text-sm font-medium text-[var(--text-secondary)] mb-3 text-center">
                Accuracy by Confidence
              </p>
              <div className="space-y-3">
                {(['high', 'medium', 'low'] as const).map((level) => {
                  const data = metrics.byConfidence[level]
                  const colors = {
                    high: 'bg-green-500',
                    medium: 'bg-amber-500',
                    low: 'bg-red-400'
                  }
                  return (
                    <div key={level}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-[var(--text-secondary)] capitalize">{level}</span>
                        <span className="text-[var(--text-primary)]">
                          {data.correct}/{data.total} ({(data.accuracy * 100).toFixed(0)}%)
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-[var(--muted-bg)] overflow-hidden">
                        <div
                          className={`h-full transition-all duration-500 ${colors[level]}`}
                          style={{ width: `${data.accuracy * 100}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Prediction List */}
      <div>
        {/* Filter Tabs */}
        <div className="flex border-b px-4" style={{ borderColor: 'var(--border-color)' }}>
          {(['all', 'correct', 'incorrect', 'pending'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-3 text-sm font-medium capitalize border-b-2 transition-colors ${
                filter === f
                  ? 'text-[var(--accent-primary)] border-[var(--accent-primary)]'
                  : 'text-[var(--text-tertiary)] border-transparent hover:text-[var(--text-secondary)]'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Predictions */}
        <div className="divide-y" style={{ borderColor: 'var(--border-color)' }}>
          {filteredPredictions.length > 0 ? (
            filteredPredictions.slice(0, 10).map((pred, idx) => (
              <PredictionRow key={pred.matchId} prediction={pred} index={idx} />
            ))
          ) : (
            <div className="p-8 text-center text-[var(--text-tertiary)]">
              No predictions found for this filter
            </div>
          )}
        </div>
      </div>

      {/* Model Insights */}
      <div className="p-4 bg-[var(--muted-bg)] border-t" style={{ borderColor: 'var(--border-color)' }}>
        <p className="text-xs text-[var(--text-tertiary)]">
          💡 Model continuously learns from outcomes. High confidence predictions (&gt;60%) show {metrics ? (metrics.byConfidence.high.accuracy * 100).toFixed(0) : '--'}% accuracy.
        </p>
      </div>
    </div>
  )
}

function PredictionRow({ prediction, index }: { prediction: PredictionResult; index: number }) {
  const getPredictedResultLabel = (result: string): string => {
    switch (result) {
      case 'home': return prediction.homeTeam + ' Win'
      case 'away': return prediction.awayTeam + ' Win'
      case 'draw': return 'Draw'
      default: return 'Unknown'
    }
  }

  return (
    <div
      className="p-4 hover:bg-[var(--muted-bg)] transition-colors animate-slideIn"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
            <span className="font-medium text-[var(--text-primary)]">
              {prediction.homeTeam} vs {prediction.awayTeam}
            </span>
            {prediction.wasPlayed && (
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                prediction.isCorrect
                  ? 'bg-green-500/20 text-green-500'
                  : 'bg-red-500/20 text-red-400'
              }`}>
                {prediction.isCorrect ? '✓ Correct' : '✗ Incorrect'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-[var(--text-tertiary)]">{prediction.date}</span>
            <span className="text-[var(--text-secondary)]">
              Predicted: <span className="text-[var(--accent-primary)]">{getPredictedResultLabel(prediction.prediction.predictedResult)}</span>
              {prediction.prediction.predictedScore && (
                <span className="ml-1">
                  ({prediction.prediction.predictedScore.home}-{prediction.prediction.predictedScore.away})
                </span>
              )}
            </span>
          </div>
        </div>
        <div className="text-right">
          {prediction.wasPlayed && prediction.actual && (
            <div>
              <p className="text-lg font-bold text-[var(--text-primary)]">
                {prediction.actual.homeScore} - {prediction.actual.awayScore}
              </p>
              <p className="text-xs text-[var(--text-tertiary)]">Final Score</p>
            </div>
          )}
          {!prediction.wasPlayed && (
            <span className="text-xs px-2 py-1 bg-amber-500/20 text-amber-500 rounded-full">
              Pending
            </span>
          )}
        </div>
      </div>
      {/* Probability Bar */}
      <div className="mt-2 flex h-2 rounded-full overflow-hidden bg-[var(--muted-bg)]">
        <div
          className="bg-green-500"
          style={{ width: `${prediction.prediction.homeWinProb * 100}%` }}
          title={`Home: ${(prediction.prediction.homeWinProb * 100).toFixed(0)}%`}
        />
        <div
          className="bg-gray-400"
          style={{ width: `${prediction.prediction.drawProb * 100}%` }}
          title={`Draw: ${(prediction.prediction.drawProb * 100).toFixed(0)}%`}
        />
        <div
          className="bg-blue-500"
          style={{ width: `${prediction.prediction.awayWinProb * 100}%` }}
          title={`Away: ${(prediction.prediction.awayWinProb * 100).toFixed(0)}%`}
        />
      </div>
    </div>
  )
}
