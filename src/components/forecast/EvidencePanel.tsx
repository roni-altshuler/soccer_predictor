'use client'

import Link from 'next/link'

import { DocsLink } from '@/components/evidence/DocsLink'
import { cn } from '@/lib/utils'

/**
 * "How accurate is this?" — answered on the page that makes the claims.
 *
 * Two rules, both about not overstating:
 *
 *  1. **The two evaluations are never merged.** The walk-forward number is
 *     large and retrospective; the live number is small and prospective. They
 *     answer different questions and this component renders them as two
 *     separate blocks with their own sample sizes, never as one figure.
 *  2. **No market comparison.** The repository has no valid evidence that this
 *     model beats a bookmaker — its own measurements say the opposite — so
 *     nothing here claims it does.
 *
 * What it no longer carries is the explanation. Two blocks used to sit under
 * the numbers: what Brier and ECE mean, and the six feature groups that were
 * measured and dropped. Both are true and both were being read on a page about
 * one league's fixtures. They are in `docs/handbook/` now — the dropped
 * features under Models, the metrics under Scoring — and a test pins that they
 * are genuinely there, because "we moved it to the docs" is only honest if the
 * docs say it.
 */

export interface Historical {
  available?: boolean
  n?: number
  brier?: number
  log_loss?: number
  accuracy?: number
  ece?: number
  protocol?: string
  note?: string
}

export interface Live {
  n: number
  brier?: number
  log_loss?: number
  ece?: number
  note?: string
}

export function EvidencePanel({
  historical,
  live,
  className,
}: {
  historical?: Historical | null
  live?: Live | null
  className?: string
}) {
  return (
    <section
      className={cn(
        'rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-4 md:px-5 md:py-5',
        className,
      )}
      aria-labelledby="evidence-heading"
    >
      <h2
        id="evidence-heading"
        className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]"
      >
        How accurate is this?
      </h2>

      <div className="mt-3.5 grid gap-4 md:grid-cols-2">
        {/* ---- retrospective ------------------------------------------- */}
        <div className="rounded-lg border border-[var(--border-color)] px-3.5 py-3">
          <h3 className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">
            Historical walk-forward
          </h3>
          {historical?.available && historical.n ? (
            <>
              <dl className="mt-2.5 space-y-1.5">
                <Metric label="Matches scored" value={historical.n.toLocaleString()} />
                <Metric label="Brier score" value={historical.brier?.toFixed(5) ?? '—'} />
                <Metric
                  label="Calibration error"
                  value={historical.ece?.toFixed(4) ?? '—'}
                />
              </dl>
              <p className="mt-2.5 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
                Retrospective: nobody saw these numbers before those kickoffs.
              </p>
            </>
          ) : (
            <p className="mt-2.5 text-[12px] text-[var(--text-tertiary)]">Not available.</p>
          )}
        </div>

        {/* ---- prospective --------------------------------------------- */}
        <div className="rounded-lg border border-[var(--border-color)] px-3.5 py-3">
          <h3 className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">
            Live published forecasts
          </h3>
          {live && live.n > 0 ? (
            <>
              <dl className="mt-2.5 space-y-1.5">
                <Metric label="Matches scored" value={live.n.toLocaleString()} />
                <Metric label="Brier score" value={live.brier?.toFixed(5) ?? '—'} />
                <Metric label="Calibration error" value={live.ece?.toFixed(4) ?? '—'} />
              </dl>
              {live.n < 100 ? (
                <p className="mt-2.5 text-[11px] leading-relaxed text-[var(--accent-warn)]">
                  {live.n} matches is too few to conclude anything. Shown because hiding it
                  until it flatters us would be the wrong way round.
                </p>
              ) : null}
            </>
          ) : (
            <p className="mt-2.5 text-[12px] leading-relaxed text-[var(--text-tertiary)]">
              <span className="text-[var(--text-secondary)]">Nothing scored yet.</span> Every
              forecast is recorded before kickoff and scored once the result lands, so this
              number is genuinely zero rather than pending.
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[var(--border-color)] pt-3.5">
        <Link
          href="/evaluation"
          className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text-tertiary)] underline-offset-4 transition-colors hover:text-[var(--accent-primary)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
        >
          This league&apos;s full record
        </Link>
        <DocsLink doc="scoring" label="What these numbers mean" />
        <DocsLink doc="models" label="What was measured and dropped" hash="what-the-model-looks-at" />
      </div>
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[12px] text-[var(--text-tertiary)]">{label}</dt>
      <dd className="font-mono text-[14px] tabular-nums text-[var(--text-primary)]">
        {value}
      </dd>
    </div>
  )
}
