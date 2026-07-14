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

import { SectionHeader } from '@/components/primitives'
import { Card } from '@/components/ui/card'
import { ChartContainer } from '@/components/viz'
import { cn } from '@/lib/utils'

/**
 * Form-over-time chart — the centrepiece of /accuracy. A rolling hit-rate
 * line (solid, green) drawn against the stated-confidence line (dashed,
 * cyan) over the same rolling window. The vertical gap between the two IS
 * the overconfidence story: when the dashed line sits above the solid one,
 * the picks claimed more than they delivered.
 *
 * Data comes straight from the tracking trend endpoints — nothing is
 * synthesised here. The caller must hide this component when fewer than
 * MIN_POINTS rolling points exist (an almost-empty line chart is worse
 * than no chart).
 */

export interface TrendPointDatum {
  /** Running count of settled picks at this point (monotonic). */
  index: number
  /** ISO date of the newest pick in the rolling window. */
  date: string
  /** Rolling hit rate 0..1. */
  accuracy: number
}

export interface ConfidencePointDatum {
  index: number
  /** Rolling average stated confidence 0..1. */
  avg_confidence: number
}

interface AccuracyTrendChartProps {
  /** Rolling hit-rate series, ordered by index ascending. */
  points: TrendPointDatum[]
  /** Optional rolling avg-confidence series (same rolling window). */
  confidence?: ConfidencePointDatum[]
  /** All-time hit rate 0..1 — drawn as a reference line when provided. */
  baseline?: number | null
  /** Rolling window size (copy only). */
  window: number
  className?: string
}

/** Minimum rolling points before the section is worth drawing. */
export const MIN_TREND_POINTS = 8

/** Cap on plotted hit-rate points — thinned evenly, endpoint always kept. */
const MAX_PLOTTED_POINTS = 240

interface ChartRow {
  index: number
  hit: number
  conf: number | null
}

function shortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function AccuracyTrendChart({
  points,
  confidence,
  baseline,
  window,
  className,
}: AccuracyTrendChartProps) {
  const { rows, ticks, dateByIndex, yDomain, hasConfidence } = useMemo(() => {
    const confByIndex = new Map<number, number>()
    for (const c of confidence ?? []) {
      if (Number.isFinite(c.avg_confidence)) confByIndex.set(c.index, c.avg_confidence)
    }

    // Thin the dense per-pick series to a plottable size, always keeping the
    // last point, then re-add every confidence index so the dashed series
    // never loses samples to the thinning.
    const stride = Math.max(1, Math.ceil(points.length / MAX_PLOTTED_POINTS))
    const keep = new Set<number>()
    for (let i = 0; i < points.length; i += stride) keep.add(points[i].index)
    if (points.length > 0) keep.add(points[points.length - 1].index)
    for (const idx of confByIndex.keys()) keep.add(idx)

    const dates = new Map<number, string>()
    const out: ChartRow[] = []
    let min = 100
    let max = 0
    for (const p of points) {
      if (!keep.has(p.index)) continue
      const hit = p.accuracy * 100
      const conf = confByIndex.has(p.index) ? confByIndex.get(p.index)! * 100 : null
      min = Math.min(min, hit, conf ?? hit)
      max = Math.max(max, hit, conf ?? hit)
      dates.set(p.index, p.date)
      out.push({ index: p.index, hit, conf })
    }
    if (typeof baseline === 'number') {
      min = Math.min(min, baseline * 100)
      max = Math.max(max, baseline * 100)
    }

    // ~6 evenly spaced date ticks along the picked rows.
    const tickCount = Math.min(6, out.length)
    const tickIdx: number[] = []
    for (let t = 0; t < tickCount; t++) {
      const at = Math.round((t * (out.length - 1)) / Math.max(1, tickCount - 1))
      tickIdx.push(out[at].index)
    }

    const lo = Math.max(0, Math.floor((min - 6) / 5) * 5)
    const hi = Math.min(100, Math.ceil((max + 6) / 5) * 5)

    return {
      rows: out,
      ticks: Array.from(new Set(tickIdx)),
      dateByIndex: dates,
      yDomain: [lo, hi] as [number, number],
      hasConfidence: confByIndex.size > 0,
    }
  }, [points, confidence, baseline])

  if (points.length < MIN_TREND_POINTS) return null

  return (
    <Card className={cn('p-4 md:p-5', className)}>
      <SectionHeader
        kicker="Form over time"
        title="Is the hit rate holding up?"
        description={`Rolling hit rate over the previous ${window} settled picks, oldest to newest.`}
        className="mb-3"
      />

      {/* Legend — same grammar as the viz-kit progression chart. */}
      <div className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[10px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
        <span className="inline-flex items-center gap-2">
          <svg width="24" height="6" aria-hidden>
            <line x1="0" y1="3" x2="24" y2="3" stroke="var(--accent-primary)" strokeWidth="2.5" />
          </svg>
          Hit rate
        </span>
        {hasConfidence && (
          <span className="inline-flex items-center gap-2">
            <svg width="24" height="6" aria-hidden>
              <line
                x1="0"
                y1="3"
                x2="24"
                y2="3"
                stroke="var(--accent-ai)"
                strokeWidth="2"
                strokeDasharray="5 5"
                strokeOpacity="0.7"
              />
            </svg>
            Avg confidence
          </span>
        )}
        {typeof baseline === 'number' && (
          <span className="inline-flex items-center gap-2">
            <svg width="24" height="6" aria-hidden>
              <line
                x1="0"
                y1="3"
                x2="24"
                y2="3"
                stroke="var(--text-tertiary)"
                strokeWidth="1.5"
                strokeDasharray="2 4"
              />
            </svg>
            All-time
          </span>
        )}
      </div>

      <ChartContainer height={300} label="Loading form chart">
        <div
          className="h-full w-full"
          role="img"
          aria-label={`Rolling hit rate over the previous ${window} settled picks${
            hasConfidence ? ', with the average stated confidence for comparison' : ''
          }`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
              <XAxis
                dataKey="index"
                type="number"
                domain={['dataMin', 'dataMax']}
                ticks={ticks}
                tickFormatter={(idx: number) => {
                  const iso = dateByIndex.get(idx)
                  return iso ? shortDate(iso) : ''
                }}
                stroke="var(--text-tertiary)"
                fontSize={11}
                tickLine={false}
                axisLine={{ stroke: 'var(--border-color)' }}
              />
              <YAxis
                domain={yDomain}
                tickFormatter={(v: number) => `${v}%`}
                stroke="var(--text-tertiary)"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                width={44}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--card-bg)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 8,
                  color: 'var(--text-primary)',
                  fontSize: 13,
                }}
                labelStyle={{ color: 'var(--text-tertiary)' }}
                labelFormatter={(idx: number) => {
                  const iso = dateByIndex.get(Number(idx))
                  return iso ? shortDate(iso) : ''
                }}
                formatter={(value: number | string | null, name: string | number) => {
                  if (value == null) return [null, null] as [null, null]
                  const label = name === 'hit' ? 'Hit rate' : 'Avg confidence'
                  return [`${Number(value).toFixed(1)}%`, label] as [string, string]
                }}
              />
              {typeof baseline === 'number' && (
                <ReferenceLine
                  y={baseline * 100}
                  stroke="var(--text-tertiary)"
                  strokeDasharray="2 4"
                  ifOverflow="extendDomain"
                />
              )}
              <Line
                type="monotone"
                dataKey="hit"
                stroke="var(--accent-primary)"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
                isAnimationActive={false}
              />
              {hasConfidence && (
                <Line
                  type="monotone"
                  dataKey="conf"
                  stroke="var(--accent-ai)"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  strokeOpacity={0.65}
                  dot={false}
                  activeDot={{ r: 3, strokeWidth: 0 }}
                  connectNulls
                  isAnimationActive={false}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </ChartContainer>

      {hasConfidence && (
        <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">
          When the dashed line sits above the solid one, picks claimed more than they delivered.
        </p>
      )}
    </Card>
  )
}
