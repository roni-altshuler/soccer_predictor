'use client'

import useSWR from 'swr'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'

const fetcher = (url: string) => fetch(url).then(res => res.json())

interface ResultDistributionChartProps {
  league: string
}

const COLORS = { win: '#00C853', draw: '#FFD700', loss: '#FF5252' };

interface ChartDatum {
  name: 'win' | 'draw' | 'loss'
  value: number
  percentage?: number
}

export const ResultDistributionChart = ({ league }: ResultDistributionChartProps) => {
  const { data, error } = useSWR(`/api/analytics/result_distribution/${league}`, fetcher)

  if (error) return <div>Failed to load chart</div>
  if (!data) return <div>Loading...</div>

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

  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="50%"
          labelLine={false}
          outerRadius={80}
          fill="#8884d8"
          dataKey="value"
          nameKey="name"
          label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
        >
          {chartData.map((entry, index: number) => (
            <Cell key={`cell-${index}`} fill={COLORS[entry.name]} />
          ))}
        </Pie>
        <Tooltip />
      </PieChart>
    </ResponsiveContainer>
  )
}
