'use client'

import { useEffect, useMemo, useState } from 'react'

import { AccuracyHero } from '@/components/accuracy/AccuracyHero'
import {
  AccuracyTrendChart,
  MIN_TREND_POINTS,
  type ConfidencePointDatum,
  type TrendPointDatum,
} from '@/components/accuracy/AccuracyTrendChart'
import { CalibrationPlot } from '@/components/accuracy/CalibrationPlot'
import { ConfidenceTiers } from '@/components/accuracy/ConfidenceTiers'
import { LeagueTable } from '@/components/accuracy/LeagueTable'
import { ModelExplainer } from '@/components/accuracy/ModelExplainer'
import { OutcomeBreakdown } from '@/components/accuracy/OutcomeBreakdown'
import { RecentPicksFeed, type RecentPick } from '@/components/accuracy/RecentPicksFeed'
import { ScorelineStats } from '@/components/accuracy/ScorelineStats'
import { Reveal } from '@/components/motion'
import { useGenderQuery } from '@/hooks/useGenderQuery'
import { getLeagueAccent } from '@/lib/leagueAccents'
import type { AccuracySummaryResponse, FlatAccuracyResponse } from '@/lib/types/accuracy'

/**
 * Public-facing accuracy page — the live track record users land on when
 * they ask "how accurate is the AI?". Matchday v3.1 grammar: a scoreboard
 * hero, the rolling form chart, calibration + confidence audits, the
 * per-league table, scoreline stats, and the recent-picks feed. Every
 * number comes from the tracker — nothing approximated, nothing fabricated,
 * and any section whose data is missing simply doesn't render.
 */

/** Rolling window shared by the form chart's two series. */
const TREND_WINDOW = 50

interface TrendResponse {
  window: number
  data_points: number
  trend: TrendPointDatum[]
  latest_accuracy: number | null
}

interface CalibrationTrendPoint extends ConfidencePointDatum {
  date: string
  accuracy: number
}

interface CalibrationTrendResponse {
  window: number
  step: number
  data_points: number
  trend: CalibrationTrendPoint[]
}

interface RecentResponse {
  count: number
  predictions: RecentPick[]
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' })
    return res.ok ? ((await res.json()) as T) : null
  } catch {
    return null
  }
}

function settledValue<T>(result: PromiseSettledResult<T | null>): T | null {
  return result.status === 'fulfilled' ? result.value : null
}

export default function AccuracyPage() {
  const { gender, asQueryParam } = useGenderQuery()
  const [metrics, setMetrics] = useState<FlatAccuracyResponse | null>(null)
  const [picks, setPicks] = useState<RecentPick[]>([])
  const [summary, setSummary] = useState<AccuracySummaryResponse | null>(null)
  const [trend, setTrend] = useState<TrendResponse | null>(null)
  const [calTrend, setCalTrend] = useState<CalibrationTrendResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    // allSettled + never-throwing fetchJson: one failed endpoint hides its
    // section, it never blanks the page.
    Promise.allSettled([
      fetchJson<FlatAccuracyResponse>(`/api/v1/tracking/accuracy?gender=${asQueryParam}`),
      fetchJson<RecentResponse>(
        `/api/v1/tracking/recent?gender=${asQueryParam}&limit=30&completed_only=true`
      ),
      fetchJson<AccuracySummaryResponse>(`/api/v1/tracking/accuracy/summary?gender=${asQueryParam}`),
      fetchJson<TrendResponse>(
        `/api/v1/tracking/accuracy/trend?window=${TREND_WINDOW}&gender=${asQueryParam}`
      ),
      fetchJson<CalibrationTrendResponse>(
        `/api/v1/tracking/calibration-trend?window=${TREND_WINDOW}&step=10&gender=${asQueryParam}`
      ),
    ]).then(([accuracy, recent, summaryRes, trendRes, calTrendRes]) => {
      if (cancelled) return
      setMetrics(settledValue(accuracy))
      setPicks(settledValue(recent)?.predictions ?? [])
      setSummary(settledValue(summaryRes))
      setTrend(settledValue(trendRes))
      setCalTrend(settledValue(calTrendRes))
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [asQueryParam])

  const completed = metrics?.completed_predictions ?? 0
  const total = metrics?.total_predictions ?? 0

  // The summary / trend endpoints roll up the whole prediction pool and
  // don't slice by universe. The men's universe is effectively that pool;
  // the women's universe is not — so pool-level sections (form chart,
  // league table baseline source) are gated to per-league or universe
  // gates below rather than mislabelled.
  const trendPoints = useMemo(
    () => (Array.isArray(trend?.trend) ? trend.trend.filter((p) => Number.isFinite(p.accuracy)) : []),
    [trend]
  )
  const confidencePoints = useMemo(
    () =>
      Array.isArray(calTrend?.trend)
        ? calTrend.trend.filter((p) => Number.isFinite(p.avg_confidence))
        : [],
    [calTrend]
  )
  const showTrend = gender === 'men' && trendPoints.length >= MIN_TREND_POINTS

  // Per-league rollup filtered to the active universe. League records are
  // single-gender, so this slice is exact even though the endpoint isn't.
  const leagueRows = useMemo(() => {
    if (!summary?.by_league) return []
    return Object.values(summary.by_league).filter(
      (row) => row.total > 0 && getLeagueAccent(row.league).gender === asQueryParam
    )
  }, [summary, asQueryParam])

  const calibrationBins = metrics?.calibration_bins ?? []
  const ece = completed > 0 ? (metrics?.expected_calibration_error ?? null) : null

  if (loading && metrics === null) {
    return (
      <div className="mx-auto w-full max-w-5xl px-3 py-4 sm:px-4">
        <PageTitle />
        <AccuracySkeleton />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-3 py-4 sm:px-4">
      <PageTitle />

      <div className="space-y-3">
        {/* 1 — Performance scoreboard */}
        <AccuracyHero
          accuracyPct={metrics?.winner_accuracy ?? 0}
          completedPredictions={completed}
          totalPredictions={total}
          brierScore={completed > 0 ? (metrics?.brier_score ?? null) : null}
          calibrationError={ece}
          recentAccuracy={metrics?.recent_accuracy ?? 0}
          recentForm={metrics?.recent_form ?? []}
          gender={gender}
        />

        {completed === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border-color)] bg-[var(--card-bg)] p-6 text-center">
            <h2 className="text-sm font-bold text-[var(--text-primary)]">
              Waiting on the first settled matches
            </h2>
            <p className="mx-auto mt-1.5 max-w-md text-[12px] text-[var(--text-tertiary)]">
              {total > 0 ? (
                <>
                  {total.toLocaleString()} pick{total === 1 ? '' : 's'} tracked, none with a final
                  result yet. The charts and recent-picks feed appear here as soon as the first
                  match finishes.
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
            {/* 2 — Form over time */}
            {showTrend && (
              <Reveal>
                <AccuracyTrendChart
                  points={trendPoints}
                  confidence={confidencePoints}
                  baseline={summary?.overall?.winner_accuracy ?? null}
                  window={trend?.window ?? TREND_WINDOW}
                />
              </Reveal>
            )}

            {/* 3 — Calibration + confidence audit */}
            <Reveal>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
                <CalibrationPlot bins={calibrationBins} ece={ece} className="lg:col-span-3" />
                <div className="flex flex-col gap-3 lg:col-span-2">
                  <ConfidenceTiers bins={calibrationBins} />
                  {metrics && (
                    <OutcomeBreakdown
                      home={{ predicted: metrics.home_win_predicted, correct: metrics.home_win_correct }}
                      draw={{ predicted: metrics.draw_predicted, correct: metrics.draw_correct }}
                      away={{ predicted: metrics.away_win_predicted, correct: metrics.away_win_correct }}
                    />
                  )}
                </div>
              </div>
            </Reveal>

            {/* 4 — League table (real per-league rollup) */}
            {leagueRows.length > 0 && (
              <Reveal>
                <LeagueTable rows={leagueRows} overallAccuracy={metrics?.winner_accuracy ?? 0} />
              </Reveal>
            )}

            {/* 5 — Scoreline intelligence */}
            {metrics && (
              <Reveal>
                <ScorelineStats
                  exactRate={metrics.exact_scoreline_rate}
                  exactCount={metrics.exact_scoreline_count}
                  completed={completed}
                  top5Rate={metrics.scoreline_top5_rate ?? 0}
                  top5Count={metrics.scoreline_top5_count ?? 0}
                  top5Eligible={metrics.scoreline_top5_eligible ?? 0}
                  avgGoalsError={
                    metrics.avg_goals_difference > 0 ? metrics.avg_goals_difference : null
                  }
                />
              </Reveal>
            )}

            {/* 6 — Recent picks feed */}
            <RecentPicksFeed picks={picks} />
          </>
        )}

        {/* 7 — Plain-language explainer */}
        <ModelExplainer />
      </div>
    </div>
  )
}

function PageTitle() {
  return (
    <div className="px-1 pb-3">
      <h1 className="text-lg font-bold tracking-tight text-[var(--text-primary)]">Accuracy</h1>
      <p className="text-[12px] text-[var(--text-tertiary)]">
        How the AI&apos;s picks have actually scored, updated as results come in.
      </p>
    </div>
  )
}

/** Loading skeleton mirroring the final layout — hero, rail, chart, 2-col, table. */
function AccuracySkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading accuracy data">
      {/* Hero scoreboard */}
      <div className="skeleton-shimmer h-[132px] rounded-2xl border border-[var(--border-color)]" />
      {/* Stat rail */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="skeleton-shimmer h-[76px] rounded-xl border border-[var(--border-color)]"
          />
        ))}
      </div>
      {/* Form chart */}
      <div className="skeleton-shimmer h-[400px] rounded-2xl border border-[var(--border-color)]" />
      {/* Calibration 2-col */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
        <div className="skeleton-shimmer h-[440px] rounded-2xl border border-[var(--border-color)] lg:col-span-3" />
        <div className="flex flex-col gap-3 lg:col-span-2">
          <div className="skeleton-shimmer h-[272px] flex-none rounded-2xl border border-[var(--border-color)]" />
          <div className="skeleton-shimmer h-[156px] flex-none rounded-2xl border border-[var(--border-color)]" />
        </div>
      </div>
      {/* League table */}
      <div className="skeleton-shimmer h-[300px] rounded-2xl border border-[var(--border-color)]" />
      <span className="sr-only">Loading…</span>
    </div>
  )
}
