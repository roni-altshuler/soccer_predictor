'use client'

import { useEffect, useMemo, useState } from 'react'

import { AccuracyHero } from '@/components/accuracy/AccuracyHero'
import { CalibrationPlot } from '@/components/accuracy/CalibrationPlot'
import { ConfusionHeatmap, type ConfusionRow, type OutcomeKey } from '@/components/accuracy/ConfusionHeatmap'
import { LeaguePerformanceBreakdown } from '@/components/accuracy/LeaguePerformanceBreakdown'
import { ModelExplainer } from '@/components/accuracy/ModelExplainer'
import { RecentPicksFeed, type RecentPick } from '@/components/accuracy/RecentPicksFeed'
import { useGenderQuery } from '@/hooks/useGenderQuery'
import type { FlatAccuracyResponse } from '@/lib/types/accuracy'

/**
 * Public-facing accuracy page — the one users land on when they click
 * "how accurate is the AI?". Matchday v3 grammar: compact title line,
 * honest headline card, then dense flat cards (calibration, confusion,
 * recent picks, league breakdown). Gender-aware via useGenderQuery.
 *
 * This is the only results surface — methodology lives in
 * docs/methodology.md, not in the UI.
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
      fetch(`/api/v1/tracking/recent?gender=${asQueryParam}&limit=30&completed_only=true`, { cache: 'no-store' })
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

  const accuracyPct = metrics?.winner_accuracy ?? 0
  const recentAccuracy = metrics?.recent_accuracy ?? 0
  const completed = metrics?.completed_predictions ?? 0
  const total = metrics?.total_predictions ?? 0
  const brier = metrics?.brier_score ?? 0

  // While the first fetch is in flight we show a skeleton instead of the
  // headline — rendering "no predictions yet" copy before the data
  // arrives would be dishonest (design rule 5).
  if (loading && metrics === null) {
    return (
      <div className="mx-auto w-full max-w-5xl px-3 py-4 sm:px-4">
        <h1 className="px-1 pb-3 text-lg font-bold tracking-tight text-[var(--text-primary)]">
          Accuracy
        </h1>
        <div className="animate-pulse space-y-3">
          <div className="h-24 rounded-xl bg-[var(--muted-bg)]" />
          <div className="h-20 rounded-xl bg-[var(--muted-bg)]" />
          <div className="h-64 rounded-xl bg-[var(--muted-bg)]" />
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-3 py-4 sm:px-4">
      <div className="px-1 pb-3">
        <h1 className="text-lg font-bold tracking-tight text-[var(--text-primary)]">
          Accuracy
        </h1>
        <p className="text-[12px] text-[var(--text-tertiary)]">
          How the AI&apos;s picks have actually scored, updated as results come in.
        </p>
      </div>

      <div className="space-y-3">
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
          <div className="rounded-xl border border-dashed border-[var(--border-color)] bg-[var(--card-bg)] p-6 text-center">
            <h2 className="text-sm font-bold text-[var(--text-primary)]">
              Waiting on the first settled matches
            </h2>
            <p className="mx-auto mt-1.5 max-w-md text-[12px] text-[var(--text-tertiary)]">
              {total > 0 ? (
                <>
                  {total.toLocaleString()} pick{total === 1 ? '' : 's'} tracked, none with a
                  final result yet. The charts and recent-picks feed appear here as
                  soon as the first match finishes.
                </>
              ) : (
                <>
                  No picks tracked yet for this universe. Try one yourself on{' '}
                  <a
                    className="font-semibold text-[var(--accent-primary)] hover:underline"
                    href="/predict"
                  >
                    AI predict
                  </a>
                  .
                </>
              )}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
              <CalibrationPlot bins={calibrationBins} className="lg:col-span-3" />
              <ConfusionHeatmap rows={confusion} className="lg:col-span-2" />
            </div>

            <RecentPicksFeed picks={picks} />

            <LeaguePerformanceBreakdown picks={picks} />
          </>
        )}

        <ModelExplainer />
      </div>
    </div>
  )
}
