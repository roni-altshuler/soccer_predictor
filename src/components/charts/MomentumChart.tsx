'use client'

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { useChartTheme } from './theme'

export interface MomentumPoint {
  /** Minute of the match. */
  minute: number
  /** Net pressure on the away goal — positive = home attacking, negative = away attacking. */
  value: number
}

interface MomentumChartProps {
  data: MomentumPoint[]
  /** Optional vertical reference markers for goals / cards. */
  events?: Array<{ minute: number; label: string }>
  height?: number
  className?: string
}

/**
 * Match-momentum area chart — divergent (home above zero, away below).
 * Replaces the legacy hand-rolled SVG in `MatchMomentum.tsx`.
 */
export function MomentumChart({ data, events, height = 220, className }: MomentumChartProps) {
  const theme = useChartTheme()
  const maxAbs = Math.max(1, ...data.map((d) => Math.abs(d.value)))

  return (
    <div className={className} style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }} stackOffset="none">
          <defs>
            <linearGradient id="momentum-home" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={theme.home} stopOpacity={0.6} />
              <stop offset="100%" stopColor={theme.home} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="momentum-away" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor={theme.away} stopOpacity={0.6} />
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
            domain={[-maxAbs, maxAbs]}
            tick={{ fill: theme.textMuted, fontSize: 11 }}
            stroke={theme.border}
            width={32}
          />
          <ReferenceLine y={0} stroke={theme.border} strokeWidth={1} />
          <Tooltip
            contentStyle={{
              backgroundColor: theme.cardBg,
              border: `1px solid ${theme.border}`,
              borderRadius: 8,
              fontSize: 12,
              color: theme.text,
            }}
            formatter={(value: number) => [
              `${value > 0 ? 'Home' : value < 0 ? 'Away' : 'Neutral'}: ${Math.abs(value).toFixed(2)}`,
              'Pressure',
            ]}
            labelFormatter={(label: number) => `Minute ${label}'`}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={theme.home}
            strokeWidth={1.5}
            fill="url(#momentum-home)"
            isAnimationActive
            baseValue={0}
          />
          {/* Underside fill for negative values — second Area with inverted gradient */}
          <Area
            type="monotone"
            dataKey={(d: MomentumPoint) => (d.value < 0 ? d.value : 0)}
            stroke={theme.away}
            strokeWidth={1.5}
            fill="url(#momentum-away)"
            isAnimationActive
            baseValue={0}
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
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
