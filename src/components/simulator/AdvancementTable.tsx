'use client'

import { FlagBadge } from '@/components/primitives'
import type { KnockoutRoundKey } from '@/lib/simulation/knockoutMonteCarlo'
import { cn } from '@/lib/utils'

import { formatPct } from './shared'

/**
 * AdvancementTable — the knockout "path to the trophy" grid: one row per
 * team (sorted by winner probability), one column per remaining round
 * (Reach QF / Reach SF / Reach final / Win). Cells carry an `--accent-ai`
 * heat wash whose intensity is proportional to the probability, so the
 * bracket favourites read as a bright diagonal. FotMob table grammar:
 * 13px, tabular numerals, hairline rows, flat card.
 */

export interface AdvancementRow {
  name: string
  reach: Partial<Record<KnockoutRoundKey, number>>
}

const ROUND_LABEL: Record<KnockoutRoundKey, { short: string; aria: string }> = {
  quarter_finals: { short: 'Reach QF', aria: 'reaches the quarter-finals' },
  semi_finals: { short: 'Reach SF', aria: 'reaches the semi-finals' },
  final: { short: 'Reach final', aria: 'reaches the final' },
  winner: { short: 'Win', aria: 'wins the tournament' },
}

function HeatCell({
  teamName,
  round,
  probability,
}: {
  teamName: string
  round: KnockoutRoundKey
  probability: number
}) {
  const visible = probability >= 0.0005
  // Wash intensity ∝ probability (72% cap keeps text readable on both themes).
  const wash = Math.round(Math.min(0.72, probability * 0.72) * 100)
  return (
    <td
      aria-label={`${teamName} ${ROUND_LABEL[round].aria} in ${formatPct(probability)} of simulations`}
      className={cn(
        'px-3 py-2 text-right text-[13px] tabular-nums',
        visible
          ? 'font-semibold text-[var(--text-primary)]'
          : 'text-[var(--text-tertiary)]',
        round === 'winner' && visible && 'font-bold',
      )}
      style={
        visible
          ? {
              background: `color-mix(in srgb, var(--accent-ai) ${wash}%, var(--card-bg))`,
            }
          : undefined
      }
    >
      {visible ? formatPct(probability) : '—'}
    </td>
  )
}

interface AdvancementTableProps {
  /** Rounds in play order, ending with 'winner' (from the simulation payload). */
  rounds: KnockoutRoundKey[]
  /** Team rows — rendered in the given order (sort by winner prob upstream). */
  teams: AdvancementRow[]
  /** National-team field — resolves flags via flagcdn; clubs get a monogram. */
  national?: boolean
  className?: string
}

export default function AdvancementTable({
  rounds,
  teams,
  national = false,
  className,
}: AdvancementTableProps) {
  if (teams.length === 0 || rounds.length === 0) return null

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]',
        className,
      )}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]" aria-label="Path to the trophy">
          <thead>
            <tr className="border-b border-[var(--border-color)] text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
              <th scope="col" className="px-3 py-2.5 text-left font-semibold">
                Team
              </th>
              {rounds.map((round) => (
                <th
                  key={round}
                  scope="col"
                  className="px-3 py-2.5 text-right font-semibold"
                >
                  {ROUND_LABEL[round].short}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {teams.map((team) => (
              <tr
                key={team.name}
                className="border-b border-[var(--border-color)]/60 transition-colors last:border-b-0 hover:bg-[var(--card-hover)]"
              >
                <th
                  scope="row"
                  className="px-3 py-2 text-left font-medium text-[var(--text-primary)]"
                >
                  <span className="flex items-center gap-2">
                    <FlagBadge
                      teamName={team.name}
                      country={national ? team.name : undefined}
                      size={18}
                    />
                    <span className="truncate">{team.name}</span>
                  </span>
                </th>
                {rounds.map((round) => (
                  <HeatCell
                    key={round}
                    teamName={team.name}
                    round={round}
                    probability={team.reach[round] ?? 0}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-[var(--border-color)] px-4 py-2.5 text-[11px] text-[var(--text-tertiary)]">
        Brighter cell = happens in more of the simulated tournaments
      </p>
    </div>
  )
}
