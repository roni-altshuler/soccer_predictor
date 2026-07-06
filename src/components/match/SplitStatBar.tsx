'use client'

import { motion, useReducedMotion } from 'framer-motion'

import { cn } from '@/lib/utils'

/**
 * FotMob-grammar centred stat duel — one row per stat:
 *
 *   62%              POSSESSION              38%
 *   [░░░░░░████████████│████████░░░░░░░░░░░░░]
 *                  (bars meet in the middle)
 *
 * The home bar grows leftward from the centre line, the away bar grows
 * rightward; each side's length is its share of the pair. The leading side
 * renders saturated in its team colour, the trailing side muted. Used on the
 * match-detail Stats tab and anywhere a numeric pair would otherwise read
 * as a plain `45 — 17`.
 *
 * Width animation respects reduced motion. When both values are zero the
 * row renders empty hairline tracks (no fabricated 50/50 split).
 */

export interface SplitStatBarProps {
  label: string
  /** Raw home-side value. Renders on the left of the label. */
  homeValue: number
  /** Raw away-side value. */
  awayValue: number
  /** Optional formatter (e.g. `(v) => `${v}%``). Defaults to integer. */
  format?: (value: number) => string
  /** Highlight which side is "winning" — saturates the leader, mutes the loser. */
  highlightLeader?: boolean
  /** For stats where the smaller number is the better one (fouls). */
  lowerIsBetter?: boolean
  homeAccent?: string
  awayAccent?: string
  className?: string
}

const DEFAULT_HOME = 'var(--team-tint-home, var(--accent-primary))'
const DEFAULT_AWAY = 'var(--team-tint-away, var(--accent-info))'

function defaultFormat(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

export function SplitStatBar({
  label,
  homeValue,
  awayValue,
  format = defaultFormat,
  highlightLeader = true,
  lowerIsBetter = false,
  homeAccent = DEFAULT_HOME,
  awayAccent = DEFAULT_AWAY,
  className,
}: SplitStatBarProps) {
  const reduceMotion = useReducedMotion()
  const total = homeValue + awayValue
  const homeShare = total > 0 ? (homeValue / total) * 100 : 0
  const awayShare = total > 0 ? (awayValue / total) * 100 : 0

  const homeLeads = lowerIsBetter ? homeValue < awayValue : homeValue > awayValue
  const awayLeads = lowerIsBetter ? awayValue < homeValue : awayValue > homeValue

  const mute = (accent: string) => `color-mix(in srgb, ${accent} 32%, transparent)`
  const homeFill = !highlightLeader || homeLeads || !awayLeads ? homeAccent : mute(homeAccent)
  const awayFill = !highlightLeader || awayLeads || !homeLeads ? awayAccent : mute(awayAccent)

  const transition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const }

  return (
    <div className={cn('w-full', className)}>
      <div className="mb-1 grid grid-cols-[1fr_auto_1fr] items-baseline gap-2">
        <span
          className={cn(
            'text-sm font-semibold tabular-nums',
            highlightLeader && !homeLeads && awayLeads
              ? 'text-[var(--text-tertiary)]'
              : 'text-[var(--text-primary)]'
          )}
        >
          {format(homeValue)}
        </span>
        <span className="text-center text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
          {label}
        </span>
        <span
          className={cn(
            'text-right text-sm font-semibold tabular-nums',
            highlightLeader && !awayLeads && homeLeads
              ? 'text-[var(--text-tertiary)]'
              : 'text-[var(--text-primary)]'
          )}
        >
          {format(awayValue)}
        </span>
      </div>
      {/* Two half-tracks meeting at the centre line; fills grow outward→inward. */}
      <div className="grid grid-cols-2 gap-[3px]" aria-hidden="true">
        <div className="flex h-[6px] justify-end overflow-hidden rounded-full bg-[var(--muted-bg)]">
          <motion.span
            className="block h-full rounded-full"
            style={{ background: homeFill }}
            initial={reduceMotion ? false : { width: 0 }}
            animate={{ width: `${homeShare}%` }}
            transition={transition}
          />
        </div>
        <div className="flex h-[6px] justify-start overflow-hidden rounded-full bg-[var(--muted-bg)]">
          <motion.span
            className="block h-full rounded-full"
            style={{ background: awayFill }}
            initial={reduceMotion ? false : { width: 0 }}
            animate={{ width: `${awayShare}%` }}
            transition={transition}
          />
        </div>
      </div>
    </div>
  )
}
