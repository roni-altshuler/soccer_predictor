'use client'

import { useEffect, useState } from 'react'

/**
 * The measured overconfidence of the season projections — and the note that it
 * is now corrected for rather than merely disclosed.
 *
 * This used to be the whole remedy: the Monte Carlo said 86%, the backtest said
 * that band lands at 78%, and the page printed both and left the reader to
 * reconcile them. Disclosure is the right answer for an error you cannot fix.
 * This one is fixable — `backend/scripts/fit_projection_calibrator.py` turns
 * the same measurement into an isotonic map, and
 * `src/lib/simulation/projectionCalibration.ts` applies it before the table
 * renders.
 *
 * The note stays, for two reasons. The reader should know a correction is
 * being applied and how big it was, and the backtest deliberately keeps
 * scoring the RAW simulator — so this number remains a live measure of the
 * error being corrected, not a self-congratulatory score of the correction.
 *
 * It is deliberately a sentence and not a chart. The numbers come from the
 * artifact rather than JSX so they cannot drift away from the backtest.
 */

interface Bin {
  range: [number, number]
  n: number
  stated: number
  happened: number
  gap: number
}

interface Payload {
  available: boolean
  n: number | null
  ece: number | null
  overstates: boolean
  worst_bin: Bin | null
}

const pct = (v: number) => `${Math.round(v * 100)}%`

export function ProjectionCalibrationNote() {
  const [data, setData] = useState<Payload | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/v1/accuracy/projection-calibration')
      .then((r) => r.json())
      .then((d) => {
        if (alive) setData(d)
      })
      .catch(() => {
        if (alive) setData(null)
      })
    return () => {
      alive = false
    }
  }, [])

  if (!data?.available || !data.worst_bin) return null
  const w = data.worst_bin

  return (
    <section className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
        How much to trust the percentages
      </p>
      <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-secondary)]">
        {data.overstates ? (
          <>
            The raw simulation runs{' '}
            <strong className="text-[var(--text-primary)]">high at the confident end</strong>:
            across <span className="font-mono tabular-nums">{data.n?.toLocaleString()}</span>{' '}
            scored projections, when it said{' '}
            <span className="font-mono tabular-nums">{pct(w.stated)}</span> the thing happened{' '}
            <span className="font-mono tabular-nums">{pct(w.happened)}</span> of the time
            &mdash; <span className="font-mono tabular-nums">{Math.abs(Math.round(w.gap * 100))} points</span>{' '}
            short, over <span className="font-mono tabular-nums">{w.n.toLocaleString()}</span>{' '}
            cases in that band.{' '}
            <strong className="text-[var(--text-primary)]">
              The percentages above have that correction applied.
            </strong>{' '}
            Each one is mapped through the curve this backtest measured, then rescaled so the
            column still adds up to one champion and three relegations. The backtest keeps
            scoring the uncorrected simulator, so this number stays an honest measure of what
            is being corrected rather than a score of the correction itself.
          </>
        ) : (
          <>
            Across <span className="font-mono tabular-nums">{data.n?.toLocaleString()}</span>{' '}
            scored projections the stated confidence has held up at the confident end.
          </>
        )}
        {data.ece !== null && (
          <>
            {' '}Pooled calibration error{' '}
            <span className="font-mono tabular-nums">{data.ece.toFixed(4)}</span>.
          </>
        )}
      </p>
    </section>
  )
}
