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
  Legend,
} from 'recharts'

import { useChartTheme } from '@/components/charts/theme'

type TeamRow = {
  name: string
  p_advance_first: number
  p_advance_second: number
  p_advance_either: number
}

type Props = {
  teams: TeamRow[]
}

/**
 * Horizontal stacked bar chart showing each team's group winner (p_first)
 * and runner-up (p_second) probabilities.  Stacks add up to
 * p_advance_either, which is the full advancement probability.
 *
 * Mobile-first: bars stack vertically below 640px by rendering the chart
 * with a layout="vertical" Recharts BarChart (categorical Y axis, numeric
 * X axis).  Recharts handles responsiveness via ResponsiveContainer.
 */
export default function GroupAdvancementChart({ teams }: Props) {
  const theme = useChartTheme()
  const COLORS = {
    first: theme.ai, // darker accent (AI prediction)
    second: theme.aiSoft, // lighter accent
    axis: theme.border,
    text: theme.textMuted,
  }
  if (!teams || teams.length === 0) {
    return (
      <p className="text-xs text-[var(--text-tertiary)]">No advancement data available yet.</p>
    )
  }

  const data = teams.map((t) => ({
    name: t.name,
    first: +(t.p_advance_first * 100).toFixed(2),
    second: +(t.p_advance_second * 100).toFixed(2),
    either: +(t.p_advance_either * 100).toFixed(2),
  }))

  const height = Math.max(180, data.length * 56)

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 10, right: 24, bottom: 10, left: 12 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={theme.border} />
          <XAxis
            type="number"
            domain={[0, 100]}
            tick={{ fill: COLORS.text, fontSize: 11 }}
            stroke={COLORS.axis}
            tickFormatter={(v) => `${v}%`}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fill: COLORS.text, fontSize: 12, fontWeight: 700 }}
            stroke={COLORS.axis}
            width={110}
          />
          <Tooltip
            cursor={{ fill: theme.border }}
            contentStyle={{
              backgroundColor: theme.cardBg,
              border: `1px solid ${theme.border}`,
              borderRadius: 6,
              color: theme.text,
              fontSize: 12,
            }}
            formatter={(value: number, name: string) => {
              const label = name === 'first' ? 'Win group' : 'Runner-up'
              return [`${value.toFixed(1)}%`, label]
            }}
          />
          <Legend
            wrapperStyle={{ color: COLORS.text, fontSize: 11 }}
            formatter={(value) => (value === 'first' ? 'Win group' : 'Runner-up')}
          />
          <Bar dataKey="first" stackId="adv" fill={COLORS.first}>
            {data.map((_, i) => (
              <Cell key={`f-${i}`} fill={COLORS.first} />
            ))}
          </Bar>
          <Bar dataKey="second" stackId="adv" fill={COLORS.second}>
            {data.map((_, i) => (
              <Cell key={`s-${i}`} fill={COLORS.second} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
