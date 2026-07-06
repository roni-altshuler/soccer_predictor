'use client'

import { motion, useReducedMotion } from 'framer-motion'
import type { CSSProperties } from 'react'

import { EASE_OUT } from '@/lib/motion'
import { cn } from '@/lib/utils'

interface ClubColorBarProps {
  /** Club brand colour — hex from the club manifest or a `var(--*)` token. */
  color: string
  /** Team name, exposed as a data attribute for debugging/QA. */
  team?: string
  orientation?: 'vertical' | 'horizontal'
  size?: 'sm' | 'md' | 'lg'
  /** `draw` scales the bar in on mount; `none` renders it statically. */
  animate?: 'draw' | 'none'
  className?: string
  style?: CSSProperties
}

const SIZE: Record<NonNullable<ClubColorBarProps['size']>, { short: string; long: string }> = {
  sm: { short: 'w-1', long: 'h-4' },
  md: { short: 'w-1.5', long: 'h-8' },
  lg: { short: 'w-2.5', long: 'h-12' },
}

/**
 * Thin flat club-colour identity bar.
 *
 * Soccer usage: the vertical brand sliver next to a team name in H2H panels,
 * squad lists, or team headers — the same grammar as the `--team-tint-*`
 * left-edge bars but as a standalone primitive. Flat solid fill only (no
 * glow/gradient variants — Matchday v3.1 forbids them). Optional `draw`
 * animation scales the bar in on mount and is skipped entirely under
 * reduced motion. Decorative: always `aria-hidden`.
 */
export function ClubColorBar({
  color,
  team,
  orientation = 'vertical',
  size = 'md',
  animate = 'none',
  className,
  style,
}: ClubColorBarProps) {
  const reduced = useReducedMotion()
  const sz = SIZE[size]
  const shortSide = orientation === 'vertical' ? sz.short : sz.long.replace('h-', 'w-')
  const longSide = orientation === 'vertical' ? sz.long : sz.short.replace('w-', 'h-')
  const draw = animate === 'draw' && !reduced

  return (
    <motion.span
      aria-hidden
      data-team={team}
      className={cn('inline-block shrink-0 rounded-full', shortSide, longSide, className)}
      style={{
        background: color,
        transformOrigin: orientation === 'vertical' ? 'top center' : 'left center',
        '--club-color': color,
        ...style,
      } as CSSProperties}
      initial={draw ? (orientation === 'vertical' ? { scaleY: 0 } : { scaleX: 0 }) : false}
      animate={draw ? { scaleY: 1, scaleX: 1 } : undefined}
      transition={{ duration: 0.45, ease: EASE_OUT }}
    />
  )
}

export default ClubColorBar
