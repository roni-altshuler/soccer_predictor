'use client'

import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(res => res.json())

interface LeagueStatsProps {
  league: string
}

export const LeagueStats = ({ league }: LeagueStatsProps) => {
  const { data, error } = useSWR(`/api/analytics/overview/${league}`, fetcher)

  if (error) return <div className="text-red-500">Failed to load stats</div>
  if (!data) return <div className="text-gray-400">Loading...</div>

  const stats = [
    { label: "Total Matches", value: data.total_matches },
    { label: "Avg Goals / Match", value: data.avg_goals_per_match },
    { label: "Home Win %", value: `${data.home_win_percentage}%` },
    { label: "Draw %", value: `${data.draw_percentage}%` },
    { label: "Away Win %", value: `${data.away_win_percentage}%` },
  ];

  return (
    <div className="w-full overflow-x-auto">
      <h2 className="text-2xl font-bold mb-4 text-center">League Overview</h2>
      <table className="min-w-full bg-gray-900 rounded-lg shadow-lg border border-gray-700">
        <thead>
          <tr>
            {stats.map((stat) => (
              <th key={stat.label} className="py-3 px-4 text-lg font-medium text-gray-300 font-sans text-center border-b border-gray-700">
                {stat.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {stats.map((stat) => (
              <td key={stat.label} className="py-3 px-4 text-2xl font-bold text-blue-400 font-mono text-center">
                {stat.value}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}
