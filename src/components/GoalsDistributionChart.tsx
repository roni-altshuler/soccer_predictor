'use client'

import useSWR from 'swr'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

import { useChartTheme } from '@/components/charts/theme'

const fetcher = (url: string) => fetch(url).then(res => res.json())

interface GoalsDistributionChartProps {
  league: string
}

interface GoalChartDatum {
  name: string
  value: number
  percentage?: number
}

export const GoalsDistributionChart = ({ league }: GoalsDistributionChartProps) => {
  const theme = useChartTheme()
  const { data, error } = useSWR(`/api/analytics/goals_distribution/${league}`, fetcher)

  if (error) return <div className="text-[var(--accent-loss)]">Failed to load chart</div>
  if (!data) return <div className="text-[var(--text-tertiary)]">Loading...</div>

  const chartData: GoalChartDatum[] = Array.isArray(data)
    ? data
    : Array.isArray(data.chart_data)
      ? data.chart_data
      : Array.isArray(data.distribution)
        ? data.distribution.map((item: { goals: number; count: number; percentage?: number }) => ({
            name: String(item.goals),
            value: item.count,
            percentage: item.percentage,
          }))
        : []

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={chartData} margin={{ top: 10, right: 20, bottom: 30, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={theme.border} />
        <XAxis
          dataKey="name"
          stroke={theme.textMuted}
          tick={{ fill: theme.textMuted, fontSize: 12 }}
          label={{
            value: 'Total Goals per Match',
            position: 'insideBottom',
            offset: 0,
            dy: 15,
            style: { textAnchor: 'middle', fill: theme.textMuted, fontSize: 12 },
          }}
        />
        <YAxis
          stroke={theme.textMuted}
          tick={{ fill: theme.textMuted, fontSize: 12 }}
          label={{
            value: 'Number of Matches',
            angle: -90,
            position: 'insideLeft',
            offset: 10,
            style: { textAnchor: 'middle', fill: theme.textMuted, fontSize: 12 },
          }}
        />
        <Tooltip
          cursor={{ fill: theme.cardBg, opacity: 0.4 }}
          contentStyle={{
            background: theme.cardBg,
            border: `1px solid ${theme.border}`,
            borderRadius: 8,
            color: theme.text,
          }}
        />
        <Bar dataKey="value" name="Number of Matches" fill={theme.primary} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
