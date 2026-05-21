'use client'

import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(res => res.json())

interface LeagueStatsProps {
  league: string
}

export const LeagueStats = ({ league }: LeagueStatsProps) => {
  const { data, error } = useSWR(`/api/analytics/overview/${league}`, fetcher)

  if (error) return <div className="text-red-500 text-center">Failed to load stats</div>
  if (!data) return <div className="text-[var(--text-tertiary)] text-center">Loading...</div>

  const stats = [
    { label: "Total Matches", value: data.total_matches, icon: '🏟️' },
    { label: "Avg Goals / Match", value: data.avg_goals_per_match, icon: '⚽' },
    { label: "Home Win %", value: `${data.home_win_percentage}%`, icon: '🏠' },
    { label: "Draw %", value: `${data.draw_percentage}%`, icon: '🤝' },
    { label: "Away Win %", value: `${data.away_win_percentage}%`, icon: '✈️' },
  ];

  return (
    <div className="w-full">
      {/* Prominent border around entire league stats section */}
      <div className="rounded-2xl border-2 border-[var(--accent-primary)]/40 bg-[var(--card-bg)] p-8 shadow-[var(--shadow-md)]">
        <div className="mb-8 text-center">
          <h2 className="flex items-center justify-center gap-3 text-4xl font-bold text-[var(--text-primary)]">
            <span className="text-5xl">⚽</span>
            League Overview
            <span className="text-5xl">⚽</span>
          </h2>
          <div className="mx-auto mt-3 h-1 w-32 bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-ai)]"></div>
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="flex flex-col items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--muted-bg)] p-6 text-center shadow-[var(--shadow-sm)] transition-transform duration-300 hover:scale-105 hover:shadow-[var(--shadow-md)]"
            >
              <div className="mb-3 text-5xl">{stat.icon}</div>
              <div className="text-sm font-semibold uppercase tracking-wide text-[var(--text-secondary)]">{stat.label}</div>
              <div className="mt-2 text-3xl font-black text-[var(--accent-primary)]">{stat.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
