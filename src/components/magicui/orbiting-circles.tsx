'use client'

import type { CSSProperties, ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface OrbitingCirclesProps {
  className?: string
  children?: ReactNode
  reverse?: boolean
  duration?: number
  delay?: number
  radius?: number
  pathColor?: string | null
  pathWidth?: number
}

/**
 * Single orbiting element wrapped in an SVG-stroked circular path.
 * Multiple instances share a parent to compose a constellation.
 */
export function OrbitingCircles({
  className,
  children,
  reverse,
  duration = 20,
  delay = 0,
  radius = 160,
  pathColor = 'color-mix(in srgb, var(--text-tertiary) 25%, transparent)',
  pathWidth = 1,
}: OrbitingCirclesProps) {
  return (
    <>
      {pathColor !== null ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          version="1.1"
          className="pointer-events-none absolute inset-0 size-full"
          aria-hidden
        >
          <circle
            className="stroke-1"
            cx="50%"
            cy="50%"
            r={radius}
            fill="none"
            stroke={pathColor}
            strokeWidth={pathWidth}
          />
        </svg>
      ) : null}

      <div
        style={
          {
            '--duration': `${duration}`,
            '--radius': radius,
            '--delay': `-${delay}s`,
          } as CSSProperties
        }
        className={cn(
          'absolute left-1/2 top-1/2 flex h-full w-full transform-gpu items-center justify-center [animation-delay:var(--delay)] animate-orbit',
          { '[animation-direction:reverse]': reverse },
          className
        )}
      >
        <div
          className="flex items-center justify-center"
          style={{ transform: `translateX(${radius}px)` }}
        >
          {children}
        </div>
      </div>
    </>
  )
}
