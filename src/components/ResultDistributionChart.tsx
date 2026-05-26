'use client'

import useSWR from 'swr'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'

import { useChartTheme } from '@/components/charts/theme'

const fetcher = (url: string) => fetch(url).then(res => res.json())

interface ResultDistributionChartProps {
  league: string
}

interface ChartDatum {
  name: 'win' | 'draw' | 'loss'
  value: number
  percentage?: number
}

export const ResultDistributionChart = ({ league }: ResultDistributionChartProps) => {
  const theme = useChartTheme()
  const { data, error } = useSWR(`/api/analytics/result_distribution/${league}`, fetcher)

  if (error) return <div className="text-[var(--accent-loss)]">Failed to load chart</div>
  if (!data) return <div className="text-[var(--text-tertiary)]">Loading...</div>

  const chartData: ChartDatum[] = Array.isArray(data)
    ? data
    : Array.isArray(data.chart_data)
      ? data.chart_data
      : Array.isArray(data.distribution)
        ? data.distribution.map((item: { result: string; count: number; percentage?: number }) => ({
            name: item.result === 'Home Win' ? 'win' : item.result === 'Away Win' ? 'loss' : 'draw',
            value: item.count,
            percentage: item.percentage,
          }))
        : []

  // Map outcome → theme token (theme.home/draw/away already encode home-win,
  // draw, and away-win semantics through CSS variables — flip dark/light safe).
  const fillFor = (outcome: ChartDatum['name']) =>
    outcome === 'win' ? theme.home : outcome === 'draw' ? theme.draw : theme.away

  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="50%"
          labelLine={false}
          outerRadius={88}
          innerRadius={48}
          paddingAngle={2}
          dataKey="value"
          nameKey="name"
          label={({ name, percent }) =>
            `${name}: ${typeof percent === 'number' ? (percent * 100).toFixed(0) : 0}%`
          }
        >
          {chartData.map((entry, index: number) => (
            <Cell key={`cell-${index}`} fill={fillFor(entry.name)} stroke={theme.cardBg} strokeWidth={2} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            background: theme.cardBg,
            border: `1px solid ${theme.border}`,
            borderRadius: 8,
            color: theme.text,
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}
