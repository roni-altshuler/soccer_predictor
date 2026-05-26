'use client'

import { Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from 'recharts'

import { useChartTheme } from './theme'

interface FormSparklineProps {
  /** Series of normalised form values (e.g. xG diff, points). */
  values: number[]
  /** Pixel height (default 32). */
  height?: number
  /** Pixel width (default 100). */
  width?: number
  /** Accent — drives line color. */
  accent?: 'primary' | 'ai' | 'warn' | 'loss'
  className?: string
}

/**
 * Tiny inline sparkline. Used in player/team cards and history tables.
 */
export function FormSparkline({
  values,
  height = 32,
  width = 100,
  accent = 'primary',
  className,
}: FormSparklineProps) {
  const theme = useChartTheme()
  const stroke =
    accent === 'primary'
      ? theme.primary
      : accent === 'ai'
        ? theme.ai
        : accent === 'warn'
          ? theme.warn
          : theme.loss

  const data = values.map((v, i) => ({ i, v }))

  return (
    <div className={className} style={{ width, height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Tooltip
            cursor={false}
            contentStyle={{
              backgroundColor: theme.cardBg,
              border: `1px solid ${theme.border}`,
              borderRadius: 6,
              fontSize: 11,
              padding: '4px 6px',
              color: theme.text,
            }}
            formatter={(value: number) => [value.toFixed(2), 'Value']}
            labelFormatter={() => ''}
          />
          <Line
            type="monotone"
            dataKey="v"
            stroke={stroke}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
