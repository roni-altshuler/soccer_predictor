'use client'

import { cn } from '@/lib/utils'

interface FormTrendProps {
  /** Metric name ("xG per match", "Goals conceded"). */
  label: string
  /** Season-average value for the metric. */
  baseline: number
  /** Recent-window value ("last 5 matches"). */
  recent: number
  /** Value formatter (default: one decimal). Client callers only — server
   *  components must use `decimals` (functions can't cross the RSC boundary). */
  format?: (n: number) => string
  /** Serializable alternative to `format`: fixed decimal places. */
  decimals?: number
  /**
   * Whether a higher recent value is an improvement (default true).
   * Set false for metrics like goals conceded or errors leading to shots.
   */
  higherIsBetter?: boolean
  /** Row captions (defaults: "Season avg" / "Last 5"). */
  baselineLabel?: string
  recentLabel?: string
  className?: string
}

function pctWidth(value: number, max: number): number {
  if (!Number.isFinite(value) || max <= 0) return 0
  return Math.min(100, Math.max(4, Math.round((value / max) * 100)))
}

/**
 * Baseline-vs-recent dual horizontal bars with a delta chip.
 *
 * Soccer usage: "last 5 matches vs season average" for one team metric — xG,
 * goals scored, goals conceded, possession. Both bars share a scale (the
 * larger of the two values), the baseline bar stays muted and the recent bar
 * is toned by direction: green (`--accent-primary`) when form is improving,
 * red (`--accent-loss`) when declining, respecting `higherIsBetter` so a drop
 * in goals conceded still reads green. The delta chip shows the signed
 * percentage change vs baseline in tabular numerals.
 */
export function FormTrend({
  label,
  baseline,
  recent,
  format,
  decimals,
  higherIsBetter = true,
  baselineLabel = 'Season avg',
  recentLabel = 'Last 5',
  className,
}: FormTrendProps) {
  const fmt =
    format ??
    ((n: number) =>
      typeof decimals === 'number' ? n.toFixed(decimals) : (Math.round(n * 10) / 10).toString())
  const reference = Math.max(baseline, recent, 0)
  const baselineW = pctWidth(baseline, reference)
  const recentW = pctWidth(recent, reference)

  const changePct = baseline !== 0 ? Math.round(((recent - baseline) / Math.abs(baseline)) * 100) : null
  const improving = higherIsBetter ? recent >= baseline : recent <= baseline
  const recentTone = improving ? 'var(--accent-primary)' : 'var(--accent-loss)'
  const deltaText = changePct === null ? null : `${changePct > 0 ? '+' : ''}${changePct}%`

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-meta font-medium text-[var(--text-primary)]">{label}</p>
        {deltaText && (
          <span
            className="shrink-0 rounded px-1.5 py-px text-caption font-numeric tabular-nums"
            style={{
              color: recentTone,
              background: `color-mix(in srgb, ${recentTone} 12%, transparent)`,
            }}
          >
            {deltaText}
          </span>
        )}
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-[11px] uppercase tracking-[0.06em] text-[var(--text-tertiary)]">
            {baselineLabel}
          </span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--muted-bg)]">
            <div
              className="h-full rounded-full"
              style={{
                width: `${baselineW}%`,
                background: 'color-mix(in srgb, var(--text-tertiary) 45%, transparent)',
              }}
            />
          </div>
          <span className="w-14 shrink-0 text-right text-caption font-numeric tabular-nums text-[var(--text-tertiary)]">
            {fmt(baseline)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-[11px] uppercase tracking-[0.06em] text-[var(--text-tertiary)]">
            {recentLabel}
          </span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--muted-bg)]">
            <div
              className="h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none"
              style={{ width: `${recentW}%`, background: recentTone }}
            />
          </div>
          <span className="w-14 shrink-0 text-right text-caption font-numeric tabular-nums text-[var(--text-secondary)]">
            {fmt(recent)}
          </span>
        </div>
      </div>
    </div>
  )
}

export default FormTrend
