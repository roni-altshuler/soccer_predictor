'use client'

import useSWR from 'swr'
import { Calendar, CircleDot, Home, Equal, Plane, type LucideIcon } from 'lucide-react'

const fetcher = (url: string) => fetch(url).then(res => res.json())

interface LeagueStatsProps {
  league: string
}

interface Stat {
  label: string
  value: string | number
  Icon: LucideIcon
}

export const LeagueStats = ({ league }: LeagueStatsProps) => {
  const { data, error } = useSWR(`/api/analytics/overview/${league}`, fetcher)

  if (error) return <div className="text-[var(--accent-loss)] text-center">Failed to load stats</div>
  if (!data) return <div className="text-[var(--text-tertiary)] text-center">Loading...</div>

  const stats: Stat[] = [
    { label: 'Total Matches', value: data.total_matches, Icon: Calendar },
    { label: 'Avg Goals / Match', value: data.avg_goals_per_match, Icon: CircleDot },
    { label: 'Home Win %', value: `${data.home_win_percentage}%`, Icon: Home },
    { label: 'Draw %', value: `${data.draw_percentage}%`, Icon: Equal },
    { label: 'Away Win %', value: `${data.away_win_percentage}%`, Icon: Plane },
  ]

  return (
    <div className="w-full">
      <div className="rounded-2xl border-2 border-[var(--accent-primary)]/40 bg-[var(--card-bg)] p-8 shadow-[var(--shadow-md)]">
        <div className="mb-8 text-center">
          <h2 className="text-4xl font-bold text-[var(--text-primary)]">League Overview</h2>
          <div className="mx-auto mt-3 h-1 w-32 bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-ai)]"></div>
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          {stats.map(({ label, value, Icon }) => (
            <div
              key={label}
              className="flex flex-col items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--muted-bg)] p-6 text-center shadow-[var(--shadow-sm)] transition-transform duration-300 hover:scale-105 hover:shadow-[var(--shadow-md)]"
            >
              <Icon className="mb-3 h-10 w-10 text-[var(--accent-primary)]" aria-hidden />
              <div className="text-meta uppercase tracking-wide text-[var(--text-secondary)]">{label}</div>
              <div className="mt-2 text-3xl font-black text-[var(--accent-primary)]">{value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
