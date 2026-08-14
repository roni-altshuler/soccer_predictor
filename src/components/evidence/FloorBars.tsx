'use client'

import { cn } from '@/lib/utils'

/**
 * A forecaster against the floor it has to clear.
 *
 * The single most repeated sentence on this site was some version of "a number
 * without a floor is not information" — written out on five pages, in five
 * wordings, and read on none of them. It is a picture: bars, the model's one
 * short, the floors long, the gap between them being the entire claim.
 *
 * Lower is better on every scale here (Brier, log loss), which is exactly why
 * the bars are drawn rather than the numbers listed: a reader should not have
 * to know that about Brier to see who is winning. The shortest bar wins, and
 * the values are printed anyway because a bar alone is a colour-only reading
 * of a number.
 */

export interface FloorRow {
  label: string
  value: number
  /** The forecaster being judged, as opposed to a yardstick. */
  subject?: boolean
  /** One or two words: what this row is. Never a sentence. */
  note?: string
}

export function FloorBars({
  rows,
  digits = 4,
  className,
}: {
  rows: FloorRow[]
  digits?: number
  className?: string
}) {
  const usable = rows.filter((r) => Number.isFinite(r.value) && r.value > 0)
  if (!usable.length) return null
  const worst = Math.max(...usable.map((r) => r.value))

  return (
    <ul className={cn('space-y-2.5', className)}>
      {usable.map((row) => (
        <li key={row.label} className="grid grid-cols-[1fr_auto] items-baseline gap-x-3">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span
                className={cn(
                  'truncate text-[12.5px]',
                  row.subject
                    ? 'font-semibold text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)]',
                )}
              >
                {row.label}
              </span>
              {row.note ? (
                <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                  {row.note}
                </span>
              ) : null}
            </div>
            <div className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-[var(--border-color)]">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(2, (row.value / worst) * 100)}%`,
                  background: row.subject
                    ? 'var(--accent-primary)'
                    : 'color-mix(in srgb, var(--text-tertiary) 70%, transparent)',
                }}
              />
            </div>
          </div>
          <span className="font-mono text-[12px] tabular-nums text-[var(--text-primary)]">
            {row.value.toFixed(digits)}
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Stated against observed, per band — calibration as two bars a reader can
 * compare by length.
 *
 * A calibrated band is two bars the same length. That sentence is the only
 * text this needs, and it replaces three paragraphs explaining what
 * calibration is.
 */
export function CalibrationBars({
  bands,
  className,
}: {
  bands: Array<{ label: string; stated: number; observed: number; n?: number }>
  className?: string
}) {
  if (!bands.length) return null

  return (
    <ul className={cn('space-y-3', className)}>
      {bands.map((b) => (
        <li key={b.label}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-[11px] tabular-nums text-[var(--text-secondary)]">
              {b.label}
            </span>
            {b.n ? (
              <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                {b.n.toLocaleString()}
              </span>
            ) : null}
          </div>
          <div className="mt-1.5 space-y-1">
            <Bar label="Said" value={b.stated} tone="muted" />
            <Bar label="Happened" value={b.observed} tone="accent" />
          </div>
        </li>
      ))}
    </ul>
  )
}

function Bar({
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
