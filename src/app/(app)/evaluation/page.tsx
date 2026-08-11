'use client'

import { useEffect, useState } from 'react'

import { EmptyState } from '@/components/EmptyState'
import { EvidencePanel } from '@/components/forecast/EvidencePanel'
import type { Historical, Live } from '@/components/forecast/EvidencePanel'
import { cn } from '@/lib/utils'

/**
 * Model evaluation.
 *
 * The single rule this page exists to keep: **historical walk-forward and live
 * published forecasts are never mixed, and never summed.** They are different
 * samples measuring different things — one retrospective and large, one
 * prospective and currently zero — and presenting either as the other would be
 * the most misleading thing this product could do.
 *
 * When the live sample is small, the page says so in words rather than drawing
 * a reliability chart from forty points. A chart implies a shape; forty points
 * do not have one.
 */

interface Bucket {
  bin_low: number
  bin_high: number
  n: number
  stated: number
  observed: number
}

interface Sample {
  basis?: string
  n: number
  brier?: number
  log_loss?: number
  accuracy?: number
  ece?: number
  reliability?: Bucket[]
  xg_mae?: number | null
  top_scoreline_hit_rate?: number | null
  by_league?: Record<string, { n: number; brier: number | null; note?: string }>
  by_model_version?: Record<string, { n: number; brier: number | null; note?: string }>
  baselines?: { uniform: number; sample_base_rate: number; note: string }
  first_kickoff?: string
  last_kickoff?: string
}

interface Payload {
  available: boolean
  generated_at?: string
  live?: Sample
  historical?: Historical
  snapshot_store?: {
    rows: number
    fixtures: number
    versions: number
    first_generated?: string
    last_generated?: string
    by_version?: Record<string, number>
  }
}

// A reliability chart needs enough points per band to have a shape. Below
// this the honest rendering is a sentence, not a diagram.
const MIN_FOR_CHART = 200

export default function EvaluationPage() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    fetch('/api/v1/evaluation', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return
        setData(d as Payload)
        setLoading(false)
      })
      .catch(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  const live = data?.live
  const store = data?.snapshot_store

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-6 md:py-8">
      <header>
        <h1 className="text-[22px] font-semibold uppercase tracking-[0.12em] text-[var(--text-primary)] md:text-[28px]">
          Evaluation
        </h1>
        <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-[var(--text-secondary)]">
          Two records, kept apart on purpose. One is a large retrospective backtest.
          The other is the forecasts this site actually published, scored after the
          fact. They measure different things and are never added together.
        </p>
      </header>

      {loading ? (
        <div
          className="mt-8 h-64 animate-pulse rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]"
          role="status"
          aria-label="Loading evaluation"
        />
      ) : !data?.available ? (
        <div className="mt-8">
          <EmptyState
            title="No evaluation has been generated here"
            description="Run evaluate_live to score the published forecasts against results."
          />
        </div>
      ) : (
        <div className="mt-8 space-y-6">
          <EvidencePanel historical={data.historical} live={live} compact />

          {/* ---- the provenance record --------------------------------- */}
          {store ? (
            <section
              className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-4 md:px-5 md:py-5"
              aria-labelledby="provenance-heading"
            >
              <h2
                id="provenance-heading"
                className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]"
              >
                What has been recorded
              </h2>
              <p className="mt-1.5 max-w-2xl text-[12px] leading-relaxed text-[var(--text-secondary)]">
                Every forecast is written down before kickoff and never rewritten. That
                is what makes the live column below possible at all — without it, a
                forecast that moved would quietly become the forecast we claim to have
                made.
              </p>
              <dl className="mt-3.5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Snapshots" value={store.rows.toLocaleString()} />
                <Stat label="Fixtures" value={store.fixtures.toLocaleString()} />
                <Stat label="Model versions" value={String(store.versions)} />
                <Stat
                  label="Scored so far"
                  value={(live?.n ?? 0).toLocaleString()}
                  tone={live?.n ? undefined : 'muted'}
                />
              </dl>
              {store.by_version && Object.keys(store.by_version).length ? (
                <ul className="mt-3.5 flex flex-wrap gap-1.5">
                  {Object.entries(store.by_version).map(([v, n]) => (
                    <li
                      key={v}
                      className="rounded-md border border-[var(--border-color)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-tertiary)]"
                    >
                      {v} · {n.toLocaleString()}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {/* ---- live detail, or an honest absence --------------------- */}
          <section
            className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-4 md:px-5 md:py-5"
            aria-labelledby="live-heading"
          >
            <h2
              id="live-heading"
              className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]"
            >
              Live published forecasts
            </h2>

            {!live?.n ? (
              <div className="mt-3">
                <p className="max-w-2xl text-[13px] leading-relaxed text-[var(--text-secondary)]">
                  Nothing has been scored yet. No fixture has both a published forecast
                  and a result.
                </p>
                <p className="mt-2 max-w-2xl text-[12px] leading-relaxed text-[var(--text-tertiary)]">
                  This is the correct state before the season starts, not a failure and
                  not a loading state. The forecasts are recorded — {' '}
                  {(store?.fixtures ?? 0).toLocaleString()} of them — and each will be
                  scored as its match is played. A reliability chart will appear here
                  once there are enough results to have a shape; drawing one from a
                  handful would show a pattern that is not there.
                </p>
              </div>
            ) : (
              <>
                <dl className="mt-3.5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Matches" value={live.n.toLocaleString()} />
                  <Stat label="Brier" value={live.brier?.toFixed(5) ?? '—'} />
                  <Stat label="Log loss" value={live.log_loss?.toFixed(5) ?? '—'} />
                  <Stat label="ECE" value={live.ece?.toFixed(4) ?? '—'} />
                </dl>

                {live.baselines ? (
                  <p className="mt-3 text-[12px] leading-relaxed text-[var(--text-tertiary)]">
                    On the same fixtures, a one-in-three forecast scores{' '}
                    <span className="text-[var(--text-secondary)]">
                      {live.baselines.uniform.toFixed(5)}
                    </span>
                    . That gap is the whole of what the model knows.
                  </p>
                ) : null}

                {live.n < MIN_FOR_CHART ? (
                  <p className="mt-3 text-[12px] leading-relaxed text-[var(--accent-warn)]">
                    {live.n} matches is too few for a reliability chart. The numbers
                    above are real; the shape of the error is not yet measurable.
                  </p>
                ) : live.reliability?.length ? (
                  <Reliability buckets={live.reliability} />
                ) : null}

                {live.by_league && Object.keys(live.by_league).length ? (
                  <Breakdown title="By league" rows={live.by_league} />
                ) : null}
                {live.by_model_version &&
                Object.keys(live.by_model_version).length > 1 ? (
                  <Breakdown title="By model version" rows={live.by_model_version} />
                ) : null}

                {live.xg_mae != null || live.top_scoreline_hit_rate != null ? (
                  <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--border-color)] pt-3.5">
                    {live.xg_mae != null ? (
                      <Stat
                        label="Goal-rate error (MAE)"
                        value={live.xg_mae.toFixed(3)}
                      />
                    ) : null}
                    {live.top_scoreline_hit_rate != null ? (
                      <Stat
                        label="Top scoreline hit rate"
                        value={`${(live.top_scoreline_hit_rate * 100).toFixed(1)}%`}
                      />
                    ) : null}
                  </dl>
                ) : null}
              </>
            )}
          </section>

          <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
            The live column scores the last forecast published <em>before</em> each
            kickoff — not the first, which would be stale, and never one generated
            after the match, which would not be a forecast.
          </p>
        </div>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'muted'
}) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
        {label}
      </dt>
      <dd
        className={cn(
          'font-mono text-[18px] tabular-nums',
          tone === 'muted' ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-primary)]',
        )}
      >
        {value}
      </dd>
    </div>
  )
}

function Reliability({ buckets }: { buckets: Bucket[] }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[420px] border-collapse font-mono text-[12px] tabular-nums">
        <caption className="pb-2 text-left font-sans text-[12px] text-[var(--text-secondary)]">
          What it said, against what happened. A calibrated forecaster has the last two
          columns matching.
        </caption>
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
            <th scope="col" className="pb-1.5 pr-3 font-medium">Band</th>
            <th scope="col" className="pb-1.5 pr-3 text-right font-medium">Forecasts</th>
            <th scope="col" className="pb-1.5 pr-3 text-right font-medium">It said</th>
            <th scope="col" className="pb-1.5 text-right font-medium">It happened</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => (
            <tr key={b.bin_low} className="border-t border-[var(--border-color)]">
              <th scope="row" className="py-1.5 pr-3 text-left font-normal text-[var(--text-secondary)]">
                {(b.bin_low * 100).toFixed(0)}–{(b.bin_high * 100).toFixed(0)}%
              </th>
              <td className="py-1.5 pr-3 text-right text-[var(--text-tertiary)]">
                {b.n.toLocaleString()}
              </td>
              <td className="py-1.5 pr-3 text-right text-[var(--text-secondary)]">
                {(b.stated * 100).toFixed(1)}%
              </td>
              <td className="py-1.5 text-right text-[var(--text-primary)]">
                {(b.observed * 100).toFixed(1)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Breakdown({
  title,
  rows,
}: {
  title: string
  rows: Record<string, { n: number; brier: number | null; note?: string }>
}) {
  return (
    <div className="mt-4 border-t border-[var(--border-color)] pt-3.5">
      <h3 className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">
        {title}
      </h3>
      <ul className="mt-2 space-y-1.5">
        {Object.entries(rows).map(([key, v]) => (
          <li
            key={key}
            className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-3 font-mono text-[12px] tabular-nums"
          >
            <span className="truncate text-[var(--text-secondary)]">{key}</span>
            <span className="text-[var(--text-tertiary)]">n={v.n}</span>
            <span className="text-right text-[var(--text-primary)]">
              {v.brier != null ? v.brier.toFixed(5) : 'too few'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
