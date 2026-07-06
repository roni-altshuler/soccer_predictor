'use client'

import { useMemo } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { cn } from '@/lib/utils'

export interface ProgressionSeries {
  /** Stable id used as the recharts dataKey (e.g. team slug). */
  key: string
  /** Display name shown in the tooltip ("Arsenal"). */
  label: string
  /** Line colour — club hex or `var(--*)` token string. */
  color: string
  /**
   * Cumulative metric per completed step (points after MD1, MD2, …).
   * Length ≤ `now`; trailing nulls are treated as "not yet played".
   */
  values: readonly (number | null)[]
  /**
   * Optional model projection for steps `now+1 … totalSteps`.
   * When omitted, a straight "current pace" extrapolation is drawn.
   */
  projected?: readonly (number | null)[]
}

interface ProgressionChartProps {
  series: ProgressionSeries[]
  /** Last completed step (1-based matchday/round). Splits solid vs dashed. */
  now: number
  /** Season length in steps (default 38 — a full PL season). */
  totalSteps?: number
  /** X-tick formatter, defaults to `MD{n}`. */
  stepLabel?: (step: number) => string
  /** Chart height in px (default 320). */
  height?: number
  className?: string
}

type ChartRow = Record<string, number | string | null>

function lastNonNullIndex(arr: readonly (number | null)[]): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] != null) return i
  }
  return -1
}

/**
 * Cumulative points/metric progression with a dashed projection.
 *
 * Soccer usage: league-title race (cumulative points per team by matchday),
 * cumulative xG or goal difference. Solid club-coloured lines run up to the
 * "now" reference line (last completed matchday); beyond it each entity gets
 * a dashed lower-opacity projection — either the model's own numbers via
 * `projected`, or an honest "at current pace" linear extrapolation.
 * The dashed segment is anchored to the solid tip via a bridge point so the
 * two never visually detach.
 */
export function ProgressionChart({
  series,
  now,
  totalSteps = 38,
  stepLabel = (step) => `MD${step}`,
  height = 320,
  className,
}: ProgressionChartProps) {
  const labelByKey = useMemo(() => new Map(series.map((s) => [s.key, s.label])), [series])

  const chartData = useMemo<ChartRow[]>(() => {
    const rows: ChartRow[] = []
    for (let step = 1; step <= totalSteps; step++) {
      const row: ChartRow = { step: stepLabel(step) }
      for (const s of series) {
        const completedIdx = lastNonNullIndex(s.values)
        const completed = Math.min(completedIdx + 1, now)
        const lastValue = completedIdx >= 0 ? (s.values[completedIdx] as number) : 0
        const pace = completed > 0 ? lastValue / completed : 0

        if (step <= completed) {
          row[`${s.key}_actual`] = s.values[step - 1] ?? null
          row[`${s.key}_proj`] = step === completed ? (s.values[step - 1] ?? null) : null
        } else {
          row[`${s.key}_actual`] = null
          const projIdx = step - completed - 1
          const supplied = s.projected?.[projIdx]
          row[`${s.key}_proj`] =
            supplied != null ? supplied : Math.round((lastValue + pace * (step - completed)) * 10) / 10
        }
      }
      rows.push(row)
    }
    return rows
  }, [series, now, totalSteps, stepLabel])

  if (series.length === 0 || now < 1) return null

  return (
    <div className={cn('w-full', className)}>
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-caption uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
        <span className="inline-flex items-center gap-2">
          <svg width="24" height="6" aria-hidden>
            <line x1="0" y1="3" x2="24" y2="3" stroke="currentColor" strokeWidth="2.5" />
          </svg>
          Played
        </span>
        <span className="inline-flex items-center gap-2">
          <svg width="24" height="6" aria-hidden>
            <line
              x1="0"
              y1="3"
              x2="24"
              y2="3"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray="5 5"
              strokeOpacity="0.7"
            />
          </svg>
          Projected
        </span>
      </div>
      <div className="w-full" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
            <XAxis
              dataKey="step"
              stroke="var(--text-tertiary)"
              fontSize={11}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis stroke="var(--text-tertiary)" fontSize={11} tickLine={false} axisLine={false} />
            <Tooltip
              contentStyle={{
                backgroundColor: 'var(--card-bg)',
                border: '1px solid var(--border-color)',
                borderRadius: 8,
                color: 'var(--text-primary)',
                fontSize: 13,
              }}
              labelStyle={{ color: 'var(--text-tertiary)' }}
              formatter={(value: number | string | null, name: string | number) => {
                if (value == null) return [null, null] as [null, null]
                const key = String(name).replace(/_(actual|proj)$/, '')
                const isProj = String(name).endsWith('_proj')
                const label = labelByKey.get(key) ?? key
                return [value, isProj ? `${label} (proj)` : label] as [
                  number | string,
                  string,
                ]
              }}
            />
            <ReferenceLine
              x={stepLabel(Math.min(now, totalSteps))}
              stroke="var(--text-tertiary)"
              strokeDasharray="2 4"
              label={{
                value: 'Now',
                position: 'top',
                fill: 'var(--text-tertiary)',
                fontSize: 10,
              }}
            />
            {series.map((s) => (
              <Line
                key={`${s.key}_actual`}
                type="monotone"
                dataKey={`${s.key}_actual`}
                stroke={s.color}
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
            {series.map((s) => (
              <Line
                key={`${s.key}_proj`}
                type="monotone"
                dataKey={`${s.key}_proj`}
                stroke={s.color}
                strokeWidth={2}
                strokeDasharray="5 5"
                strokeOpacity={0.5}
                dot={false}
                activeDot={{ r: 3, strokeWidth: 0 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default ProgressionChart
