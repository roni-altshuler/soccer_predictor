'use client'

import { useEffect, useMemo, useState } from 'react'

import { AccuracyDeepCuts } from '@/components/accuracy/AccuracyDeepCuts'
import { AccuracyHeadline } from '@/components/accuracy/AccuracyHeadline'
import { AccuracyKpiStrip } from '@/components/accuracy/AccuracyKpiStrip'
import { BaselineLadder } from '@/components/accuracy/BaselineLadder'
import { LeagueTable } from '@/components/accuracy/LeagueTable'
import { MarketBenchmarkPanel } from '@/components/accuracy/MarketBenchmarkPanel'
import { ReliabilityPanel } from '@/components/accuracy/ReliabilityPanel'
import { ScopeNote } from '@/components/accuracy/ScopeNote'
import { samplePhrase } from '@/components/accuracy/accuracyMetrics'
import type { RecentPick } from '@/components/accuracy/RecentPicksFeed'
import { DocsRow } from '@/components/evidence/DocsLink'
import { EvidenceHeader, Panel } from '@/components/evidence/primitives'
import { useGenderQuery } from '@/hooks/useGenderQuery'
import { getLeagueAccent } from '@/lib/leagueAccents'
import type { AccuracySummaryResponse, FlatAccuracyResponse } from '@/lib/types/accuracy'

/**
 * The published-pick record: how the picks this site made have actually scored.
 *
 * The sibling of `/evaluation`, and built from the same furniture on purpose —
 * one section is one Panel, the eyebrow heading names the job, the numbers are
 * the biggest thing in the block. The two pages are one part of the app and
 * were rendering as two products.
 *
 * The division of labour between them: `/evaluation` is about the MODEL —
 * what it believed in each competition and what that belief was worth against
 * the baselines. This page is about the PICKS — the record of what was
 * published, scored after the fact. Both are organised per competition,
 * because a pooled hit rate over eleven competitions and three model
 * generations is a number that describes nothing.
 *
 * Order, top to bottom:
 *   1. The headline rate, its sample, and the floor that makes it readable.
 *   2. A strip of supporting numbers, each carrying its own denominator.
 *   3. The market benchmark, then the rest of the baseline ladder.
 *   4. Calibration — the claim this page exists to support.
 *   5. The record per competition.
 *   6. The deep cuts, behind tabs rather than as four more cards.
 *   7. What the record covers and holds out.
 *
 * Honesty rules that shape the layout: a section whose data is missing renders
 * nothing, rates below their minimum sample lose their verdict chips rather
 * than their context, and no number here is derived from anything other than
 * the settled record.
 *
 * The three paragraphs of "how to read this" that used to close the page are
 * in `docs/handbook/` now — linked, not inlined. They were explaining scoring
 * on a page whose job is to report it.
 */

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
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

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
    ]).then(([accuracy, recent, summaryRes]) => {
      if (cancelled) return
      const acc = settledValue(accuracy)
      setMetrics(acc)
      setPicks(settledValue(recent)?.predictions ?? [])
      setSummary(settledValue(summaryRes))
      setFailed(acc === null)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [asQueryParam])

  const settled = metrics?.completed_predictions ?? 0
  const total = metrics?.total_predictions ?? 0
  const pending = metrics?.pending_predictions ?? Math.max(0, total - settled)

  // Per-league rollup filtered to the active universe. The summary endpoint
  // rolls up the whole pool rather than slicing by universe, but league
  // records are single-gender, so this slice is exact.
  const leagueRows = useMemo(() => {
    if (!summary?.by_league) return []
    return Object.values(summary.by_league).filter(
      (row) => row.total > 0 && getLeagueAccent(row.league).gender === asQueryParam
    )
  }, [summary, asQueryParam])

  if (loading && metrics === null) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-6 md:py-8">
        <PageHeader />
        <AccuracySkeleton />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-6 md:py-8">
      <PageHeader />

      {failed ? (
        <div className="mt-8">
          <EmptyState
            heading="The record isn't loading"
            body="The settled-results feed didn't respond. Nothing is estimated in its place — try again in a moment."
          />
        </div>
      ) : settled === 0 ? (
        <div className="mt-8 space-y-6">
          <ScopeNote scope={metrics?.scope} />
          <EmptyState
            heading={total > 0 ? 'No results in yet' : 'Nothing tracked here yet'}
            body={
              total > 0 ? (
                <>
                  {samplePhrase(total, 'pick')} recorded, none with a final result so far. The
                  rates and breakdowns appear as soon as the first match finishes.
                </>
              ) : (
                <>
                  Nothing in scope has been settled yet. The record covers the model serving
                  today in the five covered leagues, and that intersection is currently empty
                  &mdash; see the note above for what is being held out and why.
                </>
              )
            }
          />
          {/* The live record being empty is the strongest reason to show the
              backtest: without it the page says nothing at all about whether
              the model is any good. */}
          <BaselineLadder />
        </div>
      ) : (
        <div className="mt-8 space-y-6">
          <AccuracyHeadline
            accuracy={metrics?.winner_accuracy ?? 0}
            settled={settled}
            pending={pending}
            recentForm={metrics?.recent_form ?? []}
            gender={gender}
          />

          <AccuracyKpiStrip
            settled={settled}
            probabilityScore={metrics?.brier_score ?? null}
            calibrationGap={metrics?.expected_calibration_error ?? null}
            recentAccuracy={metrics?.recent_accuracy ?? 0}
            recentWindow={Math.min(50, settled)}
          />

          {/* Sits directly under the headline because it is what makes the
              headline readable. A hit rate is meaningless without the closing
              line beside it. Renders nothing if the benchmark has never run. */}
          <MarketBenchmarkPanel />

          {/* Where the model sits against yardsticks a reader would actually
              use. The headline's floor is "always pick home"; this is the rest
              of the ladder, up to the closing line. */}
          <BaselineLadder />

          <ReliabilityPanel
            bins={metrics?.calibration_bins ?? []}
            gap={metrics?.expected_calibration_error ?? null}
            settled={settled}
          />

          {/* Per competition, out of the tabs it used to hide in. A pooled hit
              rate is an average over leagues that differ by six points, and
              the reader almost always cares about one of them. */}
          {leagueRows.length ? (
            <Panel title="The record, competition by competition">
              <LeagueTable
                className="-mx-4 mt-2 md:-mx-5"
                rows={leagueRows}
                overallAccuracy={metrics?.winner_accuracy ?? 0}
                embedded
              />
            </Panel>
          ) : null}

          <AccuracyDeepCuts metrics={metrics} picks={picks} />

          <ScopeNote scope={metrics?.scope} />

          <DocsRow
            docs={[
              { doc: 'tutorialJudge', label: 'How to read this' },
              { doc: 'scoring', label: 'What the metrics mean' },
              { doc: 'evaluation', label: 'How the record is kept' },
            ]}
          />
        </div>
      )}
    </div>
  )
}

/**
 * The same header the other evidence page uses.
 *
 * `/accuracy` and `/evaluation` are one section of the app and were rendering
 * as two products: an 18px bold title with a grey line under it here, an
 * uppercase letterspaced display there, on containers with different padding
 * and different vertical rhythm. `EvidenceHeader` is the single one.
 */
function PageHeader() {
  return (
    <>
      <EvidenceHeader
        title="Accuracy"
        lede="Every pick this site has published, scored against the final result."
      />
      <DocsRow
        className="mt-3"
        docs={[
          { doc: 'tutorialJudge', label: 'How to judge this' },
          { doc: 'scoring', label: 'What the metrics mean' },
        ]}
      />
    </>
  )
}

function EmptyState({ heading, body }: { heading: string; body: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--border-color)] bg-[var(--card-bg)] px-6 py-10 text-center">
      <h2 className="text-sm font-bold text-[var(--text-primary)]">{heading}</h2>
      <p className="mx-auto mt-1.5 max-w-md text-[12px] leading-relaxed text-[var(--text-tertiary)]">
        {body}
      </p>
    </div>
  )
}

/** Loading skeleton mirroring the final layout — headline, strip, chart, tabs. */
function AccuracySkeleton() {
  return (
    <div className="mt-8 space-y-6" role="status" aria-label="Loading accuracy data">
      <div className="skeleton-shimmer h-[240px] rounded-xl border border-[var(--border-color)]" />
      <div className="skeleton-shimmer h-[300px] rounded-xl border border-[var(--border-color)] sm:h-[160px] lg:h-[92px]" />
      <div className="skeleton-shimmer h-[440px] rounded-xl border border-[var(--border-color)]" />
      <div className="skeleton-shimmer h-[320px] rounded-xl border border-[var(--border-color)]" />
      <span className="sr-only">Loading…</span>
    </div>
  )
}
