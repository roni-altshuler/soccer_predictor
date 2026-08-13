'use client'

import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * The shared furniture of the evidence pages.
 *
 * `/evaluation` and `/accuracy` had drifted into two different treatments of
 * the same job — a wall of identically-weighted bordered boxes, each with a
 * small mono heading and prose under it. Nothing on either page told a reader
 * where to look first, because everything was the same size. They read as
 * documents rather than as the scoreboard the rest of the app is.
 *
 * These are the pieces that fix that, and they are shared so the two pages
 * cannot drift again:
 *
 *   Panel     — one section, one job. An eyebrow heading, an optional line of
 *               context, then content. Replaces the ad-hoc `rounded-xl border`
 *               copied into a dozen places.
 *   StatTile  — a number and what it counts. The number is the biggest thing
 *               in it, because it is the thing being read.
 *   MetricRow — a labelled bar. Used wherever two quantities are being
 *               compared and the comparison is the point.
 *
 * Every value is rendered as TEXT, with colour as a second channel and never
 * the only one — the same rule the rest of the app follows.
 */

export function Panel({
  title,
  description,
  right,
  children,
  className,
}: {
  title: string
  description?: ReactNode
  /** Small trailing content in the header row — a count, a state chip. */
  right?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-4 md:px-5 md:py-5',
        className,
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
          {title}
        </h2>
        {right}
      </div>
      {description ? (
        <p className="mt-1.5 max-w-2xl text-[12px] leading-relaxed text-[var(--text-secondary)]">
          {description}
        </p>
      ) : null}
      {children}
    </section>
  )
}

/**
 * A number and what it counts.
 *
 * `size="lead"` is for the two or three numbers a page is actually about. The
 * old pages gave a headline Brier the same 18px as the count of model versions
 * beside it, which is a hierarchy decision made by accident.
 */
export function StatTile({
  label,
  value,
  sub,
  size = 'base',
  tone,
  className,
}: {
  label: string
  value: string
  sub?: ReactNode
  size?: 'base' | 'lead'
  tone?: 'muted' | 'accent'
  className?: string
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="truncate font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
        {label}
      </div>
      <div
        className={cn(
          'font-mono tabular-nums',
          size === 'lead' ? 'text-[26px] leading-tight md:text-[32px]' : 'text-[18px]',
          tone === 'muted'
            ? 'text-[var(--text-tertiary)]'
            : tone === 'accent'
              ? 'text-[var(--accent-primary)]'
              : 'text-[var(--text-primary)]',
        )}
      >
        {value}
      </div>
      {sub ? (
        <div className="mt-0.5 text-[11px] leading-snug text-[var(--text-tertiary)]">{sub}</div>
      ) : null}
    </div>
  )
}

/**
 * A labelled bar, for when two quantities are being compared.
 *
 * `fraction` is what to fill, 0..1. `value` is printed whatever the bar does,
 * because a bar alone is a colour-only reading of a number.
 */
export function MetricRow({
  label,
  value,
  fraction,
  note,
  tone = 'accent',
}: {
  label: string
  value: string
  fraction: number
  note?: ReactNode
  tone?: 'accent' | 'muted'
}) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0)) * 100
  return (
    <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-3">
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[13px] text-[var(--text-secondary)]">{label}</span>
          {note ? (
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
              {note}
            </span>
          ) : null}
        </div>
        <div className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-[var(--border-color)]">
          <div
            className={cn(
              'h-full rounded-full',
              tone === 'accent' ? 'bg-[var(--accent-primary)]' : 'bg-[var(--text-tertiary)]',
            )}
            style={{ width: `${Math.max(2, pct)}%` }}
          />
        </div>
      </div>
      <span className="font-mono text-[13px] tabular-nums text-[var(--text-primary)]">
        {value}
      </span>
    </div>
  )
}

/** A page header with one job: name the page and state what it claims. */
export function EvidenceHeader({
  title,
  lede,
  note,
}: {
  title: string
  lede: ReactNode
  note?: ReactNode
}) {
  return (
    <header>
      <h1 className="text-[22px] font-semibold uppercase tracking-[0.12em] text-[var(--text-primary)] md:text-[28px]">
        {title}
      </h1>
      <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-[var(--text-secondary)]">
        {lede}
      </p>
      {note ? (
        <p className="mt-2 max-w-2xl text-[12px] leading-relaxed text-[var(--text-tertiary)]">
          {note}
        </p>
      ) : null}
    </header>
  )
}
