'use client'

import { motion } from 'framer-motion'

import { cn } from '@/lib/utils'

/**
 * Horizontal two-segment bar for "home vs away" stats — possession,
 * shots on target, corners, xG, anywhere you need to render a value
 * pair in proportion. FotMob uses these throughout their stats tab;
 * we reuse the primitive on the match-detail Stats tab and anywhere
 * else a numeric pair would otherwise read as a plain `45 — 17`.
 *
 *   ┌──── HOME ─────────────────────┬─── AWAY ────┐
 *   │ Possession                                  │
 *   │ ████████████████████░░░░░░░░░░░░░░░░░░░░░░ │
 *   │ 62%                                     38% │
 *   └─────────────────────────────────────────────┘
 *
 * The bar animates in on mount via framer-motion. When both values
 * are zero, renders a neutral 50/50 split so the row doesn't collapse.
 */

export interface SplitStatBarProps {
  label: string
  /** Raw home-side value. Renders next to the home team label. */
  homeValue: number
  /** Raw away-side value. */
  awayValue: number
  /** Optional formatter (e.g. `(v) => `${v}%``). Defaults to integer. */
  format?: (value: number) => string
  /** Highlight which side is "winning" — colours the larger segment. */
  highlightLeader?: boolean
  homeAccent?: string
  awayAccent?: string
  className?: string
}

const DEFAULT_HOME = 'var(--accent-primary)'
const DEFAULT_AWAY = 'var(--accent-loss)'

function defaultFormat(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

export function SplitStatBar({
  label,
  homeValue,
  awayValue,
  format = defaultFormat,
  highlightLeader = true,
  homeAccent = DEFAULT_HOME,
  awayAccent = DEFAULT_AWAY,
  className,
}: SplitStatBarProps) {
  const total = homeValue + awayValue
  const homePct = total > 0 ? (homeValue / total) * 100 : 50
  const awayPct = total > 0 ? (awayValue / total) * 100 : 50

  const homeWins = homeValue > awayValue
  const awayWins = awayValue > homeValue

  const homeColour = highlightLeader && awayWins ? 'var(--text-tertiary)' : homeAccent
  const awayColour = highlightLeader && homeWins ? 'var(--text-tertiary)' : awayAccent

  return (
    <div className={cn('w-full', className)}>
      <div className="mb-1 flex items-center justify-between">
        <span
          className={cn(
            'text-sm font-semibold tabular-nums',
            highlightLeader && homeWins ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
          )}
        >
          {format(homeValue)}
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
          {label}
        </span>
        <span
          className={cn(
            'text-sm font-semibold tabular-nums',
            highlightLeader && awayWins ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
          )}
        >
          {format(awayValue)}
        </span>
      </div>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-[var(--surface-muted)]/30">
        <motion.span
          className="block h-full"
          style={{ background: homeColour }}
          initial={{ width: 0 }}
          animate={{ width: `${homePct}%` }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        />
        <motion.span
          className="block h-full"
          style={{ background: awayColour }}
          initial={{ width: 0 }}
          animate={{ width: `${awayPct}%` }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </div>
  )
}
