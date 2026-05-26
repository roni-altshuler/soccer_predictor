'use client'

import type { ComponentPropsWithoutRef } from 'react'

import { cn } from '@/lib/utils'

interface MarqueeProps extends ComponentPropsWithoutRef<'div'> {
  pauseOnHover?: boolean
  vertical?: boolean
  repeat?: number
  reverse?: boolean
}

/**
 * Infinite seamless marquee using a duplicated child and a CSS keyframe.
 * Animation keyframes (`marquee`, `marquee-vertical`) live in tailwind.config.js.
 */
export function Marquee({
  className,
  reverse,
  pauseOnHover = false,
  children,
  vertical = false,
  repeat = 4,
  ...props
}: MarqueeProps) {
  return (
    <div
      {...props}
      className={cn(
        'group flex overflow-hidden p-2 [--duration:40s] [--gap:1rem] [gap:var(--gap)]',
        vertical ? 'flex-col' : 'flex-row',
        className
      )}
    >
      {Array.from({ length: repeat }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'flex shrink-0 justify-around [gap:var(--gap)]',
            vertical ? 'animate-marquee-vertical flex-col' : 'animate-marquee flex-row',
            pauseOnHover && 'group-hover:[animation-play-state:paused]',
            reverse && '[animation-direction:reverse]'
          )}
        >
          {children}
        </div>
      ))}
    </div>
  )
}
