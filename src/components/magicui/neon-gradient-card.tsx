'use client'

import type { CSSProperties, ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface NeonGradientCardProps {
  borderSize?: number
  borderRadius?: number
  neonColors?: { firstColor: string; secondColor: string }
  className?: string
  children?: ReactNode
}

/**
 * Card with a soft glowing gradient border. Use sparingly (once per page max)
 * for hero/marquee surfaces — e.g. the live featured match card.
 */
export function NeonGradientCard({
  borderSize = 2,
  borderRadius = 12,
  neonColors = { firstColor: 'var(--accent-primary)', secondColor: 'var(--accent-ai)' },
  className,
  children,
}: NeonGradientCardProps) {
  return (
    <div
      className={cn('relative z-10 w-full', className)}
      style={
        {
          '--border-size': `${borderSize}px`,
          '--border-radius': `${borderRadius}px`,
          '--neon-first-color': neonColors.firstColor,
          '--neon-second-color': neonColors.secondColor,
        } as CSSProperties
      }
    >
      <div
        className="relative h-full w-full overflow-hidden p-[var(--border-size)] rounded-[var(--border-radius)]"
        style={{
          background:
            'linear-gradient(0deg, var(--neon-first-color), var(--neon-second-color))',
          backgroundSize: '200% 200%',
          animation: 'neon-pulse 6s ease infinite',
        }}
      >
        <div className="relative z-10 h-full w-full bg-[var(--card-bg)] rounded-[calc(var(--border-radius)-1px)]">
          {children}
        </div>
      </div>
      <div
        className="pointer-events-none absolute -inset-2 -z-10 rounded-[var(--border-radius)] opacity-40 blur-2xl"
        style={{
          background:
            'linear-gradient(0deg, var(--neon-first-color), var(--neon-second-color))',
        }}
      />
    </div>
  )
}
