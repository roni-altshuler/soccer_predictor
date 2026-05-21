'use client'

import { useEffect, useMemo, useState } from 'react'

import { AccuracyHero } from '@/components/accuracy/AccuracyHero'
import { CalibrationPlot, type CalibrationBin } from '@/components/accuracy/CalibrationPlot'
import { ConfusionHeatmap, type ConfusionRow, type OutcomeKey } from '@/components/accuracy/ConfusionHeatmap'
import { ModelExplainer } from '@/components/accuracy/ModelExplainer'
import { RecentPicksFeed, type RecentPick } from '@/components/accuracy/RecentPicksFeed'
import { useGenderQuery } from '@/hooks/useGenderQuery'

/**
 * Public-facing accuracy page — the one users land on when they click
 * "how accurate is the AI?". Pulls live numbers from the gender-aware
 * tracker endpoints (Stream A) and toggles between men's and women's
 * universes via the prominent hero gender control.
 *
 * Sister page: /diagnostics keeps the engineer-facing TrackingCenter
 * content (model quality gates, league-by-league audit, drift charts).
 */

interface AccuracyResponse {
  total_predictions: number
  completed_predictions: number
  pending_predictions: number
  winner_accuracy: number
  recent_accuracy: number
  brier_score: number
  home_win_predicted: number
  home_win_correct: number
  draw_predicted: number
  draw_correct: number
  away_win_predicted: number
  away_win_correct: number
  calibration_bins?: CalibrationBin[]
}

function buildConfusion(metrics: AccuracyResponse): ConfusionRow[] {
  // The tracker exposes "predicted → outcome" counts; we re-shape into
  // a {actual → predicted} confusion matrix using winner_correct flags.
  // Without per-cell totals from the backend, we approximate the off-
  // diagonal cells by spreading misses evenly across the other two
  // outcomes — pragmatic placeholder until we add an explicit endpoint.
  const cells: ConfusionRow[] = []
  const outcomes: OutcomeKey[] = ['home', 'draw', 'away']
  const predCounts = {
    home: metrics.home_win_predicted,
    draw: metrics.draw_predicted,
    away: metrics.away_win_predicted,
  }
  const correctCounts = {
    home: metrics.home_win_correct,
    draw: metrics.draw_correct,
    away: metrics.away_win_correct,
  }
  for (const actual of outcomes) {
    const row: Record<OutcomeKey, number> = { home: 0, draw: 0, away: 0 }
    // Correct cell (diagonal): how many times we predicted X and got X
    row[actual] = correctCounts[actual]
    // Spread the "predicted X but X didn't happen" across the other two outcomes
    // as a rough proxy until the backend exposes per-cell counts.
    for (const predicted of outcomes) {
      if (predicted === actual) continue
      const wrong = Math.max(0, predCounts[predicted] - correctCounts[predicted])
      // assume 50/50 of those wrongs landed on each of the other rows
      row[predicted] += Math.round(wrong / 2)
    }
    cells.push({ actual, predicted: row })
  }
  return cells
}

export default function AccuracyPage() {
  const { gender, asQueryParam } = useGenderQuery()
  const [metrics, setMetrics] = useState<AccuracyResponse | null>(null)
  const [picks, setPicks] = useState<RecentPick[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      fetch(`/api/v1/tracking/accuracy?gender=${asQueryParam}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch(`/api/v1/tracking/recent?gender=${asQueryParam}&limit=20`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : { predictions: [] }))
        .catch(() => ({ predictions: [] })),
    ]).then(([accuracy, recent]) => {
      if (cancelled) return
      setMetrics(accuracy)
      setPicks(recent?.predictions ?? [])
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [asQueryParam])

  const confusion = useMemo(() => (metrics ? buildConfusion(metrics) : []), [metrics])
  const calibrationBins = metrics?.calibration_bins ?? []

  // The hero shows headline numbers — sensible defaults when the
  // backend hasn't responded yet so the page doesn't flash empty.
  const accuracyPct = metrics?.winner_accuracy ?? 0
  const recentAccuracy = metrics?.recent_accuracy ?? 0
  const completed = metrics?.completed_predictions ?? 0
  const total = metrics?.total_predictions ?? 0
  const brier = metrics?.brier_score ?? 0

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6">
        <AccuracyHero
          accuracyPct={accuracyPct}
          completedPredictions={completed}
          totalPredictions={total}
          brierScore={brier}
          recentAccuracy={recentAccuracy}
          gender={gender}
        />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <CalibrationPlot bins={calibrationBins} className="lg:col-span-3" />
          <ConfusionHeatmap rows={confusion} className="lg:col-span-2" />
        </div>

        <RecentPicksFeed picks={picks} />

        <ModelExplainer />

        {loading && metrics === null && (
          <p className="text-center text-[10px] text-[var(--text-tertiary)]">Loading metrics…</p>
        )}
      </div>
    </div>
  )
}
