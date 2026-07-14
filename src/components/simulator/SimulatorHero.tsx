'use client'

import type { ReactNode } from 'react'

import { AnimatedNumber, ClubColorBar } from '@/components/motion'
import { MetaChip } from '@/components/primitives'
import type { LucideIcon } from 'lucide-react'

interface HeroChip {
  icon?: LucideIcon
  label: string
}

interface SimulatorHeroProps {
  /** Kicker above the team name ("Most likely champion"). */
  kicker: string
  teamName: string
  /** Winner probability, 0–1 — rendered as an animated headline %. */
  probability: number
  /** Crest / flag node (TeamBadge, FlagBadge…), sized ~56–64px. */
  badge: ReactNode
  /** Club brand colour for the identity sliver; falls back to the accent. */
  color?: string
  chips?: HeroChip[]
  className?: string
}

/**
 * SimulatorHero — the payoff card at the top of a simulation result: crest,
 * "most likely champion" kicker, team name, an animated probability
 * headline, a club-colour sliver, and compact meta chips. Flat Matchday
 * card; no gradients or glow.
 */
export function SimulatorHero({
  kicker,
  teamName,
  probability,
  badge,
  color,
  chips = [],
  className,
}: SimulatorHeroProps) {
  return (
    <div
      className={`flex items-center gap-4 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 md:p-5 ${className ?? ''}`}
    >
      <ClubColorBar
        color={color ?? 'var(--accent-primary)'}
        team={teamName}
        size="lg"
        animate="draw"
      />
      <div className="shrink-0">{badge}</div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
          {kicker}
        </p>
        <h3 className="truncate text-xl font-bold leading-tight text-[var(--text-primary)] md:text-2xl">
          {teamName}
        </h3>
        {chips.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <MetaChip key={chip.label} icon={chip.icon} className="text-[12px]">
                {chip.label}
              </MetaChip>
            ))}
          </div>
        )}
      </div>
      <div className="shrink-0 text-right">
        <p className="text-3xl font-black leading-none text-[var(--accent-ai)] md:text-4xl">
          <AnimatedNumber
            value={probability * 100}
            decimals={probability * 100 < 10 ? 1 : 0}
            suffix="%"
            whenInView={false}
          />
        </p>
        <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">of simulations</p>
      </div>
    </div>
  )
}

export default SimulatorHero
