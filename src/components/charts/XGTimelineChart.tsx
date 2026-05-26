'use client'

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { useChartTheme } from './theme'

export interface XGPoint {
  minute: number
  homeXG: number
  awayXG: number
}

interface XGTimelineChartProps {
  data: XGPoint[]
  homeLabel?: string
  awayLabel?: string
  height?: number
  className?: string
}

/**
 * Cumulative-xG area chart over match minutes. One area per side.
 */
export function XGTimelineChart({
  data,
  homeLabel = 'Home',
  awayLabel = 'Away',
  height = 220,
  className,
}: XGTimelineChartProps) {
  const theme = useChartTheme()
  return (
    <div className={className} style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <defs>
            <linearGradient id="xg-home-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={theme.home} stopOpacity={0.5} />
              <stop offset="100%" stopColor={theme.home} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="xg-away-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={theme.away} stopOpacity={0.5} />
              <stop offset="100%" stopColor={theme.away} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={theme.border} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="minute"
            tick={{ fill: theme.textMuted, fontSize: 11 }}
            stroke={theme.border}
            tickFormatter={(v) => `${v}'`}
          />
          <YAxis
            tick={{ fill: theme.textMuted, fontSize: 11 }}
            stroke={theme.border}
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
            formatter={(value: number, name: string) => [value.toFixed(2), name]}
            labelFormatter={(label: number) => `Minute ${label}'`}
          />
          <Legend
            iconType="circle"
            wrapperStyle={{ fontSize: 12, color: theme.textMuted }}
          />
          <Area
            type="monotone"
            dataKey="homeXG"
            name={`${homeLabel} xG`}
            stroke={theme.home}
            strokeWidth={2}
            fill="url(#xg-home-grad)"
            isAnimationActive
          />
          <Area
            type="monotone"
            dataKey="awayXG"
            name={`${awayLabel} xG`}
            stroke={theme.away}
            strokeWidth={2}
            fill="url(#xg-away-grad)"
            isAnimationActive
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
