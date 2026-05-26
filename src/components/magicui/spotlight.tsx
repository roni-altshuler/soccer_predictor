'use client'

import { useCallback, useEffect, useRef, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface SpotlightProps {
  children?: ReactNode
  className?: string
  size?: number
  color?: string
}

/**
 * Cursor-following radial gradient spotlight. Reveals on hover of the parent group.
 */
export function Spotlight({
  children,
  className,
  size = 280,
  color = 'color-mix(in srgb, var(--accent-primary) 15%, transparent)',
}: SpotlightProps) {
  const ref = useRef<HTMLDivElement>(null)

  const handleMove = useCallback((e: MouseEvent) => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    el.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`)
    el.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`)
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.addEventListener('mousemove', handleMove)
    return () => el.removeEventListener('mousemove', handleMove)
  }, [handleMove])

  return (
    <div
      ref={ref}
      className={cn('group/spotlight relative overflow-hidden', className)}
      style={
        {
          '--spot-color': color,
          '--spot-size': `${size}px`,
        } as React.CSSProperties
      }
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover/spotlight:opacity-100"
        style={{
          background:
            'radial-gradient(var(--spot-size) circle at var(--mouse-x) var(--mouse-y), var(--spot-color), transparent 70%)',
        }}
        aria-hidden
      />
      {children}
    </div>
  )
}
