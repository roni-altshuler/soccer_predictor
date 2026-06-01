'use client'

import { useEffect, useMemo, useState } from 'react'

import { AccuracyHero } from '@/components/accuracy/AccuracyHero'
import { CalibrationPlot } from '@/components/accuracy/CalibrationPlot'
import { ConfusionHeatmap, type ConfusionRow, type OutcomeKey } from '@/components/accuracy/ConfusionHeatmap'
import { LeaguePerformanceBreakdown } from '@/components/accuracy/LeaguePerformanceBreakdown'
import { ModelExplainer } from '@/components/accuracy/ModelExplainer'
import { type RecentPick } from '@/components/accuracy/RecentPicksFeed'
import { useGenderQuery } from '@/hooks/useGenderQuery'
import type { FlatAccuracyResponse } from '@/lib/types/accuracy'

/**
 * Public-facing accuracy page — the one users land on when they click
 * "how accurate is the AI?". Pulls live numbers from the gender-aware
 * tracker endpoints (Stream A) and toggles between men's and women's
 * universes via the prominent hero gender control.
 *
 * Sister page: /diagnostics keeps the engineer-facing TrackingCenter
 * content (model quality gates, league-by-league audit, drift charts).
 */

type AccuracyResponse = FlatAccuracyResponse

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
    <div className="min-h-screen">
      <div className="mx-auto w-full max-w-[var(--shell-content-max)] space-y-5 px-4 py-6 md:px-8">
        <AccuracyHero
          accuracyPct={accuracyPct}
          completedPredictions={completed}
          totalPredictions={total}
          brierScore={brier}
          recentAccuracy={recentAccuracy}
          gender={gender}
        />

        {/* When no predictions have been settled yet, the confusion +
            calibration views collapse to NaN/0% — render a clean
            empty-state card instead and keep the explainer below. */}
        {completed === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border-color)] bg-[var(--card-bg)]/60 p-8 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
              Collecting predictions
            </p>
            <h2 className="mt-2 text-h4 font-bold text-[var(--text-primary)]">
              We&apos;re still waiting on settled matches
            </h2>
            <p className="mx-auto mt-2 max-w-md text-small text-[var(--text-tertiary)]">
              {total > 0 ? (
                <>
                  {total.toLocaleString()} prediction{total === 1 ? '' : 's'} tracked, none with a
                  final result yet. The calibration plot, confusion matrix, and recent-picks feed
                  appear here once the outcome fetcher settles its first match.
                </>
              ) : (
                <>The unified model hasn&apos;t made any predictions yet. Run a fixture from <a className="font-semibold text-[var(--accent-primary)] hover:underline" href="/predict">/predict</a> or wait for the scheduled pipeline to fire.</>
              )}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
              <CalibrationPlot bins={calibrationBins} className="lg:col-span-3" />
              <ConfusionHeatmap rows={confusion} className="lg:col-span-2" />
            </div>

            <LeaguePerformanceBreakdown picks={picks} />
          </>
        )}

        <ModelExplainer />

        {loading && metrics === null && (
          <p className="text-center text-[10px] text-[var(--text-tertiary)]">Loading metrics…</p>
        )}
      </div>
    </div>
  )
}
