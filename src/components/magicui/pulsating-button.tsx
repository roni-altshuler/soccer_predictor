'use client'

import type { ComponentPropsWithoutRef, CSSProperties } from 'react'

import { cn } from '@/lib/utils'

interface PulsatingButtonProps extends ComponentPropsWithoutRef<'button'> {
  pulseColor?: string
  duration?: string
}

/**
 * Button with a pulsating ring expanding outward. Used for LIVE / NOW pills
 * and primary calls-to-action.
 */
export function PulsatingButton({
  className,
  children,
  pulseColor = 'var(--accent-loss)',
  duration = '1.5s',
  style,
  ...props
}: PulsatingButtonProps) {
  return (
    <button
      {...props}
      className={cn(
        'relative inline-flex cursor-pointer items-center justify-center',
        'rounded-full px-3 py-1 text-caption font-mono uppercase tracking-[0.18em] text-white',
        '[background:var(--pulse-bg,var(--accent-loss))]',
        className
      )}
      style={
        {
          '--pulse-color': pulseColor,
          '--pulse-bg': pulseColor,
          '--duration': duration,
          ...style,
        } as CSSProperties
      }
    >
      <span className="relative z-10">{children}</span>
      <span className="absolute left-1/2 top-1/2 size-full -translate-x-1/2 -translate-y-1/2 animate-pulse-ring rounded-full bg-[var(--pulse-color)] opacity-30" />
    </button>
  )
}
