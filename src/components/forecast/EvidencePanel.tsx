'use client'

import Link from 'next/link'

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

const DROPPED = [
  'referee',
  'rest',
  'head-to-head',
  'venue',
  'attendance',
  'kickoff time',
]

export function EvidencePanel({
  historical,
  live,
  compact = false,
  className,
}: {
  historical?: Historical | null
  live?: Live | null
  compact?: boolean
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
                Each match was predicted before its own result, with the model refit as
                the corpus advanced. Large and honest — but retrospective: nobody saw
                these numbers before those kickoffs.
              </p>
            </>
          ) : (
            <p className="mt-2.5 text-[12px] text-[var(--text-tertiary)]">
              Not available.
            </p>
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
                  {live.n} matches is too few to conclude anything. Shown because
                  hiding it until it flatters us would be the wrong way round.
                </p>
              ) : null}
            </>
          ) : (
            <p className="mt-2.5 text-[12px] leading-relaxed text-[var(--text-tertiary)]">
              <span className="text-[var(--text-secondary)]">Nothing scored yet.</span>{' '}
              Every forecast is recorded before kickoff and scored once the result
              lands. The 2026-27 season has not produced a scoreable match, so this
              number is genuinely zero rather than pending.
            </p>
          )}
        </div>
      </div>

      {!compact ? (
        <>
          <div className="mt-4 border-t border-[var(--border-color)] pt-3.5">
            <h3 className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">
              What the numbers mean
            </h3>
            <dl className="mt-2 space-y-2 text-[12px] leading-relaxed">
              <div>
                <dt className="inline font-medium text-[var(--text-secondary)]">
                  Brier score.{' '}
                </dt>
                <dd className="inline text-[var(--text-tertiary)]">
                  Squared error of the probabilities. Lower is better; a forecast that
                  says one-in-three to everything scores .667, so the distance below
                  that is the whole of what the model knows.
                </dd>
              </div>
              <div>
                <dt className="inline font-medium text-[var(--text-secondary)]">
                  Calibration error (ECE).{' '}
                </dt>
                <dd className="inline text-[var(--text-tertiary)]">
                  How far stated confidence drifts from what happens. At .0099, things
                  called 60% happen about 60% of the time — which matters more than
                  accuracy here, because season and knockout probabilities are built by
                  compounding these numbers.
                </dd>
              </div>
            </dl>
          </div>

          <div className="mt-4 border-t border-[var(--border-color)] pt-3.5">
            <h3 className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">
              Measured and dropped
            </h3>
            <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-tertiary)]">
              Each was added to the model, scored on matches it had not seen, and
              removed because it did not improve the forecast:
            </p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {DROPPED.map((d) => (
                <li
                  key={d}
                  className="rounded-md border border-[var(--border-color)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--text-tertiary)]"
                >
                  {d}
                </li>
              ))}
            </ul>
            <p className="mt-2.5 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
              Referee was the most expensive to test — it needed a 207,000-fixture
              scrape to make the question askable outside England — and the answer was
              still no.
            </p>
          </div>

          <p className="mt-4 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
            <Link
              href="/evaluation"
              className="text-[var(--text-secondary)] underline underline-offset-2 hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
            >
              Full evaluation dashboard
            </Link>{' '}
            — reliability by probability band, per-league breakdown, and model-version
            comparison.
          </p>
        </>
      ) : null}
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
