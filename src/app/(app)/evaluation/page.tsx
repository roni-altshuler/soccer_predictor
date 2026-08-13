'use client'

import { useEffect, useState } from 'react'

import { EmptyState } from '@/components/EmptyState'
import { RecordsHero } from '@/components/evidence/RecordsHero'
import { EvidenceHeader, MetricRow, Panel, StatTile } from '@/components/evidence/primitives'
import { EvidencePanel } from '@/components/forecast/EvidencePanel'
import type { Historical } from '@/components/forecast/EvidencePanel'
import { cn } from '@/lib/utils'

/**
 * Model evaluation.
 *
 * The single rule this page exists to keep: **historical walk-forward and live
 * published forecasts are never mixed, and never summed.** They are different
 * samples measuring different things — one retrospective and large, one
 * prospective and often zero — and presenting either as the other would be the
 * most misleading thing this product could do.
 *
 * That rule is now the LAYOUT rather than a sentence inside it. The page opens
 * on the two records side by side with a divider between them; everything
 * below is detail on one or the other. The previous version stated the rule in
 * prose and then rendered both records as identical grey boxes in a vertical
 * stack, which is the arrangement that invites exactly the reading the rule
 * forbids.
 *
 * When the live sample is small the page says so in words rather than drawing
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

/**
 * Why the scored sample is the size it is.
 *
 * "Not played yet" and "we could not match this club to a result" both shrink
 * the live sample, and only one of them means something is broken. A rehearsal
 * against last season found the join silently discarding 31% of fixtures
 * because FBref says "Gladbach" and the warehouse says "Borussia
 * Mönchengladbach". It looked exactly like a small sample. It is a number on
 * the page now so it cannot look like that again.
 */
interface JoinReport {
  snapshots?: number
  scored?: number
  awaiting_result?: number
  unresolved_count?: number
  unresolved_clubs?: Record<string, number>
}

interface Payload {
  available: boolean
  generated_at?: string
  live?: Sample
  join?: JoinReport
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

// A reliability chart needs enough points per band to have a shape. Below this
// the honest rendering is a sentence, not a diagram.
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
      <EvidenceHeader
        title="Evaluation"
        lede="Two records, kept apart on purpose. One is a large retrospective backtest. The other is the forecasts this site actually published, scored after the fact."
        note="They measure different things and are never added together."
      />

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
          {/* The rule, as the layout. */}
          <RecordsHero historical={data.historical} live={live} />

          {/* ---- live detail, or an honest absence --------------------- */}
          <Panel
            title="Live published forecasts"
            right={
              live?.n ? (
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                  {live.n.toLocaleString()} scored
                </span>
              ) : null
            }
          >
            {!live?.n ? (
              <div className="mt-3">
                <p className="max-w-2xl text-[13px] leading-relaxed text-[var(--text-secondary)]">
                  Nothing has been scored yet. No fixture has both a published forecast
                  and a result.
                </p>
                <p className="mt-2 max-w-2xl text-[12px] leading-relaxed text-[var(--text-tertiary)]">
                  This is the correct state before the season starts, not a failure and
                  not a loading state. The forecasts are recorded —{' '}
                  {(store?.fixtures ?? 0).toLocaleString()} of them — and each will be
                  scored as its match is played. A reliability chart will appear here
                  once there are enough results to have a shape; drawing one from a
                  handful would show a pattern that is not there.
                </p>
              </div>
            ) : (
              <>
                <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <StatTile label="Brier" value={live.brier?.toFixed(5) ?? '—'} size="lead" />
                  <StatTile label="Log loss" value={live.log_loss?.toFixed(5) ?? '—'} />
                  <StatTile label="ECE" value={live.ece?.toFixed(4) ?? '—'} />
                  <StatTile
                    label="Accuracy"
                    value={live.accuracy != null ? `${(live.accuracy * 100).toFixed(1)}%` : '—'}
                  />
                </dl>

                {live.baselines ? (
                  <div className="mt-4 border-t border-[var(--border-color)] pt-4">
                    <p className="mb-3 text-[12px] leading-relaxed text-[var(--text-secondary)]">
                      Against the same fixtures. Lower is better, and the gap is the whole
                      of what the model knows.
                    </p>
                    <div className="space-y-2.5">
                      {/* Bars are scaled against the worst of the three, so the
                          shorter bar is the better forecaster and the ordering
                          reads without anyone having to know that about Brier. */}
                      {(() => {
                        const rows = [
                          { label: 'This model', v: live.brier ?? 0, tone: 'accent' as const },
                          {
                            label: 'A one-in-three guess',
                            v: live.baselines!.uniform,
                            tone: 'muted' as const,
                          },
                          {
                            label: "The sample's own base rate",
                            v: live.baselines!.sample_base_rate,
                            tone: 'muted' as const,
                          },
                        ].filter((r) => Number.isFinite(r.v) && r.v > 0)
                        const worst = Math.max(...rows.map((r) => r.v), 1e-9)
                        return rows.map((r) => (
                          <MetricRow
                            key={r.label}
                            label={r.label}
                            value={r.v.toFixed(5)}
                            fraction={r.v / worst}
                            tone={r.tone}
                          />
                        ))
                      })()}
                    </div>
                  </div>
                ) : null}

                {live.n < MIN_FOR_CHART ? (
                  <p className="mt-4 border-t border-[var(--border-color)] pt-3.5 text-[12px] leading-relaxed text-[var(--accent-warn)]">
                    {live.n} matches is too few for a reliability chart. The numbers above
                    are real; the shape of the error is not yet measurable.
                  </p>
                ) : live.reliability?.length ? (
                  <Reliability buckets={live.reliability} />
                ) : null}

                {live.by_league && Object.keys(live.by_league).length ? (
                  <Breakdown title="By league" rows={live.by_league} />
                ) : null}
                {live.by_model_version && Object.keys(live.by_model_version).length > 1 ? (
                  <Breakdown title="By model version" rows={live.by_model_version} />
                ) : null}

                {live.xg_mae != null || live.top_scoreline_hit_rate != null ? (
                  <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-[var(--border-color)] pt-4">
                    {live.xg_mae != null ? (
                      <StatTile label="Goal-rate error (MAE)" value={live.xg_mae.toFixed(3)} />
                    ) : null}
                    {live.top_scoreline_hit_rate != null ? (
                      <StatTile
                        label="Top scoreline hit rate"
                        value={`${(live.top_scoreline_hit_rate * 100).toFixed(1)}%`}
                      />
                    ) : null}
                  </dl>
                ) : null}
              </>
            )}
          </Panel>

          {data.join ? <JoinPanel join={data.join} /> : null}

          {/* ---- the provenance record --------------------------------- */}
          {store ? (
            <Panel
              title="What has been recorded"
              description="Every forecast is written down before kickoff and never rewritten. That is what makes the live column possible at all — without it, a forecast that moved would quietly become the forecast we claim to have made."
            >
              <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <StatTile label="Snapshots" value={store.rows.toLocaleString()} />
                <StatTile label="Fixtures" value={store.fixtures.toLocaleString()} />
                <StatTile label="Model versions" value={String(store.versions)} />
                <StatTile
                  label="Scored so far"
                  value={(live?.n ?? 0).toLocaleString()}
                  tone={live?.n ? undefined : 'muted'}
                />
              </dl>
              {store.by_version && Object.keys(store.by_version).length ? (
                <ul className="mt-4 flex flex-wrap gap-1.5">
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
            </Panel>
          ) : null}

          <EvidencePanel historical={data.historical} live={live} compact />

          <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
            The live column scores the last forecast published <em>before</em> each
            kickoff — not the first, which would be stale, and never one generated after
            the match, which would not be a forecast.
          </p>
        </div>
      )}
    </div>
  )
}

function JoinPanel({ join }: { join: JoinReport }) {
  const unresolved = join.unresolved_count ?? 0
  const clubs = Object.entries(join.unresolved_clubs ?? {})

  return (
    <Panel
      title="Why the sample is this size"
      description={
        <>
          &ldquo;Not played yet&rdquo; and &ldquo;we no longer recognise this club&rdquo;
          both shrink the sample, and only one of them means something is broken.
        </>
      }
    >
      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label="Forecasts held" value={(join.snapshots ?? 0).toLocaleString()} />
        <StatTile label="Scored" value={(join.scored ?? 0).toLocaleString()} />
        <StatTile
          label="Not played yet"
          value={(join.awaiting_result ?? 0).toLocaleString()}
          tone="muted"
        />
        <StatTile
          label="Club not matched"
          value={unresolved.toLocaleString()}
          tone={unresolved ? 'accent' : 'muted'}
        />
      </dl>
      {clubs.length ? (
        <>
          <p className="mt-4 max-w-2xl text-[12px] leading-relaxed text-[var(--text-secondary)]">
            These clubs are named in a published forecast but do not yet exist in the
            results database — normally a promoted side that has not played a match in
            this competition before. They start being scored once they do.
          </p>
          <ul className="mt-2.5 flex flex-wrap gap-1.5">
            {clubs.map(([key, n]) => (
              <li
                key={key}
                className="rounded-md border border-[var(--border-color)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-tertiary)]"
              >
                {key} · {n}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-4 text-[12px] leading-relaxed text-[var(--text-tertiary)]">
          Every club in every published forecast matched a club in the results database.
        </p>
      )}
    </Panel>
  )
}

/**
 * Stated against observed, as a paired bar per band.
 *
 * The table this replaces made a reader compare two columns of numbers to see
 * calibration, which is the one thing calibration is bad at communicating in
 * that form. Paired bars put the comparison in the shape: a calibrated band has
 * two bars the same length.
 */
function Reliability({ buckets }: { buckets: Bucket[] }) {
  return (
    <div className="mt-4 border-t border-[var(--border-color)] pt-4">
      <h3 className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">
        What it said, against what happened
      </h3>
      <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-[var(--text-secondary)]">
        A calibrated forecaster has the two bars in each row at the same length.
      </p>
      <ul className="mt-3.5 space-y-3">
        {buckets.map((b) => (
          <li key={b.bin_low}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-[11px] tabular-nums text-[var(--text-secondary)]">
                {(b.bin_low * 100).toFixed(0)}–{(b.bin_high * 100).toFixed(0)}%
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                {b.n.toLocaleString()} forecasts
              </span>
            </div>
            <div className="mt-1.5 space-y-1">
              <Paired label="Said" value={b.stated} tone="muted" />
              <Paired label="Happened" value={b.observed} tone="accent" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Paired({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'muted' | 'accent'
}) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr_3rem] items-center gap-x-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
        {label}
      </span>
      <div className="h-[3px] w-full overflow-hidden rounded-full bg-[var(--border-color)]">
        <div
          className={cn(
            'h-full rounded-full',
            tone === 'accent' ? 'bg-[var(--accent-primary)]' : 'bg-[var(--text-tertiary)]',
          )}
          style={{ width: `${Math.max(2, Math.min(1, value) * 100)}%` }}
        />
      </div>
      <span className="text-right font-mono text-[11px] tabular-nums text-[var(--text-primary)]">
        {(value * 100).toFixed(1)}%
      </span>
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
  const scored = Object.entries(rows).filter(([, v]) => v.brier != null)
  const worst = Math.max(...scored.map(([, v]) => v.brier as number), 1e-9)

  return (
    <div className="mt-4 border-t border-[var(--border-color)] pt-4">
      <h3 className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">
        {title}
      </h3>
      <ul className="mt-3 space-y-2.5">
        {Object.entries(rows).map(([key, v]) =>
          v.brier != null ? (
            <li key={key}>
              <MetricRow
                label={key}
                value={v.brier.toFixed(5)}
                fraction={v.brier / worst}
                note={`n=${v.n}`}
              />
            </li>
          ) : (
            <li
              key={key}
              className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 text-[13px]"
            >
              <span className="truncate text-[var(--text-tertiary)]">{key}</span>
              <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                too few (n={v.n})
              </span>
            </li>
          ),
        )}
      </ul>
    </div>
  )
}
