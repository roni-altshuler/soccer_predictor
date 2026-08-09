'use client'

import { useEffect, useState } from 'react'

/**
 * The measured overconfidence of the season projections, printed next to them.
 *
 * The Monte Carlo will happily say a team is 86% down. The matchday-by-matchday
 * backtest says that when this model has said ~85%, it happened ~78% of the
 * time. Both numbers are real; showing the first without the second is the
 * failure mode the standing rule exists to prevent — displayed confidence must
 * never exceed measured confidence.
 *
 * It is deliberately a sentence and not a chart. The reader needs the size of
 * the miss and the sample behind it, and then to get back to the table. The
 * numbers come from the artifact rather than JSX so they cannot drift away
 * from the backtest that produced them.
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
            These projections run <strong className="text-[var(--text-primary)]">high at the
            confident end</strong>. Across{' '}
            <span className="font-mono tabular-nums">{data.n?.toLocaleString()}</span> scored
            projections, when this model said{' '}
            <span className="font-mono tabular-nums">{pct(w.stated)}</span> the thing happened{' '}
            <span className="font-mono tabular-nums">{pct(w.happened)}</span> of the time
            &mdash; <span className="font-mono tabular-nums">{Math.abs(Math.round(w.gap * 100))} points</span>{' '}
            short, over <span className="font-mono tabular-nums">{w.n.toLocaleString()}</span>{' '}
            cases in that band. Read anything above{' '}
            <span className="font-mono tabular-nums">{pct(w.range[0])}</span> as a little less
            certain than it looks.
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
