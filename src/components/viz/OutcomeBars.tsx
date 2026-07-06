'use client'

import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { cn } from '@/lib/utils'

export interface OutcomeBarDatum {
  /** Row label — team short name or outcome name ("Arsenal", "Draw"). */
  label: string
  /** Final (calibrated) probability, 0–1. */
  probability: number
  /**
   * Bar colour — a club hex or a `var(--*)` token string.
   * Defaults to `var(--accent-ai)` (this is AI prediction data).
   */
  color?: string
  /** Optional crest URL shown in the hover tooltip. */
  crestUrl?: string
  /** Secondary line in the tooltip ("Home", "at Anfield", form string…). */
  sublabel?: string
  /** Pre-calibration model probability, 0–1. Shown as "raw" in the tooltip. */
  rawProbability?: number
}

interface OutcomeBarsProps {
  data: OutcomeBarDatum[]
  /** Sort bars by probability descending (default true). */
  sorted?: boolean
  /** Cap the number of bars rendered (useful for league-winner boards). */
  maxBars?: number
  className?: string
}

interface TooltipContentProps {
  active?: boolean
  payload?: Array<{ payload: OutcomeBarDatum }>
}

function OutcomeTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload || !payload[0]) return null
  const row = payload[0].payload
  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] p-3 shadow-none">
      <div className="mb-1.5 flex items-center gap-2">
        {row.crestUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- tiny crest in a transient tooltip
          <img src={row.crestUrl} alt="" width={18} height={18} className="shrink-0" />
        )}
        <span className="text-meta font-semibold text-[var(--text-primary)]">{row.label}</span>
        {row.sublabel && (
          <span className="text-caption uppercase tracking-[0.06em] text-[var(--text-tertiary)]">
            {row.sublabel}
          </span>
        )}
      </div>
      <div className="text-h3 font-numeric tabular-nums text-[var(--text-primary)]">
        {(row.probability * 100).toFixed(1)}%
      </div>
      {typeof row.rawProbability === 'number' && (
        <div className="mt-1 text-caption text-[var(--text-tertiary)]">
          Raw model{' '}
          <span className="font-numeric tabular-nums">
            {(row.rawProbability * 100).toFixed(1)}%
          </span>{' '}
          → calibrated{' '}
          <span className="font-numeric tabular-nums">
            {(row.probability * 100).toFixed(1)}%
          </span>
        </div>
      )}
    </div>
  )
}

/**
 * Horizontal probability bars for match/tournament outcomes.
 *
 * Generic soccer surface: 1X2 outcome boards, "who wins the league" boards,
 * top-scorer odds. Each bar is tinted by the club colour supplied via props
 * (fallback `var(--accent-ai)` since these are AI numbers), with a custom
 * flat-card tooltip showing the exact percentage and the raw-vs-calibrated
 * pair when both are available. Renders nothing for an empty dataset —
 * missing predictions never draw placeholders.
 */
export function OutcomeBars({ data, sorted = true, maxBars, className }: OutcomeBarsProps) {
  const rows = useMemo(() => {
    const clean = data.filter((d) => Number.isFinite(d.probability) && d.probability > 0)
    const ordered = sorted ? [...clean].sort((a, b) => b.probability - a.probability) : clean
    return typeof maxBars === 'number' ? ordered.slice(0, maxBars) : ordered
  }, [data, sorted, maxBars])

  if (rows.length === 0) return null
  const chartHeight = Math.max(120, 34 * rows.length + 36)

  return (
    <div className={cn('w-full', className)} style={{ height: chartHeight }}>
      <ResponsiveContainer>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
          <XAxis
            type="number"
            domain={[0, 'dataMax']}
            tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
            axisLine={{ stroke: 'var(--border-color)' }}
            tickLine={false}
            tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={86}
            tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
            axisLine={{ stroke: 'var(--border-color)' }}
            tickLine={false}
          />
          <Tooltip
            content={<OutcomeTooltip />}
            cursor={{ fill: 'var(--card-hover)', fillOpacity: 0.6 }}
          />
          <Bar dataKey="probability" radius={[0, 3, 3, 0]} isAnimationActive={false}>
            {rows.map((row) => (
              <Cell key={row.label} fill={row.color ?? 'var(--accent-ai)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export default OutcomeBars
