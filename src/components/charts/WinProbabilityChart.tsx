'use client'

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { useChartTheme } from './theme'

export interface WinProbabilityPoint {
  /** Minute of the match (0..120). */
  minute: number
  /** 0..1 probability for the home team to win. */
  home: number
  /** 0..1 probability for a draw. */
  draw: number
  /** 0..1 probability for the away team to win. */
  away: number
  /** Optional event note (goal, red card) — rendered as a reference line label. */
  event?: string
}

interface WinProbabilityChartProps {
  data: WinProbabilityPoint[]
  /** Optional team names for the legend (default: Home / Draw / Away). */
  homeLabel?: string
  awayLabel?: string
  /** Vertical reference lines at goal/event minutes. */
  events?: Array<{ minute: number; label: string }>
  height?: number
  className?: string
}

/**
 * Live win-probability ribbon — three-series stacked line + soft area band
 * for the leading side. Designed for the match-detail "Summary" tab.
 */
export function WinProbabilityChart({
  data,
  homeLabel = 'Home',
  awayLabel = 'Away',
  events,
  height = 240,
  className,
}: WinProbabilityChartProps) {
  const theme = useChartTheme()
  const scaled = data.map((p) => ({
    minute: p.minute,
    home: Math.round(p.home * 100),
    draw: Math.round(p.draw * 100),
    away: Math.round(p.away * 100),
  }))

  return (
    <div className={className} style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={scaled} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid stroke={theme.border} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="minute"
            tick={{ fill: theme.textMuted, fontSize: 11 }}
            stroke={theme.border}
            tickFormatter={(v) => `${v}'`}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fill: theme.textMuted, fontSize: 11 }}
            stroke={theme.border}
            tickFormatter={(v) => `${v}%`}
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
            formatter={(value: number, name: string) => [`${value}%`, name]}
            labelFormatter={(label: number) => `Minute ${label}'`}
          />
          <Legend
            iconType="circle"
            wrapperStyle={{ fontSize: 12, color: theme.textMuted }}
          />
          <Area
            type="monotone"
            dataKey="home"
            name={homeLabel}
            stroke={theme.home}
            strokeWidth={2}
            fill={theme.home}
            fillOpacity={0.18}
            isAnimationActive
          />
          <Line
            type="monotone"
            dataKey="draw"
            name="Draw"
            stroke={theme.draw}
            strokeWidth={1.5}
            strokeDasharray="4 4"
            dot={false}
          />
          <Area
            type="monotone"
            dataKey="away"
            name={awayLabel}
            stroke={theme.away}
            strokeWidth={2}
            fill={theme.away}
            fillOpacity={0.18}
          />
          {events?.map((evt) => (
            <ReferenceLine
              key={`${evt.minute}-${evt.label}`}
              x={evt.minute}
              stroke={theme.textMuted}
              strokeDasharray="2 2"
              label={{ value: evt.label, fill: theme.textMuted, fontSize: 10, position: 'top' }}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
