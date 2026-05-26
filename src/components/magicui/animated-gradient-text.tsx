'use client'

import type { ComponentPropsWithoutRef } from 'react'

import { cn } from '@/lib/utils'

interface AnimatedGradientTextProps extends ComponentPropsWithoutRef<'span'> {
  speed?: number
  colorFrom?: string
  colorTo?: string
}

/**
 * Animated linear gradient text. Uses background-clip:text and animates
 * the background position. Reduced-motion stops the animation but keeps
 * the gradient visible.
 */
export function AnimatedGradientText({
  speed = 8,
  colorFrom = 'var(--accent-primary)',
  colorTo = 'var(--accent-ai)',
  className,
  children,
  style,
  ...props
}: AnimatedGradientTextProps) {
  return (
    <span
      {...props}
      className={cn('inline-block bg-clip-text text-transparent animate-gradient', className)}
      style={{
        backgroundImage: `linear-gradient(90deg, ${colorFrom}, ${colorTo}, ${colorFrom})`,
        backgroundSize: '200% 100%',
        animationDuration: `${speed}s`,
        ...style,
      }}
    >
      {children}
    </span>
  )
}
