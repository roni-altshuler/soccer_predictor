'use client'

import { motion } from 'framer-motion'
import { Crown, ShieldHalf, TrendingDown } from 'lucide-react'

/**
 * Season projections — FiveThirtyEight-style three-zone read of a Monte Carlo
 * season simulation: who wins the title, who makes the European places, and
 * who goes down. All probabilities come straight from the simulation's
 * per-team standings array; zones that don't apply to a competition (e.g. no
 * relegation in a cup-style table) are simply hidden when no team carries a
 * non-zero probability.
 */
export type ProjectionTeam = {
  team_name: string
  current_points: number
  avg_final_points: number
  title_probability: number
  top_4_probability: number
  relegation_probability: number
}

type Zone = {
  key: 'title' | 'top4' | 'releg'
  label: string
  caption: string
  Icon: typeof Crown
  prob: (t: ProjectionTeam) => number
  color: string
}

const ZONES: Zone[] = [
  {
    key: 'title',
    label: 'Title race',
    caption: 'Win the league',
    Icon: Crown,
    prob: (t) => t.title_probability,
    color: 'var(--accent-primary)',
  },
  {
    key: 'top4',
    label: 'European places',
    caption: 'Finish top four',
    Icon: ShieldHalf,
    prob: (t) => t.top_4_probability,
    color: 'var(--accent-info)',
  },
  {
    key: 'releg',
    label: 'Relegation battle',
    caption: 'Drop to the division below',
    Icon: TrendingDown,
    prob: (t) => t.relegation_probability,
    color: 'var(--accent-loss)',
  },
]

function ZoneColumn({ zone, teams }: { zone: Zone; teams: ProjectionTeam[] }) {
  const ranked = teams
    .map((t) => ({ name: t.team_name, p: zone.prob(t) }))
    .filter((t) => t.p > 0.005)
    .sort((a, b) => b.p - a.p)
    .slice(0, 5)

  if (ranked.length === 0) return null

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4">
      <div className="flex items-center gap-2">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-lg"
          style={{ background: `color-mix(in srgb, ${zone.color} 16%, transparent)`, color: zone.color }}
        >
          <zone.Icon className="h-4 w-4" strokeWidth={2.4} aria-hidden="true" />
        </span>
        <div>
          <p className="text-[13px] font-bold leading-tight text-[var(--text-primary)]">{zone.label}</p>
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">{zone.caption}</p>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {ranked.map((t, i) => (
          <div key={t.name} className="flex items-center gap-2">
            <span className="w-3 shrink-0 text-right text-[11px] font-semibold tabular-nums text-[var(--text-tertiary)]">
              {i + 1}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--text-primary)]" title={t.name}>
              {t.name}
            </span>
            <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-[var(--muted-bg)]">
              <motion.div
                className="h-full rounded-full"
                style={{ background: zone.color }}
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(3, t.p * 100)}%` }}
                transition={{ duration: 0.5, delay: i * 0.04, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
            <span className="w-9 shrink-0 text-right text-[12px] font-bold tabular-nums" style={{ color: zone.color }}>
              {t.p >= 0.995 ? '100' : (t.p * 100).toFixed(t.p < 0.1 ? 1 : 0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function SeasonProjections({
  teams,
  nSimulations,
}: {
  teams: ProjectionTeam[]
  nSimulations: number
}) {
  const columns = ZONES.map((zone) => ({ zone, node: <ZoneColumn key={zone.key} zone={zone} teams={teams} /> })).filter(
    ({ zone }) => teams.some((t) => zone.prob(t) > 0.005),
  )
  if (columns.length === 0) return null

  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] p-4 shadow-[var(--shadow-sm)] md:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
            AI projection
          </p>
          <h2 className="text-base font-bold text-[var(--text-primary)]">Season outlook</h2>
        </div>
        <span className="rounded-full border border-[var(--border-color)] px-2.5 py-1 text-[10px] font-semibold text-[var(--text-tertiary)]">
          {nSimulations.toLocaleString()} simulations
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {columns.map(({ node }) => node)}
      </div>
    </div>
  )
}
