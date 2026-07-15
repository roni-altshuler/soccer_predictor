'use client'

import { useEffect, useState } from 'react'

import { SectionHeader, TeamBadge } from '@/components/primitives'
import { cn } from '@/lib/utils'

/**
 * Justice Ledger — the luck-adjusted season table (VISION_2030 §4.4).
 *
 * Ranks a finished (or in-progress) season by xPts — the points a team's
 * chance quality typically earns — next to the points it actually took.
 * Positive delta = the team is ahead of the numbers (amber); negative =
 * behind the numbers (info blue). Educational framing only.
 *
 * Honesty contract (design language rule 5): the API only serves seasons
 * that cleared the ≥90% xG-coverage gates at build time. When the season
 * has no qualifying block this component renders NOTHING — no placeholder,
 * no empty card.
 */

interface JusticeTeamRow {
  team: string
  pts: number
  xpts: number
  delta: number
  matches: number
}

interface JusticeResponse {
  competition: string
  season: number
  coverage: number | null
  teams: JusticeTeamRow[]
}

interface JusticeLedgerProps {
  /** Warehouse competition id, e.g. "eng.1" (women's: "eng.1.w"). */
  competition: string
  /** Season start year, e.g. "2024" for 2024-25. */
  season: string
}

export default function JusticeLedger({ competition, season }: JusticeLedgerProps) {
  const [data, setData] = useState<JusticeResponse | null>(null)

  useEffect(() => {
    let cancelled = false
    setData(null)
    fetch(`/api/v1/justice?competition=${encodeURIComponent(competition)}&season=${encodeURIComponent(season)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json: JusticeResponse | null) => {
        if (!cancelled) setData(json)
      })
      .catch(() => {
        if (!cancelled) setData(null)
      })
    return () => {
      cancelled = true
    }
  }, [competition, season])

  // No qualifying season → render nothing (never an empty shell).
  if (!data || !Array.isArray(data.teams) || data.teams.length === 0) return null

  return (
    <div className="bg-[var(--card-bg)] border rounded-xl overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
      <SectionHeader
        kicker="Justice ledger"
        title="The table the numbers deserved"
        description="Actual points next to the points each team's chances were worth."
        className="p-4 border-b border-[var(--border-color)]"
      />
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] tabular-nums">
          <thead>
            <tr className="border-b border-[var(--border-color)] text-[11px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
              <th className="text-left py-2 pl-3 pr-1 font-semibold">#</th>
              <th className="text-left py-2 px-2 font-semibold">Team</th>
              <th className="text-right py-2 px-2 font-semibold">Pts</th>
              <th className="text-right py-2 px-2 font-semibold">xPts</th>
              <th className="text-right py-2 pr-3 pl-2 font-semibold">Δ</th>
            </tr>
          </thead>
          <tbody>
            {data.teams.map((row, idx) => (
              <tr
                key={row.team}
                className="border-b border-[var(--border-color)]/40 transition-colors last:border-b-0 hover:bg-[var(--card-hover)]"
              >
                <td className="py-2 pl-3 pr-1 text-[var(--text-secondary)]">{idx + 1}</td>
                <td className="py-2 px-2">
                  <span className="flex items-center gap-2 font-medium text-[var(--text-primary)]">
                    <TeamBadge name={row.team} size={18} />
                    <span className="truncate">{row.team}</span>
                  </span>
                </td>
                <td className="py-2 px-2 text-right text-[var(--text-secondary)]">{row.pts}</td>
                <td className="py-2 px-2 text-right font-bold text-[var(--text-primary)]">{row.xpts.toFixed(1)}</td>
                <td
                  className={cn(
                    'py-2 pr-3 pl-2 text-right font-semibold',
                    row.delta > 0
                      ? 'text-[var(--accent-warn)]'
                      : row.delta < 0
                        ? 'text-[var(--accent-info)]'
                        : 'text-[var(--text-tertiary)]'
                  )}
                >
                  {row.delta > 0 ? '▲ ' : row.delta < 0 ? '▼ ' : ''}
                  {row.delta > 0 ? '+' : ''}
                  {row.delta.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="p-3 border-t flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-tertiary)]" style={{ borderColor: 'var(--border-color)' }}>
        <span>xPts — the points a team&apos;s chance quality typically earns.</span>
        <span className="inline-flex items-center gap-1 text-[var(--accent-warn)]">▲ ahead of the numbers</span>
        <span className="inline-flex items-center gap-1 text-[var(--accent-info)]">▼ behind the numbers</span>
      </div>
    </div>
  )
}
