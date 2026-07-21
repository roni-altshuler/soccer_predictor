'use client'

import { useMemo } from 'react'
import {
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { ordinal } from '@/lib/ask/grammar'
import type { AskOutcome } from '@/lib/ask/schema'
import type { ChartSpec } from '@/lib/ask/types'

/**
 * Auto-chart for an Ask answer. Two views over the SAME exact counts:
 *   • the W/D/L split of the queried state (proportion bars), and
 *   • the focus-rate trajectory across the match (how the chance moves with the
 *     clock for this margin) with the queried minute marked.
 * Pure props — no fabricated points; every value comes from `ChartSpec`.
 */

function focusColor(focus: AskOutcome): string {
  if (focus === 'draw') return 'var(--accent-warn)'
  if (focus === 'loss') return 'var(--accent-loss)'
  return 'var(--accent-primary)'
}

/** A noun phrase for chart labels ("Chance of a win, minute by minute"). */
function focusNoun(focus: AskOutcome): string {
  switch (focus) {
    case 'avoid_defeat':
      return 'avoiding defeat'
    case 'draw':
      return 'a draw'
    case 'loss':
      return 'a loss'
    default:
      return 'a win'
  }
}

function SplitBar({
  label,
  count,
  n,
  color,
  emphasis,
}: {
  label: string
  count: number
  n: number
  color: string
  emphasis: boolean
}) {
  const pct = n > 0 ? (count / n) * 100 : 0
  return (
    <div className="flex items-center gap-3">
      <span
        className={
          'w-12 shrink-0 text-xs font-medium ' +
          (emphasis ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]')
        }
      >
        {label}
      </span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--muted-bg)]">
        <span
          className="block h-full rounded-full"
          style={{ width: `${Math.max(pct > 0 ? 1 : 0, pct)}%`, backgroundColor: color }}
        />
      </div>
      <span className="w-24 shrink-0 text-right text-xs tabular-nums text-[var(--text-tertiary)]">
        <span className="font-semibold text-[var(--text-secondary)]">{count.toLocaleString()}</span> ·{' '}
        {pct.toFixed(1)}%
      </span>
    </div>
  )
}

interface CurveTooltipProps {
  active?: boolean
  payload?: Array<{ payload: { minute: number; pct: number; n: number } }>
}

function CurveTooltip({ active, payload }: CurveTooltipProps) {
  if (!active || !payload || !payload[0]) return null
  const row = payload[0].payload
  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] px-2.5 py-1.5">
      <p className="text-[11px] font-semibold tabular-nums text-[var(--text-primary)]">
        {row.minute === 0 ? 'Kickoff' : `${ordinal(row.minute)} minute`}
      </p>
      <p className="text-[11px] tabular-nums text-[var(--text-secondary)]">
        {row.pct.toFixed(1)}% chance · {row.n.toLocaleString()} matches
      </p>
    </div>
  )
}

export function AskChart({ spec }: { spec: ChartSpec }) {
  const color = focusColor(spec.focus)
  const { w, d, l, n } = spec.wdl

  const curveData = useMemo(
    () => spec.curve.points.map((p) => ({ minute: p.minute, pct: Number((p.rate * 100).toFixed(1)), n: p.n })),
    [spec.curve.points]
  )
  const maxPct = useMemo(
    () => curveData.reduce((m, p) => Math.max(m, p.pct), 0),
    [curveData]
  )
  const yMax = Math.max(5, Math.ceil((maxPct * 1.15) / 5) * 5)

  return (
    <div className="space-y-5">
      {/* W/D/L split of the queried state */}
      <div className="space-y-2">
        <SplitBar label="Won" count={w} n={n} color="var(--accent-primary)" emphasis={spec.focus === 'win'} />
        <SplitBar label="Drew" count={d} n={n} color="var(--accent-warn)" emphasis={spec.focus === 'draw'} />
        <SplitBar label="Lost" count={l} n={n} color="var(--accent-loss)" emphasis={spec.focus === 'loss'} />
      </div>

      {/* Focus-rate trajectory across the match */}
      {curveData.length > 1 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
            Chance of {focusNoun(spec.focus)}, minute by minute
          </p>
          <div className="h-[130px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={curveData} margin={{ top: 6, right: 8, bottom: 2, left: -18 }}>
                <XAxis
                  dataKey="minute"
                  type="number"
                  domain={[0, 90]}
                  ticks={[0, 45, 90]}
                  tickFormatter={(v) => (v === 0 ? "KO" : `${v}'`)}
                  tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }}
                  stroke="var(--border-color)"
                  tickLine={false}
                />
                <YAxis
                  domain={[0, yMax]}
                  tickFormatter={(v) => `${v}%`}
                  tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }}
                  stroke="var(--border-color)"
                  tickLine={false}
                  width={44}
                />
                <Tooltip
                  content={<CurveTooltip />}
                  cursor={{ stroke: 'var(--border-hover)', strokeWidth: 1 }}
                />
                <ReferenceLine
                  x={spec.curve.markMinute}
                  stroke={color}
                  strokeDasharray="3 3"
                  strokeOpacity={0.7}
                />
                <Line
                  type="monotone"
                  dataKey="pct"
                  stroke={color}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 3, fill: color }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
