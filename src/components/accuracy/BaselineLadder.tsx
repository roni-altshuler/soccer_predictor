'use client'

import { useEffect, useState } from 'react'

import { cn } from '@/lib/utils'

/**
 * Where the model sits between gut feel and the closing line.
 *
 * The headline on this page used to be read against 1/3 — a home/draw/away
 * pick made at random. Nobody picks at random, and against that floor the
 * model looks nineteen points ahead. Against "pick whoever is rated higher",
 * which is roughly what an informed fan does, it is ahead by less than half a
 * point. Both numbers are true and only one of them tells a reader what the
 * model is worth to them.
 *
 * So the whole ladder is shown, in order, with the model's rung marked. It is
 * a backtest, not the live record — labelled as such, because the live record
 * is separate and currently thin.
 */

interface LadderEntry {
  key: string
  label: string
  note: string
  accuracy: number | null
  brier: number | null
  n: number
}

interface CalibrationBand {
  stated_low: number
  stated_high: number
  n: number
  observed: number
}

interface LadderResponse {
  available: boolean
  n?: number
  ladder?: LadderEntry[]
  calibration?: CalibrationBand[]
  decisive_only?: { n: number; model: number | null; market: number | null }
  method?: { since?: string; scope?: string[] }
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`

export function BaselineLadder({ className }: { className?: string }) {
  const [data, setData] = useState<LadderResponse | null>(null)

  useEffect(() => {
    let live = true
    fetch('/api/v1/accuracy/baselines')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (live) setData(j)
      })
      .catch(() => {
        if (live) setData({ available: false })
      })
    return () => {
      live = false
    }
  }, [])

  if (!data?.available || !data.ladder?.length) return null

  const ladder = data.ladder.filter((e) => e.accuracy !== null)
  if (!ladder.length) return null

  const floor = ladder[0]?.accuracy ?? 0
  const ceiling = ladder[ladder.length - 1]?.accuracy ?? 1
  const span = Math.max(0.0001, ceiling - floor)

  return (
    <section
      className={cn(
        'rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-4 md:px-5 md:py-5',
        className
      )}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
          What the model is worth
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
          backtest · {data.n?.toLocaleString()} matches
          {data.method?.since ? ` since ${data.method.since.slice(0, 7)}` : ''}
        </span>
      </header>

      <ol className="mt-4 space-y-2.5">
        {ladder.map((e) => {
          const isModel = e.key === 'model'
          const width = Math.max(4, (((e.accuracy ?? 0) - floor) / span) * 100)
          return (
            <li key={e.key} className="grid grid-cols-[1fr_auto] items-baseline gap-x-3">
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span
                    className={cn(
                      'truncate text-[13px]',
                      isModel
                        ? 'font-semibold text-[var(--text-primary)]'
                        : 'text-[var(--text-secondary)]'
                    )}
                  >
                    {e.label}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                    {e.note}
                  </span>
                </div>
                <div className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-[var(--border-color)]">
                  <div
                    className={cn(
                      'h-full rounded-full',
                      isModel ? 'bg-[var(--accent)]' : 'bg-[var(--text-tertiary)]'
                    )}
                    style={{ width: `${width}%` }}
                  />
                </div>
              </div>
              <span
                className={cn(
                  'font-mono text-[13px] tabular-nums',
                  isModel ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'
                )}
              >
                {pct(e.accuracy as number)}
              </span>
            </li>
          )
        })}
      </ol>

      <p className="mt-4 text-[12px] leading-relaxed text-[var(--text-secondary)]">
        Picking the winner, the model adds{' '}
        <span className="text-[var(--text-primary)]">
          {(
            ((ladder.find((e) => e.key === 'model')?.accuracy ?? 0) -
              (ladder.find((e) => e.key === 'higher_elo')?.accuracy ?? 0)) *
            100
          ).toFixed(1)}{' '}
          points
        </span>{' '}
        over picking whoever is rated higher, and sits{' '}
        <span className="text-[var(--text-primary)]">
          {(
            ((ladder.find((e) => e.key === 'market')?.accuracy ?? 0) -
              (ladder.find((e) => e.key === 'model')?.accuracy ?? 0)) *
            100
          ).toFixed(1)}{' '}
          points
        </span>{' '}
        behind the closing line — the practical ceiling.
      </p>

      {data.calibration?.length ? (
        <div className="mt-5 border-t border-[var(--border-color)] pt-4">
          <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
            What the confidence means
          </h3>
          <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--text-secondary)]">
            The pick is barely better than a good guess. The probability is the part worth
            using — when the model says 70%, it happens about 70% of the time.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[320px] border-collapse font-mono text-[12px] tabular-nums">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                  <th className="pb-1.5 pr-3 font-medium">Model says</th>
                  <th className="pb-1.5 pr-3 text-right font-medium">Matches</th>
                  <th className="pb-1.5 text-right font-medium">Actually won</th>
                </tr>
              </thead>
              <tbody>
                {data.calibration.map((c) => (
                  <tr key={c.stated_low} className="border-t border-[var(--border-color)]">
                    <td className="py-1.5 pr-3 text-[var(--text-secondary)]">
                      {c.stated_low}–{c.stated_high}%
                    </td>
                    <td className="py-1.5 pr-3 text-right text-[var(--text-tertiary)]">
                      {c.n.toLocaleString()}
                    </td>
                    <td className="py-1.5 text-right text-[var(--text-primary)]">
                      {pct(c.observed)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <p className="mt-4 border-t border-[var(--border-color)] pt-3.5 text-[12px] leading-relaxed text-[var(--text-secondary)]">
        Three-way here; knockout ties are two-way and measured separately on{' '}
        <a href="/evaluation" className="text-[var(--accent-primary)] hover:underline">
          the evaluation page
        </a>
        . Higher there because the question is easier, not because the model is better.
      </p>

      {data.decisive_only?.model != null && data.decisive_only.market != null ? (
        <p className="mt-4 border-t border-[var(--border-color)] pt-3.5 text-[12px] leading-relaxed text-[var(--text-secondary)]">
          Draws are the blind spot: the model almost never predicts one, and a quarter of
          matches end level. Ignoring draws entirely and asking only which side is stronger,
          it is right{' '}
          <span className="text-[var(--text-primary)]">{pct(data.decisive_only.model)}</span> of
          the time against the closing line&apos;s{' '}
          <span className="text-[var(--text-primary)]">{pct(data.decisive_only.market)}</span>{' '}
          over {data.decisive_only.n.toLocaleString()} decisive matches.
        </p>
      ) : null}
    </section>
  )
}
