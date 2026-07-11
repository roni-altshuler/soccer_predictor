'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import { Trophy } from 'lucide-react'

import { TeamBadge } from '@/components/primitives/TeamBadge'

export interface WinnerProjectionRow {
  name: string
  teamId?: string
  group?: string
  pChampion: number
  pFinal: number
  pSemi: number
}

interface WinnerProjectionsBoardProps {
  rows: WinnerProjectionRow[]
  nSimulations: number
  generatedAt?: string
  bracketSet: boolean
  /** 'live' simulator or committed 'snapshot'. */
  source?: string
  limit?: number
}

function pct(value: number, decimals = 1): string {
  return `${(value * 100).toFixed(decimals)}%`
}

/**
 * AI tournament-winner projections — the headline board of the World Cup
 * hub. Champion probability as an animated bar, with Final/Semi reach
 * columns, fed by the Monte Carlo bracket simulator.
 */
export function WinnerProjectionsBoard({
  rows,
  nSimulations,
  bracketSet,
  limit = 12,
}: WinnerProjectionsBoardProps) {
  const visible = rows.slice(0, limit)
  const maxChampion = Math.max(...visible.map((r) => r.pChampion), 0.01)

  return (
    <section
      className="overflow-hidden rounded-2xl border bg-[var(--card-bg)]"
      style={{ borderColor: 'color-mix(in srgb, var(--accent-ai) 28%, var(--border-color))' }}
      aria-label="AI World Cup winner projections"
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--border-color)] px-5 py-4">
        <Trophy className="h-4 w-4 text-[var(--accent-warn)]" />
        <h2 className="text-h4 font-bold text-[var(--text-primary)]">AI winner projections</h2>
        <span className="ml-auto text-caption uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
          Simulated {Intl.NumberFormat().format(nSimulations)} times
        </span>
      </header>

      <div className="hidden grid-cols-[2.2rem_1fr_minmax(7rem,2fr)_4.5rem_4.5rem] items-center gap-3 border-b border-[var(--border-color)] px-5 py-2 text-caption uppercase tracking-[0.14em] text-[var(--text-tertiary)] sm:grid">
        <span>#</span>
        <span>Team</span>
        <span>Champion</span>
        <span className="text-right">Final</span>
        <span className="text-right">Semis</span>
      </div>

      <ol>
        {visible.map((row, index) => (
          <li
            key={row.name}
            className="grid grid-cols-[2.2rem_1fr_minmax(5rem,2fr)_4.5rem] items-center gap-3 border-b border-[var(--border-color)] px-5 py-2.5 last:border-b-0 sm:grid-cols-[2.2rem_1fr_minmax(7rem,2fr)_4.5rem_4.5rem]"
          >
            <span className="font-mono text-small font-bold tabular-nums text-[var(--text-tertiary)]">
              {index + 1}
            </span>
            <span className="flex min-w-0 items-center gap-2.5">
              <TeamBadge teamId={row.teamId} name={row.name} size={24} />
              <span className="truncate text-small font-semibold text-[var(--text-primary)]">
                {row.name}
              </span>
              {row.group ? (
                <Link
                  href={`/world-cup/groups/${row.group}`}
                  className="rounded bg-[var(--muted-bg)] px-1.5 py-0.5 font-mono text-[10px] uppercase text-[var(--text-tertiary)] hover:text-[var(--accent-primary)]"
                >
                  {row.group}
                </Link>
              ) : null}
            </span>
            <span className="flex items-center gap-2">
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--muted-bg)]">
                <motion.span
                  className="block h-full rounded-full"
                  style={{
                    background:
                      'linear-gradient(90deg, var(--accent-ai), var(--accent-primary))',
                  }}
                  initial={{ width: 0 }}
                  whileInView={{ width: `${(row.pChampion / maxChampion) * 100}%` }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.7, delay: index * 0.04, ease: 'easeOut' }}
                />
              </span>
              <span className="w-12 text-right font-mono text-small font-bold tabular-nums text-[var(--text-primary)]">
                {pct(row.pChampion)}
              </span>
            </span>
            <span className="hidden text-right font-mono text-small tabular-nums text-[var(--text-secondary)] sm:block">
              {pct(row.pFinal)}
            </span>
            <span className="text-right font-mono text-small tabular-nums text-[var(--text-secondary)]">
              {pct(row.pSemi)}
            </span>
          </li>
        ))}
      </ol>

      <footer className="px-5 py-3 text-caption leading-relaxed text-[var(--text-tertiary)]">
        Simulated tournament runs over the official 2026 bracket
        {bracketSet
          ? ', knockout entrants confirmed'
          : ' — group outcomes projected from current standings and remaining fixtures; best-third qualifiers approximated by team strength'}
        . Strength ratings derive from World Cup, Euro, and Copa América results since 1998.
      </footer>
    </section>
  )
}

export default WinnerProjectionsBoard
