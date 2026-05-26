'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { useChartTheme } from './theme'

export interface ScorelineBucket {
  /** Scoreline label e.g. "2-1". */
  label: string
  /** Probability mass (0..1) the simulation assigns. */
  probability: number
  /** Outcome derived from the scoreline — used to color the bar. */
  outcome: 'home' | 'draw' | 'away'
}

interface SimulationDistributionChartProps {
  buckets: ScorelineBucket[]
  /** Highlight the top-N most likely scorelines. */
  highlightTop?: number
  height?: number
  className?: string
}

/**
 * Monte-Carlo scoreline distribution. Bars are colored by outcome
 * (home / draw / away) and probabilities shown as percentages.
 */
export function SimulationDistributionChart({
  buckets,
  highlightTop = 3,
  height = 260,
  className,
}: SimulationDistributionChartProps) {
  const theme = useChartTheme()
  const data = buckets.map((b) => ({ ...b, pct: +(b.probability * 100).toFixed(1) }))
  const sortedIdx = [...data]
    .map((d, i) => ({ d, i }))
    .sort((a, b) => b.d.probability - a.d.probability)
    .slice(0, highlightTop)
    .map(({ i }) => i)

  const tone = (b: ScorelineBucket): string =>
    b.outcome === 'home' ? theme.home : b.outcome === 'away' ? theme.away : theme.draw

  return (
    <div className={className} style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid stroke={theme.border} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: theme.textMuted, fontSize: 11 }}
            stroke={theme.border}
          />
          <YAxis
            tick={{ fill: theme.textMuted, fontSize: 11 }}
            stroke={theme.border}
            tickFormatter={(v: number) => `${v}%`}
            width={36}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: theme.cardBg,
              border: `1px solid ${theme.border}`,
              borderRadius: 8,
              fontSize: 12,
              color: theme.text,
            }}
            formatter={(value: number) => [`${value}%`, 'Probability']}
            labelFormatter={(label: string) => `Scoreline ${label}`}
          />
          <Bar dataKey="pct" radius={[6, 6, 0, 0]} isAnimationActive>
            {data.map((entry, idx) => (
              <Cell
                key={idx}
                fill={tone(entry)}
                fillOpacity={sortedIdx.includes(idx) ? 1 : 0.55}
                stroke={sortedIdx.includes(idx) ? tone(entry) : 'transparent'}
                strokeWidth={sortedIdx.includes(idx) ? 1.5 : 0}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
